import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { supabaseAdmin } from '@/lib/pilot-upload/server'
import { PILOT_UPLOAD_BUCKET } from '@/lib/pilot-upload/shared'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireAdmin(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return { user: null, errorResponse }
  if (!isAdmin) return { user: null, errorResponse: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, errorResponse: null }
}

/** Make sure the bucket exists (the migration also creates it; this covers a project where it wasn't run). */
async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(PILOT_UPLOAD_BUCKET)
  if (data) return
  await supabaseAdmin.storage.createBucket(PILOT_UPLOAD_BUCKET, {
    public: false,
    fileSizeLimit: 200 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/tiff', 'image/x-adobe-dng', 'application/octet-stream'],
  })
}

// GET - all links, newest first, with their totals.
export async function GET(request: NextRequest) {
  const { errorResponse } = await requireAdmin(request)
  if (errorResponse) return errorResponse
  const { data, error } = await supabaseAdmin
    .from('pilot_upload_links')
    .select('id, token, pilot_name, pilot_email, client_name, site_name, instructions, status, max_files, expires_at, submitted_at, submitted_notes, file_count, total_bytes, last_upload_at, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data })
}

// POST - create a link. Body: { client_name, site_name?, pilot_name?, pilot_email?, instructions?, expires_in_days?, max_files? }
export async function POST(request: NextRequest) {
  const { user, errorResponse } = await requireAdmin(request)
  if (errorResponse) return errorResponse
  const body = await request.json()
  const clientName = String(body.client_name || '').trim()
  if (!clientName) return NextResponse.json({ error: 'client_name is required' }, { status: 400 })
  await ensureBucket()
  const days = Number(body.expires_in_days)
  const expires_at = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86400e3).toISOString() : null
  const maxFiles = Math.min(Math.max(Number(body.max_files) || 5000, 10), 50000)
  const row = {
    token: randomBytes(24).toString('base64url'),
    client_name: clientName,
    site_name: String(body.site_name || '').trim() || null,
    pilot_name: String(body.pilot_name || '').trim() || null,
    pilot_email: String(body.pilot_email || '').trim().toLowerCase() || null,
    instructions: String(body.instructions || '').trim() || null,
    expires_at, max_files: maxFiles, created_by: user.id,
  }
  const { data, error } = await supabaseAdmin.from('pilot_upload_links').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data })
}

// PATCH - edit metadata or status. Body: { id, ...fields }
export async function PATCH(request: NextRequest) {
  const { errorResponse } = await requireAdmin(request)
  if (errorResponse) return errorResponse
  const body = await request.json()
  if (!body.id || !UUID_RE.test(body.id)) return NextResponse.json({ error: 'Valid id is required' }, { status: 400 })
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['client_name', 'site_name', 'pilot_name', 'instructions']) {
    if (typeof body[k] === 'string') update[k] = body[k].trim() || null
  }
  if (typeof body.pilot_email === 'string') update.pilot_email = body.pilot_email.trim().toLowerCase() || null
  if (body.status && ['open', 'submitted', 'closed'].includes(body.status)) update.status = body.status
  if (body.expires_at === null) update.expires_at = null
  else if (typeof body.expires_at === 'string' && !Number.isNaN(Date.parse(body.expires_at))) update.expires_at = body.expires_at
  if (Number.isFinite(Number(body.max_files))) update.max_files = Math.min(Math.max(Number(body.max_files), 10), 50000)
  if (update.client_name === null) return NextResponse.json({ error: 'client_name cannot be empty' }, { status: 400 })
  const { data, error } = await supabaseAdmin.from('pilot_upload_links').update(update).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data })
}

// DELETE ?id= - remove a link and every file it received.
export async function DELETE(request: NextRequest) {
  const { errorResponse } = await requireAdmin(request)
  if (errorResponse) return errorResponse
  const id = request.nextUrl.searchParams.get('id') || ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Valid id is required' }, { status: 400 })
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabaseAdmin.storage.from(PILOT_UPLOAD_BUCKET).list(id, { limit: 1000, offset })
    if (!data?.length) break
    await supabaseAdmin.storage.from(PILOT_UPLOAD_BUCKET).remove(data.map((o) => `${id}/${o.name}`))
    if (data.length < 1000) break
  }
  const { error } = await supabaseAdmin.from('pilot_upload_links').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
