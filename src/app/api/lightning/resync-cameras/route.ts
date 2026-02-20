import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { LightningClient } from '@/lib/webodm/lightning-client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/lightning/resync-cameras
 * Re-fetch corrected camera positions from an existing Lightning task.
 * Useful for orthomosaics that were processed before camera position download was added.
 */
export async function POST(request: NextRequest) {
  try {
    const { orthomosaicId } = await request.json()

    if (!orthomosaicId) {
      return NextResponse.json({ error: 'orthomosaicId required' }, { status: 400 })
    }

    // Get orthomosaic record
    const { data: ortho, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .select('id, webodm_project_id, webodm_task_id, camera_positions')
      .eq('id', orthomosaicId)
      .single()

    if (orthoError || !ortho) {
      return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
    }

    if (ortho.webodm_project_id !== 'lightning') {
      return NextResponse.json(
        { error: 'This orthomosaic was not processed with Lightning' },
        { status: 400 }
      )
    }

    const taskId = ortho.webodm_task_id
    if (!taskId) {
      return NextResponse.json({ error: 'No task ID found' }, { status: 400 })
    }

    // Try to download camera positions
    const lightning = new LightningClient()
    const cameraPositions = await lightning.downloadCameraPositions(taskId)

    if (!cameraPositions || Object.keys(cameraPositions).length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Camera positions not available. The Lightning task may have expired (tasks expire after ~7 days).',
      }, { status: 404 })
    }

    // Save to database
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update({
        camera_positions: cameraPositions,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orthomosaicId)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to save camera positions' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      count: Object.keys(cameraPositions).length,
      filenames: Object.keys(cameraPositions).slice(0, 5),
    })
  } catch (error) {
    console.error('Resync cameras error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resync cameras' },
      { status: 500 }
    )
  }
}
