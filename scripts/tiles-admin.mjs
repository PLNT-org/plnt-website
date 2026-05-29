// tiles-admin.mjs — manage share tile storage.
//
//   set -a; source .env.local; set +a
//   node scripts/tiles-admin.mjs migrate <shareId>        # public orthomosaic-tiles -> private property-shares, then delete public
//   node scripts/tiles-admin.mjs delete-public <shareId>  # recursively delete a share's public tiles
//
// Used to move legacy POC tiles behind the gated proxy (private bucket).

import { createClient } from '@supabase/supabase-js'

const PUBLIC_BUCKET = 'orthomosaic-tiles'
const PRIVATE_BUCKET = 'property-shares'
const CONCURRENCY = 24

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Supabase list() returns one level; subfolders are entries with a null id.
async function listAll(bucket, prefix) {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const e of data) {
      const full = `${prefix}/${e.name}`
      if (e.id === null) out.push(...(await listAll(bucket, full)))
      else out.push(full)
    }
    if (data.length < 1000) break
    offset += data.length
  }
  return out
}

async function deletePublic(shareId) {
  const paths = await listAll(PUBLIC_BUCKET, `property/${shareId}`)
  console.log(`deleting ${paths.length} public tiles for ${shareId}`)
  for (let i = 0; i < paths.length; i += 1000) {
    const { error } = await supabase.storage.from(PUBLIC_BUCKET).remove(paths.slice(i, i + 1000))
    if (error) throw new Error(error.message)
  }
  console.log('done')
}

async function migrate(shareId) {
  const prefix = `property/${shareId}`
  const paths = await listAll(PUBLIC_BUCKET, prefix)
  console.log(`migrating ${paths.length} tiles for ${shareId} -> private`)
  let done = 0
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (src) => {
      const rel = src.slice(prefix.length + 1) // <layer>/<z>/<x>/<y>.png
      const dest = `${shareId}/tiles/${rel}`
      const { data, error } = await supabase.storage.from(PUBLIC_BUCKET).download(src)
      if (error || !data) throw new Error(`download ${src}: ${error?.message}`)
      const buf = Buffer.from(await data.arrayBuffer())
      const up = await supabase.storage.from(PRIVATE_BUCKET).upload(dest, buf, { contentType: 'image/png', upsert: true })
      if (up.error) throw new Error(`upload ${dest}: ${up.error.message}`)
    }))
    done += batch.length
    process.stdout.write(`\r  ${done}/${paths.length}`)
  }
  process.stdout.write('\n')
  console.log('migrated; deleting public copies...')
  await deletePublic(shareId)
}

const [, , cmd, shareId] = process.argv
if (!cmd || !shareId) {
  console.error('Usage: node scripts/tiles-admin.mjs <migrate|delete-public> <shareId>')
  process.exit(1)
}
const fn = cmd === 'migrate' ? migrate : cmd === 'delete-public' ? deletePublic : null
if (!fn) {
  console.error(`Unknown command: ${cmd}`)
  process.exit(1)
}
fn(shareId).catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
