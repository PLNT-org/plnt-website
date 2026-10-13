import { NextRequest, NextResponse } from 'next/server'
import { loadLink, linkIsOpen, supabaseAdmin } from '@/lib/pilot-upload/server'
import {
  PILOT_UPLOAD_BUCKET, MAX_FILE_BYTES, MAX_FILES_PER_BATCH, isAcceptedName, safeFileName,
} from '@/lib/pilot-upload/shared'

export const dynamic = 'force-dynamic'

// POST - Mint signed upload URLs for a batch of files. The browser then PUTs
// each file straight to Supabase Storage; nothing passes through this server.
// Body: { files: [{ name, size }] } -> { signed: [{ name, path, token }], rejected: [{ name, reason }] }
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const { link, errorResponse } = await loadLink(params.token)
  if (errorResponse || !link) return errorResponse
  const closed = linkIsOpen(link)
  if (closed) return NextResponse.json({ error: closed }, { status: 403 })

  let body: { files?: { name?: string; size?: number }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_BATCH) : []
  if (!files.length) return NextResponse.json({ error: 'No files given' }, { status: 400 })

  const { count } = await supabaseAdmin
    .from('pilot_upload_files')
    .select('id', { count: 'exact', head: true })
    .eq('link_id', link.id)
  let remaining = Math.max(0, link.max_files - (count || 0))

  const signed: { name: string; path: string; token: string }[] = []
  const rejected: { name: string; reason: string }[] = []
  for (const f of files) {
    const name = safeFileName(String(f.name || ''))
    const size = Number(f.size || 0)
    if (!name || !isAcceptedName(name)) { rejected.push({ name, reason: 'Not a DJI image (.jpg/.tif/.dng)' }); continue }
    if (size <= 0 || size > MAX_FILE_BYTES) { rejected.push({ name, reason: 'File is empty or over 200 MB' }); continue }
    if (remaining <= 0) { rejected.push({ name, reason: `This link accepts at most ${link.max_files} files` }); continue }
    const path = `${link.id}/${name}`
    const { data, error } = await supabaseAdmin.storage
      .from(PILOT_UPLOAD_BUCKET)
      .createSignedUploadUrl(path, { upsert: true })
    if (error || !data) { rejected.push({ name, reason: error?.message || 'Could not prepare upload' }); continue }
    signed.push({ name, path, token: data.token })
    remaining -= 1
  }
  return NextResponse.json({ signed, rejected })
}
