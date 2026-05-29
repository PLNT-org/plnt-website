import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { BUCKETS } from '@/lib/supabase/storage'

// Share creation lives in `scripts/publish-survey.mjs` (uses local GDAL for
// COG conversion, NDVI compute, color-relief, and gdal2tiles -> WebP). The web
// admin is management-only: list / edit metadata / delete.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeEmails(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\n,;]+/)
      : []
  return Array.from(
    new Set(raw.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@')))
  )
}

// GET - List shares created by the admin.
export async function GET(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('property_shares')
    .select('id, token, title, client_name, allowed_emails, layers, expires_at, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shares: data })
}

// PATCH - Edit share metadata (title, client, allowed emails, expiry).
// Raster regeneration is not supported here — re-run the CLI pipeline with a
// `share_id` config to re-tile in place.
export async function PATCH(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const id = body.id
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Valid id is required' }, { status: 400 })
  }

  const update: Record<string, any> = { updated_at: new Date().toISOString() }

  if (typeof body.title === 'string') {
    const t = body.title.trim()
    if (!t) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    update.title = t
  }
  if ('client_name' in body) {
    update.client_name = typeof body.client_name === 'string' ? body.client_name.trim() || null : null
  }
  if (body.allowed_emails !== undefined) {
    const emails = normalizeEmails(body.allowed_emails)
    if (emails.length === 0) {
      return NextResponse.json({ error: 'At least one authorized email is required' }, { status: 400 })
    }
    update.allowed_emails = emails
  }
  if ('expires_at' in body) {
    update.expires_at = body.expires_at || null
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('property_shares')
    .update(update)
    .eq('id', id)
    .select('id, token, title, client_name, allowed_emails, layers, expires_at, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ share: data })
}

// Recursively collect every object path under a storage prefix (Supabase `list`
// only returns one level; subfolders come back as entries with a null id).
async function listAllPaths(prefix: string): Promise<string[]> {
  const { data } = await supabaseAdmin.storage.from(BUCKETS.PROPERTY_SHARES).list(prefix, { limit: 1000 })
  const out: string[] = []
  for (const entry of data || []) {
    const full = `${prefix}/${entry.name}`
    if (entry.id === null) out.push(...(await listAllPaths(full)))
    else out.push(full)
  }
  return out
}

// DELETE - Remove a share and all its stored assets (COGs + tile pyramids).
export async function DELETE(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Valid id is required' }, { status: 400 })
  }

  const paths = await listAllPaths(id)
  for (let i = 0; i < paths.length; i += 1000) {
    await supabaseAdmin.storage.from(BUCKETS.PROPERTY_SHARES).remove(paths.slice(i, i + 1000))
  }

  const { error } = await supabaseAdmin.from('property_shares').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
