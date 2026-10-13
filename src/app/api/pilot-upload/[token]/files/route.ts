import { NextRequest, NextResponse } from 'next/server'
import { loadLink, linkIsOpen, refreshLinkTotals, supabaseAdmin } from '@/lib/pilot-upload/server'
import { PILOT_UPLOAD_BUCKET, contentTypeFor, safeFileName, type DjiMeta } from '@/lib/pilot-upload/shared'

export const dynamic = 'force-dynamic'

// POST - Record files the browser has finished uploading, with the DJI metadata
// it parsed. Each is verified to exist in the bucket before the row is written,
// so a row never claims a file that didn't land.
// Body: { files: [{ name, size, meta }] } -> { recorded: n, missing: [name] }
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const { link, errorResponse } = await loadLink(params.token)
  if (errorResponse || !link) return errorResponse
  const closed = linkIsOpen(link)
  if (closed) return NextResponse.json({ error: closed }, { status: 403 })

  let body: { files?: { name?: string; size?: number; meta?: DjiMeta }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const files = Array.isArray(body.files) ? body.files.slice(0, 500) : []
  if (!files.length) return NextResponse.json({ error: 'No files given' }, { status: 400 })

  // One listing per batch instead of one HEAD per file.
  const present = new Map<string, number>()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.storage
      .from(PILOT_UPLOAD_BUCKET)
      .list(link.id, { limit: 1000, offset })
    if (error || !data?.length) break
    for (const o of data) present.set(o.name, Number((o.metadata as { size?: number } | null)?.size ?? -1))
    if (data.length < 1000) break
  }

  const rows: Record<string, unknown>[] = []
  const missing: string[] = []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  for (const f of files) {
    const name = safeFileName(String(f.name || ''))
    if (!present.has(name)) { missing.push(name); continue }
    const m = f.meta || {}
    rows.push({
      link_id: link.id,
      file_name: name,
      storage_path: `${link.id}/${name}`,
      size_bytes: present.get(name)! >= 0 ? present.get(name) : Number(f.size || 0),
      content_type: contentTypeFor(name),
      lat: num(m.lat), lon: num(m.lon), rel_alt_m: num(m.rel_alt_m), gimbal_pitch_deg: num(m.gimbal_pitch_deg),
      captured_at: m.captured_at || null,
      camera_model: m.camera_model ? String(m.camera_model).slice(0, 60) : null,
      gps_status: m.gps_status ? String(m.gps_status).slice(0, 20) : null,
      uploaded_at: new Date().toISOString(),
    })
  }
  if (rows.length) {
    const { error } = await supabaseAdmin
      .from('pilot_upload_files')
      .upsert(rows, { onConflict: 'link_id,file_name' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await refreshLinkTotals(link.id)
  }
  return NextResponse.json({ recorded: rows.length, missing })
}
