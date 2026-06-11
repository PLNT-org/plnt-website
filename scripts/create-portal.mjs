// create-portal.mjs — mint a stable per-client portal link.
//
// A portal is one permanent /portal/<token> URL for a client. After they enter
// an email on the portal's allowlist, they see every property_share that email
// is authorized for and can switch between locations — independent of any single
// map, so the link never breaks when a survey is re-flighted or replaced.
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (optionally SITE_URL for the printed link).
//
// Usage:
//   set -a; source .env.local; set +a
//   node scripts/create-portal.mjs "Shade Trees Nursery" porter@plnt.net,myles@shadetreesnursery.com
//   node scripts/create-portal.mjs                       # interactive prompts
//
// Re-run with an existing portal token as the 3rd arg to REPLACE its email list:
//   node scripts/create-portal.mjs "Label" a@b.com,c@d.com <existing-portal-token>

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { createInterface } from 'readline/promises'

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '')

function normalizeEmails(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/)
  return Array.from(new Set(raw.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@'))))
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env')
  const supabase = createClient(url, key)

  let [, , label, emailsArg, existingToken] = process.argv

  if (!emailsArg) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    label = label || (await rl.question('Client label (for your reference): ')).trim()
    emailsArg = (await rl.question('Authorized emails, comma-separated: ')).trim()
    existingToken = (await rl.question('Existing portal token to update (blank for new): ')).trim()
    rl.close()
  }

  const allowed_emails = normalizeEmails(emailsArg)
  if (allowed_emails.length === 0) throw new Error('At least one valid email is required')

  let token
  if (existingToken) {
    const { error } = await supabase
      .from('client_portals')
      .update({ label: label || null, allowed_emails, updated_at: new Date().toISOString() })
      .eq('token', existingToken)
    if (error) throw new Error(`Update portal: ${error.message}`)
    token = existingToken
    console.log(`\n✅ Updated portal "${label || existingToken}"`)
  } else {
    token = randomBytes(24).toString('base64url')
    const { error } = await supabase
      .from('client_portals')
      .insert({ token, label: label || null, allowed_emails })
    if (error) throw new Error(`Insert portal: ${error.message}`)
    console.log(`\n✅ Created portal "${label || token}"`)
  }

  console.log(`   Authorized: ${allowed_emails.join(', ')}`)
  console.log(`\n   Portal link:  ${SITE_URL}/portal/${token}\n`)
}

main().catch((e) => {
  console.error('\n❌', e.message || e)
  process.exit(1)
})
