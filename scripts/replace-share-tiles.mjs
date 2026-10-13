// replace-share-tiles.mjs — swap one flight's RGB tile pyramid on a gated share
// for a pyramid already generated locally (gdal2tiles --xyz, webp), leaving the
// flight's points.json, plant_count and everything else untouched.
//
// Use when the imagery was re-stitched but nothing else changed — a full
// publish-survey run would also rewrite the flight record (and needs the
// plant-points config repeated to keep the dots).
//
//   set -a; source .env.local; set +a
//   node scripts/replace-share-tiles.mjs <shareId> <flightKey> <localTileDir> [maxZoom]
//
// localTileDir holds {z}/{x}/{y}.webp. Old tiles for that flight+layer are
// removed first, then the new ones are uploaded (24 at a time, with retries),
// and the layer's max_zoom is set to maxZoom (default: the deepest z dir found).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const SHARE_BUCKET = 'property-shares'
const CONCURRENCY = 24

const [shareId, flightKey, tileDir, maxZoomArg] = process.argv.slice(2)
if (!shareId || !flightKey || !tileDir) {
  console.error('usage: node scripts/replace-share-tiles.mjs <shareId> <flightKey> <localTileDir> [maxZoom]')
  process.exit(1)
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function withRetry(fn, what, tries = 5) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fn()
      if (r?.error) throw new Error(r.error.message)
      return r
    } catch (e) {
      last = e
      await new Promise((res) => setTimeout(res, 500 * 2 ** i))
    }
  }
  throw new Error(`${what}: ${last?.message || last}`)
}

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (e.endsWith('.webp')) out.push(p)
  }
  return out
}

async function listAll(prefix) {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage.from(SHARE_BUCKET).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(error.message)
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

const destPrefix = `${shareId}/${flightKey}/tiles/rgb`
const files = walk(tileDir)
const zooms = [...new Set(files.map((f) => Number(relative(tileDir, f).split('/')[0])))].sort((a, b) => a - b)
const maxZoom = maxZoomArg ? Number(maxZoomArg) : zooms[zooms.length - 1]
console.log(`${files.length} local tiles, zooms ${zooms[0]}-${zooms[zooms.length - 1]} -> ${destPrefix}`)

const old = await listAll(destPrefix)
console.log(`removing ${old.length} existing tiles`)
for (let i = 0; i < old.length; i += 1000) {
  await withRetry(() => supabase.storage.from(SHARE_BUCKET).remove(old.slice(i, i + 1000)), 'remove')
  process.stdout.write(`\r    removed ${Math.min(i + 1000, old.length)}/${old.length}`)
}
console.log('')

for (let i = 0; i < files.length; i += CONCURRENCY) {
  const batch = files.slice(i, i + CONCURRENCY)
  await Promise.all(
    batch.map((file) => {
      const dest = `${destPrefix}/${relative(tileDir, file)}`
      return withRetry(
        () => supabase.storage.from(SHARE_BUCKET).upload(dest, readFileSync(file), { contentType: 'image/webp', upsert: true }),
        `tile ${dest}`
      )
    })
  )
  process.stdout.write(`\r    uploaded ${Math.min(i + CONCURRENCY, files.length)}/${files.length}`)
}
console.log('')

const { data: row, error } = await supabase.from('property_shares').select('flights, layers').eq('id', shareId).single()
if (error) throw new Error(error.message)
const flights = row.flights
const flight = flights.find((f) => f.key === flightKey)
if (!flight) throw new Error(`flight ${flightKey} not on share`)
const rgb = flight.layers.find((l) => l.type === 'rgb')
rgb.max_zoom = maxZoom
rgb.tiled = true
const newest = [...flights].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
const update = { flights, updated_at: new Date().toISOString() }
if (newest.key === flightKey) update.layers = flight.layers
const { error: e2 } = await supabase.from('property_shares').update(update).eq('id', shareId)
if (e2) throw new Error(e2.message)
console.log(`done: ${files.length} tiles live, max_zoom ${maxZoom}`)
