#!/usr/bin/env node
/**
 * One-time import of Sales Desk records into Supabase.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   node scripts/import-sales-desk.mjs /path/to/export
 *
 * The export directory holds one JSON file per record:
 *   orgs/<id>.json        -> sales_orgs
 *   templates/<id>.json   -> sales_templates
 *   settings/<id>.json    -> sales_settings   (e.g. settings/team.json)
 *
 * Each file is either the document body itself, or the {id, data, ...}
 * envelope the artifact database export writes; both shapes are accepted.
 * Rows are upserted by id, so re-running is safe. Writes go to PRODUCTION
 * Supabase with the service role — be deliberate.
 */
import { createClient } from '@supabase/supabase-js'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (source .env.local).')
  process.exit(1)
}
const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node scripts/import-sales-desk.mjs <export-dir>')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })
const MAP = { orgs: 'sales_orgs', templates: 'sales_templates', settings: 'sales_settings' }

async function loadDir(sub) {
  let files
  try {
    files = (await readdir(path.join(dir, sub))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const rows = []
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(dir, sub, f), 'utf8'))
    const id = raw?.id && raw?.data ? raw.id : path.basename(f, '.json')
    const doc = raw?.id && raw?.data ? raw.data : raw
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      console.warn(`skip ${sub}/${f}: not an object`)
      continue
    }
    rows.push({ id, doc, updated_at: doc.updatedAt || new Date().toISOString() })
  }
  return rows
}

for (const [sub, table] of Object.entries(MAP)) {
  const rows = await loadDir(sub)
  if (!rows.length) {
    console.log(`${table}: nothing to import`)
    continue
  }
  let done = 0
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const { error } = await sb.from(table).upsert(batch, { onConflict: 'id' })
    if (error) {
      console.error(`${table}: batch starting at ${i} failed:`, error.message)
      process.exit(1)
    }
    done += batch.length
  }
  console.log(`${table}: upserted ${done} rows`)
}
console.log('Import complete.')
