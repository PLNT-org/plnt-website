#!/usr/bin/env node
// Publish average plant size per plot for one flight of a share:
//   node scripts/publish-plot-sizes.mjs <shareId> <flightKey> <sizes.json> [unit]
// sizes.json is keyed by block number: { "25": { height, width, height_from: 'rim'|'ground', plants } }.
// Writes <shareId>/<flightKey>/plot_sizes.json keyed by plot id and sets plot_size_path on the flight's RGB layer.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const [shareId, flightKey, file, unit = 'in'] = process.argv.slice(2)
if (!shareId || !flightKey || !file) {
  console.error('usage: publish-plot-sizes.mjs <shareId> <flightKey> <sizes.json> [unit]')
  process.exit(1)
}
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const byBlock = JSON.parse(fs.readFileSync(file, 'utf8'))

const { data: share, error: se } = await sb.from('property_shares').select('flights').eq('id', shareId).single()
if (se) throw se
const flights = share.flights || []
const flight = flights.find((f) => f.key === flightKey)
const rgb = flight?.layers?.find((l) => l.type === 'rgb')
if (!rgb) throw new Error(`flight ${flightKey} has no rgb layer`)

// A multi-site share reuses block numbers across sites: only plots inside this flight's bounds count.
const B = flight.bounds
const inFlight = (p) => {
  const ring = p.boundary?.coordinates?.[0] || []
  if (!ring.length || !B) return false
  const lng = ring.reduce((a, c) => a + c[0], 0) / ring.length
  const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length
  return lat >= B.south && lat <= B.north && lng >= B.west && lng <= B.east
}
const { data: plots, error: pe } = await sb.from('share_plots').select('id,block,boundary').eq('share_id', shareId).not('block', 'is', null)
if (pe) throw pe
const out = { unit, plots: {} }
for (const p of plots) if (byBlock[p.block] && inFlight(p)) out.plots[p.id] = byBlock[p.block]
const n = Object.keys(out.plots).length
if (!n) throw new Error('no plot on this share matches a block in the sizes file')

const path = `${shareId}/${flightKey}/plot_sizes.json`
const { error: ue } = await sb.storage.from('property-shares').upload(path, JSON.stringify(out), { contentType: 'application/json', upsert: true })
if (ue) throw ue

if (rgb.plot_size_path !== path) {
  rgb.plot_size_path = path
  const { error } = await sb.from('property_shares').update({ flights }).eq('id', shareId)
  if (error) throw error
}
console.log(`published ${n} plot sizes (${unit}) -> ${path}`)
