import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchWithWebODMAuth } from '@/lib/webodm/token-manager'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const WEBODM_URL = (process.env.WEBODM_URL || 'http://localhost:8000').replace(/\/$/, '')

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

    // Fetch task data from WebODM
    const taskResponse = await fetchWithWebODMAuth(
      `${WEBODM_URL}/api/projects/${ortho.webodm_project_id}/tasks/${ortho.webodm_task_id}/`
    )

    if (!taskResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch from WebODM' }, { status: 500 })
    }

    const task = await taskResponse.json()

    // Extract bounds from extent [west, south, east, north]
    const extent = task.extent
    const bounds = extent ? {
      west: extent[0],
      south: extent[1],
      east: extent[2],
      north: extent[3],
    } : null

    // Build orthomosaic URL
    const orthomosaicUrl = `${WEBODM_URL}/api/projects/${ortho.webodm_project_id}/tasks/${ortho.webodm_task_id}/download/orthophoto.tif`

    // Update record
    const { error: updateError } = await supabaseAdmin
      .from('orthomosaics')
      .update({
        status: task.status === 40 ? 'completed' : task.status === 30 ? 'failed' : 'processing',
        bounds,
        orthomosaic_url: orthomosaicUrl,
        completed_at: task.status === 40 ? new Date().toISOString() : null,
      })
      .eq('id', orthomosaicId)

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      bounds,
      orthomosaicUrl,
      status: task.status === 40 ? 'completed' : 'processing'
    })

  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
