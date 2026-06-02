// fetch-cropped-rgb.mjs — helper for publishing a cropped survey to the gated link.
//
// The boundary you drew on the dashboard lives only in the cropped RGB's alpha
// band (in Supabase). This pulls that file down so publish-survey.mjs can both
// (a) tile it as the RGB layer and (b) derive the property footprint from it to
// clip the NDVI to the exact same boundary ("boundary": { "from_layer": "rgb" }).
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Usage:
//   set -a; source .env.local; set +a
//   node scripts/fetch-cropped-rgb.mjs                       # list orthos + counts
//   node scripts/fetch-cropped-rgb.mjs <orthomosaic_id> [out.tif]   # download cropped RGB

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
const supabase = createClient(url, key)

const BUCKET = 'orthomosaics'
const CROPPED_COG = (id) => `${id}/orthophoto_cropped_cog.tif`

async function labelCount(orthoId) {
  const { count } = await supabase
    .from('plant_labels')
    .select('id', { count: 'exact', head: true })
    .eq('orthomosaic_id', orthoId)
  return count ?? 0
}

async function hasCropped(orthoId) {
  const { data } = await supabase.storage.from(BUCKET).list(orthoId, { limit: 100 })
  return !!data?.some((f) => f.name === 'orthophoto_cropped_cog.tif')
}

async function list() {
  const { data: orthos, error } = await supabase
    .from('orthomosaics')
    .select('id, name, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  if (!orthos?.length) {
    console.log('No orthomosaics found.')
    return
  }
  console.log(`\n${orthos.length} orthomosaic(s):\n`)
  for (const o of orthos) {
    const [count, cropped] = await Promise.all([labelCount(o.id), hasCropped(o.id)])
    console.log(`  ${o.name || '(unnamed)'}`)
    console.log(`    id:      ${o.id}`)
    console.log(`    plants:  ${count.toLocaleString()}   cropped RGB: ${cropped ? 'yes' : 'NO (run Crop to Boundary first)'}`)
    console.log('')
  }
  console.log('Download a cropped RGB:  node scripts/fetch-cropped-rgb.mjs <id> [out.tif]\n')
}

async function download(orthoId, out) {
  const path = CROPPED_COG(orthoId)
  console.log(`Downloading ${BUCKET}/${path} ...`)
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw new Error(`download failed: ${error.message} (has this ortho been cropped?)`)
  const buf = Buffer.from(await data.arrayBuffer())
  const dest = out || join(process.cwd(), `${orthoId}_cropped_rgb.tif`)
  writeFileSync(dest, buf)
  const count = await labelCount(orthoId)
  console.log(`\n✅ Saved ${(buf.length / 1e6).toFixed(1)} MB -> ${dest}`)
  console.log(`   In-boundary plant count for this ortho: ${count.toLocaleString()}`)
  console.log(`\n   Put that path in your config's layers.rgb.input and that count in "plant_count".\n`)
}

const id = process.argv[2]
const out = process.argv[3]
;(id ? download(id, out) : list()).catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
