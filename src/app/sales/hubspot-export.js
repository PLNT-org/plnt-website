/* Sales Desk -> HubSpot import files.
 *
 * Pure functions, no DOM and no network, so the same code runs in the browser
 * (the "Export for HubSpot" button) and in Node (scripts/export-hubspot.mjs).
 *
 * HubSpot's importer (knowledge.hubspot.com/import-and-export) shapes the output:
 *  - One file may carry several objects per row; records on the same row are
 *    associated. Every desk organization has at most one contact and one open
 *    deal, so file 1 is one row per organization: company + contact + deal.
 *  - Companies de-duplicate on "Company Domain Name", contacts on "Email".
 *    Two desk organizations that share a website would collapse into one
 *    company, so only the first keeps the domain; the rest keep "Website URL".
 *  - Activities (calls, notes, tasks) are separate objects. They attach to
 *    records that already exist via a unique identifier on the row, so those
 *    files carry the contact's Email and/or the company's domain. An activity
 *    with neither cannot be linked; it is listed in a reference file instead,
 *    and every organization's full history also rides along on the company as
 *    one text property, so nothing is lost either way.
 *  - Dropdown values must match HubSpot's options. Deal stages map onto the
 *    default "Sales Pipeline"; the desk's own stage is kept in a text column.
 */

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'yahoo.ca', 'ymail.com', 'aol.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net', 'sbcglobal.net', 'att.net', 'verizon.net', 'cox.net', 'charter.net', 'bellsouth.net', 'earthlink.net', 'protonmail.com', 'proton.me'])

const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' }
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([k, v]) => [v.toLowerCase(), k]))

export const PLNT_STAGE = { cold: 'Cold outreach', demo_5acre: '5-acre demo', demo_video: 'Video demo', pilot: 'Paid pilot', paying: 'Paying', recurring: 'Recurring client', lost: 'Lost / On hold' }

/** Desk stage -> stage label in HubSpot's default "Sales Pipeline". Cold leads get no deal. */
export const HUBSPOT_DEAL_STAGE = {
  demo_5acre: 'Presentation Scheduled',
  demo_video: 'Presentation Scheduled',
  pilot: 'Decision Maker Bought-In',
  paying: 'Closed Won',
  recurring: 'Closed Won',
  lost: 'Closed Lost',
}
const LIFECYCLE = { cold: 'Lead', demo_5acre: 'Opportunity', demo_video: 'Opportunity', pilot: 'Opportunity', paying: 'Customer', recurring: 'Customer', lost: 'Lead' }
const CALL_OUTCOME = { connected: 'Connected', voicemail: 'Left voicemail', not_connected: 'No answer' }
const OUTCOME_LABEL = { connected: 'Connected', not_connected: 'Not connected', voicemail: 'Left voicemail', sent: 'Sent', replied: 'They replied', bounced: 'Bounced' }
const TITLE_WORDS = new Set(['owner', 'ceo', 'cfo', 'coo', 'cto', 'president', 'founder', 'partner', 'sales', 'operations', 'production', 'inventory', 'purchasing', 'shipping', 'office', 'admin', 'management', 'principal', 'head', 'lead', 'staff', 'unknown'])
const TASK_TYPE = { call: 'Call', email: 'Email', demo: 'To-do' }

// ---------- small helpers ----------
const pad = (n) => String(n).padStart(2, '0')
function fmtDate(d) {
  // Accepts YYYY-MM-DD (kept as that calendar day) or an ISO timestamp (local day).
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (m) return `${m[2]}/${m[3]}/${m[1]}`
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '' : `${pad(t.getMonth() + 1)}/${pad(t.getDate())}/${t.getFullYear()}`
}
function fmtDateTime(d, fallbackTime) {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (m) return `${m[2]}/${m[3]}/${m[1]} ${fallbackTime || '09:00'}`
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '' : `${pad(t.getMonth() + 1)}/${pad(t.getDate())}/${t.getFullYear()} ${pad(t.getHours())}:${pad(t.getMinutes())}`
}
function isoDay(d) {
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? String(d).slice(0, 10) : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
const html = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/** "Newton Nurseries https://newtonnurseries.com/ Wholesale" -> { name, website, channel } */
export function splitOrgName(raw) {
  raw = String(raw || '').trim()
  let name = raw, website = '', channel = ''
  const m = /\s*(https?:\/\/\S+|www\.\S+|(?<=\s)[a-z0-9-]+\.(?:com|net|org|app|us|ca)\b\/?)\s*/i.exec(raw)
  if (m) {
    website = m[1].replace(/\/+$/, '')
    name = raw.slice(0, m.index).trim()
    channel = raw.slice(m.index + m[0].length).trim()
  } else {
    const m2 = /^(.*\S)\s+((?:Wholesale|Grower|Retail|Retailer|Propagator)\b(?:[ /]+[A-Za-z]+)*)$/.exec(raw)
    if (m2) { name = m2[1]; channel = m2[2] }
  }
  name = name.replace(/\s+/g, ' ').replace(/^[\s\-,]+|[\s\-,]+$/g, '') || raw
  channel = channel.replace(/^[\s/]+|[\s/]+$/g, '')
  if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website
  return { name, website, channel: channel ? channel[0].toUpperCase() + channel.slice(1) : '' }
}
export function domainOf(urlOrEmail) {
  if (!urlOrEmail) return ''
  let s = String(urlOrEmail).trim().toLowerCase()
  if (s.includes('@') && !s.includes('/')) s = s.split('@').pop()
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : ''
}
function stateCode(explicit, address) {
  const e = String(explicit || '').trim()
  if (e) return US_STATES[e.toUpperCase()] ? e.toUpperCase() : STATE_BY_NAME[e.toLowerCase()] || e
  const a = String(address || '')
  const codes = [...a.matchAll(/(?:^|[\s,])([A-Za-z]{2})(?=[\s,.]|$|\s*\d{5})/g)].map((x) => x[1].toUpperCase()).filter((c) => US_STATES[c])
  if (codes.length) return codes[codes.length - 1]
  const low = a.toLowerCase()
  let best = ''
  for (const [nm, code] of Object.entries(STATE_BY_NAME)) if (low.includes(nm)) best = code
  return best
}
/** Best-effort split of the desk's free-text address into HubSpot's address fields. */
export function splitAddress(address, explicitState) {
  const a = String(address || '').trim()
  const out = { street: '', city: '', state: stateCode(explicitState, a), zip: '', country: '' }
  if (!a) return out
  if (/canada|british columbia|\bBC\b|alberta|ontario/i.test(a)) out.country = 'Canada'
  else if (out.state && US_STATES[out.state]) out.country = 'United States'
  // "Huntersville, North Carolina North Carolina 1" (imported "City, State State rank")
  let m = /^(.+?),\s+([A-Za-z .]+?)\s+\2\s+\d+$/.exec(a)
  if (m) { out.city = m[1].trim(); return out }
  // "Mount Vernon, WA Washington"
  m = /^(.+?),\s+([A-Z]{2})\s+[A-Za-z ]+$/.exec(a)
  if (m && !/\d/.test(m[1])) { out.city = m[1].trim(); return out }
  // "... , ST 12345"
  m = /^(.*?),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)(?:,?\s*(?:USA|United States))?$/.exec(a)
  if (m) {
    out.zip = m[3]
    const rest = m[1].replace(/,\s*$/, '')
    const i = rest.lastIndexOf(',')
    if (i >= 0) { out.street = rest.slice(0, i).trim(); out.city = rest.slice(i + 1).trim() } else out.street = rest.trim()
    return out
  }
  // "City, ST"
  m = /^([^,\d]+),\s*([A-Z]{2})$/.exec(a)
  if (m) { out.city = m[1].trim(); return out }
  out.street = a
  return out
}
function splitAcreage(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 20000 ? { n: '', note: `Recorded as ${v.toLocaleString('en-US')}; looks malformed, verify` } : { n: v, note: '' }
  const s = String(v ?? '').trim()
  if (!s) return { n: '', note: '' }
  return /^[\d,]+(\.\d+)?$/.test(s) ? { n: parseFloat(s.replace(/,/g, '')), note: '' } : { n: '', note: s }
}
/** "Nathan Bernhardt (CFO)" -> first/last + a role hint; group names stay whole in First Name. */
function splitPerson(name, role) {
  let n = String(name || '').trim()
  if (!n || n === '(unknown)') return { first: '', last: '', role: role || '' }
  let hint = ''
  if (!/ and |,|&/.test(n)) {
    const p = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(n)
    if (p) { n = p[1].trim(); hint = p[2].trim() }
  }
  if (/ and |,|&|\(/.test(n)) return { first: n, last: '', role: role || hint }
  const parts = n.split(/\s+/)
  let last = parts.slice(1).join(' ')
  let title = role || hint
  // The desk has a few contacts whose surname was typed into Role ("Kaleb" / "Sifers").
  // A single capitalised word that is not a recognisable job title is taken as the surname.
  if (!last && /^[A-Z][a-z'’-]+$/.test(title) && !TITLE_WORDS.has(title.toLowerCase()) && !/(er|or|ist|ant|ent|ian|ive|ing)$/.test(title)) { last = title; title = '' }
  return { first: parts[0], last, role: title }
}

/**
 * Build the HubSpot import bundle.
 * @param {Array<object>} orgs   desk organizations, each with an `id`
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.ownerEmails]  desk owner name -> HubSpot user email
 * @param {string} [opts.pipeline]  HubSpot pipeline label (default "Sales Pipeline")
 * @returns {{files: Record<string,string>, summary: object}}
 */
export function buildHubspotExport(orgs, opts = {}) {
  const ownerEmails = opts.ownerEmails || {}
  const pipeline = opts.pipeline || 'Sales Pipeline'
  const ownerEmail = (name) => {
    const n = String(name || '').trim()
    if (!n) return ''
    if (ownerEmails[n]) return ownerEmails[n]
    return n.includes('@') ? n : ''
  }
  const isTouch = (e) => e.type === 'call' || e.type === 'email' || e.type === 'demo'
  const AUTO_NOTE = /^(Imported from spreadsheet|Lead created)$/i

  const seenDomain = new Map()
  const sharedDomains = []
  const duplicates = []
  const sameName = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')
  const main = [], calls = [], notes = [], tasks = [], unlinked = []
  const sorted = [...orgs].sort((a, b) => String(a.name).localeCompare(String(b.name)))

  for (const o of sorted) {
    const { name, website, channel } = splitOrgName(o.name)
    const c = (o.contacts || []).find((x) => x.primary) || (o.contacts || [])[0] || null
    const email = c && c.email ? String(c.email).trim().toLowerCase() : ''
    const emailDomain = domainOf(email)
    let domain = domainOf(website) || (emailDomain && !FREE_MAIL.has(emailDomain) ? emailDomain : '')
    if (domain) {
      const first = seenDomain.get(domain)
      if (!first) seenDomain.set(domain, name)
      else if (sameName(first, name)) duplicates.push(`${name} (${domain})`) // same nursery entered twice: keep the domain so HubSpot merges the rows
      else { sharedDomains.push(`${name} (shares ${domain} with ${first})`); domain = '' } // different branch: keep them separate
    }
    const addr = splitAddress(o.address, o.state)
    const acres = splitAcreage(o.acreage)
    const person = splitPerson(c && c.name, c && c.role)
    const owner = ownerEmail(o.owner)
    const log = [...(o.log || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))
    const touches = log.filter(isTouch)
    const last = touches[touches.length - 1]
    const stage = o.stage || 'cold'
    const contactName = (id) => ((o.contacts || []).find((x) => x.id === id) || {}).name || ''

    // Whole history as text on the company, so it survives even where an
    // activity cannot be linked to a record.
    const history = log.filter((e) => !(e.type === 'note' && AUTO_NOTE.test(e.notes || ''))).map((e) => {
      const what = e.type === 'stage' ? `Stage: ${e.notes || ''}` : e.type === 'note' ? `Note: ${oneLine(e.notes)}` : `${e.type[0].toUpperCase() + e.type.slice(1)}${e.outcome ? ' · ' + (OUTCOME_LABEL[e.outcome] || e.outcome) : ''}${contactName(e.contactId) ? ' · ' + contactName(e.contactId) : ''}${e.notes ? ' — ' + oneLine(e.notes) : ''}`
      const nx = e.next && e.next.date && TASK_TYPE[e.next.type] ? ` | Next: ${e.next.type} ${fmtDate(e.next.date)}` : ''
      return `${isoDay(e.at)} · ${what}${e.by ? ' (' + e.by + ')' : ''}${nx}`
    }).join('\n')

    // Lead status for the contact, from how far the conversation got.
    let leadStatus = ''
    if (c) {
      if (stage === 'lost') leadStatus = 'Bad Timing'
      else if (stage !== 'cold') leadStatus = 'Open Deal'
      else if (touches.some((e) => e.outcome === 'connected' || e.outcome === 'replied')) leadStatus = 'Connected'
      else if (touches.length) leadStatus = 'Attempted to Contact'
      else leadStatus = 'New'
    }

    const hasDeal = !!HUBSPOT_DEAL_STAGE[stage]
    const monthly = typeof o.monthly === 'number' ? o.monthly : parseFloat(o.monthly) || ''
    const hasContact = !!(c && (email || person.first || person.last))

    main.push([
      // company
      name, domain, website, addr.street, addr.city, addr.state, addr.zip, addr.country, oneLine(o.notes), owner, LIFECYCLE[stage] || 'Lead',
      acres.n, acres.note, o.plantTypes || '', o.inventory || '', PLNT_STAGE[stage] || stage, channel, o.id,
      c ? [c.name && c.name !== '(unknown)' ? c.name : '', c.role, c.phone, c.email].filter(Boolean).join(' · ') : '',
      touches.length || '', last ? fmtDate(last.at) : '', history,
      // contact
      hasContact ? person.first : '', hasContact ? person.last : '', hasContact ? email : '', hasContact ? (c.phone || '') : '', hasContact ? person.role : '',
      hasContact ? owner : '', hasContact ? leadStatus : '', hasContact ? (LIFECYCLE[stage] || 'Lead') : '', hasContact ? oneLine(c.notes) : '',
      // deal
      hasDeal ? `${name} – PLNT inventory service` : '', hasDeal ? pipeline : '', hasDeal ? HUBSPOT_DEAL_STAGE[stage] : '', hasDeal ? monthly : '',
      hasDeal ? owner : '', hasDeal ? (stage === 'demo_5acre' ? '5-acre on-site' : stage === 'demo_video' ? 'Video call' : '') : '',
      hasDeal ? fmtDate(o.demoDate) : '', hasDeal ? fmtDate(o.pilotStart) : '', hasDeal && stage === 'lost' ? (o.lostReason || '') : '', hasDeal ? (PLNT_STAGE[stage] || stage) : '',
    ])

    // ---- activities: need an identifier HubSpot can match to an existing record ----
    const linkable = !!(email || domain)
    const idCols = (e) => {
      const who = (o.contacts || []).find((x) => x.id === e.contactId)
      const em = who && who.email ? String(who.email).trim().toLowerCase() : email
      return [em, domain]
    }
    for (const e of log) {
      if (e.type === 'note' && AUTO_NOTE.test(e.notes || '')) continue
      const by = ownerEmail(e.by) || owner
      const who = contactName(e.contactId)
      const nx = e.next && e.next.date && TASK_TYPE[e.next.type] ? `Next step set: ${e.next.type} on ${fmtDate(e.next.date)}` : ''
      if (!linkable) {
        unlinked.push([name, isoDay(e.at), e.type, OUTCOME_LABEL[e.outcome] || '', who, e.by || '', oneLine(e.notes), nx])
        continue
      }
      if (e.type === 'call') {
        const body = [e.notes ? html(e.notes) : `Call ${OUTCOME_LABEL[e.outcome] ? '(' + OUTCOME_LABEL[e.outcome].toLowerCase() + ')' : 'logged'}; no notes recorded.`, nx].filter(Boolean).join('<br><br>')
        calls.push([`Call${who ? ' with ' + who : ''} · ${name}`, body, fmtDateTime(e.at), CALL_OUTCOME[e.outcome] || '', 'Outbound', by, ...idCols(e)])
      } else {
        const head = e.type === 'email' ? `Email ${(OUTCOME_LABEL[e.outcome] || 'logged').toLowerCase()}${who ? ' · ' + who : ''}` : e.type === 'demo' ? `Demo${who ? ' with ' + who : ''}` : e.type === 'stage' ? `Stage change: ${e.notes || ''}` : 'Note'
        const body = e.type === 'stage' ? `<b>${html(head)}</b>` : [`<b>${html(head)}</b>`, e.notes ? html(e.notes) : '', nx].filter(Boolean).join('<br>')
        notes.push([body, fmtDateTime(e.at), by, ...idCols(e)])
      }
    }
    for (const k of o.contacts || []) {
      const n = k.next
      if (!n || !n.date || !TASK_TYPE[n.type]) continue
      const em = k.email ? String(k.email).trim().toLowerCase() : ''
      const who = k.name && k.name !== '(unknown)' ? k.name : ''
      const title = `${n.type === 'demo' ? 'Demo' : n.type === 'email' ? 'Email' : 'Call'} ${who || name}${who ? ' · ' + name : ''}`
      const detail = [n.note, k.phone ? 'Phone: ' + k.phone : '', k.lastOutcome ? `Last outcome: ${OUTCOME_LABEL[k.lastOutcome] || k.lastOutcome}${k.lastAt ? ' on ' + fmtDate(k.lastAt) : ''}` : ''].filter(Boolean).join('<br>')
      if (!(em || domain)) { unlinked.push([name, n.date, 'follow-up ' + n.type, '', who, o.owner || '', oneLine(n.note), '']); continue }
      tasks.push([title, fmtDateTime(n.date, '09:00'), TASK_TYPE[n.type], 'Not started', detail, owner, em, domain])
    }
  }

  const H_MAIN = [
    'Company name', 'Company Domain Name', 'Website URL', 'Street Address', 'City', 'State/Region', 'Postal Code', 'Country/Region', 'Description', 'Company owner', 'Company Lifecycle Stage',
    'Acreage', 'Acreage note', 'Plant types', 'Critical inventory information', 'PLNT stage', 'Channel', 'PLNT Sales Desk ID',
    'Primary contact (PLNT)', 'PLNT touches', 'PLNT last activity date', 'PLNT activity history',
    'First Name', 'Last Name', 'Email', 'Phone Number', 'Job Title', 'Contact owner', 'Lead Status', 'Lifecycle Stage', 'Contact notes (PLNT)',
    'Deal Name', 'Pipeline', 'Deal Stage', 'Amount', 'Deal owner', 'Demo type', 'Demo date', 'Pilot start date', 'Closed Lost Reason', 'PLNT deal stage',
  ]
  const H_CALLS = ['Call Title', 'Call notes', 'Activity date', 'Call outcome', 'Call direction', 'Activity assigned to', 'Email', 'Company Domain Name']
  const H_NOTES = ['Note body', 'Activity date', 'Activity assigned to', 'Email', 'Company Domain Name']
  const H_TASKS = ['Task title', 'Due date', 'Task type', 'Task status', 'Task notes', 'Activity assigned to', 'Email', 'Company Domain Name']
  const H_UNLINKED = ['Organization', 'Date', 'Type', 'Outcome', 'Contact', 'Rep', 'Notes', 'Next step']

  const col = (h) => H_MAIN.indexOf(h)
  const summary = {
    companies: main.length,
    contacts: main.filter((r) => r[col('Email')] || r[col('First Name')] || r[col('Last Name')]).length,
    contactsWithEmail: main.filter((r) => r[col('Email')]).length,
    deals: main.filter((r) => r[col('Deal Name')]).length,
    companiesWithDomain: main.filter((r) => r[col('Company Domain Name')]).length,
    calls: calls.length, notes: notes.length, tasks: tasks.length, unlinked: unlinked.length,
    sharedDomains,
    duplicates,
    ownersWithoutEmail: [...new Set(sorted.map((o) => o.owner).filter((n) => n && !ownerEmail(n)))],
  }

  const files = {
    '1-companies-contacts-deals.csv': toCsv(H_MAIN, main),
    '2-calls.csv': toCsv(H_CALLS, calls),
    '3-notes.csv': toCsv(H_NOTES, notes),
    '4-tasks.csv': toCsv(H_TASKS, tasks),
    'reference-activities-not-linked.csv': toCsv(H_UNLINKED, unlinked),
    'README.txt': readme(summary, pipeline),
  }
  return { files, summary }
}

function readme(s, pipeline) {
  return `PLNT Sales Desk -> HubSpot import
Generated ${fmtDateTime(new Date().toISOString())} (local time)

WHAT IS IN THIS FOLDER
  1-companies-contacts-deals.csv   ${s.companies} companies, ${s.contacts} contacts (${s.contactsWithEmail} with email), ${s.deals} deals. One row per organization.
  2-calls.csv                      ${s.calls} logged calls
  3-notes.csv                      ${s.notes} notes: emails sent, demos, stage changes, free-form notes
  4-tasks.csv                      ${s.tasks} scheduled follow-ups, as HubSpot tasks
  reference-activities-not-linked.csv   ${s.unlinked} activities that HubSpot cannot attach to a record (see below). Do not import.

IMPORT ORDER  (HubSpot: CRM > Contacts > Import > Start an import > Import file from computer)

  Step 1. Create these custom properties first (Settings > Properties), or create them from the
          mapping screen with "Create new property" when HubSpot shows the column as unmapped.
     Company:  Acreage (Number) · Acreage note (Single-line text) · Plant types (Single-line text)
               Critical inventory information (Multi-line text) · PLNT stage (Single-line text)
               Channel (Single-line text) · PLNT Sales Desk ID (Single-line text)
               Primary contact (PLNT) (Single-line text) · PLNT touches (Number)
               PLNT last activity date (Date picker) · PLNT activity history (Multi-line text)
     Contact:  Contact notes (PLNT) (Multi-line text)
     Deal:     Demo type (Single-line text) · Demo date (Date picker) · Pilot start date (Date picker)
               PLNT deal stage (Single-line text)

  Step 2. Import 1-companies-contacts-deals.csv
     - Choose "One file" then "Multiple objects", and tick Companies, Contacts, Deals.
     - Choose "Create and update" for each object.
     - On the mapping screen, check which object each column belongs to. The file is ordered
       company columns, then contact columns (First Name ... Contact notes), then deal columns
       (Deal Name ... PLNT deal stage). "Company Lifecycle Stage" maps to the COMPANY property
       "Lifecycle Stage"; the plain "Lifecycle Stage" column maps to the CONTACT property.
     - Date format: Month Day Year (MM/DD/YYYY).
     - Deal Stage uses HubSpot's default "${pipeline}" stage names:
         5-acre demo / Video demo -> Presentation Scheduled
         Paid pilot               -> Decision Maker Bought-In
         Paying / Recurring       -> Closed Won
         Lost / On hold           -> Closed Lost
       The original stage is kept in "PLNT deal stage". If you would rather have your own
       pipeline, create it first with stages named as you like, then use "Edit errored values"
       on the mapping screen to point each stage at yours.
     - Owner columns hold HubSpot user emails. If an email is not a user in your HubSpot
       account, the importer flags it; pick the right user under "Edit errored values".

  Step 3. Import 2-calls.csv, then 3-notes.csv, then 4-tasks.csv  (one import each)
     - Choose "One file" then "Multiple objects": tick the activity (Calls, Notes or Tasks)
       plus Contacts and Companies.
     - Map "Email" to the Contact property Email and "Company Domain Name" to the Company
       property. Those two columns are how each activity finds the record it belongs to, so
       step 2 must be finished first.
     - For Contacts and Companies choose "Update existing only" so no new records are made.
     - Date format: Month Day Year, with your time zone.
     - Call outcome uses HubSpot's default labels (Connected, Left voicemail, No answer) and
       Call direction is Outbound. Task type is Call, Email or To-do; Task status is Not started.

THINGS TO KNOW
  - HubSpot matches companies on domain and contacts on email. ${s.companiesWithDomain} of ${s.companies} companies have a domain.
    Companies without one import fine but cannot be matched later, so re-importing this file
    would duplicate them. Import file 1 once.
  - ${s.contacts - s.contactsWithEmail} contacts have no email. HubSpot creates them from the name but cannot
    de-duplicate them. Each company also carries "Primary contact (PLNT)" with the name, role,
    phone and email as text, so the detail is on the company either way.
  - Every company carries "PLNT activity history": its full call, email and stage history as
    text. That is the complete record. Files 2 to 4 additionally create real HubSpot
    activities wherever a contact email or company domain exists to attach them to.
  - ${s.unlinked} activities belong to organizations with neither, and are listed in
    reference-activities-not-linked.csv for your records.
${s.duplicates.length ? `  - These organizations appear twice in the Sales Desk with the same name and website. Both
    rows keep the domain, so HubSpot merges each pair into one company:
${s.duplicates.map((x) => '      ' + x).join('\n')}
` : ''}${s.sharedDomains.length ? `  - These organizations share a website with another row. Only the first keeps the domain, so
    HubSpot does not merge them into one company; the website stays in "Website URL":
${s.sharedDomains.map((x) => '      ' + x).join('\n')}
` : ''}${s.ownersWithoutEmail.length ? `  - No HubSpot email is known for these owners, so their owner columns are blank:
      ${s.ownersWithoutEmail.join(', ')}
` : ''}  - Acreage is a number only where it is confirmed. Text such as "Needs verification" is in
    "Acreage note".
`
}
