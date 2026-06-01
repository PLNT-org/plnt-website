import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'
import { getArucoAuthHeaders } from '@/lib/aruco/auth'

// The aruco-service does the heavy lifting (gdal2tiles + upload), so this route
// just authenticates, kicks it off, and returns. The client polls the ortho's
// tiles_url to know when it's done.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUCO_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'

// POST: Generate an XYZ tile pyramid for an orthomosaic via the GDAL service.
export async function POST(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  let orthomosaicId: string | undefined
  try {
    ({ orthomosaicId } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!orthomosaicId) {
    return NextResponse.json({ error: 'orthomosaicId is required' }, { status: 400 })
  }

  const ownershipError = await verifyOrthomosaicOwnership(supabase, orthomosaicId, user.id, isAdmin)
  if (ownershipError) return ownershipError

  const { data: ortho, error } = await supabase
    .from('orthomosaics')
    .select('original_tif_url, orthomosaic_url, bounds')
    .eq('id', orthomosaicId)
    .single()

  if (error || !ortho) {
    return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
  }
  if (!ortho.bounds) {
    return NextResponse.json({ error: 'Orthomosaic has no bounds yet' }, { status: 400 })
  }
  const geotiffUrl = ortho.original_tif_url || ortho.orthomosaic_url
  if (!geotiffUrl) {
    return NextResponse.json({ error: 'No source GeoTIFF for this orthomosaic' }, { status: 400 })
  }

  // Fire-and-forget: gdal2tiles + tile upload runs for minutes on the service and
  // sets tiles_url when done. The client polls for tiles_url (see GET on the
  // plant-detection / orthomosaic routes). Mirrors the detection-jobs pattern.
  const authHeaders = await getArucoAuthHeaders(ARUCO_SERVICE_URL)
  fetch(`${ARUCO_SERVICE_URL}/generate-tiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      geotiff_url: geotiffUrl,
      orthomosaic_id: orthomosaicId,
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabase_service_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
  }).catch(err => console.error('[GenerateTiles] Failed to reach tile service:', err))

  return NextResponse.json({ started: true })
}
