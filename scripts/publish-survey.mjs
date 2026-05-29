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
// Config flags: "upload_cogs": false skips archiving COGs (tiles only).
//   "share_id": "<uuid>" re-tiles/updates an EXISTING share in place (keeps its
//   link/token, replaces its tiles, updates layers/bounds; title/emails are only
//   changed if also present in the config).

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { tmpdir } from 'os'
import { createInterface } from 'readline/promises'

const SHARE_BUCKET = 'property-shares' // private: holds both COGs and tiles, gated by the share access token
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const DEFAULT_ZOOM = '13-22'
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

// Recursively remove an existing share's tile subtree (used when re-tiling).
async function deleteTiles(supabase, shareId) {
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
  const paths = await listAll(`${shareId}/tiles`)
  for (let i = 0; i < paths.length; i += 1000) {
    await supabase.storage.from(SHARE_BUCKET).remove(paths.slice(i, i + 1000))
  }
  return paths.length
}

async function uploadCog(supabase, dest, file) {
  const { error } = await supabase.storage.from(SHARE_BUCKET).upload(dest, readFileSync(file), { contentType: 'image/tiff', upsert: true })
  if (error) throw new Error(`COG upload ${dest}: ${error.message}`)
}

async function uploadTileDir(supabase, tileDir, destPrefix) {
  const files = walk(tileDir)
  for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
    const batch = files.slice(i, i + UPLOAD_CONCURRENCY)
    await Promise.all(batch.map(async (file) => {
      const dest = `${destPrefix}/${relative(tileDir, file)}`
      const { error } = await supabase.storage.from(SHARE_BUCKET).upload(dest, readFileSync(file), { contentType: 'image/webp', upsert: true })
      if (error) throw new Error(`tile upload ${dest}: ${error.message}`)
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

  const share_id = (await ask('Update an existing share? Paste its share_id (blank for new)')).trim()
  const isUpdate = !!share_id

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

  const zoom = await ask('Zoom range', DEFAULT_ZOOM)
  const uploadCogsAns = await ask('Archive COGs to private storage? (y/n)', 'y')
  rl.close()

  const cfg = {}
  if (share_id) cfg.share_id = share_id
  if (title) cfg.title = title
  if (client_name) cfg.client_name = client_name
  if (emails) cfg.allowed_emails = emails
  cfg.expires_at = expires_at || null
  cfg.zoom = zoom
  cfg.upload_cogs = !uploadCogsAns.toLowerCase().startsWith('n')
  cfg.layers = layers

  const base = title ? slugify(title) : `update-${share_id.slice(0, 8)}`
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
  const isUpdate = !!(cfg.share_id && UUID_RE.test(cfg.share_id))
  if (!isUpdate && !cfg.title) throw new Error('config.title is required for a new share')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
  const supabase = createClient(url, key)

  const shareId = isUpdate ? cfg.share_id : randomUUID()
  const zoom = cfg.zoom || DEFAULT_ZOOM
  const uploadCogs = cfg.upload_cogs !== false
  const work = mkdtempSync(join(tmpdir(), 'plnt-survey-'))
  mkdirSync(join(work, 'tiles')) // gdal2tiles (GDAL 3.13) only creates the leaf dir, not parents
  console.log(`${isUpdate ? 'Updating' : 'Publishing'} share ${shareId}\nWork dir: ${work}\n`)

  // ---- Phase 1: process all layers locally (fails fast before any upload) ----
  const processed = [] // { type, cogPath, tileDir, bounds, value_min, value_max }
  for (const type of ['rgb', 'ndvi', 'chm']) {
    const lc = cfg.layers?.[type]
    if (!lc?.input) continue
    console.log(`=== ${type}: processing ===`)
    const cog = join(work, `${type}_cog.tif`)
    let tileSource

    if (type === 'rgb') {
      gdal('gdal_translate', [lc.input, cog, ...COG_OPTS])
      tileSource = cog
    } else {
      const [dmin, dmax] = DEFAULT_RANGE[type]
      const vmin = lc.value_min ?? dmin
      const vmax = lc.value_max ?? dmax

      if (type === 'ndvi') {
        const nir = lc.nir_band ?? 1
        const red = lc.red_band ?? 2
        const alpha = lc.alpha_band
        const raw = join(work, 'ndvi_raw.tif')
        const args = ['-A', lc.input, `--A_band=${nir}`, '-B', lc.input, `--B_band=${red}`]
        let calc
        if (alpha) {
          args.push('-C', lc.input, `--C_band=${alpha}`)
          calc = 'numpy.where(C>0, numpy.clip((A.astype(numpy.float32)-B.astype(numpy.float32))/(A.astype(numpy.float32)+B.astype(numpy.float32)+1e-6),-1,1), -9999)'
        } else {
          calc = 'numpy.clip((A.astype(numpy.float32)-B.astype(numpy.float32))/(A.astype(numpy.float32)+B.astype(numpy.float32)+1e-6),-1,1)'
        }
        args.push(`--outfile=${raw}`, '--type=Float32', '--NoDataValue=-9999', `--calc=${calc}`, '--overwrite', '--quiet')
        gdal('gdal_calc.py', args)
        gdal('gdal_translate', [raw, cog, ...COG_OPTS])
      } else {
        gdal('gdal_translate', [lc.input, cog, ...COG_OPTS])
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
    const webpOpts = type === 'rgb' ? ['--webp-quality=88'] : ['--webp-lossless']
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

  // ---- Phase 2: upload ----
  if (isUpdate) {
    console.log('update mode: clearing old tiles...')
    const removed = await deleteTiles(supabase, shareId)
    console.log(`  removed ${removed} old tiles\n`)
  }
  const layers = []
  for (const p of processed) {
    console.log(`=== ${p.type}: uploading ===`)
    if (uploadCogs) {
      console.log('    COG...')
      await uploadCog(supabase, `${shareId}/${p.type}_cog.tif`, p.cogPath)
    }
    await uploadTileDir(supabase, p.tileDir, `${shareId}/tiles/${p.type}`)
    const layer = { type: p.type, storage_path: `${shareId}/${p.type}_cog.tif`, bounds: p.bounds, tiled: true }
    if (p.type !== 'rgb') {
      layer.value_min = p.value_min
      layer.value_max = p.value_max
    }
    layers.push(layer)
  }

  // ---- Phase 3: create or update the share ----
  const bounds = unionBounds(layers.map((l) => l.bounds))
  let token
  if (isUpdate) {
    const update = { layers, bounds, updated_at: new Date().toISOString() }
    if (cfg.title) update.title = cfg.title
    if (cfg.client_name !== undefined) update.client_name = cfg.client_name || null
    if (cfg.allowed_emails) update.allowed_emails = normalizeEmails(cfg.allowed_emails)
    if (cfg.expires_at !== undefined) update.expires_at = cfg.expires_at || null
    const { error } = await supabase.from('property_shares').update(update).eq('id', shareId)
    if (error) throw new Error(`Update share: ${error.message}`)
    const { data, error: tErr } = await supabase.from('property_shares').select('token').eq('id', shareId).single()
    if (tErr || !data) throw new Error(`Fetch token: ${tErr?.message}`)
    token = data.token
  } else {
    token = randomBytes(24).toString('base64url')
    const { error } = await supabase.from('property_shares').insert({
      id: shareId,
      token,
      title: cfg.title,
      client_name: cfg.client_name || null,
      allowed_emails: normalizeEmails(cfg.allowed_emails),
      layers,
      bounds,
      expires_at: cfg.expires_at || null,
    })
    if (error) throw new Error(`Insert share: ${error.message}`)
  }

  rmSync(work, { recursive: true, force: true })
  console.log(`\n✅ ${isUpdate ? 'Updated' : 'Published'} "${cfg.title || shareId}" (${layers.map((l) => l.type).join(', ')})`)
  console.log(`\n   Share link:  ${SITE_URL}/share/${token}\n`)
}

main().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
