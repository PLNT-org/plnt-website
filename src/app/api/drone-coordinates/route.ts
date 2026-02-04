import { NextRequest, NextResponse } from 'next/server'
import {
  extractDroneMetadata,
  pixelToGroundCoordinate,
  getImageFootprintCorners,
  isNadirShot,
  DroneImageMetadata,
} from '@/lib/drone/coordinate-extractor'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const image = formData.get('image') as File | null
    const pixelX = formData.get('pixelX')
    const pixelY = formData.get('pixelY')

    if (!image) {
      return NextResponse.json(
        { error: 'No image provided' },
        { status: 400 }
      )
    }

    // Read image buffer
    const arrayBuffer = await image.arrayBuffer()

    // Extract metadata
    let metadata: DroneImageMetadata
    try {
      metadata = await extractDroneMetadata(arrayBuffer)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to extract EXIF data' },
        { status: 400 }
      )
    }

    // Check if it's a nadir shot
    const nadir = isNadirShot(metadata)
    if (!nadir && metadata.gimbalPitch !== undefined) {
      console.warn(`Image may not be nadir. Gimbal pitch: ${metadata.gimbalPitch}°`)
    }

    // Get footprint corners
    const corners = getImageFootprintCorners(metadata)

    // If pixel coordinates provided, calculate ground coordinate for that point
    let clickedPoint = null
    if (pixelX !== null && pixelY !== null) {
      const x = parseFloat(pixelX as string)
      const y = parseFloat(pixelY as string)
      if (!isNaN(x) && !isNaN(y)) {
        clickedPoint = pixelToGroundCoordinate({ x, y }, metadata)
      }
    }

    return NextResponse.json({
      success: true,
      metadata: {
        dronePosition: {
          latitude: metadata.latitude,
          longitude: metadata.longitude,
          altitude: metadata.altitude,
          absoluteAltitude: metadata.absoluteAltitude,
        },
        camera: {
          focalLength: metadata.focalLength,
          focalLength35mm: metadata.focalLength35mm,
          sensorWidth: metadata.sensorWidth,
          sensorHeight: metadata.sensorHeight,
        },
        image: {
          width: metadata.imageWidth,
          height: metadata.imageHeight,
          gsdX: metadata.gsdX,
          gsdY: metadata.gsdY,
          gsdCm: isNaN(metadata.gsdX) || isNaN(metadata.gsdY)
            ? null
            : ((metadata.gsdX + metadata.gsdY) / 2) * 100, // Average GSD in cm
        },
        footprint: {
          width: isNaN(metadata.footprintWidth) ? null : metadata.footprintWidth,
          height: isNaN(metadata.footprintHeight) ? null : metadata.footprintHeight,
          corners,
        },
        gimbal: {
          pitch: metadata.gimbalPitch,
          yaw: metadata.gimbalYaw,
          roll: metadata.gimbalRoll,
          isNadir: nadir,
        },
        droneModel: metadata.droneModel,
        timestamp: metadata.timestamp,
      },
      clickedPoint,
    })
  } catch (err) {
    console.error('Error processing drone image:', err)
    return NextResponse.json(
      { error: 'Failed to process image' },
      { status: 500 }
    )
  }
}

// GET endpoint for coordinate calculation (when metadata is already known)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const lat = parseFloat(searchParams.get('lat') || '')
  const lon = parseFloat(searchParams.get('lon') || '')
  const altitude = parseFloat(searchParams.get('altitude') || '')
  const pixelX = parseFloat(searchParams.get('pixelX') || '')
  const pixelY = parseFloat(searchParams.get('pixelY') || '')
  const imageWidth = parseFloat(searchParams.get('imageWidth') || '')
  const imageHeight = parseFloat(searchParams.get('imageHeight') || '')
  const gsdX = parseFloat(searchParams.get('gsdX') || '')
  const gsdY = parseFloat(searchParams.get('gsdY') || '')

  if (isNaN(lat) || isNaN(lon) || isNaN(pixelX) || isNaN(pixelY)) {
    return NextResponse.json(
      { error: 'Missing required parameters: lat, lon, pixelX, pixelY' },
      { status: 400 }
    )
  }

  // Use provided GSD or require image dimensions and altitude to calculate
  let effectiveGsdX = gsdX
  let effectiveGsdY = gsdY

  if (isNaN(effectiveGsdX) || isNaN(effectiveGsdY)) {
    if (isNaN(altitude) || isNaN(imageWidth) || isNaN(imageHeight)) {
      return NextResponse.json(
        { error: 'Must provide either gsdX/gsdY or altitude/imageWidth/imageHeight' },
        { status: 400 }
      )
    }
    // Estimate GSD with typical drone camera params
    const focalLength = 6.7 // mm (DJI Mini 3 typical)
    const sensorWidth = 9.7 // mm
    const sensorHeight = 7.3 // mm
    effectiveGsdX = (altitude * sensorWidth) / (focalLength * imageWidth)
    effectiveGsdY = (altitude * sensorHeight) / (focalLength * imageHeight)
  }

  const metadata: DroneImageMetadata = {
    latitude: lat,
    longitude: lon,
    altitude: altitude || 100,
    focalLength: 6.7,
    imageWidth: imageWidth || 4000,
    imageHeight: imageHeight || 3000,
    sensorWidth: 9.7,
    sensorHeight: 7.3,
    gsdX: effectiveGsdX,
    gsdY: effectiveGsdY,
    footprintWidth: effectiveGsdX * (imageWidth || 4000),
    footprintHeight: effectiveGsdY * (imageHeight || 3000),
  }

  const groundCoord = pixelToGroundCoordinate({ x: pixelX, y: pixelY }, metadata)

  return NextResponse.json({
    success: true,
    groundCoordinate: groundCoord,
  })
}
