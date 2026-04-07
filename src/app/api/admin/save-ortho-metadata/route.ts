import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST - Save orthomosaic metadata extracted client-side (no file processing needed)
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const { orthomosaicId, bounds, imageWidth, imageHeight, resolutionCm, storagePath, webpPath } = await request.json()

    if (!orthomosaicId || !bounds || !storagePath) {
      return NextResponse.json(
        { error: 'orthomosaicId, bounds, and storagePath are required' },
        { status: 400 }
      )
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

    // Get public URL for the uploaded TIF
    const { data: tifUrlData } = supabaseAdmin.storage
      .from('orthomosaics')
      .getPublicUrl(storagePath)

    const updateData: Record<string, any> = {
      status: 'completed',
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      bounds,
      original_tif_url: tifUrlData.publicUrl,
    }

    if (imageWidth) updateData.image_width = imageWidth
    if (imageHeight) updateData.image_height = imageHeight
    if (resolutionCm) updateData.resolution_cm = resolutionCm

    // Use WebP URL if available, otherwise fall back to TIF
    if (webpPath) {
      const { data: webpUrlData } = supabaseAdmin.storage
        .from('orthomosaics')
        .getPublicUrl(webpPath)
      updateData.orthomosaic_url = webpUrlData.publicUrl
    } else {
      updateData.orthomosaic_url = tifUrlData.publicUrl
    }

    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update(updateData)
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('[SaveMeta] DB update error:', updateError)
      return NextResponse.json({ error: 'Failed to update database' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      orthomosaicId,
      bounds,
      orthomosaicUrl: updateData.orthomosaic_url,
    })
  } catch (error) {
    console.error('[SaveMeta] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save metadata' },
      { status: 500 }
    )
  }
}
