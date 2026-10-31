// publish-flight-size.mjs — put per-plant crown widths on a published flight.
// Uploads a size file next to the flight's points.json and records it as
// size_path on the rgb layer; the share map then offers a "Plant size" toggle
// that colours dots by crown-width class and shows the bay's median width.
//
//   set -a; source .env.local; set +a
//   node scripts/publish-flight-size.mjs <share_url_or_token> <flight_key> <size.json>
//
// size.json is [[lat, lng, diam_cm], ...] with lat/lng rounded to 6 decimals
// exactly as in points.json (that is how a width finds its dot). Pass an
// empty array to clear.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SHARE_BUCKET = 'property-shares'
const extractToken = (s) => { const m = String(s).match(/\/share\/([^/?#\s]+)/); return (m ? m[1] : String(s)).trim() }

async function main() {
  const [, , shareRef, flightKey, file] = process.argv
  if (!shareRef || !flightKey || !file) throw new Error('Usage: publish-flight-size.mjs <share_url_or_token> <flight_key> <size.json>')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
  const supabase = createClient(url, key)
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r) || r.length < 3 || typeof r[0] !== 'number' || typeof r[1] !== 'number' || typeof r[2] !== 'number')) throw new Error('size.json must be [[lat, lng, diam_cm], ...]')
  const token = extractToken(shareRef)
  const { data: share, error } = await supabase.from('property_shares').select('id, token, title, flights, layers').eq('token', token).single()
  if (error || !share) throw new Error(`Share not found for token ${token}`)
  const flights = Array.isArray(share.flights) ? share.flights : []
  const flight = flights.find((f) => f.key === flightKey)
  if (!flight) throw new Error(`Flight key "${flightKey}" not found on "${share.title}". Available: ${flights.map((f) => f.key).join(', ')}`)
  const rgb = (flight.layers || []).find((l) => l.type === 'rgb')
  if (!rgb) throw new Error(`No rgb layer on flight ${flightKey}`)
  const path = `${share.id}/${flightKey}/size.json`
  const body = Buffer.from(JSON.stringify(rows))
  const { error: upErr } = await supabase.storage.from(SHARE_BUCKET).upload(path, body, { contentType: 'application/json', upsert: true })
  if (upErr) throw new Error(`upload size.json: ${upErr.message}`)
  rgb.size_path = path
  const newest = [...flights].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
  const topLayers = newest && newest.key === flightKey ? flight.layers : share.layers
  const { error: updErr } = await supabase.from('property_shares').update({ flights, layers: topLayers, updated_at: new Date().toISOString() }).eq('id', share.id)
  if (updErr) throw new Error(`update share: ${updErr.message}`)
  const cms = rows.map((r) => r[2]).sort((a, b) => a - b)
  console.log(`✅ "${share.title}" · flight ${flightKey}: ${rows.length} plants, median crown ${cms[Math.floor(cms.length / 2)]} cm -> ${path} (${(body.length / 1e3).toFixed(0)} KB)`)
}
main().catch((e) => { console.error('\n❌', e.message || e); process.exit(1) })
