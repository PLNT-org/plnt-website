// refresh-flight-points.mjs — refresh a published flight's plant dots + count
// from the latest detections on an orthomosaic, WITHOUT re-tiling the imagery.
// Use after re-running Count Plants (e.g. after a model update).
//
//   set -a; source .env.local; set +a
//   node scripts/refresh-flight-points.mjs <share_url_or_token> <flight_key> <orthomosaic_id> [source]
//
// [source] pins which detection engine's labels to export ('ai' = YOLO,
// 'sam3' = SAM 3). Omit it and the script picks whichever machine source the
// ortho actually has; it refuses to run when both are present rather than
// publishing a doubled count.

import { createClient } from '@supabase/supabase-js'

const SHARE_BUCKET = 'property-shares'
const MACHINE_SOURCES = ['ai', 'sam3']

function extractToken(s) {
  const m = String(s).match(/\/share\/([^/?#\s]+)/)
  return (m ? m[1] : String(s)).trim()
}

// Which machine source to export for an ortho — see publish-survey.mjs for the
// full rationale. null means the ortho has no machine labels (manual only).
async function resolveLabelSource(supabase, orthoId, requested) {
  const present = []
  for (const src of MACHINE_SOURCES) {
    const { count, error } = await supabase
      .from('plant_labels')
      .select('id', { count: 'exact', head: true })
      .eq('orthomosaic_id', orthoId)
      .eq('source', src)
    if (error) throw new Error(`count ${src} labels: ${error.message}`)
    if (count > 0) present.push({ source: src, count })
  }

  if (requested) {
    if (!MACHINE_SOURCES.includes(requested)) {
      throw new Error(`source must be one of: ${MACHINE_SOURCES.join(', ')}`)
    }
    return requested
  }
  if (present.length === 0) return null
  if (present.length === 1) return present[0].source
  throw new Error(
    `Ortho ${orthoId} has labels from BOTH detection engines — ` +
      present.map((p) => `${p.source}=${p.count.toLocaleString()}`).join(', ') + '.\n' +
      `   Publishing both would double every plant. Either re-run detection in the\n` +
      `   dashboard (a run now clears the other engine's labels), or pass the source\n` +
      `   as a 4th argument, e.g. ... <orthomosaic_id> ai`
  )
}

// Pull an ortho's plant points (paged past the 1000-row cap) as compact
// [lat, lng] pairs (6 decimals ≈ 0.1 m) — same shape publish-survey writes.
// One machine source plus every 'manual' label, never two machine sources.
async function fetchPlantPoints(supabase, orthoId, source) {
  const keep = ['manual', ...(source ? [source] : [])]
  const pts = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('plant_labels')
      .select('latitude, longitude, source')
      .eq('orthomosaic_id', orthoId)
      .in('source', keep)
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

async function main() {
  const [, , shareRef, flightKey, orthoId, sourceArg] = process.argv
  if (!shareRef || !flightKey || !orthoId) {
    throw new Error('Usage: refresh-flight-points.mjs <share_url_or_token> <flight_key> <orthomosaic_id> [source]')
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
  const supabase = createClient(url, key)

  const token = extractToken(shareRef)
  const { data: share, error } = await supabase
    .from('property_shares')
    .select('id, token, title, flights, layers')
    .eq('token', token)
    .single()
  if (error || !share) throw new Error(`Share not found for token ${token}`)

  const flights = Array.isArray(share.flights) ? share.flights : []
  const flight = flights.find((f) => f.key === flightKey)
  if (!flight) {
    throw new Error(`Flight key "${flightKey}" not found on "${share.title}". Available: ${flights.map((f) => f.key).join(', ')}`)
  }
  const rgb = (flight.layers || []).find((l) => l.type === 'rgb')
  if (!rgb) throw new Error(`No rgb layer on flight ${flightKey}`)
  const ptsPath = rgb.points_path || `${share.id}/${flightKey}/points.json`

  console.log(`Refreshing "${share.title}" · flight ${flightKey} from ortho ${orthoId}...`)
  const src = await resolveLabelSource(supabase, orthoId, sourceArg)
  console.log(`  source: ${src ? `${src} + manual` : 'manual only (no machine labels)'}`)
  const pts = await fetchPlantPoints(supabase, orthoId, src)
  console.log(`  fetched ${pts.length.toLocaleString()} plants (was ${(rgb.plant_count ?? 0).toLocaleString()})`)

  const body = Buffer.from(JSON.stringify(pts))
  const { error: upErr } = await supabase.storage
    .from(SHARE_BUCKET)
    .upload(ptsPath, body, { contentType: 'application/json', upsert: true })
  if (upErr) throw new Error(`upload points.json: ${upErr.message}`)
  console.log(`  uploaded points.json -> ${ptsPath} (${(body.length / 1e3).toFixed(0)} KB)`)

  // Update the flight's rgb count + points_path; mirror to top-level if newest.
  rgb.plant_count = pts.length
  rgb.points_path = ptsPath
  const newest = [...flights].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
  const topLayers = newest && newest.key === flightKey ? flight.layers : share.layers
  const { error: updErr } = await supabase
    .from('property_shares')
    .update({ flights, layers: topLayers, updated_at: new Date().toISOString() })
    .eq('id', share.id)
  if (updErr) throw new Error(`update share: ${updErr.message}`)

  console.log(`\n✅ Flight ${flightKey} now shows ${pts.length.toLocaleString()} plants. Reload the link to see the new dots + count.`)
}

main().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
