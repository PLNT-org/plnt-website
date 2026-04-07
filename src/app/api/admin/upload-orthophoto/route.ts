import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'
import { getOrthomosaicStorage } from '@/lib/supabase/storage'
import { fromArrayBuffer } from 'geotiff'
import { convertBoundsToWGS84 } from '@/lib/geo/convert-bounds'

export const maxDuration = 300
export const memory = 3009

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST - Upload an orthophoto file directly for a stuck orthomosaic
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const formData = await request.formData()
    const orthomosaicId = formData.get('orthomosaicId') as string
    const file = formData.get('file') as File

    if (!orthomosaicId || !file) {
      return NextResponse.json(
        { error: 'orthomosaicId and file are required' },
        { status: 400 }
      )
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

    console.log(`[Upload] Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) for ortho ${orthomosaicId}`)

    let orthophotoBuffer = await file.arrayBuffer()
    const updateData: Record<string, any> = {
      status: 'completed',
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }

    // Extract geo bounds from the GeoTIFF
    try {
      console.log('[Upload] Extracting bounds from GeoTIFF...')
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

      console.log(`[Upload] Bounds: ${JSON.stringify(updateData.bounds)}, ${width}x${height}, ${updateData.resolution_cm.toFixed(1)} cm/px`)
    } catch (boundsError) {
      console.error('[Upload] Could not extract GeoTIFF bounds:', boundsError)
    }

    const storage = getOrthomosaicStorage()

    // Upload original TIF for plant detection
    try {
      console.log('[Upload] Uploading original GeoTIFF...')
      const { url: tifUrl } = await storage.uploadOrthophoto(
        orthomosaicId,
        orthophotoBuffer,
        'orthophoto.tif'
      )
      updateData.original_tif_url = tifUrl
      console.log(`[Upload] TIF uploaded: ${tifUrl}`)
    } catch (tifErr) {
      console.error('[Upload] Failed to upload TIF:', tifErr)
    }

    // Convert to WebP for map display
    try {
      console.log('[Upload] Converting to WebP...')
      const sharp = (await import('sharp')).default
      const webpBuffer = await sharp(Buffer.from(orthophotoBuffer), { limitInputPixels: false })
        .webp({ quality: 85 })
        .toBuffer()

      // Free original buffer
      orthophotoBuffer = new ArrayBuffer(0)

      console.log(`[Upload] WebP: ${(webpBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`)

      const { url } = await storage.uploadOrthophoto(
        orthomosaicId,
        webpBuffer,
        'orthophoto.webp'
      )
      updateData.orthomosaic_url = url
      console.log(`[Upload] WebP uploaded: ${url}`)
    } catch (convertErr) {
      console.error('[Upload] WebP conversion failed:', convertErr)
      // If conversion fails, try uploading TIF URL as the display URL
      if (updateData.original_tif_url) {
        updateData.orthomosaic_url = updateData.original_tif_url
      }
    }

    // Update database
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update(updateData)
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('[Upload] DB update error:', updateError)
      return NextResponse.json({ error: 'Failed to update database' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      orthomosaicId,
      bounds: updateData.bounds,
      orthomosaicUrl: updateData.orthomosaic_url,
    })
  } catch (error) {
    console.error('[Upload] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
