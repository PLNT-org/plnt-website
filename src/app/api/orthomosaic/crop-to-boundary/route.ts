import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'
import { getArucoAuthHeaders } from '@/lib/aruco/auth'

// The aruco-service does the gdalwarp clip + COG + upload (minutes); this route
// authenticates and kicks it off. The client polls the ortho's original_tif_url
// flipping to the *_cropped file to know it's done.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUCO_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'

// POST: Crop an orthomosaic to a drawn boundary polygon (GeoJSON, WGS84).
export async function POST(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  let body: { orthomosaicId?: string; boundary?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { orthomosaicId, boundary } = body
  if (!orthomosaicId || !boundary) {
    return NextResponse.json({ error: 'orthomosaicId and boundary are required' }, { status: 400 })
  }

  const ownershipError = await verifyOrthomosaicOwnership(supabase, orthomosaicId, user.id, isAdmin)
  if (ownershipError) return ownershipError

  const { data: ortho, error } = await supabase
    .from('orthomosaics')
    .select('original_tif_url, orthomosaic_url')
    .eq('id', orthomosaicId)
    .single()
  if (error || !ortho) {
    return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
  }
  const geotiffUrl = ortho.original_tif_url || ortho.orthomosaic_url
  if (!geotiffUrl) {
    return NextResponse.json({ error: 'No source GeoTIFF for this orthomosaic' }, { status: 400 })
  }

  // Fire-and-forget: the service clips, writes *_cropped TIF/COG, updates the row
  // (new bounds, clears tiles_url). Client polls original_tif_url for "_cropped".
  const authHeaders = await getArucoAuthHeaders(ARUCO_SERVICE_URL)
  fetch(`${ARUCO_SERVICE_URL}/crop-to-boundary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      geotiff_url: geotiffUrl,
      orthomosaic_id: orthomosaicId,
      boundary,
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabase_service_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
  }).catch(err => console.error('[CropToBoundary] Failed to reach service:', err))

  return NextResponse.json({ started: true })
}
