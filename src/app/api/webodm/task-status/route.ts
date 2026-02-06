import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { webodm, isTaskComplete, isTaskFailed, getStatusLabel } from '@/lib/webodm/client'
import {
  LightningClient,
  isLightningTaskComplete,
  isLightningTaskFailed,
  getLightningStatusLabel,
} from '@/lib/webodm/lightning-client'
import { WebODMStatusCode } from '@/lib/webodm/types'
import { getOrthomosaicStorage } from '@/lib/supabase/storage'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orthomosaicId = searchParams.get('orthomosaicId')
    const taskId = searchParams.get('taskId')
    const projectId = searchParams.get('projectId')

    // If we have an orthomosaic ID, look up the task details
    let webodmTaskId = taskId
    let webodmProjectId = projectId

    if (orthomosaicId) {
      const { data: ortho, error } = await supabaseAdmin
        .from('orthomosaics')
        .select('webodm_task_id, webodm_project_id, status')
        .eq('id', orthomosaicId)
        .single()

      if (error || !ortho) {
        return NextResponse.json(
          { error: 'Orthomosaic not found' },
          { status: 404 }
        )
      }

      webodmTaskId = ortho.webodm_task_id
      webodmProjectId = ortho.webodm_project_id

      // If already completed/failed, return cached status
      if (ortho.status === 'completed' || ortho.status === 'failed') {
        return NextResponse.json({
          status: ortho.status,
          statusLabel: ortho.status === 'completed' ? 'Completed' : 'Failed',
          progress: ortho.status === 'completed' ? 100 : 0,
          isComplete: ortho.status === 'completed',
          isFailed: ortho.status === 'failed',
        })
      }
    }

    if (!webodmTaskId || !webodmProjectId) {
      return NextResponse.json(
        { error: 'Missing taskId or projectId' },
        { status: 400 }
      )
    }

    // Check if this is a Lightning task
    const isLightning = webodmProjectId === 'lightning'

    if (isLightning) {
      // Use Lightning client
      const lightning = new LightningClient()
      const taskResult = await lightning.getTaskStatus(webodmTaskId)

      const isComplete = isLightningTaskComplete(taskResult.status)
      const isFailed = isLightningTaskFailed(taskResult.status)

      // If task completed, download and upload to Supabase Storage
      if (isComplete && orthomosaicId) {
        try {
          // Download the orthophoto from Lightning
          const orthophotoBuffer = await lightning.downloadOrthophoto(webodmTaskId)

          // Upload to Supabase Storage
          const storage = getOrthomosaicStorage()
          const { url } = await storage.uploadOrthophoto(
            orthomosaicId,
            orthophotoBuffer,
            'orthophoto.tif'
          )

          // Update orthomosaic record with Supabase URL
          await supabaseAdmin
            .from('orthomosaics')
            .update({
              status: 'completed',
              orthomosaic_url: url,
              completed_at: new Date().toISOString(),
            })
            .eq('id', orthomosaicId)
        } catch (uploadError) {
          console.error('Error uploading to Supabase:', uploadError)
          // Still mark as complete but note the error
          await supabaseAdmin
            .from('orthomosaics')
            .update({
              status: 'completed',
              orthomosaic_url: lightning.getOrthophotoUrl(webodmTaskId),
              error_message: `Upload to storage failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`,
              completed_at: new Date().toISOString(),
            })
            .eq('id', orthomosaicId)
        }
      }

      // If task failed, update database
      if (isFailed && orthomosaicId) {
        await supabaseAdmin
          .from('orthomosaics')
          .update({
            status: 'failed',
            error_message: taskResult.error || 'Processing failed',
          })
          .eq('id', orthomosaicId)
      }

      return NextResponse.json({
        status: taskResult.status,
        statusCode: taskResult.status,
        statusLabel: getLightningStatusLabel(taskResult.status),
        progress: taskResult.progress,
        processingTime: taskResult.processingTime,
        imagesCount: taskResult.imagesCount,
        isComplete,
        isFailed,
        error: taskResult.error,
        backend: 'lightning',
      })
    }

    // Standard WebODM flow
    const taskStatus = await webodm.getTaskStatus(
      parseInt(webodmProjectId),
      webodmTaskId
    )

    const isComplete = isTaskComplete(taskStatus.status)
    const isFailed = isTaskFailed(taskStatus.status)

    // If task completed, update database with results
    if (isComplete && orthomosaicId) {
      try {
        // Get orthomosaic metadata from WebODM
        const metadata = await webodm.getOrthomosaicMetadata(
          parseInt(webodmProjectId),
          webodmTaskId
        )

        const orthophotoUrl = webodm.getOrthophotoUrl(
          parseInt(webodmProjectId),
          webodmTaskId
        )

        // Update orthomosaic record
        await supabaseAdmin
          .from('orthomosaics')
          .update({
            status: 'completed',
            orthomosaic_url: orthophotoUrl,
            bounds: metadata.bounds,
            resolution_cm: metadata.resolution,
            image_width: metadata.width,
            image_height: metadata.height,
            completed_at: new Date().toISOString(),
          })
          .eq('id', orthomosaicId)

      } catch (metadataError) {
        console.error('Error fetching orthomosaic metadata:', metadataError)
        // Still mark as complete even if we couldn't get metadata
        await supabaseAdmin
          .from('orthomosaics')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', orthomosaicId)
      }
    }

    // If task failed, update database
    if (isFailed && orthomosaicId) {
      await supabaseAdmin
        .from('orthomosaics')
        .update({
          status: 'failed',
          error_message: taskStatus.error || 'Processing failed',
        })
        .eq('id', orthomosaicId)
    }

    return NextResponse.json({
      status: taskStatus.status,
      statusCode: taskStatus.status,
      statusLabel: getStatusLabel(taskStatus.status),
      progress: taskStatus.progress,
      processingTime: taskStatus.processingTime,
      imagesCount: taskStatus.imagesCount,
      availableAssets: taskStatus.availableAssets,
      isComplete,
      isFailed,
      error: taskStatus.error,
    })

  } catch (error) {
    console.error('Error getting task status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get task status' },
      { status: 500 }
    )
  }
}

// Also support POST for webhook-style callbacks
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orthomosaicId, taskId, projectId, status } = body

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    // Update status based on webhook data
    const updates: any = {
      status: status === WebODMStatusCode.COMPLETED ? 'completed'
        : status === WebODMStatusCode.FAILED ? 'failed'
        : 'processing',
    }

    if (status === WebODMStatusCode.COMPLETED) {
      updates.completed_at = new Date().toISOString()

      // Try to get metadata
      if (taskId && projectId) {
        try {
          const metadata = await webodm.getOrthomosaicMetadata(projectId, taskId)
          updates.bounds = metadata.bounds
          updates.resolution_cm = metadata.resolution
          updates.image_width = metadata.width
          updates.image_height = metadata.height
          updates.orthomosaic_url = webodm.getOrthophotoUrl(projectId, taskId)
        } catch {
          // Ignore metadata errors
        }
      }
    }

    await supabaseAdmin
      .from('orthomosaics')
      .update(updates)
      .eq('id', orthomosaicId)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error updating task status:', error)
    return NextResponse.json(
      { error: 'Failed to update status' },
      { status: 500 }
    )
  }
}
