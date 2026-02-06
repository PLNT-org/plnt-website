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

// SAM3 API configuration
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY
const SAM3_API_URL = 'https://serverless.roboflow.com/sam3/concept_segment'

// Tiling configuration
const TILE_SIZE = 640
const TILE_OVERLAP = 0.25      // 25% overlap between tiles (160px)
const NMS_IOU_THRESHOLD = 0.3  // Tighter threshold for SAM3 polygon-derived boxes

// SAM3-specific defaults
const DEFAULT_PROMPT = 'individual plant'
const DEFAULT_CONFIDENCE = 0.15
const MIN_AREA_PX = 100        // Skip tiny detections (noise)
const API_RATE_LIMIT_MS = 1000 // 1s delay between API calls
const API_TIMEOUT_MS = 120_000 // 120s timeout per tile
const JPEG_QUALITY = 95

// SAM3 response types
interface SAM3PolygonPoint {
  x: number
  y: number
}

interface SAM3Prediction {
  confidence: number
  masks: (SAM3PolygonPoint[] | number[][])[] // Polygons: either {x,y} objects or [x,y] arrays
}

interface SAM3Response {
  prompt_results: Array<{
    predictions: SAM3Prediction[]
  }>
}

// Detection in corner format (axis-aligned bounding box)
interface Detection {
  x1: number  // left
  y1: number  // top
  x2: number  // right
  y2: number  // bottom
  confidence: number
  label: string
}

// Calculate IoU (Intersection over Union) between two corner-format boxes
function calculateIoU(box1: Detection, box2: Detection): number {
  const xA = Math.max(box1.x1, box2.x1)
  const yA = Math.max(box1.y1, box2.y1)
  const xB = Math.min(box1.x2, box2.x2)
  const yB = Math.min(box1.y2, box2.y2)

  const intersection = Math.max(0, xB - xA) * Math.max(0, yB - yA)
  const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1)
  const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1)
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

// Sleep helper for rate limiting
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Run SAM3 concept segmentation on a single tile
async function runSAM3Inference(
  tileBuffer: Buffer,
  prompt: string,
  confidenceThreshold: number
): Promise<Detection[]> {
  // Encode tile as base64 JPEG
  const base64Image = tileBuffer.toString('base64')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

  try {
    const response = await fetch(`${SAM3_API_URL}?api_key=${ROBOFLOW_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'polygon',
        image: { type: 'base64', value: base64Image },
        prompts: [{ type: 'text', text: prompt }],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('SAM3 API error:', errorText)
      throw new Error(`SAM3 API error: ${response.status}`)
    }

    const data = await response.json()

    // Parse predictions from first prompt result
    const predictions = (data as SAM3Response).prompt_results?.[0]?.predictions || []
    const detections: Detection[] = []

    for (const pred of predictions) {
      // Skip low-confidence predictions
      if (pred.confidence < confidenceThreshold) continue

      // Skip if no masks
      if (!pred.masks || pred.masks.length === 0) continue

      // Convert first polygon mask to axis-aligned bounding box
      // SAM3 masks can be: array of {x,y} objects OR array of [x,y] arrays
      const polygon = pred.masks[0]
      if (!polygon || polygon.length === 0) continue

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const pt of polygon) {
        const px = Array.isArray(pt) ? pt[0] : pt.x
        const py = Array.isArray(pt) ? pt[1] : pt.y
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
      }

      const area = (maxX - minX) * (maxY - minY)
      if (area < MIN_AREA_PX) continue

      detections.push({
        x1: minX,
        y1: minY,
        x2: maxX,
        y2: maxY,
        confidence: pred.confidence,
        label: 'plant',
      })
    }

    return detections
  } finally {
    clearTimeout(timeout)
  }
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
    prompt = DEFAULT_PROMPT,
  } = body as {
    orthomosaicId?: string
    userId?: string
    confidence_threshold?: number
    prompt?: string
  }

  if (!orthomosaicId) {
    return NextResponse.json(
      { error: 'orthomosaicId is required' },
      { status: 400 }
    )
  }

  if (!ROBOFLOW_API_KEY) {
    return NextResponse.json(
      { error: 'Roboflow API not configured. Please set ROBOFLOW_API_KEY environment variable.' },
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
        const imageResponse = await fetchWithWebODMAuth(orthomosaic.orthomosaic_url)
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

        console.log(`SAM3: ${imageWidth}x${imageHeight}, ${totalTiles} tiles (stride ${stride}px)`)

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
            const tileLeft = Math.min(tx * stride, imageWidth - TILE_SIZE)
            const tileTop = Math.min(ty * stride, imageHeight - TILE_SIZE)

            const cropWidth = Math.min(TILE_SIZE, imageWidth - Math.max(0, tileLeft))
            const cropHeight = Math.min(TILE_SIZE, imageHeight - Math.max(0, tileTop))

            // Extract tile — crop only, no resize
            const tileBuffer = await sharp(imageBuffer)
              .extract({
                left: Math.max(0, tileLeft),
                top: Math.max(0, tileTop),
                width: cropWidth,
                height: cropHeight,
              })
              .jpeg({ quality: JPEG_QUALITY })
              .toBuffer()

            try {
              const tileDetections = await runSAM3Inference(
                tileBuffer,
                prompt as string,
                confidence_threshold as number,
              )

              if (tileDetections.length > 0) {
                console.log(`Tile (${tx}, ${ty}): ${tileDetections.length} detections`)
              }

              // Remap tile coordinates to full image
              for (const det of tileDetections) {
                allDetections.push({
                  x1: det.x1 + Math.max(0, tileLeft),
                  y1: det.y1 + Math.max(0, tileTop),
                  x2: det.x2 + Math.max(0, tileLeft),
                  y2: det.y2 + Math.max(0, tileTop),
                  confidence: det.confidence,
                  label: det.label,
                })
              }
            } catch (err) {
              console.error(`Error processing tile (${tx}, ${ty}):`, err)
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

            // Rate limit between API calls
            if (processedTiles < totalTiles) {
              await sleep(API_RATE_LIMIT_MS)
            }
          }
        }

        // NMS phase
        send({ type: 'progress', processedTiles: totalTiles, totalTiles, detectionsCount: allDetections.length, phase: 'nms' })
        console.log(`Total detections before NMS: ${allDetections.length}`)
        const finalDetections = applyNMS(allDetections, NMS_IOU_THRESHOLD)
        console.log(`Detections after NMS: ${finalDetections.length}`)

        // Saving phase
        send({ type: 'progress', processedTiles: totalTiles, totalTiles, detectionsCount: finalDetections.length, phase: 'saving' })

        // Delete existing AI labels
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

        // Convert to GPS labels
        const labels = finalDetections.map(det => {
          const centerX = (det.x1 + det.x2) / 2
          const centerY = (det.y1 + det.y2) / 2
          const gps = pixelToGPS(centerX, centerY, orthomosaic.bounds, imageWidth, imageHeight)
          return {
            orthomosaic_id: orthomosaicId,
            user_id: userId || null,
            latitude: gps.lat,
            longitude: gps.lng,
            pixel_x: Math.round(centerX),
            pixel_y: Math.round(centerY),
            source: 'ai' as const,
            confidence: det.confidence,
            label: 'plant',
            verified: false,
          }
        })

        // Batch insert
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
                console.error(`Chunk insert failed (attempt ${attempt}/${maxRetries}):`, insertError.message)
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

          console.log(`Batch insert: ${successfulInserts} saved, ${failedInserts} failed of ${labels.length}`)
        }

        // Final count
        const { count: savedCount } = await supabase
          .from('plant_labels')
          .select('*', { count: 'exact', head: true })
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        const classCounts: Record<string, number> = {}
        finalDetections.forEach(det => {
          classCounts[det.label || 'plant'] = (classCounts[det.label || 'plant'] || 0) + 1
        })

        console.log(`Plant detection complete: ${finalDetections.length} detected, ${savedCount} saved`)

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
        console.error('Plant detection error:', error)
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
    // Fetch AI labels in batches to bypass Supabase's default 1000 row limit
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

      // Safety limit
      if (allLabels.length >= 100000) {
        hasMore = false
      }
    }

    // Calculate statistics
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
