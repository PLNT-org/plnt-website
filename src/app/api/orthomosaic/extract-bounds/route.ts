import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fromArrayBuffer } from 'geotiff'
import { convertBoundsToWGS84 } from '@/lib/geo/convert-bounds'
import { getOrthomosaicStorage } from '@/lib/supabase/storage'

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
    const { orthomosaicId, force } = await request.json()

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

    // Already has bounds — skip unless force re-extract requested
    if (ortho.bounds && !force) {
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
    const bbox = image.getBoundingBox() // [west, south, east, north] in native CRS
    const geoKeys = image.getGeoKeys()
    const width = image.getWidth()
    const height = image.getHeight()
    const [resX] = image.getResolution()

    console.log(`GeoTIFF CRS: EPSG:${geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || 'unknown'}`)
    console.log(`Raw bbox: [${bbox.join(', ')}]`)

    // Convert from native CRS (usually UTM) to WGS84 lat/lng for Leaflet
    const bounds = convertBoundsToWGS84(bbox, geoKeys)
    const resolution_cm = Math.abs(resX) * 100

    console.log(`WGS84 bounds: ${JSON.stringify(bounds)}, ${width}x${height}, ${resolution_cm.toFixed(1)} cm/px`)

    // If the stored file is a .tif, convert to JPEG and re-upload
    // (browsers can't display GeoTIFF)
    let newUrl: string | undefined
    if (ortho.orthomosaic_url.endsWith('.tif')) {
      try {
        console.log('Converting GeoTIFF to JPEG for web display...')
        const sharp = (await import('sharp')).default
        const jpegBuffer = await sharp(Buffer.from(buffer))
          .jpeg({ quality: 90 })
          .toBuffer()
        console.log(`Converted: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB TIF → ${(jpegBuffer.byteLength / 1024 / 1024).toFixed(1)} MB JPEG`)

        const storage = getOrthomosaicStorage()
        const { url } = await storage.uploadOrthophoto(
          orthomosaicId,
          jpegBuffer,
          'orthophoto.jpg'
        )
        newUrl = url
        console.log(`Uploaded JPEG to: ${url}`)
      } catch (convertError) {
        console.error('JPEG conversion failed, keeping .tif URL:', convertError)
      }
    }

    // Update the database record
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update({
        bounds,
        image_width: width,
        image_height: height,
        resolution_cm,
        ...(newUrl ? { orthomosaic_url: newUrl } : {}),
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
