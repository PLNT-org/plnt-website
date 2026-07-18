// upload-ortho-resumable.mjs — register a pre-processed orthomosaic .tif in
// Supabase and upload it to the `orthomosaics` bucket via the TUS resumable
// protocol. Use this instead of upload-ortho.mjs when the file is larger than
// the ~5 GB standard-upload cap (or larger than Node can buffer with
// readFileSync). Tiny files can still use upload-ortho.mjs.
//
// After this finishes, generate the dashboard tile pyramid with:
//   node scripts/upload-ortho.mjs --tiles-only <orthomosaic_id> <path/to/ortho.tif>
//
// Usage:
//   set -a; source .env.local; set +a
//   node scripts/upload-ortho-resumable.mjs /path/to/ortho.tif ["Display name"]
//
// Optional env: ADMIN_EMAIL (defaults to porter@plnt.net) — sets user_id so the
// ortho shows up under your account in the dashboard viewer.

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { createReadStream, statSync } from 'fs'
import { basename } from 'path'
import * as tus from 'tus-js-client'

const ORTHOS_BUCKET = 'orthomosaics'
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'porter@plnt.net').toLowerCase()
const CHUNK_SIZE = 6 * 1024 * 1024 // Supabase resumable uploads require exactly 6 MB chunks

function inspectTif(path) {
  const info = JSON.parse(execFileSync('gdalinfo', ['-json', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  const ring = info.wgs84Extent?.coordinates?.[0]
  if (!ring) throw new Error('Could not read WGS84 extent — is the .tif georeferenced?')
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const bounds = { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) }
  const [width, height] = info.size ?? [0, 0]
  const resM = Math.abs(info.geoTransform?.[1] ?? 0) || null
  return { bounds, width, height, resCm: resM ? resM * 100 : null }
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

// Resumable (TUS) upload of a local file to a Supabase Storage bucket. Streams
// from disk in 6 MB chunks, so memory stays flat regardless of file size, and
// transient errors retry from the last committed offset instead of restarting.
function resumableUpload(url, key, bucket, objectName, filePath) {
  const size = statSync(filePath).size
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(createReadStream(filePath), {
      endpoint: `${url}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      headers: { authorization: `Bearer ${key}`, apikey: key, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      uploadSize: size,
      metadata: { bucketName: bucket, objectName, contentType: 'image/tiff', cacheControl: '3600' },
      onError: (err) => reject(err),
      onProgress: (sent, total) => {
        const pct = ((sent / total) * 100).toFixed(1)
        process.stdout.write(`\r  uploading ${(sent / 1e9).toFixed(2)}/${(total / 1e9).toFixed(2)} GB (${pct}%)   `)
      },
      onSuccess: () => { process.stdout.write('\n'); resolve() },
    })
    upload.start()
  })
}

async function main() {
  const tifPath = process.argv[2]
  if (!tifPath) throw new Error('Usage: node scripts/upload-ortho-resumable.mjs <path/to/ortho.tif> [name]')
  const name = process.argv[3] || basename(tifPath).replace(/\.[^.]+$/, '')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Source .env.local first: `set -a; source .env.local; set +a`')
  const supabase = createClient(url, key)

  const sizeGB = (statSync(tifPath).size / 1e9).toFixed(2)
  console.log(`Reading ${tifPath} (${sizeGB} GB)…`)
  const meta = inspectTif(tifPath)
  console.log(`  size: ${meta.width}×${meta.height} px, ${meta.resCm?.toFixed(1) ?? '?'} cm/px`)
  console.log(`  bounds: N ${meta.bounds.north.toFixed(5)}, S ${meta.bounds.south.toFixed(5)}, E ${meta.bounds.east.toFixed(5)}, W ${meta.bounds.west.toFixed(5)}`)

  const id = randomUUID()
  const ownerId = await findAdminUserId(supabase)
  console.log(ownerId ? `  owner: ${ADMIN_EMAIL} (${ownerId.slice(0, 8)}…)` : `  (no user ${ADMIN_EMAIL}; user_id=null)`)

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

  const storagePath = `${id}/orthophoto.tif`
  console.log(`Resumable-uploading to ${ORTHOS_BUCKET}/${storagePath} …`)
  await resumableUpload(url, key, ORTHOS_BUCKET, storagePath, tifPath)

  const { data: urlData } = supabase.storage.from(ORTHOS_BUCKET).getPublicUrl(storagePath)
  const { error: updErr } = await supabase.from('orthomosaics').update({ original_tif_url: urlData.publicUrl }).eq('id', id)
  if (updErr) throw new Error(`Set original_tif_url: ${updErr.message}`)

  console.log(`\n✅ Registered "${name}"\n   orthomosaic_id: ${id}`)
  console.log(`   original_tif_url: ${urlData.publicUrl}`)
  console.log(`\nNext — generate dashboard tiles:`)
  console.log(`   node scripts/upload-ortho.mjs --tiles-only ${id} ${tifPath}`)
}

main().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
