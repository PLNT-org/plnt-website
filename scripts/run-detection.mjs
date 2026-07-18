// run-detection.mjs — kick off a plnt_v3 detection job on an orthomosaic by
// calling the aruco service directly (so tile/dedup params can be overridden,
// which the /api/detection-jobs Next.js route does not forward).
//
// Reach the private Cloud Run service through an authenticated proxy first:
//   gcloud run services proxy plnt-aruco-service --region us-central1 --port 8080
//
// Usage:
//   set -a; source .env.local; set +a
//   node scripts/run-detection.mjs <orthomosaic_id>
//
// Env overrides (all optional):
//   ARUCO_BASE     default http://127.0.0.1:8080
//   TILE           tile width & height px            (default 640)
//   OVERLAP        tile overlap px                   (default 64)
//   R_DEDUP        centroid dedup radius px          (default 22)
//   CONF           confidence threshold              (default 0.25)
//   ENGINE         yolo | sam3                       (default yolo)

import { createClient } from '@supabase/supabase-js'

const ARUCO_BASE = (process.env.ARUCO_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '')
const TILE = Number(process.env.TILE || 640)
const OVERLAP = Number(process.env.OVERLAP || 64)
const R_DEDUP = Number(process.env.R_DEDUP || 22)
const CONF = Number(process.env.CONF || 0.25)
const ENGINE = process.env.ENGINE || 'yolo'
const INCLUDE_CLASSES = ['plant', 'plants']

async function main() {
  const orthoId = process.argv[2]
  if (!orthoId) throw new Error('Usage: node scripts/run-detection.mjs <orthomosaic_id>')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Source .env.local first: `set -a; source .env.local; set +a`')
  const supabase = createClient(url, key)

  const { data: ortho, error: oErr } = await supabase
    .from('orthomosaics')
    .select('id, name, original_tif_url, orthomosaic_url, bounds, user_id, status')
    .eq('id', orthoId)
    .single()
  if (oErr || !ortho) throw new Error(`Orthomosaic ${orthoId} not found`)
  if (ortho.status !== 'completed' || !ortho.bounds) throw new Error('Orthomosaic is not ready (status/bounds)')
  const geotiff_url = ortho.original_tif_url || ortho.orthomosaic_url
  if (!geotiff_url) throw new Error('Ortho has no original_tif_url/orthomosaic_url')

  // Guard against double-runs, mirroring the Next.js route.
  const { data: active } = await supabase
    .from('detection_jobs').select('id, status')
    .eq('orthomosaic_id', orthoId).in('status', ['pending', 'downloading', 'detecting', 'saving'])
  if (active && active.length) throw new Error(`A job is already active for this ortho: ${active[0].id} (${active[0].status})`)

  const config = { confidence_threshold: CONF, include_classes: INCLUDE_CLASSES, engine: ENGINE,
    tile_width: TILE, tile_height: TILE, overlap_x: OVERLAP, overlap_y: OVERLAP, r_dedup: R_DEDUP }
  const { data: job, error: jErr } = await supabase
    .from('detection_jobs')
    .insert({ orthomosaic_id: orthoId, user_id: ortho.user_id, method: 'orthomosaic', status: 'pending', config })
    .select().single()
  if (jErr || !job) throw new Error(`Create job: ${jErr?.message}`)

  console.log(`Ortho "${ortho.name}" (${orthoId})`)
  console.log(`  job_id: ${job.id}`)
  console.log(`  params: tile=${TILE} overlap=${OVERLAP} R=${R_DEDUP} conf=${CONF} engine=${ENGINE}`)
  console.log(`  posting to ${ARUCO_BASE}/detect-plants-async …`)

  const payload = {
    job_id: job.id,
    geotiff_url,
    confidence_threshold: CONF,
    include_classes: INCLUDE_CLASSES,
    tile_width: TILE, tile_height: TILE,
    overlap_x: OVERLAP, overlap_y: OVERLAP,
    r_dedup: R_DEDUP,
    bounds: ortho.bounds,
    orthomosaic_id: orthoId,
    user_id: ortho.user_id,
    supabase_url: url,
    supabase_service_key: key,
    engine: ENGINE,
  }
  const res = await fetch(`${ARUCO_BASE}/detect-plants-async`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) {
    await supabase.from('detection_jobs').update({ status: 'failed', error_message: `service ${res.status}: ${text.slice(0, 300)}` }).eq('id', job.id)
    throw new Error(`Service returned ${res.status}: ${text.slice(0, 300)}`)
  }
  console.log(`  service accepted: ${text}`)
  console.log(`\n✅ Detection started. Poll with:`)
  console.log(`   node scripts/poll-detection.mjs ${job.id}`)
}

main().catch((e) => { console.error('\n❌', e.message || e); process.exit(1) })
