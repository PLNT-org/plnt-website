import { NextRequest, NextResponse } from 'next/server'
import { escapeHtml, loadLink, linkIsOpen, refreshLinkTotals, sendOperatorEmail, supabaseAdmin } from '@/lib/pilot-upload/server'

export const dynamic = 'force-dynamic'

// POST - The pilot says the upload is complete. Marks the link submitted and
// emails the operator a summary (count, size, GPS coverage, their notes).
// The link stays usable afterwards in case they find a missed folder.
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const { link, errorResponse } = await loadLink(params.token)
  if (!link) return errorResponse ?? NextResponse.json({ error: 'This upload link is invalid.' }, { status: 404 })
  const closed = linkIsOpen(link)
  if (closed) return NextResponse.json({ error: closed }, { status: 403 })

  let body: { pilot_name?: string; pilot_email?: string; notes?: string } = {}
  try { body = await request.json() } catch { /* notes are optional */ }
  const pilotName = String(body.pilot_name || link.pilot_name || '').trim().slice(0, 120)
  const pilotEmail = String(body.pilot_email || link.pilot_email || '').trim().toLowerCase().slice(0, 200)
  const notes = String(body.notes || '').trim().slice(0, 4000)

  await refreshLinkTotals(link.id)
  const { data: files } = await supabaseAdmin
    .from('pilot_upload_files')
    .select('size_bytes, lat, lon, rel_alt_m, gimbal_pitch_deg, captured_at, camera_model, gps_status')
    .eq('link_id', link.id)
  const all = files || []
  if (!all.length) return NextResponse.json({ error: 'No files have been uploaded yet.' }, { status: 400 })

  const now = new Date().toISOString()
  await supabaseAdmin
    .from('pilot_upload_links')
    .update({
      status: 'submitted', submitted_at: now, submitted_notes: notes || null,
      ...(pilotName ? { pilot_name: pilotName } : {}), ...(pilotEmail.includes('@') ? { pilot_email: pilotEmail } : {}),
      updated_at: now,
    })
    .eq('id', link.id)

  // Summary for the notification.
  const gb = all.reduce((s, f) => s + Number(f.size_bytes || 0), 0) / 1e9
  const withGps = all.filter((f) => f.lat != null && f.lon != null)
  const alts = all.map((f) => f.rel_alt_m).filter((v): v is number => typeof v === 'number')
  const nadir = all.filter((f) => typeof f.gimbal_pitch_deg === 'number' && f.gimbal_pitch_deg <= -80).length
  const times = all.map((f) => f.captured_at).filter(Boolean).sort() as string[]
  const models = Array.from(new Set(all.map((f) => f.camera_model).filter(Boolean)))
  const rtk = all.filter((f) => f.gps_status === 'RTK').length
  const siteUrl = (process.env.SITE_URL || 'https://plnt.net').replace(/\/$/, '')
  const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${k}</td><td>${v}</td></tr>`
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#0f2e1d">
      <h2 style="margin:0 0 16px">Pilot upload submitted — ${escapeHtml(link.client_name)}${link.site_name ? ` / ${escapeHtml(link.site_name)}` : ''}</h2>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Pilot', escapeHtml(pilotName || '—') + (pilotEmail ? ` &lt;${escapeHtml(pilotEmail)}&gt;` : ''))}
        ${row('Files', `${all.length} (${gb.toFixed(2)} GB)`)}
        ${row('With GPS', `${withGps.length} of ${all.length}${rtk ? ` · ${rtk} RTK` : ''}`)}
        ${row('Altitude AGL', alts.length ? `${Math.min(...alts).toFixed(0)}–${Math.max(...alts).toFixed(0)} m` : '—')}
        ${row('Nadir frames', `${nadir} of ${all.length}`)}
        ${row('Captured', times.length ? `${times[0].slice(0, 16).replace('T', ' ')} → ${times[times.length - 1].slice(0, 16).replace('T', ' ')} UTC` : '—')}
        ${row('Camera', escapeHtml(models.join(', ') || '—'))}
        ${row('Fetch', `<code>node scripts/fetch-pilot-upload.mjs ${escapeHtml(link.token)} ~/Desktop/PLNT/&lt;client&gt;</code>`)}
        ${row('Admin', `<a href="${siteUrl}/dashboard/admin/pilot-uploads">${siteUrl}/dashboard/admin/pilot-uploads</a>`)}
      </table>
      ${notes ? `<p style="margin:16px 0 4px;color:#6b7280;font-size:14px">Pilot notes</p><p style="margin:0;white-space:pre-wrap">${escapeHtml(notes)}</p>` : ''}
    </div>`
  await sendOperatorEmail(
    `Pilot upload: ${link.client_name}${link.site_name ? ` / ${link.site_name}` : ''} — ${all.length} files`,
    html, pilotEmail.includes('@') ? pilotEmail : null,
  )
  return NextResponse.json({ ok: true, file_count: all.length, total_bytes: Math.round(gb * 1e9) })
}
