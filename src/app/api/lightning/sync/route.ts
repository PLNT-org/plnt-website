import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  LightningClient,
  LightningStatusCode,
  isLightningTaskComplete,
  isLightningTaskFailed,
} from '@/lib/webodm/lightning-client'
import { getOrthomosaicStorage, BUCKETS } from '@/lib/supabase/storage'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    // Check if this is a Lightning task
    if (ortho.webodm_project_id !== 'lightning') {
      return NextResponse.json(
        { error: 'This orthomosaic was not processed with Lightning. Use /api/orthomosaic/sync instead.' },
        { status: 400 }
      )
    }

    const taskId = ortho.webodm_task_id
    if (!taskId) {
      return NextResponse.json({ error: 'No task ID found' }, { status: 400 })
    }

    // Initialize Lightning client
    const lightning = new LightningClient()

    // Get task status
    const taskResult = await lightning.getTaskStatus(taskId)

    // Determine status
    let newStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'processing'
    if (isLightningTaskComplete(taskResult.status)) {
      newStatus = 'completed'
    } else if (isLightningTaskFailed(taskResult.status)) {
      newStatus = 'failed'
    }

    // Build update object
    const updateData: Record<string, any> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    }

    // If completed, download and upload to Supabase Storage
    if (newStatus === 'completed') {
      try {
        // Download the orthophoto from Lightning
        console.log(`Downloading orthophoto for task ${taskId}...`)
        const orthophotoBuffer = await lightning.downloadOrthophoto(taskId)

        // Upload to Supabase Storage
        const storage = getOrthomosaicStorage()
        const { url } = await storage.uploadOrthophoto(
          orthomosaicId,
          orthophotoBuffer,
          'orthophoto.tif'
        )

        console.log(`Uploaded orthophoto to: ${url}`)

        // Update with Supabase URL
        updateData.orthomosaic_url = url
        updateData.completed_at = new Date().toISOString()

        // Try to get bounds from the task info
        // Note: Lightning/NodeODM doesn't provide bounds in the same way as WebODM
        // We'll need to extract bounds from the GeoTIFF itself or estimate from images
        // For now, we'll leave bounds as null and handle it in the frontend

      } catch (uploadError) {
        console.error('Error uploading to Supabase:', uploadError)
        // Still mark as completed but note the upload failure
        updateData.error_message = `Upload to storage failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`
        // Keep the Lightning URL as fallback
        updateData.orthomosaic_url = lightning.getOrthophotoUrl(taskId)
      }
    } else if (newStatus === 'failed') {
      updateData.error_message = taskResult.error || 'Processing failed'
    }

    // Update database record
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update(updateData)
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      progress: taskResult.progress,
      processingTime: taskResult.processingTime,
      orthomosaicUrl: updateData.orthomosaic_url,
      backend: 'lightning',
    })
  } catch (error) {
    console.error('Lightning sync error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to check task status without syncing
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const taskId = searchParams.get('taskId')

  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  }

  try {
    const lightning = new LightningClient()
    const status = await lightning.getTaskStatus(taskId)

    return NextResponse.json({
      uuid: status.uuid,
      status: status.status,
      statusLabel: getStatusLabel(status.status),
      progress: status.progress,
      processingTime: status.processingTime,
      imagesCount: status.imagesCount,
      isComplete: isLightningTaskComplete(status.status),
      isFailed: isLightningTaskFailed(status.status),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    )
  }
}

function getStatusLabel(status: LightningStatusCode): string {
  switch (status) {
    case LightningStatusCode.QUEUED:
      return 'Queued'
    case LightningStatusCode.RUNNING:
      return 'Processing'
    case LightningStatusCode.FAILED:
      return 'Failed'
    case LightningStatusCode.COMPLETED:
      return 'Completed'
    case LightningStatusCode.CANCELED:
      return 'Canceled'
    default:
      return 'Unknown'
  }
}
