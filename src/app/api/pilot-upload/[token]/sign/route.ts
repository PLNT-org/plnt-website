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
  if (!link) return errorResponse ?? NextResponse.json({ error: 'This upload link is invalid.' }, { status: 404 })
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
  const toSign: string[] = []
  for (const f of files) {
    const name = safeFileName(String(f.name || ''))
    const size = Number(f.size || 0)
    if (!name || !isAcceptedName(name)) { rejected.push({ name, reason: 'Not a DJI image (.jpg/.tif/.dng)' }); continue }
    if (size <= 0 || size > MAX_FILE_BYTES) { rejected.push({ name, reason: 'File is empty or over 200 MB' }); continue }
    if (remaining <= 0) { rejected.push({ name, reason: `This link accepts at most ${link.max_files} files` }); continue }
    toSign.push(name)
    remaining -= 1
  }
  // Signing is one round-trip to Storage per file (~150 ms); do 20 at a time so a
  // 200-file batch takes ~2 s instead of ~30 s.
  for (let i = 0; i < toSign.length; i += 20) {
    const chunk = toSign.slice(i, i + 20)
    const results = await Promise.all(chunk.map((name) =>
      supabaseAdmin.storage.from(PILOT_UPLOAD_BUCKET).createSignedUploadUrl(`${link.id}/${name}`, { upsert: true })))
    results.forEach(({ data, error }, k) => {
      const name = chunk[k]
      if (error || !data) rejected.push({ name, reason: error?.message || 'Could not prepare upload' })
      else signed.push({ name, path: `${link.id}/${name}`, token: data.token })
    })
  }
  return NextResponse.json({ signed, rejected })
}
