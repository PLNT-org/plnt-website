import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getOrthomosaicStorage } from '@/lib/supabase/storage'

export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TILE_SIZE = 256

// Web Mercator helpers
function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z))
}

function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, z)
  )
}

function tileXToLng(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/**
 * POST: Generate XYZ tiles from an orthomosaic image.
 * Downloads the orthomosaic from its URL, slices into 256x256 tiles
 * at multiple zoom levels, and uploads to Supabase Storage.
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

    if (!ortho.orthomosaic_url || !ortho.bounds) {
      return NextResponse.json(
        { error: 'Orthomosaic must have a URL and bounds before generating tiles' },
        { status: 400 }
      )
    }

    const bounds = ortho.bounds as { north: number; south: number; east: number; west: number }

    // Validate bounds are in WGS84
    if (Math.abs(bounds.north) > 90 || Math.abs(bounds.south) > 90 ||
        Math.abs(bounds.east) > 180 || Math.abs(bounds.west) > 180) {
      return NextResponse.json(
        { error: 'Bounds appear to be in a projected CRS, not WGS84' },
        { status: 400 }
      )
    }

    // Download the orthomosaic image
    console.log(`[Tiles] Downloading orthomosaic from: ${ortho.orthomosaic_url}`)
    const imageResponse = await fetch(ortho.orthomosaic_url)
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: `Failed to download orthomosaic: HTTP ${imageResponse.status}` },
        { status: 500 }
      )
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    console.log(`[Tiles] Downloaded ${(imageBuffer.length / 1024 / 1024).toFixed(1)} MB`)

    // Get image dimensions using sharp
    const sharp = (await import('sharp')).default
    const metadata = await sharp(imageBuffer).metadata()
    const imgWidth = metadata.width!
    const imgHeight = metadata.height!
    console.log(`[Tiles] Image dimensions: ${imgWidth}x${imgHeight}`)

    // Determine zoom levels based on image resolution
    // At zoom z, each tile pixel covers roughly (156543 * cos(lat)) / 2^z meters
    const centerLat = (bounds.north + bounds.south) / 2
    const metersPerPixelAtZ0 = 156543 * Math.cos((centerLat * Math.PI) / 180)

    // Image covers this many meters
    const latSpan = bounds.north - bounds.south
    const lngSpan = bounds.east - bounds.west
    const imageWidthMeters = lngSpan * 111320 * Math.cos((centerLat * Math.PI) / 180)
    const imageHeightMeters = latSpan * 110574

    // Native resolution (meters per pixel)
    const nativeRes = Math.max(imageWidthMeters / imgWidth, imageHeightMeters / imgHeight)

    // Max zoom: where native resolution matches tile pixel size (no upscaling beyond 2x)
    const maxZoom = Math.min(
      22,
      Math.floor(Math.log2(metersPerPixelAtZ0 / (nativeRes / 2)))
    )
    // Min zoom: where the entire image fits in ~2 tiles
    const minZoom = Math.max(
      10,
      Math.floor(Math.log2(metersPerPixelAtZ0 / Math.max(imageWidthMeters, imageHeightMeters) * 2))
    )

    console.log(`[Tiles] Native resolution: ${(nativeRes * 100).toFixed(1)} cm/px`)
    console.log(`[Tiles] Zoom range: ${minZoom}-${maxZoom}`)

    const storage = getOrthomosaicStorage()
    let totalTiles = 0
    let uploadedTiles = 0

    // Count total tiles first
    for (let z = minZoom; z <= maxZoom; z++) {
      const xMin = lngToTileX(bounds.west, z)
      const xMax = lngToTileX(bounds.east, z)
      const yMin = latToTileY(bounds.north, z) // note: y is inverted
      const yMax = latToTileY(bounds.south, z)
      totalTiles += (xMax - xMin + 1) * (yMax - yMin + 1)
    }
    console.log(`[Tiles] Total tiles to generate: ${totalTiles}`)

    // Generate tiles for each zoom level
    for (let z = minZoom; z <= maxZoom; z++) {
      const xMin = lngToTileX(bounds.west, z)
      const xMax = lngToTileX(bounds.east, z)
      const yMin = latToTileY(bounds.north, z)
      const yMax = latToTileY(bounds.south, z)

      const tileBatch: Array<{ z: number; x: number; y: number; data: Buffer }> = []

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          // Get geographic bounds of this tile
          const tileLngLeft = tileXToLng(x, z)
          const tileLngRight = tileXToLng(x + 1, z)
          const tileLatTop = tileYToLat(y, z)
          const tileLatBottom = tileYToLat(y + 1, z)

          // Map tile bounds to pixel coordinates in source image
          // Linear interpolation within the image bounds
          const srcLeft = Math.floor(
            ((tileLngLeft - bounds.west) / (bounds.east - bounds.west)) * imgWidth
          )
          const srcRight = Math.ceil(
            ((tileLngRight - bounds.west) / (bounds.east - bounds.west)) * imgWidth
          )
          const srcTop = Math.floor(
            ((bounds.north - tileLatTop) / (bounds.north - bounds.south)) * imgHeight
          )
          const srcBottom = Math.ceil(
            ((bounds.north - tileLatBottom) / (bounds.north - bounds.south)) * imgHeight
          )

          // Clamp to image bounds
          const cropLeft = Math.max(0, srcLeft)
          const cropTop = Math.max(0, srcTop)
          const cropRight = Math.min(imgWidth, srcRight)
          const cropBottom = Math.min(imgHeight, srcBottom)
          const cropWidth = cropRight - cropLeft
          const cropHeight = cropBottom - cropTop

          if (cropWidth <= 0 || cropHeight <= 0) continue

          // Calculate the position of the cropped region within the 256x256 tile
          const tilePixelLeft = srcLeft < 0 ? Math.round((-srcLeft / (srcRight - srcLeft)) * TILE_SIZE) : 0
          const tilePixelTop = srcTop < 0 ? Math.round((-srcTop / (srcBottom - srcTop)) * TILE_SIZE) : 0
          const tilePixelWidth = Math.round((cropWidth / (srcRight - srcLeft)) * TILE_SIZE)
          const tilePixelHeight = Math.round((cropHeight / (srcBottom - srcTop)) * TILE_SIZE)

          if (tilePixelWidth <= 0 || tilePixelHeight <= 0) continue

          try {
            // Extract and resize the image portion
            const croppedBuffer = await sharp(imageBuffer)
              .extract({
                left: cropLeft,
                top: cropTop,
                width: cropWidth,
                height: cropHeight,
              })
              .resize(
                Math.min(tilePixelWidth, TILE_SIZE),
                Math.min(tilePixelHeight, TILE_SIZE),
                { fit: 'fill' }
              )
              .png()
              .toBuffer()

            // If the tile doesn't fill the entire 256x256 area, composite onto transparent background
            let tileBuffer: Buffer
            if (tilePixelLeft > 0 || tilePixelTop > 0 ||
                tilePixelWidth < TILE_SIZE || tilePixelHeight < TILE_SIZE) {
              tileBuffer = await sharp({
                create: {
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  channels: 4,
                  background: { r: 0, g: 0, b: 0, alpha: 0 },
                },
              })
                .composite([
                  {
                    input: croppedBuffer,
                    left: Math.min(tilePixelLeft, TILE_SIZE - 1),
                    top: Math.min(tilePixelTop, TILE_SIZE - 1),
                  },
                ])
                .png()
                .toBuffer()
            } else {
              tileBuffer = croppedBuffer
            }

            tileBatch.push({ z, x, y, data: tileBuffer })
          } catch (err) {
            console.error(`[Tiles] Failed to generate tile z${z}/x${x}/y${y}:`, err)
          }
        }
      }

      // Upload this zoom level's tiles
      if (tileBatch.length > 0) {
        console.log(`[Tiles] Uploading z${z}: ${tileBatch.length} tiles...`)
        await storage.uploadTiles(
          orthomosaicId,
          tileBatch.map((t) => ({ z: t.z, x: t.x, y: t.y, data: t.data }))
        )
        uploadedTiles += tileBatch.length
      }
    }

    // Get the tile URL template
    const tilesUrl = storage.getTilesUrlTemplate(orthomosaicId)

    // Update DB with tiles info
    await supabaseAdmin
      .from('orthomosaics')
      .update({
        tiles_url: tilesUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orthomosaicId)

    console.log(`[Tiles] Done! Generated ${uploadedTiles} tiles for zoom ${minZoom}-${maxZoom}`)

    return NextResponse.json({
      success: true,
      tilesUrl,
      totalTiles: uploadedTiles,
      zoomRange: { min: minZoom, max: maxZoom },
    })
  } catch (error) {
    console.error('[Tiles] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate tiles' },
      { status: 500 }
    )
  }
}
