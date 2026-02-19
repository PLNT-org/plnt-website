import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fromArrayBuffer } from 'geotiff'

export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST: Extract geo bounds from an orthophoto.
 * Downloads from wherever the file is hosted (Supabase Storage or Lightning),
 * parses the GeoTIFF, and saves bounds to the database.
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

    // Download from the stored URL (could be Lightning or Supabase Storage)
    console.log(`Downloading orthophoto from: ${ortho.orthomosaic_url}`)

    const response = await fetch(ortho.orthomosaic_url)
    if (!response.ok) {
      console.error(`Download failed: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        { error: `Failed to download orthophoto: HTTP ${response.status}` },
        { status: 500 }
      )
    }

    const contentLength = response.headers.get('content-length')
    console.log(`Download started, size: ${contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(1)} MB` : 'unknown'}`)

    const buffer = await response.arrayBuffer()
    console.log(`Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB, parsing GeoTIFF...`)

    const tiff = await fromArrayBuffer(buffer)
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
