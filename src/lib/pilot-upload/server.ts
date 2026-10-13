import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const supabaseAdmin: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

export interface PilotLinkRow {
  id: string
  token: string
  pilot_name: string | null
  pilot_email: string | null
  client_name: string
  site_name: string | null
  instructions: string | null
  status: 'open' | 'submitted' | 'closed'
  max_files: number
  expires_at: string | null
  file_count: number
  total_bytes: number
}

/** Look a link up by token; returns a ready-made error response when it can't be used. */
export async function loadLink(token: string): Promise<{ link: PilotLinkRow | null; errorResponse: NextResponse | null }> {
  if (!TOKEN_RE.test(token)) {
    return { link: null, errorResponse: NextResponse.json({ error: 'This upload link is invalid.' }, { status: 404 }) }
  }
  const { data, error } = await supabaseAdmin
    .from('pilot_upload_links')
    .select('id, token, pilot_name, pilot_email, client_name, site_name, instructions, status, max_files, expires_at, file_count, total_bytes')
    .eq('token', token)
    .single()
  if (error || !data) {
    return { link: null, errorResponse: NextResponse.json({ error: 'This upload link is invalid.' }, { status: 404 }) }
  }
  return { link: data as PilotLinkRow, errorResponse: null }
}

export function linkIsOpen(link: PilotLinkRow): string | null {
  if (link.status === 'closed') return 'This upload link has been closed.'
  if (link.expires_at && new Date(link.expires_at) < new Date()) return 'This upload link has expired.'
  return null
}

/** Every file row for a link. PostgREST caps a query at 1,000 rows, so page through — a flight is 2,000+ files. */
export async function allFiles<T = Record<string, unknown>>(linkId: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('pilot_upload_files')
      .select(columns)
      .eq('link_id', linkId)
      .order('file_name')
      .range(from, from + 999)
    if (error || !data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

/** Recompute file_count / total_bytes from the files table (keeps the link row honest). */
export async function refreshLinkTotals(linkId: string) {
  const files = await allFiles<{ size_bytes: number }>(linkId, 'size_bytes')
  await supabaseAdmin
    .from('pilot_upload_links')
    .update({
      file_count: files.length,
      total_bytes: files.reduce((s, f) => s + Number(f.size_bytes || 0), 0),
      last_upload_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', linkId)
}

export async function sendOperatorEmail(subject: string, html: string, replyTo?: string | null) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const from = process.env.CONTACT_NOTIFY_FROM || 'PLNT <onboarding@resend.dev>'
  const to = process.env.CONTACT_NOTIFY_TO || 'porter@plnt.net'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], ...(replyTo ? { reply_to: replyTo } : {}), subject, html }),
    })
    if (!res.ok) console.error('[pilot-upload] Resend failed:', res.status, await res.text())
  } catch (err) {
    console.error('[pilot-upload] Resend threw:', err)
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
