// publish-survey.mjs — one-command pipeline to publish a client survey.
//
// For each layer it: converts to COG, (NDVI) computes (NIR-Red)/(NIR+Red),
// bakes a color ramp, generates Web-Mercator XYZ tiles (gdal2tiles), uploads
// the COGs (archival, private bucket) + tiles (public CDN bucket), then creates
// the email-gated property_shares row and prints the share link.
//
// Requires GDAL (brew install gdal) + env: NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (optionally SITE_URL for the printed link).
//
// Usage:
//   set -a; source .env.local; set +a
//   node scripts/publish-survey.mjs scripts/survey.example.json   # use a config file
//   node scripts/publish-survey.mjs                                # interactive mode (prompts you)
//
// Config flags: "flight_date": "YYYY-MM-DD" is REQUIRED — each publish is a dated
//   flight stored under ${shareId}/${flight_date}; viewers switch between dates.
//   "upload_cogs": false skips archiving COGs (tiles only).
//   Re-flighting a property? Point at the EXISTING share to add a new dated flight
//   in place — keeps its link/token, ADDS this flight (previous flights remain),
//   and PRESERVES every drawn boundary (share_plots stay keyed to the same share).
//   Identify it any of three ways: "share_id": "<uuid>", "token": "<token>", or
//   "share_url": "https://.../share/<token>". Title/emails only change if also
//   present in the config. A given update target must already exist — the script
//   refuses to silently create a new share (which would orphan your boundaries).
//   "boundary": { "from_layer": "rgb" } clips NDVI/CHM to the (already-cropped)
//   RGB's footprint so all layers align and exclude neighbouring land; or
//   { "geojson": "/path/boundary.geojson" } clips every layer to that polygon.
//   "plant_count": <number> is shown on the client view while RGB is active.
//   "plant_points": { "orthomosaic_id": "<uuid>" } exports that ortho's plant
//   detections as per-plant dots (and sets the count from the actual rows).

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { tmpdir } from 'os'
import { createInterface } from 'readline/promises'

const SHARE_BUCKET = 'property-shares' // private: holds both COGs and tiles, gated by the share access token
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const DEFAULT_ZOOM = '13-23' // z23 ≈ 1.5 cm/px — captures typical 2 cm/px ortho detail
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COG_OPTS = ['-of', 'COG', '-co', 'COMPRESS=DEFLATE', '-co', 'BLOCKSIZE=512', '-co', 'OVERVIEW_RESAMPLING=AVERAGE', '-co', 'BIGTIFF=IF_SAFER']
const UPLOAD_CONCURRENCY = 24

// Color ramps (low -> high). RdYlGn for NDVI, green->brown for canopy height.
const RDYLGN = [[165, 0, 38], [215, 48, 39], [244, 109, 67], [253, 174, 97], [254, 224, 139], [255, 255, 191], [217, 239, 139], [166, 217, 106], [102, 189, 99], [26, 152, 80], [0, 104, 55]]
const TERRAIN = [[26, 93, 26], [74, 127, 74], [143, 188, 143], [222, 184, 135], [139, 69, 19]]
const DEFAULT_RANGE = { ndvi: [-0.1, 0.9], chm: [0, 5] }

const gdal = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const gdalOut = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })

function writeRamp(path, stops, min, max) {
  const n = stops.length - 1
  const lines = ['nv 0 0 0 0']
  for (let i = 0; i <= n; i++) {
    const v = min + (max - min) * (i / n)
    const [r, g, b] = stops[i]
    lines.push(`${v.toFixed(4)} ${r} ${g} ${b}`)
  }
  writeFileSync(path, lines.join('\n') + '\n')
}

function bandCount(path) {
  const info = JSON.parse(gdalOut('gdalinfo', ['-json', path]))
  return info.bands?.length ?? 0
}

function boundsFromCog(cogPath) {
  const info = JSON.parse(gdalOut('gdalinfo', ['-json', cogPath]))
  const ring = info.wgs84Extent.coordinates[0]
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) }
}

function unionBounds(list) {
  return {
    north: Math.max(...list.map((b) => b.north)),
    south: Math.min(...list.map((b) => b.south)),
    east: Math.max(...list.map((b) => b.east)),
    west: Math.min(...list.map((b) => b.west)),
  }
}

function normalizeEmails(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/)
  return Array.from(new Set(raw.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@'))))
}

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.webp')) out.push(p)
  }
  return out
}

// Recursively remove a flight's tile subtree (used when re-tiling the same date).
async function deleteTiles(supabase, flightPrefix) {
  const listAll = async (prefix) => {
    const out = []
    let offset = 0
    for (;;) {
      const { data } = await supabase.storage.from(SHARE_BUCKET).list(prefix, { limit: 1000, offset })
      if (!data || data.length === 0) break
      for (const e of data) {
        const full = `${prefix}/${e.name}`
        if (e.id === null) out.push(...(await listAll(full)))
        else out.push(full)
      }
      if (data.length < 1000) break
      offset += data.length
    }
    return out
  }
  const paths = await listAll(`${flightPrefix}/tiles`)
  for (let i = 0; i < paths.length; i += 1000) {
    await supabase.storage.from(SHARE_BUCKET).remove(paths.slice(i, i + 1000))
  }
  return paths.length
}

// Storage uploads occasionally get a transient HTML error page (gateway/rate
// limit) instead of JSON — retry with backoff so one blip doesn't abort a job
// that's minutes deep. Supabase upload() can either return {error} or throw
// (e.g. the JSON-parse error on an HTML body), so handle both.
async function withRetry(fn, label, tries = 5) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const { error } = (await fn()) || {}
      if (!error) return
      lastErr = error
    } catch (e) {
      lastErr = e
    }
    if (i < tries - 1) {
      const wait = 800 * 2 ** i
      process.stdout.write(`\n    retry ${label} ${i + 1}/${tries - 1} in ${wait}ms (${String(lastErr?.message || lastErr).slice(0, 70)})\n`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw new Error(`${label}: ${lastErr?.message || lastErr}`)
}

// Pull every AI/manual plant point for an ortho (paged past the 1000-row cap)
// as compact [lat, lng] pairs (6 decimals ≈ 0.1 m) for the client map to dot.
async function fetchPlantPoints(supabase, orthoId) {
  const pts = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('plant_labels')
      .select('latitude, longitude')
      .eq('orthomosaic_id', orthoId)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`fetch plant points: ${error.message}`)
    if (!data?.length) break
    for (const r of data) {
      if (typeof r.latitude === 'number' && typeof r.longitude === 'number') {
        pts.push([Math.round(r.latitude * 1e6) / 1e6, Math.round(r.longitude * 1e6) / 1e6])
      }
    }
    if (data.length < PAGE) break
  }
  return pts
}

async function uploadCog(supabase, dest, file) {
  const body = readFileSync(file)
  await withRetry(() => supabase.storage.from(SHARE_BUCKET).upload(dest, body, { contentType: 'image/tiff', upsert: true }), `COG upload ${dest}`)
}

async function uploadTileDir(supabase, tileDir, destPrefix) {
  const files = walk(tileDir)
  for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
    const batch = files.slice(i, i + UPLOAD_CONCURRENCY)
    await Promise.all(batch.map(async (file) => {
      const dest = `${destPrefix}/${relative(tileDir, file)}`
      await withRetry(() => supabase.storage.from(SHARE_BUCKET).upload(dest, readFileSync(file), { contentType: 'image/webp', upsert: true }), `tile ${dest}`)
    }))
    process.stdout.write(`\r    tiles ${Math.min(i + UPLOAD_CONCURRENCY, files.length)}/${files.length}`)
  }
  process.stdout.write('\n')
  return files.length
}

// Strip drag-and-drop decorations from a pasted Terminal path:
//   /Users/.../North\ Field.tif   ->   /Users/.../North Field.tif
//   '/Users/.../North Field.tif'  ->   /Users/.../North Field.tif
function cleanPath(p) {
  return p.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ')
}

function slugify(s) {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) ||
    'survey'
  )
}

// Pull the share token out of a /share/<token> URL, or return the bare token.
function extractToken(s) {
  const m = String(s).match(/\/share\/([^/?#\s]+)/)
  return (m ? m[1] : String(s)).trim()
}

// Resolve a re-flight update target (a UUID, a token, or a full share URL) to
// the actual { id, token } row. Returns null if nothing matches. Updating a
// missing target would orphan the property's drawn boundaries, so callers must
// treat null as a hard error rather than falling back to creating a new share.
async function resolveExistingShare(supabase, raw) {
  const val = String(raw || '').trim()
  if (!val) return null
  const col = UUID_RE.test(val) ? 'id' : 'token'
  const lookup = col === 'id' ? val : extractToken(val)
  const { data, error } = await supabase
    .from('property_shares')
    .select('id, token')
    .eq(col, lookup)
    .maybeSingle()
  if (error) throw new Error(`Looking up share by ${col}: ${error.message}`)
  return data || null
}

// Interactive setup: prompts for everything, writes a scripts/<slug>.json config,
// and returns the path so the rest of the pipeline can read it back.
async function interactiveSetup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = async (q, def = '') => {
    const v = await rl.question(def ? `${q} [${def}]: ` : `${q}: `)
    return v.trim() || def
  }
  const askPath = async (q) => {
    const v = (await ask(q)).trim()
    return v ? cleanPath(v) : ''
  }

  console.log('\nInteractive publish — I\'ll ask a few questions then run the pipeline.\n')
  console.log('Tip: drag a .tif from Finder into Terminal to paste its full path.\n')

  const updateRef = (await ask('Re-flighting a property? Paste its share link, token, or share_id (blank for a new share)')).trim()
  const isUpdate = !!updateRef

  const title = isUpdate
    ? await ask('Title (blank to keep existing)')
    : await ask('Title (required)')
  if (!isUpdate && !title) throw new Error('Title is required for a new share')

  const client_name = await ask('Client name (blank to skip)')
  const emails = isUpdate
    ? await ask('Authorized emails, comma-separated (blank to keep existing)')
    : await ask('Authorized emails, comma-separated (required)')
  if (!isUpdate && !emails) throw new Error('At least one authorized email is required')

  const expires_at = await ask('Expires YYYY-MM-DD (blank for none)')
  const flight_date = await ask('Flight date YYYY-MM-DD (the date this orthophoto was flown)')

  const layers = {}
  const rgb = await askPath('RGB .tif (blank to skip)')
  if (rgb) layers.rgb = { input: rgb }

  const ndvi = await askPath('NDVI source .tif with NIR+R bands (blank to skip)')
  if (ndvi) {
    const nir_band = Number(await ask('  NIR band number', '2'))
    const red_band = Number(await ask('  Red band number', '1'))
    const alphaStr = (await ask('  Alpha band number (blank if none)', '3')).trim()
    const value_min = Number(await ask('  NDVI legend min', '-0.1'))
    const value_max = Number(await ask('  NDVI legend max', '0.9'))
    layers.ndvi = { input: ndvi, nir_band, red_band, value_min, value_max }
    if (alphaStr) layers.ndvi.alpha_band = Number(alphaStr)
  }

  const chm = await askPath('Canopy height (CHM) .tif (blank to skip)')
  if (chm) {
    const value_min = Number(await ask('  CHM legend min (m)', '0'))
    const value_max = Number(await ask('  CHM legend max (m)', '5'))
    layers.chm = { input: chm, value_min, value_max }
  }

  if (Object.keys(layers).length === 0) throw new Error('You need at least one layer (RGB, NDVI, or CHM)')

  let boundary
  if (layers.rgb && (layers.ndvi || layers.chm)) {
    const clipAns = await ask('Clip NDVI/CHM to the RGB boundary? (use this when your RGB is already cropped) (y/n)', 'y')
    if (!clipAns.toLowerCase().startsWith('n')) boundary = { from_layer: 'rgb' }
  }
  if (!boundary) {
    const gj = await askPath('Boundary GeoJSON to clip all layers to (blank for none)')
    if (gj) boundary = { geojson: gj }
  }

  const countStr = (await ask('Plant count to display on RGB (blank to skip)')).trim()
  const plant_count = countStr ? Number(countStr.replace(/[^0-9]/g, '')) : null

  const zoom = await ask('Zoom range', DEFAULT_ZOOM)
  const uploadCogsAns = await ask('Archive COGs to private storage? (y/n)', 'y')
  rl.close()

  const cfg = {}
  if (updateRef) {
    // Store as share_id when it's a UUID, otherwise as a token (URLs are reduced
    // to their token) — main() resolves any of the three back to the share row.
    if (UUID_RE.test(updateRef)) cfg.share_id = updateRef
    else cfg.token = extractToken(updateRef)
  }
  if (title) cfg.title = title
  if (client_name) cfg.client_name = client_name
  if (emails) cfg.allowed_emails = emails
  if (flight_date) cfg.flight_date = flight_date
  cfg.expires_at = expires_at || null
  cfg.zoom = zoom
  cfg.upload_cogs = !uploadCogsAns.toLowerCase().startsWith('n')
  if (boundary) cfg.boundary = boundary
  if (typeof plant_count === 'number' && !Number.isNaN(plant_count)) cfg.plant_count = plant_count
  cfg.layers = layers

  const base = title ? slugify(title) : `update-${(cfg.share_id || cfg.token || 'share').slice(0, 8)}`
  let outPath = join(process.cwd(), 'scripts', `${base}.json`)
  if (existsSync(outPath)) {
    outPath = join(process.cwd(), 'scripts', `${base}-${Date.now()}.json`)
  }
  writeFileSync(outPath, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`\n📝 Wrote config: ${outPath}`)
  console.log('   (you can re-run with `node scripts/publish-survey.mjs ' + relative(process.cwd(), outPath) + '`)\n')

  return outPath
}

async function main() {
  let configPath = process.argv[2]
  if (!configPath) configPath = await interactiveSetup()
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
  const supabase = createClient(url, key)

  // Re-flight? Resolve the existing share by id, token, or share URL. If the
  // config names a target but it can't be found, stop — updating a phantom row
  // would orphan this property's drawn boundaries.
  const updateRef = cfg.share_id || cfg.token || cfg.share_url
  let existingShare = null
  if (updateRef) {
    existingShare = await resolveExistingShare(supabase, updateRef)
    if (!existingShare) {
      throw new Error(
        `Update target not found: "${updateRef}".\n` +
          `   Re-check the share_id / token / share_url, or remove it from the config to publish a brand-new share.`
      )
    }
  }
  const isUpdate = !!existingShare
  if (!isUpdate && !cfg.title) throw new Error('config.title is required for a new share')

  const shareId = isUpdate ? existingShare.id : randomUUID()

  // Each publish is a dated flight stored under ${shareId}/${flightKey}. Multiple
  // flights accumulate per parcel so viewers can switch between dates.
  const flightDate = String(cfg.flight_date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) {
    throw new Error('config.flight_date is required, formatted YYYY-MM-DD (the date this orthophoto was flown)')
  }
  const flightKey = flightDate
  const flightPrefix = `${shareId}/${flightKey}`

  const zoom = cfg.zoom || DEFAULT_ZOOM
  const uploadCogs = cfg.upload_cogs !== false
  const work = mkdtempSync(join(tmpdir(), 'plnt-survey-'))
  mkdirSync(join(work, 'tiles')) // gdal2tiles (GDAL 3.13) only creates the leaf dir, not parents
  console.log(`${isUpdate ? 'Updating' : 'Publishing'} share ${shareId} — flight ${flightKey}\nWork dir: ${work}\n`)

  // Reassure (and audit) that re-flighting keeps the boundaries drawn so far.
  if (isUpdate) {
    const { count, error } = await supabase
      .from('share_plots')
      .select('id', { count: 'exact', head: true })
      .eq('share_id', shareId)
    if (!error) {
      const n = count ?? 0
      console.log(`🔒 Update in place — preserving ${n} drawn boundar${n === 1 ? 'y' : 'ies'} across this flight.\n`)
    }
  }

  // ---- Resolve the (optional) property-boundary cutline ----
  // Clips every layer to the same polygon so the client never sees neighbouring
  // land — and so RGB and NDVI line up exactly. Two ways to supply it:
  //   "boundary": { "geojson": "/path/to/boundary.geojson" }  -> clip ALL layers
  //   "boundary": { "from_layer": "rgb" }                      -> derive the polygon
  //       from that layer's already-cropped input (gdal_footprint on its alpha),
  //       then clip the OTHER layers to it (the source layer is left as-is).
  let cutlinePath = null
  let cutlineSkip = null // a layer that's already cropped -> don't re-clip it
  const bcfg = cfg.boundary
  if (bcfg?.geojson) {
    cutlinePath = cleanPath(bcfg.geojson)
    if (!existsSync(cutlinePath)) throw new Error(`boundary.geojson not found: ${cutlinePath}`)
    console.log(`Boundary cutline: ${cutlinePath} (clipping all layers)\n`)
  } else if (bcfg?.from_layer) {
    const src = cfg.layers?.[bcfg.from_layer]?.input
    if (!src) throw new Error(`boundary.from_layer "${bcfg.from_layer}" has no matching layer input`)
    cutlinePath = join(work, 'boundary.geojson')
    cutlineSkip = bcfg.from_layer
    console.log(`=== deriving boundary footprint from ${bcfg.from_layer} (gdal_footprint) ===`)
    gdal('gdal_footprint', ['-t_srs', 'EPSG:4326', '-of', 'GeoJSON', '-overwrite', cleanPath(src), cutlinePath])
    console.log('')
  }

  // Clip a layer's input GeoTIFF to the boundary, returning the path to use
  // downstream. Outside-boundary must become transparent/masked:
  //   - RGB/CHM: add a fresh alpha band (-dstalpha).
  //   - precomputed (single-band) NDVI: fill outside with NoData -9999 (the
  //     color ramp's "nv" entry maps that to transparent).
  //   - raw multi-band NDVI: already carries an alpha band, so -crop_to_cutline
  //     zeroing it outside the polygon is enough (the NDVI calc masks on it).
  const clipToBoundary = (type, input, precomputedNdvi) => {
    if (!cutlinePath || type === cutlineSkip) return input
    const clipped = join(work, `${type}_clipped.tif`)
    let extra
    if (type === 'ndvi') extra = precomputedNdvi ? ['-dstnodata', '-9999'] : []
    else extra = ['-dstalpha']
    console.log(`=== ${type}: clipping to boundary ===`)
    gdal('gdalwarp', ['-cutline', cutlinePath, '-crop_to_cutline', ...extra,
      '-of', 'GTiff', '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', '-co', 'BIGTIFF=IF_SAFER',
      '-overwrite', input, clipped])
    return clipped
  }

  // ---- Phase 1: process all layers locally (fails fast before any upload) ----
  const processed = [] // { type, cogPath, tileDir, bounds, value_min, value_max }
  for (const type of ['rgb', 'ndvi', 'chm']) {
    const lc = cfg.layers?.[type]
    if (!lc?.input) continue
    console.log(`=== ${type}: processing ===`)
    const cog = join(work, `${type}_cog.tif`)
    // A single-band NDVI input is already-computed NDVI — color-ramp it directly
    // rather than deriving it from NIR/Red bands.
    const precomputedNdvi = type === 'ndvi' && (lc.precomputed === true || bandCount(lc.input) === 1)
    const input = clipToBoundary(type, lc.input, precomputedNdvi)
    let tileSource

    if (type === 'rgb') {
      gdal('gdal_translate', [input, cog, ...COG_OPTS])
      tileSource = cog
    } else {
      const [dmin, dmax] = DEFAULT_RANGE[type]
      const vmin = lc.value_min ?? dmin
      const vmax = lc.value_max ?? dmax

      if (type === 'ndvi' && !precomputedNdvi) {
        const nir = lc.nir_band ?? 1
        const red = lc.red_band ?? 2
        const alpha = lc.alpha_band
        const raw = join(work, 'ndvi_raw.tif')
        const args = ['-A', input, `--A_band=${nir}`, '-B', input, `--B_band=${red}`]
        let calc
        if (alpha) {
          args.push('-C', input, `--C_band=${alpha}`)
          calc = 'numpy.where(C>0, numpy.clip((A.astype(numpy.float32)-B.astype(numpy.float32))/(A.astype(numpy.float32)+B.astype(numpy.float32)+1e-6),-1,1), -9999)'
        } else {
          calc = 'numpy.clip((A.astype(numpy.float32)-B.astype(numpy.float32))/(A.astype(numpy.float32)+B.astype(numpy.float32)+1e-6),-1,1)'
        }
        args.push(`--outfile=${raw}`, '--type=Float32', '--NoDataValue=-9999', `--calc=${calc}`, '--overwrite', '--quiet')
        gdal('gdal_calc.py', args)
        gdal('gdal_translate', [raw, cog, ...COG_OPTS])
      } else {
        // precomputed NDVI, or CHM: COG the (clipped) band directly.
        gdal('gdal_translate', [input, cog, ...COG_OPTS])
      }

      const ramp = join(work, `${type}_ramp.txt`)
      writeRamp(ramp, type === 'ndvi' ? RDYLGN : TERRAIN, vmin, vmax)
      tileSource = join(work, `${type}_rgba.tif`)
      gdal('gdaldem', ['color-relief', cog, ramp, tileSource, '-alpha'])
      lc._range = [vmin, vmax]
    }

    const bounds = boundsFromCog(cog)
    const tileDir = join(work, 'tiles', type)
    console.log(`=== ${type}: tiling (z ${zoom}, webp) ===`)
    // RGB: lossy webp (great for photographic imagery, small). NDVI/CHM: lossless
    // webp so the color-mapped boundaries stay crisp.
    const webpOpts = type === 'rgb' ? ['--webp-quality=90'] : ['--webp-lossless']
    gdal('gdal2tiles.py', ['--xyz', '-z', zoom, '-w', 'none', '--processes=4', '--tiledriver=WEBP', ...webpOpts, tileSource, tileDir])

    const entry = { type, cogPath: cog, tileDir, bounds }
    if (type !== 'rgb') {
      entry.value_min = lc._range[0]
      entry.value_max = lc._range[1]
    }
    processed.push(entry)
    console.log('')
  }

  if (processed.length === 0) throw new Error('No layers had an "input" path')

  // ---- Phase 2: upload (under this flight's prefix) ----
  // Clear any prior tiles for THIS flight date (re-tiling); other flights untouched.
  {
    const removed = await deleteTiles(supabase, flightPrefix)
    if (removed > 0) console.log(`cleared ${removed} existing tiles for flight ${flightKey}\n`)
  }
  const layers = []
  for (const p of processed) {
    console.log(`=== ${p.type}: uploading ===`)
    if (uploadCogs) {
      console.log('    COG...')
      await uploadCog(supabase, `${flightPrefix}/${p.type}_cog.tif`, p.cogPath)
    }
    await uploadTileDir(supabase, p.tileDir, `${flightPrefix}/tiles/${p.type}`)
    const topZoom = parseInt(String(zoom).split('-').pop(), 10) || 22
    const layer = { type: p.type, storage_path: `${flightPrefix}/${p.type}_cog.tif`, bounds: p.bounds, tiled: true, max_zoom: topZoom }
    if (p.type !== 'rgb') {
      layer.value_min = p.value_min
      layer.value_max = p.value_max
    }
    // The in-boundary plant count + per-plant dots ride on the RGB layer (the
    // client shows them only when RGB is the active layer — they're tied to the
    // photo). plant_points.orthomosaic_id exports the actual detections as dots
    // (and makes the count authoritative); otherwise a manual plant_count shows.
    if (p.type === 'rgb') {
      const orthoId = cfg.plant_points?.orthomosaic_id
      if (orthoId) {
        console.log('    fetching plant points...')
        const pts = await fetchPlantPoints(supabase, orthoId)
        const ptsPath = `${flightPrefix}/points.json`
        const body = Buffer.from(JSON.stringify(pts))
        await withRetry(() => supabase.storage.from(SHARE_BUCKET).upload(ptsPath, body, { contentType: 'application/json', upsert: true }), 'points.json upload')
        layer.points_path = ptsPath
        layer.plant_count = pts.length
        console.log(`    ${pts.length.toLocaleString()} plant points uploaded (${(body.length / 1e3).toFixed(0)} KB)`)
      } else if (typeof cfg.plant_count === 'number') {
        layer.plant_count = cfg.plant_count
      }
    }
    layers.push(layer)
  }

  // ---- Phase 3: create or update the share, merging this flight in ----
  const bounds = unionBounds(layers.map((l) => l.bounds))
  const flight = { key: flightKey, date: flightDate, bounds, layers }
  let token
  if (isUpdate) {
    // Merge: replace any flight with the same date, then keep newest-first. The
    // top-level layers/bounds mirror the newest flight.
    const { data: existing } = await supabase.from('property_shares').select('flights').eq('id', shareId).single()
    const prior = Array.isArray(existing?.flights) ? existing.flights : []
    const flights = prior
      .filter((f) => f.key !== flightKey)
      .concat(flight)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    const latest = flights[0]
    const update = { flights, layers: latest.layers, bounds: latest.bounds, updated_at: new Date().toISOString() }
    if (cfg.title) update.title = cfg.title
    if (cfg.client_name !== undefined) update.client_name = cfg.client_name || null
    if (cfg.allowed_emails) update.allowed_emails = normalizeEmails(cfg.allowed_emails)
    if (cfg.expires_at !== undefined) update.expires_at = cfg.expires_at || null
    const { error } = await supabase.from('property_shares').update(update).eq('id', shareId)
    if (error) throw new Error(`Update share: ${error.message}`)
    token = existingShare.token
    console.log(`\n   This parcel now has ${flights.length} flight${flights.length === 1 ? '' : 's'}: ${flights.map((f) => f.date).join(', ')}`)
  } else {
    token = randomBytes(24).toString('base64url')
    const { error } = await supabase.from('property_shares').insert({
      id: shareId,
      token,
      title: cfg.title,
      client_name: cfg.client_name || null,
      allowed_emails: normalizeEmails(cfg.allowed_emails),
      flights: [flight],
      layers,
      bounds,
      expires_at: cfg.expires_at || null,
    })
    if (error) throw new Error(`Insert share: ${error.message}`)
  }

  rmSync(work, { recursive: true, force: true })
  console.log(`\n✅ ${isUpdate ? 'Updated' : 'Published'} "${cfg.title || shareId}" — flight ${flightKey} (${layers.map((l) => l.type).join(', ')})`)
  console.log(`\n   Share link:  ${SITE_URL}/share/${token}\n`)
}

main().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
