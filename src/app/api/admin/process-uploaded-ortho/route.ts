import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'
import { fromArrayBuffer } from 'geotiff'
import { convertBoundsToWGS84 } from '@/lib/geo/convert-bounds'

export const maxDuration = 300
export const memory = 3009

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST - Process an orthophoto that was uploaded directly to Supabase Storage
// Reads the TIF from storage, extracts bounds, converts to WebP, and updates DB
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const { orthomosaicId, storagePath } = await request.json()

    if (!orthomosaicId || !storagePath) {
      return NextResponse.json(
        { error: 'orthomosaicId and storagePath are required' },
        { status: 400 }
      )
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

    console.log(`[ProcessOrtho] Processing uploaded file: ${storagePath}`)

    // Download the TIF from Supabase Storage
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('orthomosaics')
      .download(storagePath)

    if (downloadError || !fileData) {
      console.error('[ProcessOrtho] Download error:', downloadError)
      return NextResponse.json({ error: 'Failed to download file from storage' }, { status: 500 })
    }

    let orthophotoBuffer = await fileData.arrayBuffer()
    console.log(`[ProcessOrtho] Downloaded ${(orthophotoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`)

    const updateData: Record<string, any> = {
      status: 'completed',
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }

    // Get public URL for the uploaded TIF
    const { data: urlData } = supabaseAdmin.storage
      .from('orthomosaics')
      .getPublicUrl(storagePath)
    updateData.original_tif_url = urlData.publicUrl

    // Extract geo bounds from the GeoTIFF
    try {
      console.log('[ProcessOrtho] Extracting bounds...')
      const tiff = await fromArrayBuffer(orthophotoBuffer)
      const image = await tiff.getImage()
      const bbox = image.getBoundingBox()
      const geoKeys = image.getGeoKeys()
      const width = image.getWidth()
      const height = image.getHeight()
      const [resX] = image.getResolution()

      updateData.bounds = convertBoundsToWGS84(bbox, geoKeys)
      updateData.image_width = width
      updateData.image_height = height
      updateData.resolution_cm = Math.abs(resX) * 100

      console.log(`[ProcessOrtho] Bounds: ${JSON.stringify(updateData.bounds)}, ${width}x${height}`)
    } catch (boundsError) {
      console.error('[ProcessOrtho] Bounds extraction failed:', boundsError)
      return NextResponse.json({ error: 'Failed to extract bounds from GeoTIFF' }, { status: 500 })
    }

    // Convert to WebP for map display
    try {
      console.log('[ProcessOrtho] Converting to WebP...')
      const sharp = (await import('sharp')).default
      const webpBuffer = await sharp(Buffer.from(orthophotoBuffer), { limitInputPixels: false })
        .webp({ quality: 85 })
        .toBuffer()

      // Free original buffer
      orthophotoBuffer = new ArrayBuffer(0)

      console.log(`[ProcessOrtho] WebP: ${(webpBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`)

      // Upload WebP to storage
      const webpPath = `${orthomosaicId}/orthophoto.webp`
      const { error: uploadError } = await supabaseAdmin.storage
        .from('orthomosaics')
        .upload(webpPath, webpBuffer, {
          contentType: 'image/webp',
          upsert: true,
        })

      if (uploadError) {
        throw uploadError
      }

      const { data: webpUrlData } = supabaseAdmin.storage
        .from('orthomosaics')
        .getPublicUrl(webpPath)

      updateData.orthomosaic_url = webpUrlData.publicUrl
      console.log(`[ProcessOrtho] WebP uploaded: ${webpUrlData.publicUrl}`)
    } catch (convertErr) {
      console.error('[ProcessOrtho] WebP conversion failed:', convertErr)
      // Fall back to TIF URL for display
      updateData.orthomosaic_url = updateData.original_tif_url
    }

    // Update database
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update(updateData)
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('[ProcessOrtho] DB update error:', updateError)
      return NextResponse.json({ error: 'Failed to update database' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      orthomosaicId,
      bounds: updateData.bounds,
      orthomosaicUrl: updateData.orthomosaic_url,
    })
  } catch (error) {
    console.error('[ProcessOrtho] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    )
  }
}
