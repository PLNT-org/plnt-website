import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

export const maxDuration = 300

import {
  LightningClient,
  LightningStatusCode,
  isLightningTaskComplete,
  isLightningTaskFailed,
} from '@/lib/webodm/lightning-client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUCO_SERVICE_URL = process.env.ARUCO_SERVICE_URL || 'http://localhost:8001'

export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const { orthomosaicId } = await request.json()

    if (!orthomosaicId) {
      return NextResponse.json({ error: 'orthomosaicId required' }, { status: 400 })
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

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

    // If completed, offload download/conversion to Docker service
    if (newStatus === 'completed') {
      try {
        const geotiffUrl = lightning.getOrthophotoUrl(taskId)
        const tifPath = `${orthomosaicId}/orthophoto.tif`
        const cogPath = `${orthomosaicId}/orthophoto_cog.tif`

        // Create signed upload URLs for TIF and COG
        const [tifUpload, cogUpload] = await Promise.all([
          supabaseAdmin.storage.from('orthomosaics').createSignedUploadUrl(tifPath, { upsert: true }),
          supabaseAdmin.storage.from('orthomosaics').createSignedUploadUrl(cogPath, { upsert: true }),
        ])

        if (tifUpload.error || !tifUpload.data || cogUpload.error || !cogUpload.data) {
          throw new Error('Failed to create signed upload URLs')
        }

        // Call Docker service to download, upload TIF, convert COG, upload COG, extract metadata
        console.log(`[Sync] Calling Docker service for task ${taskId}...`)
        const syncRes = await fetch(`${ARUCO_SERVICE_URL}/sync-ortho`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geotiff_url: geotiffUrl,
            tif_upload_url: tifUpload.data.signedUrl,
            cog_upload_url: cogUpload.data.signedUrl,
          }),
        })

        if (!syncRes.ok) {
          throw new Error(`Docker service error: ${syncRes.status}`)
        }

        const syncData = await syncRes.json()

        if (!syncData.success) {
          throw new Error(syncData.error || 'Sync failed')
        }

        // Get public URLs
        const { data: tifUrlData } = supabaseAdmin.storage.from('orthomosaics').getPublicUrl(tifPath)
        const { data: cogUrlData } = supabaseAdmin.storage.from('orthomosaics').getPublicUrl(cogPath)

        updateData.original_tif_url = tifUrlData.publicUrl
        updateData.orthomosaic_url = cogUrlData.publicUrl
        updateData.bounds = syncData.bounds
        updateData.image_width = syncData.image_width
        updateData.image_height = syncData.image_height
        updateData.resolution_cm = syncData.resolution_cm
        updateData.completed_at = new Date().toISOString()

        console.log(`[Sync] Done. TIF: ${syncData.tif_size_mb} MB, COG: ${syncData.cog_size_mb} MB`)

        // Try to download corrected camera positions AND reconstruction data from ODM output
        try {
          console.log('[Sync] Fetching camera positions and reconstruction data...')
          const { cameraPositions, reconstructionData } = await lightning.downloadReconstructionAndPositions(taskId)
          if (cameraPositions) {
            updateData.camera_positions = cameraPositions
            console.log(`[Sync] Saved ${Object.keys(cameraPositions).length} corrected camera positions`)
          }
          if (reconstructionData) {
            updateData.reconstruction_data = reconstructionData
            console.log(`[Sync] Saved reconstruction data: ${Object.keys(reconstructionData.shots).length} shots`)
          }
        } catch (camErr) {
          console.error('[Sync] Failed to fetch camera positions (non-fatal):', camErr)
        }

      } catch (syncError) {
        console.error('[Sync] Error:', syncError)
        updateData.error_message = `Sync failed: ${syncError instanceof Error ? syncError.message : 'Unknown error'}`
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
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse

  const { searchParams } = new URL(request.url)
  const taskId = searchParams.get('taskId')

  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  }

  // Look up orthomosaic by task ID and verify ownership
  const { data: ortho } = await supabaseAdmin.from('orthomosaics').select('id, user_id').eq('webodm_task_id', taskId).single()
  if (ortho) {
    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, ortho.id, user.id, isAdmin)
    if (ownershipError) return ownershipError
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
