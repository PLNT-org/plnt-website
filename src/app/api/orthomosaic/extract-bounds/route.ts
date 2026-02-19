import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fromUrl } from 'geotiff'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST: Extract geo bounds from an already-uploaded orthophoto in Supabase Storage.
 * Uses HTTP range requests (fromUrl) to read only the GeoTIFF header/metadata
 * without downloading the entire multi-hundred-MB file into memory.
 */
export async function POST(request: NextRequest) {
  try {
    const { orthomosaicId } = await request.json()

    if (!orthomosaicId) {
      return NextResponse.json({ error: 'orthomosaicId required' }, { status: 400 })
    }

    // Get orthomosaic record
    const { data: ortho, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .select('*')
      .eq('id', orthomosaicId)
      .single()

    if (orthoError || !ortho) {
      return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
    }

    if (!ortho.orthomosaic_url) {
      return NextResponse.json({ error: 'No orthophoto URL found' }, { status: 400 })
    }

    // Already has bounds — nothing to do
    if (ortho.bounds) {
      return NextResponse.json({
        success: true,
        bounds: ortho.bounds,
        message: 'Bounds already extracted',
      })
    }

    // Use fromUrl to read only the GeoTIFF metadata via HTTP range requests.
    // This avoids downloading the entire file (which can be hundreds of MB).
    console.log(`Extracting bounds via range requests from: ${ortho.orthomosaic_url}`)
    const tiff = await fromUrl(ortho.orthomosaic_url)
    const image = await tiff.getImage()
    const bbox = image.getBoundingBox() // [west, south, east, north]
    const width = image.getWidth()
    const height = image.getHeight()
    const [resX] = image.getResolution()

    const bounds = {
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
    }
    const resolution_cm = Math.abs(resX) * 100

    console.log(`Extracted bounds: ${JSON.stringify(bounds)}, ${width}x${height}, ${resolution_cm.toFixed(1)} cm/px`)

    // Update the database record
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update({
        bounds,
        image_width: width,
        image_height: height,
        resolution_cm,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('Failed to update bounds:', updateError)
      return NextResponse.json({ error: 'Failed to save bounds' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      bounds,
      image_width: width,
      image_height: height,
      resolution_cm,
    })
  } catch (error) {
    console.error('Extract bounds error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract bounds' },
      { status: 500 }
    )
  }
}
