// sync-share-plots.mjs — publish a versioned bay layer onto a gated share.
//
// Upserts one share_plots row per bay (matched by bay_ref, so a bay keeps its
// identity when its boundary is redrawn), sets its boundary, bed, latest count,
// method and confidence, and appends a share_plot_counts row for the flight +
// version. Plots the viewer drew by hand (no bay_ref) are left untouched.
//
//   set -a; source .env.local; set +a
//   node scripts/sync-share-plots.mjs <shareId> <flightKey> <version> <bays.geojson (EPSG:4326)>
//
// bays.geojson features need properties: bay, bed, plants, method, confidence.
// Run the 20261016 migration first (bay_ref, share_plot_counts).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const [shareId, flightKey, version, geojsonPath] = process.argv.slice(2)
if (!shareId || !flightKey || !version || !geojsonPath) {
  console.error('usage: node scripts/sync-share-plots.mjs <shareId> <flightKey> <version> <bays.geojson>')
  process.exit(1)
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Map PLNT's per-bay method onto the four confidence levels the share shows.
const CONF = { hand: 'verified', edited: 'verified', detector: 'good', detplus: 'good', grid: 'good', gridchip: 'medium', lattice: 'medium', stripes: 'estimate', layout: 'estimate', rims: 'estimate' }
const ERR = { verified: 0, good: 3, medium: 5, estimate: 15 }

const fc = JSON.parse(readFileSync(geojsonPath, 'utf8'))
const feats = fc.features.filter((f) => f.geometry && f.properties?.bay)
console.log(`${feats.length} bays in ${geojsonPath}`)

const { data: existing, error: e0 } = await supabase.from('share_plots').select('id, bay_ref').eq('share_id', shareId).not('bay_ref', 'is', null)
if (e0) throw new Error(e0.message)
const byRef = new Map((existing || []).map((p) => [p.bay_ref, p.id]))

let inserted = 0, updated = 0, counts = 0
for (let i = 0; i < feats.length; i += 100) {
  const chunk = feats.slice(i, i + 100)
  for (const f of chunk) {
    const p = f.properties
    const m = String(p.method || '').toLowerCase()
    const confidence = p.confidence_level || (/hand|reviewer|edited/.test(m) ? 'verified' : CONF[m] || ({ good: 'good', medium: 'medium', check: 'estimate' })[String(p.confidence || '').toLowerCase()] || 'medium')
    const geom = f.geometry.type === 'MultiPolygon' ? { type: 'Polygon', coordinates: f.geometry.coordinates.sort((a, b) => b[0].length - a[0].length)[0] } : f.geometry
    const row = { share_id: shareId, boundary: geom, bay_ref: String(p.bay), bed_ref: String(p.bed ?? String(p.bay).split('-')[0]), plant_count: Number(p.plants) || 0, count_method: p.method || null, count_confidence: confidence, block: Number.isFinite(Number(p.bed)) ? Number(p.bed) : null, updated_at: new Date().toISOString() }
    let plotId = byRef.get(row.bay_ref)
    if (plotId) {
      const { error } = await supabase.from('share_plots').update(row).eq('id', plotId)
      if (error) throw new Error(`update ${row.bay_ref}: ${error.message}`)
      updated++
    } else {
      const { data, error } = await supabase.from('share_plots').insert(row).select('id').single()
      if (error) throw new Error(`insert ${row.bay_ref}: ${error.message}`)
      plotId = data.id; byRef.set(row.bay_ref, plotId); inserted++
    }
    const { error: ec } = await supabase.from('share_plot_counts').insert({ share_id: shareId, plot_id: plotId, flight_key: flightKey, version, plant_count: row.plant_count, method: row.count_method || 'unknown', confidence, expected_error_pct: ERR[confidence], source: 'plnt', note: p.note || null })
    if (ec) throw new Error(`count ${row.bay_ref}: ${ec.message}`)
    counts++
  }
  console.log(`  ${Math.min(i + 100, feats.length)}/${feats.length}`)
}
console.log(`done: ${inserted} plots inserted, ${updated} updated, ${counts} count rows for ${flightKey} ${version}`)
