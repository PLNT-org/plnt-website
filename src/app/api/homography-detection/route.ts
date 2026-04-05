import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { extractDroneMetadata } from '@/lib/drone/coordinate-extractor'
import { applyGPSNMS } from '@/lib/detection/gps-nms'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

// Allow up to 10 minutes for processing — homography matching is heavier per image
export const maxDuration = 600

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Roboflow API configuration
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com'

// Python CV service (aruco-service with homography endpoint)
const CV_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'

// Tiling configuration — SAHI-style sliding window on raw images
const TILE_SIZE = 640
const TILE_OVERLAP_PX = 320  // 50% overlap
const NMS_IOU_THRESHOLD = 0.05
const DEFAULT_CONFIDENCE = 0.17
const CONCURRENT_TILES = 8
const GPS_NMS_DISTANCE_METERS = 0.3

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
  x: number  // center x in raw image pixels
  y: number  // center y in raw image pixels
  width: number
  height: number
  confidence: number
  class: string
}

interface HomographyResult {
  success: boolean
  homography: number[][] | null  // 3x3 matrix
  crop_offset_x: number
  crop_offset_y: number
  crop_width: number
  crop_height: number
  good_matches: number
  inlier_count: number
  inlier_ratio: number
  error?: string
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

/**
 * Apply a 3x3 homography matrix to a point, then add the crop offset
 * to get coordinates in the full orthomosaic pixel space.
 */
function applyHomography(
  px: number,
  py: number,
  H: number[][],
  cropOffsetX: number,
  cropOffsetY: number
): { orthoX: number; orthoY: number } {
  // Homogeneous coordinates: [x', y', w'] = H * [x, y, 1]
  const w = H[2][0] * px + H[2][1] * py + H[2][2]
  const x = (H[0][0] * px + H[0][1] * py + H[0][2]) / w
  const y = (H[1][0] * px + H[1][1] * py + H[1][2]) / w

  // Add crop offset to get full-ortho pixel coordinates
  return {
    orthoX: x + cropOffsetX,
    orthoY: y + cropOffsetY,
  }
}

/**
 * Convert ortho pixel coordinates to GPS using the ortho's bounds.
 */
function orthoPixelToGPS(
  orthoX: number,
  orthoY: number,
  bounds: { north: number; south: number; east: number; west: number },
  orthoWidth: number,
  orthoHeight: number
): { latitude: number; longitude: number } {
  const latitude = bounds.north - (orthoY / orthoHeight) * (bounds.north - bounds.south)
  const longitude = bounds.west + (orthoX / orthoWidth) * (bounds.east - bounds.west)
  return { latitude, longitude }
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
          console.warn(`[HomographyDetection] Roboflow ${response.status}, retrying in ${delay}ms`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw new Error(`Roboflow API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      return data.predictions || []
    } catch (err) {
      if (attempt < MAX_RETRIES && err instanceof Error && (err.message.includes('502') || err.message.includes('ECONNRESET'))) {
        const delay = 1000 * (attempt + 1)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }

  return []
}

/**
 * Call the Python CV service to compute homography between a raw image and the ortho.
 */
async function computeHomography(
  rawImageUrl: string,
  geotiffUrl: string,
  latitude: number,
  longitude: number,
  footprintWidthM: number,
  footprintHeightM: number
): Promise<HomographyResult> {
  const response = await fetch(`${CV_SERVICE_URL}/homography`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      geotiff_url: geotiffUrl,
      raw_image_url: rawImageUrl,
      image_latitude: latitude,
      image_longitude: longitude,
      footprint_width_m: footprintWidthM,
      footprint_height_m: footprintHeightM,
      padding_factor: 1.5,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return {
      success: false,
      homography: null,
      crop_offset_x: 0,
      crop_offset_y: 0,
      crop_width: 0,
      crop_height: 0,
      good_matches: 0,
      inlier_count: 0,
      inlier_ratio: 0,
      error: `CV service error: ${response.status} - ${errorText}`,
    }
  }

  return response.json()
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
      const ext = item.name.toLowerCase().substring(item.name.lastIndexOf('.'))
      if (IMAGE_EXTENSIONS.includes(ext)) {
        allImages.push(fullPath)
      }
    } else {
      const subImages = await listImagesInStorage(fullPath)
      allImages.push(...subImages)
    }
  }

  return allImages
}

export async function POST(request: NextRequest) {
  // Auth check
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    orthomosaicId: inputOrthoId,
    storagePath,
    confidence_threshold = DEFAULT_CONFIDENCE,
    maxImages,
    startIndex = 0,
    batchSize = 5,
    gps_nms_distance = GPS_NMS_DISTANCE_METERS,
  } = body as {
    orthomosaicId?: string
    storagePath?: string
    confidence_threshold?: number
    maxImages?: number
    startIndex?: number
    batchSize?: number
    gps_nms_distance?: number
  }

  if (!inputOrthoId) {
    return NextResponse.json(
      { error: 'orthomosaicId is required (needed for the orthomosaic reference)' },
      { status: 400 }
    )
  }

  if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) {
    return NextResponse.json(
      { error: 'Roboflow API not configured. Set ROBOFLOW_API_KEY and ROBOFLOW_MODEL_ID.' },
      { status: 500 }
    )
  }

  // Verify ownership
  const ownershipError = await verifyOrthomosaicOwnership(supabase, inputOrthoId, user.id, isAdmin)
  if (ownershipError) return ownershipError

  // Fetch orthomosaic metadata — we need bounds, dimensions, and the GeoTIFF URL
  const { data: ortho, error: orthoError } = await supabase
    .from('orthomosaics')
    .select('source_image_paths, bounds, image_width, image_height, original_tif_url, orthomosaic_url')
    .eq('id', inputOrthoId)
    .single()

  if (orthoError || !ortho) {
    return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
  }

  if (!ortho.bounds) {
    return NextResponse.json({ error: 'Orthomosaic bounds not available' }, { status: 400 })
  }

  // We need the original TIF for feature matching (not the WebP)
  const geotiffUrl = ortho.original_tif_url
  if (!geotiffUrl) {
    return NextResponse.json(
      { error: 'Original GeoTIFF not available. Re-process the orthomosaic to generate it.' },
      { status: 400 }
    )
  }

  const orthoBounds = ortho.bounds as { north: number; south: number; east: number; west: number }
  const orthoWidth = ortho.image_width as number
  const orthoHeight = ortho.image_height as number

  if (!orthoWidth || !orthoHeight) {
    return NextResponse.json({ error: 'Orthomosaic dimensions not stored' }, { status: 400 })
  }

  // Resolve image paths
  let imagePaths: string[]
  if (storagePath) {
    imagePaths = await listImagesInStorage(storagePath)
  } else if (ortho.source_image_paths && (ortho.source_image_paths as string[]).length > 0) {
    imagePaths = ortho.source_image_paths as string[]
  } else {
    return NextResponse.json(
      { error: 'No source images found. Provide storagePath or ensure orthomosaic has source_image_paths.' },
      { status: 404 }
    )
  }

  if (imagePaths.length === 0) {
    return NextResponse.json({ error: 'No images found' }, { status: 404 })
  }

  const totalImageCount = maxImages ? Math.min(imagePaths.length, maxImages as number) : imagePaths.length
  const endIndex = Math.min((startIndex as number) + (batchSize as number), totalImageCount)
  const batchPaths = imagePaths.slice(startIndex as number, endIndex)
  const isFirstBatch = (startIndex as number) === 0
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

        send({
          type: 'status',
          message: `Homography-based detection: processing images ${(startIndex as number) + 1}-${endIndex} of ${totalImageCount}. Detections on raw images will be feature-matched to the orthomosaic.`,
        })

        const orthomosaicId = inputOrthoId

        // Delete existing AI labels only on first batch
        if (isFirstBatch) {
          const { count: deleteCount } = await supabase
            .from('plant_labels')
            .delete()
            .eq('orthomosaic_id', orthomosaicId)
            .eq('source', 'ai')

          console.log(`[HomographyDetection] Deleted ${deleteCount ?? 0} existing AI labels`)
        }

        let totalDetections = 0
        let imagesProcessed = 0
        let imagesSkipped = 0
        let homographyFailures = 0

        for (let imgIdx = 0; imgIdx < batchPaths.length; imgIdx++) {
          const storagFilePath = batchPaths[imgIdx]
          const globalIdx = (startIndex as number) + imgIdx
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
              console.error(`[HomographyDetection] Failed to download ${imageName}:`, downloadError)
              send({ type: 'warning', message: `Skipping ${imageName}: download failed` })
              imagesSkipped++
              continue
            }

            const imageBuffer = await fileData.arrayBuffer()

            // Extract EXIF metadata (for GPS position and footprint estimation)
            let metadata
            try {
              metadata = await extractDroneMetadata(imageBuffer)
              console.log(`[HomographyDetection] ${imageName}: GPS=(${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}), footprint=${metadata.footprintWidth.toFixed(1)}x${metadata.footprintHeight.toFixed(1)}m`)
            } catch {
              console.warn(`[HomographyDetection] No GPS data in ${imageName}, skipping`)
              send({ type: 'warning', message: `Skipping ${imageName}: no GPS data in EXIF` })
              imagesSkipped++
              continue
            }

            // === Phase 1: Run YOLO on the raw image (high quality) ===
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

            // Build tile grid
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

            send({
              type: 'imageProgress',
              imageIndex: globalIdx,
              totalImages: totalImageCount,
              imageName,
              phase: 'inferring',
              totalTiles: tileJobs.length,
            })

            // Process tiles
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
                  console.error('[HomographyDetection] Tile error:', result.reason)
                }
              }
            }

            // Per-image pixel-space NMS
            const nmsDetections = applyNMS(allDetections, NMS_IOU_THRESHOLD)
            console.log(`[HomographyDetection] ${imageName}: ${allDetections.length} raw -> ${nmsDetections.length} after NMS`)

            if (nmsDetections.length === 0) {
              console.log(`[HomographyDetection] ${imageName}: No detections, skipping homography`)
              imagesProcessed++
              send({
                type: 'imageProgress',
                imageIndex: globalIdx,
                totalImages: totalImageCount,
                imageName,
                phase: 'done',
                detectionsInImage: 0,
                totalDetections,
              })
              continue
            }

            // === Phase 2: Compute homography (raw image -> ortho) ===
            send({
              type: 'imageProgress',
              imageIndex: globalIdx,
              totalImages: totalImageCount,
              imageName,
              phase: 'matching',
              detectionsInImage: nmsDetections.length,
            })

            // Create a signed URL for the raw image so the Python service can download it
            const { data: signedData } = await supabase
              .storage
              .from('flight-images')
              .createSignedUrl(storagFilePath, 600)  // 10 min expiry

            if (!signedData?.signedUrl) {
              console.error(`[HomographyDetection] Failed to create signed URL for ${imageName}`)
              send({ type: 'warning', message: `Skipping ${imageName}: failed to create signed URL` })
              imagesSkipped++
              continue
            }

            const homographyResult = await computeHomography(
              signedData.signedUrl,
              geotiffUrl,
              metadata.latitude,
              metadata.longitude,
              metadata.footprintWidth,
              metadata.footprintHeight
            )

            if (!homographyResult.success || !homographyResult.homography) {
              console.warn(`[HomographyDetection] ${imageName}: Homography failed: ${homographyResult.error}`)
              send({
                type: 'warning',
                message: `${imageName}: Feature matching failed (${homographyResult.error}). Detections from this image will be skipped.`,
              })
              homographyFailures++
              imagesProcessed++
              send({
                type: 'imageProgress',
                imageIndex: globalIdx,
                totalImages: totalImageCount,
                imageName,
                phase: 'done',
                detectionsInImage: 0,
                totalDetections,
              })
              continue
            }

            const H = homographyResult.homography
            console.log(`[HomographyDetection] ${imageName}: Homography OK — ${homographyResult.inlier_count} inliers (${(homographyResult.inlier_ratio * 100).toFixed(0)}%)`)

            // === Phase 3: Transform detections through homography to ortho pixel space, then to GPS ===
            const labels = nmsDetections.map(det => {
              const { orthoX, orthoY } = applyHomography(
                det.x, det.y,
                H,
                homographyResult.crop_offset_x,
                homographyResult.crop_offset_y
              )

              const { latitude, longitude } = orthoPixelToGPS(
                orthoX, orthoY,
                orthoBounds,
                orthoWidth,
                orthoHeight
              )

              return {
                orthomosaic_id: orthomosaicId,
                user_id: user.id,
                latitude,
                longitude,
                pixel_x: Math.round(orthoX),
                pixel_y: Math.round(orthoY),
                source: 'ai' as const,
                confidence: det.confidence,
                label: det.class || 'plant',
                verified: false,
              }
            })

            // Filter out labels that project outside the ortho bounds
            const validLabels = labels.filter(l =>
              l.pixel_x >= 0 && l.pixel_x < orthoWidth &&
              l.pixel_y >= 0 && l.pixel_y < orthoHeight
            )

            if (validLabels.length < labels.length) {
              console.log(`[HomographyDetection] ${imageName}: ${labels.length - validLabels.length} detections projected outside ortho bounds, discarded`)
            }

            // Save labels to DB
            if (validLabels.length > 0) {
              const chunkSize = 250
              for (let i = 0; i < validLabels.length; i += chunkSize) {
                const chunk = validLabels.slice(i, i + chunkSize)
                const { error: insertError } = await supabase
                  .from('plant_labels')
                  .insert(chunk)

                if (insertError) {
                  console.error(`[HomographyDetection] Insert error for ${imageName}:`, insertError.message)
                }
              }
            }

            totalDetections += validLabels.length
            imagesProcessed++

            const elapsed = ((Date.now() - imageStart) / 1000).toFixed(1)
            console.log(`[HomographyDetection] ${imageName}: ${validLabels.length} plants placed on ortho in ${elapsed}s`)

            send({
              type: 'imageProgress',
              imageIndex: globalIdx,
              totalImages: totalImageCount,
              imageName,
              phase: 'done',
              detectionsInImage: validLabels.length,
              totalDetections,
              homographyInliers: homographyResult.inlier_count,
            })
          } catch (imgErr) {
            console.error(`[HomographyDetection] Error processing ${imageName}:`, imgErr)
            send({ type: 'warning', message: `Error processing ${imageName}: ${imgErr instanceof Error ? imgErr.message : 'unknown'}` })
            imagesSkipped++
          }
        }

        // === Phase 4: Cross-image GPS NMS deduplication (last batch only) ===
        if (isLastBatch) {
          send({ type: 'status', message: 'Deduplicating across overlapping images...' })

          // Fetch all AI labels
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
              .eq('orthomosaic_id', inputOrthoId)
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

          console.log(`[HomographyDetection] Fetched ${allLabels.length} AI labels for dedup`)

          if (allLabels.length > 0) {
            const effectiveNmsDistance = gps_nms_distance as number
            console.log(`[HomographyDetection] GPS NMS: ${allLabels.length} labels, distance: ${effectiveNmsDistance}m`)

            const suppressedIds = applyGPSNMS(
              allLabels.map(l => ({
                id: l.id,
                latitude: l.latitude,
                longitude: l.longitude,
                confidence: l.confidence || 0,
              })),
              effectiveNmsDistance
            )

            const suppressedSet = new Set(suppressedIds)
            const survivingLabels = allLabels.filter(l => !suppressedSet.has(l.id))
            console.log(`[HomographyDetection] GPS NMS: ${allLabels.length} → ${survivingLabels.length} (suppressed ${suppressedIds.length})`)

            // Delete all and re-insert survivors
            send({ type: 'status', message: `Saving ${survivingLabels.length} deduplicated labels...` })

            const { error: deleteError } = await supabase
              .from('plant_labels')
              .delete({ count: 'exact' })
              .eq('orthomosaic_id', inputOrthoId)
              .eq('source', 'ai')

            if (deleteError) {
              console.error(`[HomographyDetection] Delete error:`, deleteError.message)
            }

            let insertedCount = 0
            for (let i = 0; i < survivingLabels.length; i += 250) {
              const chunk = survivingLabels.slice(i, i + 250).map(({ id, ...rest }) => rest)
              const { error: insertError } = await supabase
                .from('plant_labels')
                .insert(chunk)

              if (insertError) {
                console.error(`[HomographyDetection] Re-insert error at chunk ${i}:`, insertError.message)
              } else {
                insertedCount += chunk.length
              }
            }

            totalDetections = survivingLabels.length
            console.log(`[HomographyDetection] Re-inserted ${insertedCount} deduplicated labels`)
          }
        }

        // Final count
        const { count: savedCount } = await supabase
          .from('plant_labels')
          .select('*', { count: 'exact', head: true })
          .eq('orthomosaic_id', inputOrthoId)
          .eq('source', 'ai')

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`[HomographyDetection] Done: ${savedCount} plants from ${imagesProcessed} images in ${elapsed}s (${imagesSkipped} skipped, ${homographyFailures} homography failures)`)

        send({
          type: 'result',
          success: true,
          orthomosaicId: inputOrthoId,
          totalDetections: savedCount || 0,
          savedCount: savedCount || 0,
          imagesProcessed,
          imagesSkipped,
          homographyFailures,
          totalImages: totalImageCount,
          batchComplete: true,
          isLastBatch,
          nextStartIndex: isLastBatch ? undefined : endIndex,
          elapsedSeconds: parseFloat(elapsed),
        })
      } catch (error) {
        console.error('[HomographyDetection] Error:', error)
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
