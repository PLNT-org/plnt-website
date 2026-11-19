#!/usr/bin/env node
/**
 * Export the Sales Desk to HubSpot import files, from the command line.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   node scripts/export-hubspot.mjs [output-dir]
 *
 * Writes the same files the "Export for HubSpot" button on plnt.net/sales
 * produces (see src/app/sales/hubspot-export.js for the format and the
 * reasoning), into output-dir (default ./hubspot-export-YYYY-MM-DD). Read-only
 * against Supabase. Times are written in the machine's local time zone; set
 * TZ=America/Los_Angeles to pin it.
 */
import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (source .env.local).')
  process.exit(1)
}

// The builder is plain ESM in a package without "type": "module", so load it
// through a temporary .mjs copy rather than importing the .js path directly.
const here = path.dirname(fileURLToPath(import.meta.url))
const src = await readFile(path.join(here, '../src/app/sales/hubspot-export.js'), 'utf8')
const tmp = path.join(os.tmpdir(), `hubspot-export-${process.pid}.mjs`)
await writeFile(tmp, src)
const { buildHubspotExport } = await import(pathToFileURL(tmp).href)

const sb = createClient(url, key, { auth: { persistSession: false } })
const orgs = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('sales_orgs').select('id,doc').range(from, from + 999)
  if (error) { console.error('Could not read sales_orgs:', error.message); process.exit(1) }
  orgs.push(...data.map((r) => ({ id: r.id, ...r.doc })))
  if (data.length < 1000) break
}
const { data: team } = await sb.from('sales_settings').select('doc').eq('id', 'team').maybeSingle()
const ownerEmails = {}
for (const [email, name] of Object.entries(team?.doc?.byEmail || {})) {
  if (!ownerEmails[name] || /@plnt\.net$/.test(email)) ownerEmails[name] = email
}
// A record can also be owned by a raw login email (an alternate sign-in for the
// same person); point those at that person's primary address too.
for (const [email, name] of Object.entries(team?.doc?.byEmail || {})) ownerEmails[email] = ownerEmails[name]

const { files, summary } = buildHubspotExport(orgs, { ownerEmails })
const d = new Date()
const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const out = path.resolve(process.argv[2] || `hubspot-export-${stamp}`)
await mkdir(out, { recursive: true })
for (const [name, text] of Object.entries(files)) await writeFile(path.join(out, name), text)
console.log(`Wrote ${Object.keys(files).length} files to ${out}`)
console.log(JSON.stringify(summary, null, 2))
