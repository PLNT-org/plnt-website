// upload-ortho.mjs — register a pre-processed orthomosaic .tif in Supabase
// (so plnt_v3 detection can run on it) AND generate a public XYZ WebP tile
// pyramid so the dashboard viewer can display it.
//
// The returned orthomosaic_id is what `publish-survey.mjs` references via
//   "plant_points": { "orthomosaic_id": "<id>" }
// to render per-plant dots on the gated share.
//
// Usage:
//   set -a; source .env.local; set +a
//
//   # Full flow: upload + insert + tile + set tiles_url
//   node scripts/upload-ortho.mjs /path/to/ortho.tif ["Display name"]
//
//   # Tiles only (existing ortho, local source .tif):
//   node scripts/upload-ortho.mjs --tiles-only <orthomosaic_id> /path/to/ortho.tif
//
//   # Retile an existing ortho from whatever .tif is stored on the row (handy
//   # after the dashboard crops it — the row's original_tif_url already points
//   # at the cropped .tif, so this is a one-shot fix):
//   node scripts/upload-ortho.mjs --retile <orthomosaic_id>
//
// What the full flow does:
//   1. Reads bounds/dimensions from the .tif (gdalinfo).
//   2. Inserts a row in `orthomosaics` (status=completed).
//   3. Uploads the .tif to the `orthomosaics` bucket at <id>/orthophoto.tif.
//   4. Generates a Web-Mercator XYZ WebP tile pyramid (gdal2tiles, z13-22).
//   5. Uploads tiles to the public `orthomosaic-tiles` bucket at
//      <id>/{z}/{x}/{y}.webp and sets the row's tiles_url.
//
// Optional env: ADMIN_EMAIL (defaults to porter@plnt.net) — sets user_id so
// the ortho shows up under your account in the dashboard viewer.

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'fs'
import { basename, join, relative } from 'path'
import { tmpdir } from 'os'

const ORTHOS_BUCKET = 'orthomosaics'
const TILES_BUCKET = 'orthomosaic-tiles'
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'porter@plnt.net').toLowerCase()
const TILE_ZOOM = '13-22'
const UPLOAD_CONCURRENCY = 24
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const gdal = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const gdalOut = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })

function inspectTif(path) {
  const info = JSON.parse(gdalOut('gdalinfo', ['-json', path]))
  const ring = info.wgs84Extent?.coordinates?.[0]
  if (!ring) throw new Error('Could not read WGS84 extent — is the .tif georeferenced?')
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const bounds = {
    west: Math.min(...lons),
    east: Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  }
  const [width, height] = info.size ?? [0, 0]
  const resM = Math.abs(info.geoTransform?.[1] ?? 0) || null
  const resCm = resM ? resM * 100 : null
  return { bounds, width, height, resCm }
}

async function findAdminUserId(supabase) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Looking up admin user: ${error.message}`)
    const hit = data?.users?.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL)
    if (hit) return hit.id
    if (!data?.users || data.users.length < 1000) break
  }
  return null
}

function walk(dir, ext) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, ext))
    else if (e.name.endsWith(ext)) out.push(p)
  }
  return out
}

// Storage uploads occasionally get an HTML gateway/rate-limit page back instead
// of JSON. Retry with exponential backoff so one blip doesn't kill a long job.
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
      await new Promise((r) => setTimeout(r, 800 * 2 ** i))
    }
  }
  throw new Error(`${label}: ${lastErr?.message || lastErr}`)
}

// Generate a public XYZ WebP tile pyramid for an existing orthomosaic_id and
// wire up its tiles_url so the dashboard viewer renders it.
async function tileAndPublish(supabase, orthoId, tifPath) {
  const work = mkdtempSync(join(tmpdir(), 'ortho-tiles-'))
  try {
    const tilesDir = join(work, 'tiles')
    console.log(`\nTiling z${TILE_ZOOM} (WebP)…`)
    gdal('gdal2tiles.py', [
      '--xyz', '-z', TILE_ZOOM, '-w', 'none', '--processes=4',
      '--tiledriver=WEBP', '--webp-quality=88',
      tifPath, tilesDir,
    ])

    const files = walk(tilesDir, '.webp')
    console.log(`Uploading ${files.length} tiles…`)
    let done = 0
    for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
      const batch = files.slice(i, i + UPLOAD_CONCURRENCY)
      await Promise.all(batch.map(async (file) => {
        const rel = relative(tilesDir, file)
        const dest = `${orthoId}/${rel}`
        const body = readFileSync(file)
        await withRetry(
          () => supabase.storage.from(TILES_BUCKET).upload(dest, body, { contentType: 'image/webp', upsert: true }),
          `tile ${dest}`,
        )
      }))
      done += batch.length
      process.stdout.write(`\r  ${done}/${files.length}`)
    }
    process.stdout.write('\n')

    // Supabase URL-encodes {z}/{x}/{y} — decode so Leaflet can substitute.
    const { data: u } = supabase.storage
      .from(TILES_BUCKET)
      .getPublicUrl(`${orthoId}/{z}/{x}/{y}.webp`)
    const tilesUrl = decodeURIComponent(u.publicUrl)
    const { error: updateErr } = await supabase
      .from('orthomosaics')
      .update({ tiles_url: tilesUrl })
      .eq('id', orthoId)
    if (updateErr) throw new Error(`Update tiles_url: ${updateErr.message}`)
    console.log(`  tiles_url: ${tilesUrl}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

async function tilesOnly() {
  const orthoId = process.argv[3]
  const tifPath = process.argv[4]
  if (!orthoId || !UUID_RE.test(orthoId) || !tifPath) {
    throw new Error('Usage: node scripts/upload-ortho.mjs --tiles-only <orthomosaic_id> <path/to/ortho.tif>')
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Source .env.local first: `set -a; source .env.local; set +a`')
  const supabase = createClient(url, key)

  console.log(`Tiling existing ortho ${orthoId} from ${tifPath}`)
  await tileAndPublish(supabase, orthoId, tifPath)
  console.log(`\n✅ Dashboard viewer should now show this ortho.`)
}

// Pull the row's current source .tif from Supabase, generate fresh tiles, and
// set tiles_url. Most useful after the dashboard's crop-to-boundary endpoint,
// which writes a new orthophoto_cropped.tif and clears tiles_url.
async function retile() {
  const orthoId = process.argv[3]
  if (!orthoId || !UUID_RE.test(orthoId)) {
    throw new Error('Usage: node scripts/upload-ortho.mjs --retile <orthomosaic_id>')
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Source .env.local first: `set -a; source .env.local; set +a`')
  const supabase = createClient(url, key)

  const { data: row, error } = await supabase
    .from('orthomosaics')
    .select('name, original_tif_url, orthomosaic_url')
    .eq('id', orthoId)
    .single()
  if (error || !row) throw new Error(`Orthomosaic ${orthoId} not found`)

  // Prefer the original (post-crop becomes the cropped tif); only fall back to
  // orthomosaic_url if no original was ever stored.
  const sourceUrl = row.original_tif_url || row.orthomosaic_url
  if (!sourceUrl) throw new Error('No source .tif URL on this orthomosaic')

  console.log(`Retiling "${row.name}" (${orthoId})`)
  console.log(`  source: ${sourceUrl}`)

  const tempDir = mkdtempSync(join(tmpdir(), 'plnt-retile-'))
  const tempTif = join(tempDir, 'source.tif')
  try {
    console.log('Downloading source .tif…')
    execFileSync('curl', ['-fsSL', sourceUrl, '-o', tempTif], { stdio: 'inherit' })
    const sizeMB = (statSync(tempTif).size / 1024 / 1024).toFixed(1)
    console.log(`  downloaded ${sizeMB} MB`)

    await tileAndPublish(supabase, orthoId, tempTif)
    console.log(`\n✅ Tiles regenerated for "${row.name}" — dashboard viewer will load them on next refresh.`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function fullFlow() {
  const tifPath = process.argv[2]
  if (!tifPath) {
    throw new Error('Usage: node scripts/upload-ortho.mjs <path/to/ortho.tif> [name]\n       node scripts/upload-ortho.mjs --tiles-only <orthomosaic_id> <path/to/ortho.tif>')
  }
  const name = process.argv[3] || basename(tifPath).replace(/\.[^.]+$/, '')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Source .env.local first: `set -a; source .env.local; set +a`')
  const supabase = createClient(url, key)

  const sizeMB = (statSync(tifPath).size / 1024 / 1024).toFixed(1)
  console.log(`Reading ${tifPath} (${sizeMB} MB)…`)
  const meta = inspectTif(tifPath)
  console.log(`  size: ${meta.width}×${meta.height} px, ${meta.resCm?.toFixed(1) ?? '?'} cm/px`)
  console.log(`  bounds: N ${meta.bounds.north.toFixed(5)}, S ${meta.bounds.south.toFixed(5)}, E ${meta.bounds.east.toFixed(5)}, W ${meta.bounds.west.toFixed(5)}`)

  const id = randomUUID()
  const ownerId = await findAdminUserId(supabase)
  if (ownerId) console.log(`  owner: ${ADMIN_EMAIL} (${ownerId.slice(0, 8)}…)`)
  else console.log(`  (couldn't find user ${ADMIN_EMAIL}; row will have user_id=null)`)

  console.log(`\nInserting orthomosaics row id=${id}…`)
  const { error: insertErr } = await supabase.from('orthomosaics').insert({
    id,
    name,
    user_id: ownerId,
    bounds: meta.bounds,
    image_width: meta.width,
    image_height: meta.height,
    resolution_cm: meta.resCm,
    status: 'completed',
    completed_at: new Date().toISOString(),
  })
  if (insertErr) throw new Error(`Insert orthomosaic: ${insertErr.message}`)

  console.log('Uploading TIF…')
  const body = readFileSync(tifPath)
  const storagePath = `${id}/orthophoto.tif`
  await withRetry(
    () => supabase.storage.from(ORTHOS_BUCKET).upload(storagePath, body, { contentType: 'image/tiff', upsert: true }),
    'TIF upload',
  )

  const { data: urlData } = supabase.storage.from(ORTHOS_BUCKET).getPublicUrl(storagePath)
  await supabase.from('orthomosaics').update({ original_tif_url: urlData.publicUrl }).eq('id', id)

  // Generate dashboard tiles so the row shows up in the orthomosaic viewer.
  await tileAndPublish(supabase, id, tifPath)

  console.log(`\n✅ Registered "${name}"\n   orthomosaic_id: ${id}\n`)
  console.log('Next:')
  console.log('  1. Run plnt_v3 detection on this ortho so plant_labels rows populate.')
  console.log('  2. In your survey config add:')
  console.log(`       "plant_points": { "orthomosaic_id": "${id}" }`)
  console.log('  3. node scripts/publish-survey.mjs scripts/<your-config>.json')
}

const mode = process.argv[2]
const run =
  mode === '--retile' ? retile :
  mode === '--tiles-only' ? tilesOnly :
  fullFlow
run().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
