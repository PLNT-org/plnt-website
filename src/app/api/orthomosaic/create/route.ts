import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PROCESSING_PRESETS } from '@/lib/webodm/types'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const WEBODM_URL = process.env.WEBODM_URL || 'http://localhost:8000'
const WEBODM_TOKEN = process.env.WEBODM_TOKEN || ''

export async function POST(request: NextRequest) {
  try {
    // Get user from cookies
    let user = null
    const cookies = request.headers.get('cookie') || ''
    const accessTokenMatch = cookies.match(/sb-[^-]+-auth-token=([^;]+)/)
    if (accessTokenMatch) {
      try {
        const tokenData = JSON.parse(decodeURIComponent(accessTokenMatch[1]))
        if (tokenData.access_token) {
          const { data } = await supabaseAdmin.auth.getUser(tokenData.access_token)
          user = data.user
        }
      } catch {
        // Token parsing failed
      }
    }

    const formData = await request.formData()
    const name = formData.get('name') as string
    const quality = formData.get('quality') as string || 'balanced'
    const images = formData.getAll('images') as File[]

    if (!name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      )
    }

    if (images.length < 3) {
      return NextResponse.json(
        { error: 'At least 3 images are required' },
        { status: 400 }
      )
    }

    // Check WebODM availability
    try {
      const healthCheck = await fetch(`${WEBODM_URL}/api/projects/`, {
        headers: { Authorization: `JWT ${WEBODM_TOKEN}` }
      })
      if (!healthCheck.ok) {
        throw new Error('WebODM not responding')
      }
    } catch {
      return NextResponse.json(
        { error: 'WebODM is not available. Please ensure it is running at ' + WEBODM_URL },
        { status: 503 }
      )
    }

    // Create project in WebODM
    const projectResponse = await fetch(`${WEBODM_URL}/api/projects/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${WEBODM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `PLNT - ${name}`,
        description: `Created via PLNT upload on ${new Date().toISOString()}`
      }),
    })

    if (!projectResponse.ok) {
      const error = await projectResponse.text()
      throw new Error(`Failed to create WebODM project: ${error}`)
    }

    const project = await projectResponse.json()

    // Select processing options based on quality
    const processingOptions = quality === 'fast'
      ? PROCESSING_PRESETS.fast
      : quality === 'high'
      ? PROCESSING_PRESETS.plantCounting
      : quality === 'height-mapping'
      ? PROCESSING_PRESETS.heightMapping
      : PROCESSING_PRESETS.balanced

    // Create task with images
    const taskFormData = new FormData()
    taskFormData.append('name', name)

    // Add processing options - WebODM expects all values as strings
    const optionsArray = Object.entries(processingOptions).map(([key, value]) => ({
      name: key,
      value: String(value),
    }))
    taskFormData.append('options', JSON.stringify(optionsArray))

    // Add images
    for (const image of images) {
      taskFormData.append('images', image, image.name)
    }

    const taskResponse = await fetch(`${WEBODM_URL}/api/projects/${project.id}/tasks/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${WEBODM_TOKEN}`,
      },
      body: taskFormData,
    })

    if (!taskResponse.ok) {
      const error = await taskResponse.text()
      throw new Error(`Failed to create WebODM task: ${error}`)
    }

    const task = await taskResponse.json()

    // Create orthomosaic record in database
    // Note: We don't have a flight_id since this is a direct upload
    const isHeightMapping = quality === 'height-mapping'
    const { data: orthomosaic, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .insert({
        flight_id: null, // Direct upload, no associated flight
        user_id: user?.id || null,
        name: name,
        webodm_task_id: task.id,
        webodm_project_id: String(project.id),
        status: 'processing',
        processing_type: isHeightMapping ? 'height-mapping' : 'orthomosaic',
        has_dsm: isHeightMapping,
        has_dtm: isHeightMapping,
      })
      .select()
      .single()

    if (orthoError) {
      console.error('Error creating orthomosaic record:', orthoError)
      // Don't fail - task is already created in WebODM
    }

    return NextResponse.json({
      success: true,
      taskId: task.id,
      projectId: project.id,
      orthomosaicId: orthomosaic?.id,
      imagesCount: images.length,
      message: `Processing started with ${images.length} images`,
      webodmUrl: `${WEBODM_URL}/dashboard/`,
    })

  } catch (error) {
    console.error('Error creating orthomosaic:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create orthomosaic' },
      { status: 500 }
    )
  }
}
