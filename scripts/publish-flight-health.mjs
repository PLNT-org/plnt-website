// publish-flight-health.mjs — put per-plant health flags on a published flight.
// Uploads a flags file next to the flight's points.json and records it as
// health_path on the rgb layer; the share map then colours those dots red
// (stressed) or orange (sparse) and shows a "Health flags" toggle.
//
//   set -a; source .env.local; set +a
//   node scripts/publish-flight-health.mjs <share_url_or_token> <flight_key> <health.json>
//
// health.json is [[lat, lng, kind, reason], ...] with lat/lng rounded to 6
// decimals exactly as in points.json (that's how a flag finds its dot), kind
// 'stressed' | 'sparse', reason free text shown on hover. Pass an empty array
// to clear the flags.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SHARE_BUCKET = 'property-shares'

function extractToken(s) {
  const m = String(s).match(/\/share\/([^/?#\s]+)/)
  return (m ? m[1] : String(s)).trim()
}

async function main() {
  const [, , shareRef, flightKey, file] = process.argv
  if (!shareRef || !flightKey || !file) throw new Error('Usage: publish-flight-health.mjs <share_url_or_token> <flight_key> <health.json>')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
  const supabase = createClient(url, key)

  const rows = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r) || typeof r[0] !== 'number' || typeof r[1] !== 'number' || !['stressed', 'sparse'].includes(r[2]))) {
    throw new Error('health.json must be [[lat, lng, "stressed"|"sparse", reason], ...]')
  }

  const token = extractToken(shareRef)
  const { data: share, error } = await supabase.from('property_shares').select('id, token, title, flights, layers').eq('token', token).single()
  if (error || !share) throw new Error(`Share not found for token ${token}`)
  const flights = Array.isArray(share.flights) ? share.flights : []
  const flight = flights.find((f) => f.key === flightKey)
  if (!flight) throw new Error(`Flight key "${flightKey}" not found on "${share.title}". Available: ${flights.map((f) => f.key).join(', ')}`)
  const rgb = (flight.layers || []).find((l) => l.type === 'rgb')
  if (!rgb) throw new Error(`No rgb layer on flight ${flightKey}`)

  const path = `${share.id}/${flightKey}/health.json`
  const body = Buffer.from(JSON.stringify(rows))
  const { error: upErr } = await supabase.storage.from(SHARE_BUCKET).upload(path, body, { contentType: 'application/json', upsert: true })
  if (upErr) throw new Error(`upload health.json: ${upErr.message}`)
  rgb.health_path = path
  const newest = [...flights].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
  const topLayers = newest && newest.key === flightKey ? flight.layers : share.layers
  const { error: updErr } = await supabase.from('property_shares').update({ flights, layers: topLayers, updated_at: new Date().toISOString() }).eq('id', share.id)
  if (updErr) throw new Error(`update share: ${updErr.message}`)
  const n = (k) => rows.filter((r) => r[2] === k).length
  console.log(`✅ "${share.title}" · flight ${flightKey}: ${rows.length} flags (${n('stressed')} stressed, ${n('sparse')} sparse) -> ${path}`)
}

main().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
