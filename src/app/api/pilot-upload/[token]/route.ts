import { NextRequest, NextResponse } from 'next/server'
import { allFiles, loadLink } from '@/lib/pilot-upload/server'

export const dynamic = 'force-dynamic'

// GET - What the portal needs to render: who/what the link is for, whether it
// still accepts files, and which files have already landed (so a pilot who
// re-drops the same folder after a dropped connection skips what's done).
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const { link, errorResponse } = await loadLink(params.token)
  if (!link) return errorResponse ?? NextResponse.json({ error: 'This upload link is invalid.' }, { status: 404 })
  const files = await allFiles<{ file_name: string; size_bytes: number }>(link.id, 'file_name, size_bytes')
  return NextResponse.json({
    link: {
      id: link.id,
      client_name: link.client_name,
      site_name: link.site_name,
      pilot_name: link.pilot_name,
      instructions: link.instructions,
      status: link.status,
      max_files: link.max_files,
      expires_at: link.expires_at,
      file_count: link.file_count,
      total_bytes: link.total_bytes,
    },
    uploaded: files.map((f) => ({ name: f.file_name, size: Number(f.size_bytes) })),
  })
}
