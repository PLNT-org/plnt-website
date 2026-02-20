import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { extractDroneMetadata, pixelToGroundCoordinate } from '@/lib/drone/coordinate-extractor'
import { applyGPSNMS } from '@/lib/detection/gps-nms'

// Allow up to 5 minutes for processing many images
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Roboflow API configuration
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com'

// Tiling configuration — matches Colab inference pipeline exactly
const TILE_SIZE = 400
const TILE_OVERLAP_PX = 100
const NMS_IOU_THRESHOLD = 0.5
const DEFAULT_CONFIDENCE = 0.17
const CONCURRENT_TILES = 25
const GPS_NMS_DISTANCE_METERS = 0.15

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.dng']

interface RoboflowPrediction {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  class: string
}

interface Detection {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  class: string
}

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

async function runTileInference(
  tileBuffer: Buffer,
  confidenceThreshold: number
): Promise<RoboflowPrediction[]> {
  const roboflowUrl = `${ROBOFLOW_API_URL}/${ROBOFLOW_MODEL_ID}?api_key=${ROBOFLOW_API_KEY}&confidence=${confidenceThreshold}`

  const blob = new Blob([tileBuffer], { type: 'image/png' })
  const formData = new FormData()
  formData.append('file', blob, 'tile.png')

  const response = await fetch(roboflowUrl, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[FlightDetection] Roboflow API error:', errorText)
    throw new Error(`Roboflow API error: ${response.status}`)
  }

  const data = await response.json()
  return data.predictions || []
}

// Recursively list image files in a storage folder
async function listImagesInStorage(prefix: string): Promise<string[]> {
  const allImages: string[] = []

  const { data: items, error } = await supabase
    .storage
    .from('flight-images')
    .list(prefix, { limit: 1000 })

  if (error || !items) return allImages

  for (const item of items) {
    const fullPath = `${prefix}/${item.name}`
    if (item.id) {
      // It's a file
      const ext = item.name.toLowerCase().substring(item.name.lastIndexOf('.'))
      if (IMAGE_EXTENSIONS.includes(ext)) {
        allImages.push(fullPath)
      }
    } else {
      // It's a subfolder
      const subImages = await listImagesInStorage(fullPath)
      allImages.push(...subImages)
    }
  }

  return allImages
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    orthomosaicId: inputOrthoId,
    storagePath,
    userId,
    confidence_threshold = DEFAULT_CONFIDENCE,
    maxImages,
  } = body as {
    orthomosaicId?: string
    storagePath?: string
    userId?: string
    confidence_threshold?: number
    maxImages?: number
  }

  if (!inputOrthoId && !storagePath) {
    return NextResponse.json({ error: 'orthomosaicId or storagePath is required' }, { status: 400 })
  }

  if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) {
    return NextResponse.json(
      { error: 'Roboflow API not configured. Set ROBOFLOW_API_KEY and ROBOFLOW_MODEL_ID.' },
      { status: 500 }
    )
  }

  // Resolve image paths — either from orthomosaic record or storage folder
  let imagePaths: string[]

  if (inputOrthoId) {
    // Look up source_image_paths from the orthomosaic record
    const { data: ortho, error: orthoError } = await supabase
      .from('orthomosaics')
      .select('source_image_paths')
      .eq('id', inputOrthoId)
      .single()

    if (orthoError || !ortho) {
      return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
    }

    if (!ortho.source_image_paths || (ortho.source_image_paths as string[]).length === 0) {
      return NextResponse.json(
        { error: 'No source images stored for this orthomosaic. Re-upload images to create a new orthomosaic.' },
        { status: 404 }
      )
    }

    imagePaths = ortho.source_image_paths as string[]
  } else {
    // Fallback: list from storage folder
    imagePaths = await listImagesInStorage(storagePath!)
  }

  if (imagePaths.length === 0) {
    return NextResponse.json({ error: 'No images found' }, { status: 404 })
  }

  if (maxImages) {
    imagePaths = imagePaths.slice(0, maxImages)
  }

  // Stream NDJSON progress
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        const t0 = Date.now()
        const totalImages = imagePaths.length
        send({ type: 'status', message: `Processing ${totalImages} raw drone images...` })

        // Step 1: Determine orthomosaic ID for storing labels
        let orthomosaicId: string

        if (inputOrthoId) {
          // Use the same orthomosaic the user selected
          orthomosaicId = inputOrthoId
          console.log(`[FlightDetection] Using selected ortho: ${orthomosaicId}`)
        } else {
          // Create a sentinel orthomosaic for standalone storage-path runs
          const sentinelKey = `raw-${storagePath}`

          const { data: existingOrtho } = await supabase
            .from('orthomosaics')
            .select('id')
            .eq('webodm_project_id', 'raw-detection')
            .eq('webodm_task_id', sentinelKey)
            .single()

          if (existingOrtho) {
            orthomosaicId = existingOrtho.id
          } else {
            const { data: newOrtho, error: createError } = await supabase
              .from('orthomosaics')
              .insert({
                user_id: userId || null,
                name: `Raw Detection - ${storagePath!.substring(0, 8)}...`,
                status: 'completed',
                webodm_project_id: 'raw-detection',
                webodm_task_id: sentinelKey,
              })
              .select('id')
              .single()

            if (createError || !newOrtho) {
              send({ type: 'error', error: `Failed to create sentinel orthomosaic: ${createError?.message}` })
              controller.close()
              return
            }

            orthomosaicId = newOrtho.id
          }
          console.log(`[FlightDetection] Using sentinel ortho: ${orthomosaicId}`)
        }

        // Step 2: Delete existing AI labels for this orthomosaic
        const { count: deleteCount } = await supabase
          .from('plant_labels')
          .delete()
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        console.log(`[FlightDetection] Deleted ${deleteCount ?? 0} existing AI labels`)

        // Step 3: Process images one at a time
        let totalDetections = 0
        let imagesProcessed = 0
        let imagesSkipped = 0

        for (let imgIdx = 0; imgIdx < imagePaths.length; imgIdx++) {
          const storagFilePath = imagePaths[imgIdx]
          const imageName = storagFilePath.split('/').pop() || `image-${imgIdx}`
          const imageStart = Date.now()

          send({
            type: 'imageProgress',
            imageIndex: imgIdx,
            totalImages,
            imageName,
            phase: 'downloading',
          })

          try {
            // Download image from Supabase Storage
            const { data: fileData, error: downloadError } = await supabase
              .storage
              .from('flight-images')
              .download(storagFilePath)

            if (downloadError || !fileData) {
              console.error(`[FlightDetection] Failed to download ${imageName}:`, downloadError)
              send({ type: 'warning', message: `Skipping ${imageName}: download failed` })
              imagesSkipped++
              continue
            }

            const imageBuffer = await fileData.arrayBuffer()

            // Extract EXIF metadata
            let metadata
            try {
              metadata = await extractDroneMetadata(imageBuffer)
            } catch {
              console.warn(`[FlightDetection] No GPS data in ${imageName}, skipping`)
              send({ type: 'warning', message: `Skipping ${imageName}: no GPS data in EXIF` })
              imagesSkipped++
              continue
            }

            // Decode to raw pixels with sharp
            send({
              type: 'imageProgress',
              imageIndex: imgIdx,
              totalImages,
              imageName,
              phase: 'decoding',
            })

            const { data: rawPixels, info: rawInfo } = await sharp(Buffer.from(imageBuffer))
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true })

            const imageWidth = rawInfo.width
            const imageHeight = rawInfo.height
            const channels = rawInfo.channels

            // Build tile grid — 400x400, stride 300
            const stride = TILE_SIZE - TILE_OVERLAP_PX
            interface TileJob { x: number; y: number; cropWidth: number; cropHeight: number }
            const tileJobs: TileJob[] = []

            for (let y = 0; y < imageHeight; y += stride) {
              for (let x = 0; x < imageWidth; x += stride) {
                const cropWidth = Math.min(TILE_SIZE, imageWidth - x)
                const cropHeight = Math.min(TILE_SIZE, imageHeight - y)
                tileJobs.push({ x, y, cropWidth, cropHeight })
              }
            }

            console.log(`[FlightDetection] ${imageName}: ${imageWidth}x${imageHeight}, ${tileJobs.length} tiles`)

            send({
              type: 'imageProgress',
              imageIndex: imgIdx,
              totalImages,
              imageName,
              phase: 'inferring',
              totalTiles: tileJobs.length,
            })

            // Process tiles in batches
            const allDetections: Detection[] = []

            for (let i = 0; i < tileJobs.length; i += CONCURRENT_TILES) {
              const batch = tileJobs.slice(i, i + CONCURRENT_TILES)

              const batchResults = await Promise.allSettled(
                batch.map(async (job) => {
                  const tileBuffer = await sharp(rawPixels, {
                    raw: { width: imageWidth, height: imageHeight, channels },
                  })
                    .extract({
                      left: job.x,
                      top: job.y,
                      width: job.cropWidth,
                      height: job.cropHeight,
                    })
                    .removeAlpha()
                    .png()
                    .toBuffer()

                  const predictions = await runTileInference(
                    tileBuffer,
                    confidence_threshold as number,
                  )

                  const detections: Detection[] = []
                  for (const pred of predictions) {
                    const predClass = (pred.class || 'plant').toLowerCase()
                    if (!['plant', 'plants'].includes(predClass)) continue

                    detections.push({
                      x: job.x + pred.x,
                      y: job.y + pred.y,
                      width: pred.width,
                      height: pred.height,
                      confidence: pred.confidence,
                      class: pred.class,
                    })
                  }

                  return detections
                })
              )

              for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                  allDetections.push(...result.value)
                } else {
                  console.error('[FlightDetection] Tile error:', result.reason)
                }
              }
            }

            // Per-image pixel-space NMS
            const nmsDetections = applyNMS(allDetections, NMS_IOU_THRESHOLD)
            console.log(`[FlightDetection] ${imageName}: ${allDetections.length} raw -> ${nmsDetections.length} after NMS`)

            // Convert each detection to GPS via EXIF metadata
            const labels = nmsDetections.map(det => {
              const gps = pixelToGroundCoordinate(
                { x: det.x, y: det.y },
                metadata
              )

              return {
                orthomosaic_id: orthomosaicId,
                user_id: userId || null,
                latitude: gps.latitude,
                longitude: gps.longitude,
                pixel_x: Math.round(det.x),
                pixel_y: Math.round(det.y),
                source: 'ai' as const,
                confidence: det.confidence,
                label: det.class || 'plant',
                verified: false,
              }
            })

            // Save labels to DB per-image
            if (labels.length > 0) {
              const chunkSize = 250
              for (let i = 0; i < labels.length; i += chunkSize) {
                const chunk = labels.slice(i, i + chunkSize)
                const { error: insertError } = await supabase
                  .from('plant_labels')
                  .insert(chunk)

                if (insertError) {
                  console.error(`[FlightDetection] Insert error for ${imageName}:`, insertError.message)
                }
              }
            }

            totalDetections += nmsDetections.length
            imagesProcessed++

            const elapsed = ((Date.now() - imageStart) / 1000).toFixed(1)
            console.log(`[FlightDetection] ${imageName}: ${nmsDetections.length} plants in ${elapsed}s`)

            send({
              type: 'imageProgress',
              imageIndex: imgIdx,
              totalImages,
              imageName,
              phase: 'done',
              detectionsInImage: nmsDetections.length,
              totalDetections,
            })
          } catch (imgErr) {
            console.error(`[FlightDetection] Error processing ${imageName}:`, imgErr)
            send({ type: 'warning', message: `Error processing ${imageName}: ${imgErr instanceof Error ? imgErr.message : 'unknown'}` })
            imagesSkipped++
          }
        }

        // Step 4: Cross-image GPS NMS
        send({ type: 'status', message: 'Running cross-image deduplication...' })
        console.log(`[FlightDetection] Cross-image GPS NMS on ${totalDetections} detections (threshold: ${GPS_NMS_DISTANCE_METERS}m)`)

        const batchSize = 1000
        let allLabels: Array<{ id: string; latitude: number; longitude: number; confidence: number }> = []
        let offset = 0
        let hasMore = true

        while (hasMore) {
          const { data, error } = await supabase
            .from('plant_labels')
            .select('id, latitude, longitude, confidence')
            .eq('orthomosaic_id', orthomosaicId)
            .eq('source', 'ai')
            .range(offset, offset + batchSize - 1)

          if (error || !data || data.length === 0) {
            hasMore = false
          } else {
            allLabels = [...allLabels, ...data]
            offset += batchSize
            hasMore = data.length === batchSize
          }
        }

        if (allLabels.length > 0) {
          const suppressedIds = applyGPSNMS(
            allLabels.map(l => ({
              id: l.id,
              latitude: l.latitude,
              longitude: l.longitude,
              confidence: l.confidence || 0,
            })),
            GPS_NMS_DISTANCE_METERS
          )

          if (suppressedIds.length > 0) {
            console.log(`[FlightDetection] GPS NMS: suppressing ${suppressedIds.length} of ${allLabels.length} labels`)

            for (let i = 0; i < suppressedIds.length; i += 100) {
              const chunk = suppressedIds.slice(i, i + 100)
              await supabase
                .from('plant_labels')
                .delete()
                .in('id', chunk)
            }
          }

          totalDetections = allLabels.length - suppressedIds.length
        }

        // Final count from DB
        const { count: savedCount } = await supabase
          .from('plant_labels')
          .select('*', { count: 'exact', head: true })
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`[FlightDetection] Complete: ${savedCount} plants saved from ${imagesProcessed} images in ${elapsed}s (${imagesSkipped} skipped)`)

        send({
          type: 'result',
          success: true,
          orthomosaicId,
          storagePath,
          totalDetections: savedCount || 0,
          savedCount: savedCount || 0,
          imagesProcessed,
          imagesSkipped,
          totalImages,
          elapsedSeconds: parseFloat(elapsed),
        })
      } catch (error) {
        console.error('[FlightDetection] Error:', error)
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
