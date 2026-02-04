'use server'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

// Initialize Supabase with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Roboflow API configuration
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID // e.g., "plant-counting/1"
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com'

// Tiling configuration
const TILE_SIZE = 640        // Model input size
const TILE_OVERLAP = 0.2     // 20% overlap between tiles
const NMS_IOU_THRESHOLD = 0.5 // IoU threshold for removing duplicates

interface RoboflowPrediction {
  x: number           // center x in pixels (relative to tile)
  y: number           // center y in pixels (relative to tile)
  width: number       // bounding box width
  height: number      // bounding box height
  confidence: number  // 0-1
  class: string       // class name
  points?: { x: number; y: number }[]  // polygon points for instance segmentation
}

interface RoboflowResponse {
  predictions: RoboflowPrediction[]
  image: {
    width: number
    height: number
  }
}

interface Detection {
  x: number           // center x in full image pixels
  y: number           // center y in full image pixels
  width: number
  height: number
  confidence: number
  class: string
}

// Calculate IoU (Intersection over Union) between two boxes
function calculateIoU(box1: Detection, box2: Detection): number {
  const x1_1 = box1.x - box1.width / 2
  const y1_1 = box1.y - box1.height / 2
  const x2_1 = box1.x + box1.width / 2
  const y2_1 = box1.y + box1.height / 2

  const x1_2 = box2.x - box2.width / 2
  const y1_2 = box2.y - box2.height / 2
  const x2_2 = box2.x + box2.width / 2
  const y2_2 = box2.y + box2.height / 2

  const xA = Math.max(x1_1, x1_2)
  const yA = Math.max(y1_1, y1_2)
  const xB = Math.min(x2_1, x2_2)
  const yB = Math.min(y2_1, y2_2)

  const intersection = Math.max(0, xB - xA) * Math.max(0, yB - yA)
  const area1 = box1.width * box1.height
  const area2 = box2.width * box2.height
  const union = area1 + area2 - intersection

  return union > 0 ? intersection / union : 0
}

// Non-Maximum Suppression to remove duplicate detections
function applyNMS(detections: Detection[], iouThreshold: number): Detection[] {
  if (detections.length === 0) return []

  // Sort by confidence (descending)
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
  const kept: Detection[] = []

  while (sorted.length > 0) {
    const best = sorted.shift()!
    kept.push(best)

    // Remove detections with high IoU with the best one
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (calculateIoU(best, sorted[i]) > iouThreshold) {
        sorted.splice(i, 1)
      }
    }
  }

  return kept
}

// Convert pixel coordinates to GPS coordinates
function pixelToGPS(
  pixelX: number,
  pixelY: number,
  bounds: { north: number; south: number; east: number; west: number },
  imageWidth: number,
  imageHeight: number
): { lat: number; lng: number } {
  const lat = bounds.north - (pixelY / imageHeight) * (bounds.north - bounds.south)
  const lng = bounds.west + (pixelX / imageWidth) * (bounds.east - bounds.west)
  return { lat, lng }
}

// Run inference on a single tile
async function runTileInference(
  tileBuffer: Buffer,
  confidenceThreshold: number
): Promise<RoboflowPrediction[]> {
  const roboflowUrl = `${ROBOFLOW_API_URL}/${ROBOFLOW_MODEL_ID}?api_key=${ROBOFLOW_API_KEY}&confidence=${confidenceThreshold}`

  // Create a Blob from the buffer and use FormData for file upload
  const blob = new Blob([tileBuffer], { type: 'image/jpeg' })
  const formData = new FormData()
  formData.append('file', blob, 'tile.jpg')

  const response = await fetch(roboflowUrl, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Roboflow API error:', errorText)
    throw new Error(`Roboflow API error: ${response.status}`)
  }

  const data = await response.json()

  // Log response for debugging
  console.log('Roboflow response keys:', Object.keys(data))
  if (data.predictions) {
    console.log(`Predictions count: ${data.predictions.length}`)
  }

  return data.predictions || []
}

// POST: Run plant detection on an orthomosaic with tiling
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      orthomosaicId,
      userId,
      confidence_threshold = 0.5,
      include_classes = ['plant', 'plants'],  // Only count these classes (case-insensitive)
    } = body

    // Normalize class names to lowercase for comparison
    const allowedClasses = include_classes.map((c: string) => c.toLowerCase())

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    // Check for Roboflow configuration
    if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) {
      return NextResponse.json(
        { error: 'Roboflow API not configured. Please set ROBOFLOW_API_KEY and ROBOFLOW_MODEL_ID environment variables.' },
        { status: 500 }
      )
    }

    // Get orthomosaic details
    const { data: orthomosaic, error: orthoError } = await supabase
      .from('orthomosaics')
      .select('*')
      .eq('id', orthomosaicId)
      .single()

    if (orthoError || !orthomosaic) {
      return NextResponse.json(
        { error: 'Orthomosaic not found' },
        { status: 404 }
      )
    }

    if (orthomosaic.status !== 'completed') {
      return NextResponse.json(
        { error: 'Orthomosaic is not ready for processing' },
        { status: 400 }
      )
    }

    if (!orthomosaic.orthomosaic_url) {
      return NextResponse.json(
        { error: 'Orthomosaic image URL not found' },
        { status: 400 }
      )
    }

    if (!orthomosaic.bounds) {
      return NextResponse.json(
        { error: 'Orthomosaic bounds not available' },
        { status: 400 }
      )
    }

    console.log(`Starting plant detection for orthomosaic: ${orthomosaic.name}`)
    console.log(`Confidence threshold: ${confidence_threshold}`)
    console.log(`Filtering to classes: ${allowedClasses.join(', ')}`)

    // Download the orthomosaic image
    console.log('Downloading orthomosaic image...')
    const webodmToken = process.env.WEBODM_TOKEN
    const imageResponse = await fetch(orthomosaic.orthomosaic_url, {
      headers: webodmToken ? { 'Authorization': `JWT ${webodmToken}` } : {},
    })
    if (!imageResponse.ok) {
      throw new Error(`Failed to download orthomosaic: ${imageResponse.status}`)
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())

    // Get image dimensions
    const image = sharp(imageBuffer)
    const metadata = await image.metadata()
    const imageWidth = metadata.width!
    const imageHeight = metadata.height!

    console.log(`Image dimensions: ${imageWidth}x${imageHeight}`)

    // Calculate tile positions with overlap
    const stride = Math.floor(TILE_SIZE * (1 - TILE_OVERLAP))
    const tilesX = Math.ceil((imageWidth - TILE_SIZE) / stride) + 1
    const tilesY = Math.ceil((imageHeight - TILE_SIZE) / stride) + 1
    const totalTiles = tilesX * tilesY

    console.log(`Tiling into ${tilesX}x${tilesY} = ${totalTiles} tiles (stride: ${stride}px)`)

    // Process each tile
    const allDetections: Detection[] = []
    let processedTiles = 0

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tileX = Math.min(tx * stride, imageWidth - TILE_SIZE)
        const tileY = Math.min(ty * stride, imageHeight - TILE_SIZE)

        // Extract tile
        const tileBuffer = await sharp(imageBuffer)
          .extract({
            left: Math.max(0, tileX),
            top: Math.max(0, tileY),
            width: Math.min(TILE_SIZE, imageWidth - tileX),
            height: Math.min(TILE_SIZE, imageHeight - tileY),
          })
          .resize(TILE_SIZE, TILE_SIZE, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0 }
          })
          .jpeg({ quality: 90 })
          .toBuffer()

        // Run inference on tile
        try {
          const predictions = await runTileInference(tileBuffer, confidence_threshold)

          if (predictions.length > 0) {
            console.log(`Tile (${tx}, ${ty}): ${predictions.length} predictions - classes: ${[...new Set(predictions.map(p => p.class))].join(', ')}`)
          }

          // Convert tile coordinates to full image coordinates
          const tileWidth = Math.min(TILE_SIZE, imageWidth - tileX)
          const tileHeight = Math.min(TILE_SIZE, imageHeight - tileY)
          const scaleX = tileWidth / TILE_SIZE
          const scaleY = tileHeight / TILE_SIZE

          // Log first tile's predictions to see class names
          if (processedTiles === 0 && predictions.length > 0) {
            console.log('Sample predictions from first tile:', predictions.slice(0, 3).map(p => ({ class: p.class, confidence: p.confidence })))
          }

          for (const pred of predictions) {
            // Filter by class - only include allowed classes
            const predClass = (pred.class || 'plant').toLowerCase()
            if (!allowedClasses.includes(predClass)) {
              // Only log occasionally to avoid spam
              if (Math.random() < 0.01) console.log(`Skipping detection with class: ${pred.class}`)
              continue // Skip this detection (e.g., roadways, beds)
            }

            // Log that we're keeping a plant
            if (Math.random() < 0.01) console.log(`KEEPING plant detection: ${pred.class} (confidence: ${pred.confidence})`)

            allDetections.push({
              x: tileX + pred.x * scaleX,
              y: tileY + pred.y * scaleY,
              width: pred.width * scaleX,
              height: pred.height * scaleY,
              confidence: pred.confidence,
              class: pred.class,
            })
          }
        } catch (err) {
          console.error(`Error processing tile (${tx}, ${ty}):`, err)
          // Continue with other tiles
        }

        processedTiles++
        if (processedTiles % 10 === 0 || processedTiles === totalTiles) {
          console.log(`Processed ${processedTiles}/${totalTiles} tiles, ${allDetections.length} detections so far`)
        }
      }
    }

    console.log(`Total detections before NMS: ${allDetections.length}`)

    // Apply NMS to remove duplicate detections at tile boundaries
    const finalDetections = applyNMS(allDetections, NMS_IOU_THRESHOLD)
    console.log(`Detections after NMS: ${finalDetections.length}`)

    // Delete existing AI labels for this orthomosaic
    console.log('Deleting existing AI labels...')
    const { error: deleteError, count: deleteCount } = await supabase
      .from('plant_labels')
      .delete()
      .eq('orthomosaic_id', orthomosaicId)
      .eq('source', 'ai')

    if (deleteError) {
      console.error('Error deleting existing labels:', deleteError)
    } else {
      console.log(`Deleted existing AI labels (count: ${deleteCount ?? 'unknown'})`)
    }

    // Convert detections to plant labels with GPS coordinates
    console.log('Converting detections to GPS coordinates...')
    const labels = finalDetections.map(det => {
      const gps = pixelToGPS(
        det.x,
        det.y,
        orthomosaic.bounds,
        imageWidth,
        imageHeight
      )

      return {
        orthomosaic_id: orthomosaicId,
        user_id: userId || null,
        latitude: gps.lat,
        longitude: gps.lng,
        pixel_x: Math.round(det.x),
        pixel_y: Math.round(det.y),
        source: 'ai' as const,
        confidence: det.confidence,
        label: det.class || 'plant',
        verified: false,
      }
    })

    // Insert all labels in batch with retry logic
    console.log(`Starting batch insert of ${labels.length} labels...`)
    if (labels.length > 0) {
      const chunkSize = 250  // Smaller chunks for reliability
      const maxRetries = 3
      let successfulInserts = 0
      let failedInserts = 0

      for (let i = 0; i < labels.length; i += chunkSize) {
        const chunk = labels.slice(i, i + chunkSize)
        const chunkIndex = Math.floor(i / chunkSize) + 1
        const totalChunks = Math.ceil(labels.length / chunkSize)

        let success = false
        let lastError = null

        // Retry loop with exponential backoff
        for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
          const { error: insertError } = await supabase
            .from('plant_labels')
            .insert(chunk)

          if (insertError) {
            lastError = insertError
            console.error(`Chunk ${chunkIndex}/${totalChunks} insert failed (attempt ${attempt}/${maxRetries}):`, insertError.message)

            if (attempt < maxRetries) {
              // Exponential backoff: 1s, 2s, 4s
              const delay = Math.pow(2, attempt - 1) * 1000
              await new Promise(resolve => setTimeout(resolve, delay))
            }
          } else {
            success = true
            successfulInserts += chunk.length
          }
        }

        if (!success) {
          failedInserts += chunk.length
          console.error(`Chunk ${chunkIndex}/${totalChunks} failed after ${maxRetries} attempts. Labels lost: ${chunk.length}`)
        }

        // Log progress every 10 chunks
        if (chunkIndex % 10 === 0 || chunkIndex === totalChunks) {
          console.log(`Insert progress: ${chunkIndex}/${totalChunks} chunks (${successfulInserts} saved, ${failedInserts} failed)`)
        }
      }

      console.log(`Batch insert complete: ${successfulInserts} labels saved, ${failedInserts} failed out of ${labels.length} total`)
    }

    // Get count of newly inserted labels (use count query for efficiency)
    const { count: savedCount } = await supabase
      .from('plant_labels')
      .select('*', { count: 'exact', head: true })
      .eq('orthomosaic_id', orthomosaicId)
      .eq('source', 'ai')

    // Calculate summary statistics
    const classCounts: Record<string, number> = {}
    finalDetections.forEach(det => {
      const className = det.class || 'plant'
      classCounts[className] = (classCounts[className] || 0) + 1
    })

    console.log(`Plant detection complete: ${finalDetections.length} detected, ${savedCount} saved to database`)

    return NextResponse.json({
      success: true,
      orthomosaicId,
      totalDetections: finalDetections.length,
      savedCount: savedCount || 0,
      tilesProcessed: totalTiles,
      classCounts,
      averageConfidence: finalDetections.length > 0
        ? finalDetections.reduce((sum, d) => sum + d.confidence, 0) / finalDetections.length
        : 0,
      // Don't return all labels in response - too large. Client should fetch separately.
      labelsCount: savedCount || 0,
    })

  } catch (error) {
    console.error('Plant detection error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    )
  }
}

// GET: Get detection status/results for an orthomosaic
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const orthomosaicId = searchParams.get('orthomosaicId')

  if (!orthomosaicId) {
    return NextResponse.json(
      { error: 'orthomosaicId is required' },
      { status: 400 }
    )
  }

  try {
    // Fetch AI labels in batches to bypass Supabase's default 1000 row limit
    const batchSize = 1000
    let allLabels: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('plant_labels')
        .select('*')
        .eq('orthomosaic_id', orthomosaicId)
        .eq('source', 'ai')
        .order('created_at', { ascending: false })
        .range(offset, offset + batchSize - 1)

      if (error) {
        throw error
      }

      if (data && data.length > 0) {
        allLabels = [...allLabels, ...data]
        offset += batchSize
        hasMore = data.length === batchSize
      } else {
        hasMore = false
      }

      // Safety limit
      if (allLabels.length >= 100000) {
        hasMore = false
      }
    }

    // Calculate statistics
    const classCounts: Record<string, number> = {}
    let totalConfidence = 0

    allLabels.forEach(label => {
      const className = label.label || 'plant'
      classCounts[className] = (classCounts[className] || 0) + 1
      totalConfidence += label.confidence || 0
    })

    return NextResponse.json({
      orthomosaicId,
      hasDetections: allLabels.length > 0,
      totalDetections: allLabels.length,
      verifiedCount: allLabels.filter(l => l.verified).length,
      classCounts,
      averageConfidence: allLabels.length > 0
        ? totalConfidence / allLabels.length
        : 0,
      labels: allLabels,
    })

  } catch (error) {
    console.error('Error fetching detection results:', error)
    return NextResponse.json(
      { error: 'Failed to fetch detection results' },
      { status: 500 }
    )
  }
}
