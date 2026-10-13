import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { allFiles, supabaseAdmin } from '@/lib/pilot-upload/server'

export const dynamic = 'force-dynamic'

// GET ?id=<link id> - the received files with their DJI metadata (admin review + coverage map).
export async function GET(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = request.nextUrl.searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Valid id is required' }, { status: 400 })
  const files = await allFiles(id, 'file_name, size_bytes, lat, lon, rel_alt_m, gimbal_pitch_deg, captured_at, camera_model, gps_status, uploaded_at')
  return NextResponse.json({ files })
}
