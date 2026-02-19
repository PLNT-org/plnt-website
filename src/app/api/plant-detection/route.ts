'use server'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { fetchWithWebODMAuth } from '@/lib/webodm/token-manager'

// Initialize Supabase with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Roboflow API configuration
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID // e.g., "my-first-project-8qm2b/15"
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com'

// Tiling configuration
const TILE_SIZE = 640        // Model input size
const TILE_OVERLAP = 0.2     // 20% overlap between tiles
const NMS_IOU_THRESHOLD = 0.5 // IoU threshold for removing duplicates
const DEFAULT_CONFIDENCE = 0.5
const JPEG_QUALITY = 90

interface RoboflowPrediction {
  x: number           // center x in pixels (relative to tile)
  y: number           // center y in pixels (relative to tile)
  width: number       // bounding box width
  height: number      // bounding box height
  confidence: number  // 0-1
  class: string       // class name
}

// Detection in center format (matching Roboflow output)
interface Detection {
  x: number           // center x in full image pixels
  y: number           // center y in full image pixels
  width: number
  height: number
  confidence: number
  class: string
}

// Calculate IoU between two center-format boxes
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

  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
  const kept: Detection[] = []

  while (sorted.length > 0) {
    const best = sorted.shift()!
    kept.push(best)

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

// Run YOLOv11 inference on a single tile via Roboflow
async function runTileInference(
  tileBuffer: Buffer,
  confidenceThreshold: number
): Promise<RoboflowPrediction[]> {
  const roboflowUrl = `${ROBOFLOW_API_URL}/${ROBOFLOW_MODEL_ID}?api_key=${ROBOFLOW_API_KEY}&confidence=${confidenceThreshold}`

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
  return data.predictions || []
}

// POST: Run plant detection on an orthomosaic with tiling (streams NDJSON progress)
export async function POST(request: NextRequest) {
  // Parse body upfront so we can return errors as normal JSON
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    orthomosaicId,
    userId,
    confidence_threshold = DEFAULT_CONFIDENCE,
    include_classes = ['plant', 'plants'],
  } = body as {
    orthomosaicId?: string
    userId?: string
    confidence_threshold?: number
    include_classes?: string[]
  }

  // Normalize class names to lowercase for comparison
  const allowedClasses = (include_classes as string[]).map(c => c.toLowerCase())

  if (!orthomosaicId) {
    return NextResponse.json(
      { error: 'orthomosaicId is required' },
      { status: 400 }
    )
  }

  if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) {
    return NextResponse.json(
      { error: 'Roboflow API not configured. Please set ROBOFLOW_API_KEY and ROBOFLOW_MODEL_ID environment variables.' },
      { status: 500 }
    )
  }

  // Pre-flight: fetch orthomosaic metadata before starting the stream
  const { data: orthomosaic, error: orthoError } = await supabase
    .from('orthomosaics')
    .select('*')
    .eq('id', orthomosaicId)
    .single()

  if (orthoError || !orthomosaic) {
    return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
  }
  if (orthomosaic.status !== 'completed') {
    return NextResponse.json({ error: 'Orthomosaic is not ready for processing' }, { status: 400 })
  }
  if (!orthomosaic.orthomosaic_url) {
    return NextResponse.json({ error: 'Orthomosaic image URL not found' }, { status: 400 })
  }
  if (!orthomosaic.bounds) {
    return NextResponse.json({ error: 'Orthomosaic bounds not available' }, { status: 400 })
  }

  // Stream NDJSON: each line is a JSON object followed by \n
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        send({ type: 'status', message: 'Downloading orthomosaic image...' })

        // Download orthomosaic image
        // Use plain fetch for Supabase Storage / public URLs, WebODM auth only for local WebODM
        const orthoUrl = orthomosaic.orthomosaic_url
        const isWebODMUrl = orthoUrl.includes('/api/projects/') || orthoUrl.includes('localhost:8000') || orthoUrl.includes('webodm')
        const imageResponse = isWebODMUrl
          ? await fetchWithWebODMAuth(orthoUrl)
          : await fetch(orthoUrl)
        if (!imageResponse.ok) {
          send({ type: 'error', error: `Failed to download orthomosaic: ${imageResponse.status}` })
          controller.close()
          return
        }
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())

        // Get image dimensions
        const image = sharp(imageBuffer)
        const metadata = await image.metadata()
        const imageWidth = metadata.width!
        const imageHeight = metadata.height!

        // Calculate tile grid
        const stride = Math.floor(TILE_SIZE * (1 - TILE_OVERLAP))
        const tilesX = Math.ceil((imageWidth - TILE_SIZE) / stride) + 1
        const tilesY = Math.ceil((imageHeight - TILE_SIZE) / stride) + 1
        const totalTiles = tilesX * tilesY

        console.log(`[Detection] YOLOv11: ${imageWidth}x${imageHeight}, ${totalTiles} tiles (stride ${stride}px)`)
        console.log(`[Detection] Model: ${ROBOFLOW_MODEL_ID}, confidence: ${confidence_threshold}`)
        console.log(`[Detection] Filtering to classes: ${allowedClasses.join(', ')}`)

        send({
          type: 'progress',
          processedTiles: 0,
          totalTiles,
          detectionsCount: 0,
          phase: 'tiling',
        })

        // Process each tile
        const allDetections: Detection[] = []
        let processedTiles = 0

        for (let ty = 0; ty < tilesY; ty++) {
          for (let tx = 0; tx < tilesX; tx++) {
            const tileX = Math.min(tx * stride, imageWidth - TILE_SIZE)
            const tileY = Math.min(ty * stride, imageHeight - TILE_SIZE)

            const cropWidth = Math.min(TILE_SIZE, imageWidth - Math.max(0, tileX))
            const cropHeight = Math.min(TILE_SIZE, imageHeight - Math.max(0, tileY))

            // Extract tile and resize to model input size
            const tileBuffer = await sharp(imageBuffer)
              .extract({
                left: Math.max(0, tileX),
                top: Math.max(0, tileY),
                width: cropWidth,
                height: cropHeight,
              })
              .resize(TILE_SIZE, TILE_SIZE, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0 }
              })
              .jpeg({ quality: JPEG_QUALITY })
              .toBuffer()

            try {
              const predictions = await runTileInference(
                tileBuffer,
                confidence_threshold as number,
              )

              // Log first tile's predictions to debug class names
              if (processedTiles === 0 && predictions.length > 0) {
                console.log('[Detection] Sample predictions from first tile:', predictions.slice(0, 3).map(p => ({ class: p.class, confidence: p.confidence })))
              }

              if (predictions.length > 0) {
                console.log(`[Detection] Tile (${tx}, ${ty}): ${predictions.length} predictions - classes: ${[...new Set(predictions.map(p => p.class))].join(', ')}`)
              }

              // Convert tile coordinates to full image coordinates
              const scaleX = cropWidth / TILE_SIZE
              const scaleY = cropHeight / TILE_SIZE

              for (const pred of predictions) {
                // Filter by class
                const predClass = (pred.class || 'plant').toLowerCase()
                if (!allowedClasses.includes(predClass)) continue

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
              console.error(`[Detection] Error processing tile (${tx}, ${ty}):`, err)
            }

            processedTiles++

            // Send progress update after every tile
            send({
              type: 'progress',
              processedTiles,
              totalTiles,
              detectionsCount: allDetections.length,
              phase: 'tiling',
            })
          }
        }

        // NMS phase
        send({ type: 'progress', processedTiles: totalTiles, totalTiles, detectionsCount: allDetections.length, phase: 'nms' })
        console.log(`[Detection] Total detections before NMS: ${allDetections.length}`)
        const finalDetections = applyNMS(allDetections, NMS_IOU_THRESHOLD)
        console.log(`[Detection] Detections after NMS: ${finalDetections.length}`)

        // Saving phase
        send({ type: 'progress', processedTiles: totalTiles, totalTiles, detectionsCount: finalDetections.length, phase: 'saving' })

        // Delete existing AI labels
        const { error: deleteError, count: deleteCount } = await supabase
          .from('plant_labels')
          .delete()
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        if (deleteError) {
          console.error('[Detection] Error deleting existing labels:', deleteError)
        } else {
          console.log(`[Detection] Deleted existing AI labels (count: ${deleteCount ?? 'unknown'})`)
        }

        // Convert to GPS labels
        const labels = finalDetections.map(det => {
          const gps = pixelToGPS(det.x, det.y, orthomosaic.bounds, imageWidth, imageHeight)
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

        // Batch insert with retries
        if (labels.length > 0) {
          const chunkSize = 250
          const maxRetries = 3
          let successfulInserts = 0
          let failedInserts = 0

          for (let i = 0; i < labels.length; i += chunkSize) {
            const chunk = labels.slice(i, i + chunkSize)
            let success = false

            for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
              const { error: insertError } = await supabase
                .from('plant_labels')
                .insert(chunk)

              if (insertError) {
                console.error(`[Detection] Chunk insert failed (attempt ${attempt}/${maxRetries}):`, insertError.message)
                if (attempt < maxRetries) {
                  await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000))
                }
              } else {
                success = true
                successfulInserts += chunk.length
              }
            }

            if (!success) {
              failedInserts += chunk.length
            }
          }

          console.log(`[Detection] Batch insert: ${successfulInserts} saved, ${failedInserts} failed of ${labels.length}`)
        }

        // Final count
        const { count: savedCount } = await supabase
          .from('plant_labels')
          .select('*', { count: 'exact', head: true })
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        const classCounts: Record<string, number> = {}
        finalDetections.forEach(det => {
          classCounts[det.class || 'plant'] = (classCounts[det.class || 'plant'] || 0) + 1
        })

        console.log(`[Detection] Complete: ${finalDetections.length} detected, ${savedCount} saved`)

        // Final result event
        send({
          type: 'result',
          success: true,
          orthomosaicId,
          totalDetections: finalDetections.length,
          savedCount: savedCount || 0,
          tilesProcessed: totalTiles,
          classCounts,
          averageConfidence: finalDetections.length > 0
            ? finalDetections.reduce((sum, d) => sum + d.confidence, 0) / finalDetections.length
            : 0,
          labelsCount: savedCount || 0,
        })
      } catch (error) {
        console.error('[Detection] Error:', error)
        send({ type: 'error', error: error instanceof Error ? error.message : 'Detection failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
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
    const batchSize = 1000
    let allLabels: Record<string, unknown>[] = []
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

      if (allLabels.length >= 100000) {
        hasMore = false
      }
    }

    const classCounts: Record<string, number> = {}
    let totalConfidence = 0

    allLabels.forEach(label => {
      const className = (label.label as string) || 'plant'
      classCounts[className] = (classCounts[className] || 0) + 1
      totalConfidence += (label.confidence as number) || 0
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
