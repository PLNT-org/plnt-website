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
const NMS_IOU_THRESHOLD = 0.05
const DEFAULT_CONFIDENCE = 0.17
const CONCURRENT_TILES = 10
const GPS_NMS_DISTANCE_METERS = 2.0

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

  const MAX_RETRIES = 3
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const blob = new Blob([tileBuffer], { type: 'image/png' })
      const formData = new FormData()
      formData.append('file', blob, 'tile.png')

      const response = await fetch(roboflowUrl, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (attempt < MAX_RETRIES && (response.status === 502 || response.status === 503 || response.status === 429)) {
          const delay = 1000 * (attempt + 1)
          console.warn(`[FlightDetection] Roboflow ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        console.error('[FlightDetection] Roboflow API error:', errorText)
        throw new Error(`Roboflow API error: ${response.status}`)
      }

      const data = await response.json()
      return data.predictions || []
    } catch (err) {
      if (attempt < MAX_RETRIES && err instanceof Error && (err.message.includes('502') || err.message.includes('connection') || err.message.includes('ECONNRESET'))) {
        const delay = 1000 * (attempt + 1)
        console.warn(`[FlightDetection] Roboflow connection error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }

  return [] // Shouldn't reach here, but satisfy TypeScript
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
    startIndex = 0,
    batchSize = 10,
    gps_nms_distance = GPS_NMS_DISTANCE_METERS,
  } = body as {
    orthomosaicId?: string
    storagePath?: string
    userId?: string
    confidence_threshold?: number
    maxImages?: number
    startIndex?: number
    batchSize?: number
    gps_nms_distance?: number
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

  const totalImageCount = maxImages ? Math.min(imagePaths.length, maxImages) : imagePaths.length
  // Slice to the batch for this invocation
  const endIndex = Math.min(startIndex + batchSize, totalImageCount)
  const batchPaths = imagePaths.slice(startIndex, endIndex)
  const isFirstBatch = startIndex === 0
  const isLastBatch = endIndex >= totalImageCount

  // Stream NDJSON progress
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        const t0 = Date.now()
        send({ type: 'status', message: `Processing images ${startIndex + 1}-${endIndex} of ${totalImageCount}...` })

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

        // Step 2: Delete existing AI labels only on first batch
        if (isFirstBatch) {
          const { count: deleteCount } = await supabase
            .from('plant_labels')
            .delete()
            .eq('orthomosaic_id', orthomosaicId)
            .eq('source', 'ai')

          console.log(`[FlightDetection] Deleted ${deleteCount ?? 0} existing AI labels`)
        }

        console.log(`[FlightDetection] Processing batch: images ${startIndex}-${endIndex - 1} of ${totalImageCount} (batch size ${batchSize})`)

        // Step 3: Process images one at a time
        let totalDetections = 0
        let imagesProcessed = 0
        let imagesSkipped = 0

        for (let imgIdx = 0; imgIdx < batchPaths.length; imgIdx++) {
          const storagFilePath = batchPaths[imgIdx]
          const globalIdx = startIndex + imgIdx
          const imageName = storagFilePath.split('/').pop() || `image-${globalIdx}`
          const imageStart = Date.now()

          send({
            type: 'imageProgress',
            imageIndex: globalIdx,
            totalImages: totalImageCount,
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
              console.log(`[FlightDetection] ${imageName}: GPS=(${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}), alt=${metadata.altitude}m, yaw=${metadata.gimbalYaw}, pitch=${metadata.gimbalPitch}, GSD=${metadata.gsdX.toFixed(4)}m/px`)
            } catch {
              console.warn(`[FlightDetection] No GPS data in ${imageName}, skipping`)
              send({ type: 'warning', message: `Skipping ${imageName}: no GPS data in EXIF` })
              imagesSkipped++
              continue
            }

            // Decode to raw pixels with sharp
            send({
              type: 'imageProgress',
              imageIndex: globalIdx,
              totalImages: totalImageCount,
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
              imageIndex: globalIdx,
              totalImages: totalImageCount,
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
              imageIndex: globalIdx,
              totalImages: totalImageCount,
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

        // Step 4: Offset correction + cross-image GPS NMS (only on last batch)
        if (isLastBatch) {
          send({ type: 'status', message: 'Correcting GPS offset and deduplicating...' })

          // 4a. Fetch ALL AI labels with full row data (for re-insertion after correction)
          const dbPageSize = 1000
          let allLabels: Array<{
            id: string; orthomosaic_id: string; user_id: string | null;
            latitude: number; longitude: number; pixel_x: number | null; pixel_y: number | null;
            source: string; confidence: number; label: string; verified: boolean;
          }> = []
          let offset = 0
          let hasMore = true

          while (hasMore) {
            const { data, error } = await supabase
              .from('plant_labels')
              .select('id, orthomosaic_id, user_id, latitude, longitude, pixel_x, pixel_y, source, confidence, label, verified')
              .eq('orthomosaic_id', orthomosaicId)
              .eq('source', 'ai')
              .range(offset, offset + dbPageSize - 1)

            if (error || !data || data.length === 0) {
              hasMore = false
            } else {
              allLabels = [...allLabels, ...data]
              offset += dbPageSize
              hasMore = data.length === dbPageSize
            }
          }

          console.log(`[FlightDetection] Fetched ${allLabels.length} AI labels for post-processing`)

          if (allLabels.length > 0) {
            // 4b. GPS offset correction — align raw EXIF GPS with orthomosaic coordinates
            // Compute centroid of all detections and compare to orthomosaic center.
            // Raw EXIF GPS has systematic bias vs the photogrammetry-corrected orthomosaic.
            const { data: orthoData } = await supabase
              .from('orthomosaics')
              .select('bounds')
              .eq('id', orthomosaicId)
              .single()

            if (orthoData?.bounds) {
              const bounds = orthoData.bounds as { north: number; south: number; east: number; west: number }
              const orthoCenterLat = (bounds.north + bounds.south) / 2
              const orthoCenterLon = (bounds.east + bounds.west) / 2

              const labelCenterLat = allLabels.reduce((sum, l) => sum + l.latitude, 0) / allLabels.length
              const labelCenterLon = allLabels.reduce((sum, l) => sum + l.longitude, 0) / allLabels.length

              const offsetLat = orthoCenterLat - labelCenterLat
              const offsetLon = orthoCenterLon - labelCenterLon

              // Compute offset magnitude in meters
              const offsetMeters = Math.sqrt(
                (offsetLat * 111320) ** 2 +
                (offsetLon * 111320 * Math.cos(labelCenterLat * Math.PI / 180)) ** 2
              )

              console.log(`[FlightDetection] GPS offset: ${offsetMeters.toFixed(1)}m (dlat=${offsetLat.toFixed(6)}, dlon=${offsetLon.toFixed(6)})`)
              console.log(`[FlightDetection]   Ortho center: (${orthoCenterLat.toFixed(6)}, ${orthoCenterLon.toFixed(6)})`)
              console.log(`[FlightDetection]   Label center: (${labelCenterLat.toFixed(6)}, ${labelCenterLon.toFixed(6)})`)

              // Apply offset if significant (> 0.3m)
              if (offsetMeters > 0.3) {
                send({ type: 'status', message: `Applying GPS offset correction (${offsetMeters.toFixed(1)}m)...` })
                for (const label of allLabels) {
                  label.latitude += offsetLat
                  label.longitude += offsetLon
                }
                console.log(`[FlightDetection] Applied offset correction to ${allLabels.length} labels`)
              } else {
                console.log(`[FlightDetection] GPS offset < 0.3m, skipping correction`)
              }
            }

            // 4c. Cross-image GPS NMS with configurable distance
            console.log(`[FlightDetection] GPS NMS: ${allLabels.length} labels, distance threshold: ${gps_nms_distance}m`)

            const suppressedIds = applyGPSNMS(
              allLabels.map(l => ({
                id: l.id,
                latitude: l.latitude,
                longitude: l.longitude,
                confidence: l.confidence || 0,
              })),
              gps_nms_distance as number
            )

            const suppressedSet = new Set(suppressedIds)
            const survivingLabels = allLabels.filter(l => !suppressedSet.has(l.id))
            console.log(`[FlightDetection] GPS NMS: ${allLabels.length} → ${survivingLabels.length} (suppressed ${suppressedIds.length})`)

            // 4d. Delete all AI labels and re-insert surviving ones with corrected coordinates
            send({ type: 'status', message: `Saving ${survivingLabels.length} deduplicated labels...` })

            // Delete all AI labels for this orthomosaic
            let deleteOffset = 0
            let deleteMore = true
            while (deleteMore) {
              const { data: toDelete } = await supabase
                .from('plant_labels')
                .select('id')
                .eq('orthomosaic_id', orthomosaicId)
                .eq('source', 'ai')
                .range(0, 999)

              if (!toDelete || toDelete.length === 0) {
                deleteMore = false
              } else {
                await supabase
                  .from('plant_labels')
                  .delete()
                  .in('id', toDelete.map(r => r.id))
                deleteOffset += toDelete.length
              }
            }
            console.log(`[FlightDetection] Deleted ${deleteOffset} old AI labels`)

            // Re-insert surviving labels with corrected GPS coordinates
            for (let i = 0; i < survivingLabels.length; i += 250) {
              const chunk = survivingLabels.slice(i, i + 250).map(({ id, ...rest }) => rest)
              const { error: insertError } = await supabase
                .from('plant_labels')
                .insert(chunk)

              if (insertError) {
                console.error(`[FlightDetection] Re-insert error at chunk ${i}:`, insertError.message)
              }
            }

            totalDetections = survivingLabels.length
            console.log(`[FlightDetection] Re-inserted ${survivingLabels.length} corrected labels`)
          }
        }

        // Final count from DB
        const { count: savedCount } = await supabase
          .from('plant_labels')
          .select('*', { count: 'exact', head: true })
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`[FlightDetection] Batch done: ${savedCount} plants saved from ${imagesProcessed} images in ${elapsed}s (${imagesSkipped} skipped), isLastBatch=${isLastBatch}`)

        send({
          type: 'result',
          success: true,
          orthomosaicId,
          storagePath,
          totalDetections: savedCount || 0,
          savedCount: savedCount || 0,
          imagesProcessed,
          imagesSkipped,
          totalImages: totalImageCount,
          batchComplete: true,
          isLastBatch,
          nextStartIndex: isLastBatch ? undefined : endIndex,
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
