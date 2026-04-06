import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST - Link a Lightning task ID to a stuck orthomosaic
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { orthomosaicId, taskId } = await request.json()

    if (!orthomosaicId || !taskId) {
      return NextResponse.json(
        { error: 'orthomosaicId and taskId are required' },
        { status: 400 }
      )
    }

    // Verify the orthomosaic exists
    const { data: ortho, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .select('id, status, webodm_task_id')
      .eq('id', orthomosaicId)
      .single()

    if (orthoError || !ortho) {
      return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
    }

    // Update the record with the task ID and set to processing so the poller picks it up
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update({
        webodm_task_id: taskId,
        webodm_project_id: 'lightning',
        status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('Error linking task:', updateError)
      return NextResponse.json({ error: 'Failed to update orthomosaic' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      orthomosaicId,
      taskId,
      previousStatus: ortho.status,
      previousTaskId: ortho.webodm_task_id,
    })
  } catch (error) {
    console.error('Error linking task:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to link task' },
      { status: 500 }
    )
  }
}
