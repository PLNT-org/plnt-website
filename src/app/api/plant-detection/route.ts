import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

// Allow up to 5 minutes for large orthomosaics
export const maxDuration = 300

// Initialize Supabase with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUCO_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'

// Roboflow API configuration
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com'

const DEFAULT_CONFIDENCE = 0.17

// POST: Run plant detection on an orthomosaic via Docker service (streams NDJSON progress)
export async function POST(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    orthomosaicId,
    confidence_threshold = DEFAULT_CONFIDENCE,
    include_classes = ['plant', 'plants'],
  } = body as {
    orthomosaicId?: string
    confidence_threshold?: number
    include_classes?: string[]
  }

  if (!orthomosaicId) {
    return NextResponse.json({ error: 'orthomosaicId is required' }, { status: 400 })
  }

  if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) {
    return NextResponse.json(
      { error: 'Roboflow API not configured. Please set ROBOFLOW_API_KEY and ROBOFLOW_MODEL_ID environment variables.' },
      { status: 500 }
    )
  }

  // Fetch orthomosaic metadata
  const { data: orthomosaic, error: orthoError } = await supabase
    .from('orthomosaics')
    .select('*')
    .eq('id', orthomosaicId)
    .single()

  if (orthoError || !orthomosaic) {
    return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
  }

  const ownershipError = await verifyOrthomosaicOwnership(supabase, orthomosaicId, user.id, isAdmin)
  if (ownershipError) return ownershipError

  if (orthomosaic.status !== 'completed') {
    return NextResponse.json({ error: 'Orthomosaic is not ready for processing' }, { status: 400 })
  }
  if (!orthomosaic.orthomosaic_url) {
    return NextResponse.json({ error: 'Orthomosaic image URL not found' }, { status: 400 })
  }
  if (!orthomosaic.bounds) {
    return NextResponse.json({ error: 'Orthomosaic bounds not available' }, { status: 400 })
  }

  // Use original TIF for best quality detection
  const orthoUrl = orthomosaic.original_tif_url || orthomosaic.orthomosaic_url

  // Stream NDJSON progress from Docker service to the client
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      try {
        send({ type: 'status', message: 'Starting plant detection via Docker service...' })

        // Call Docker service
        const detectRes = await fetch(`${ARUCO_SERVICE_URL}/detect-plants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geotiff_url: orthoUrl,
            roboflow_api_key: ROBOFLOW_API_KEY,
            roboflow_model_id: ROBOFLOW_MODEL_ID,
            roboflow_api_url: ROBOFLOW_API_URL,
            confidence_threshold,
            include_classes,
            bounds: orthomosaic.bounds,
          }),
        })

        if (!detectRes.ok) {
          const errText = await detectRes.text()
          send({ type: 'error', error: `Docker service error: ${errText}` })
          controller.close()
          return
        }

        // Read NDJSON stream from Docker service
        const reader = detectRes.body?.getReader()
        if (!reader) {
          send({ type: 'error', error: 'No response body from Docker service' })
          controller.close()
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let finalResult: Record<string, unknown> | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line)

              if (event.type === 'result') {
                finalResult = event
              } else {
                // Forward status/progress events to client
                send(event)
              }
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Process remaining buffer
        buffer += decoder.decode()
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer)
            if (event.type === 'result') {
              finalResult = event
            } else {
              send(event)
            }
          } catch {
            // Skip
          }
        }

        if (!finalResult || !finalResult.success) {
          send({ type: 'error', error: (finalResult as any)?.error || 'Detection returned no results' })
          controller.close()
          return
        }

        // Save detections to DB
        send({ type: 'progress', processedTiles: 0, totalTiles: 0, detectionsCount: finalResult.totalDetections, phase: 'saving' })

        // Delete existing AI labels
        const { error: deleteError } = await supabase
          .from('plant_labels')
          .delete()
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        if (deleteError) {
          console.error('[Detection] Error deleting existing labels:', deleteError)
        }

        // Convert detections to labels and batch insert
        const detections = (finalResult.detections as any[]) || []
        const labels = detections.map(det => ({
          orthomosaic_id: orthomosaicId,
          user_id: user.id,
          latitude: det.latitude,
          longitude: det.longitude,
          pixel_x: det.pixel_x,
          pixel_y: det.pixel_y,
          source: 'ai' as const,
          confidence: det.confidence,
          label: det.class || 'plant',
          verified: false,
        }))

        if (labels.length > 0) {
          const chunkSize = 250
          const maxRetries = 3
          let successfulInserts = 0

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
          }

          console.log(`[Detection] Saved ${successfulInserts} of ${labels.length} labels`)
        }

        // Get final count
        const { count: savedCount } = await supabase
          .from('plant_labels')
          .select('*', { count: 'exact', head: true })
          .eq('orthomosaic_id', orthomosaicId)
          .eq('source', 'ai')

        send({
          type: 'result',
          success: true,
          orthomosaicId,
          totalDetections: finalResult.totalDetections,
          savedCount: savedCount || 0,
          classCounts: finalResult.classCounts,
          averageConfidence: finalResult.averageConfidence,
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
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabase)
  if (errorResponse) return errorResponse

  const { searchParams } = new URL(request.url)
  const orthomosaicId = searchParams.get('orthomosaicId')

  if (!orthomosaicId) {
    return NextResponse.json(
      { error: 'orthomosaicId is required' },
      { status: 400 }
    )
  }

  const ownershipError = await verifyOrthomosaicOwnership(supabase, orthomosaicId, user.id, isAdmin)
  if (ownershipError) return ownershipError

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
