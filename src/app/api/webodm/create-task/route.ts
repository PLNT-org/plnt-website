import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { WebODMClient, webodm } from '@/lib/webodm/client'
import { PROCESSING_PRESETS } from '@/lib/webodm/types'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { flightId, name, quality = 'balanced' } = body

    if (!flightId) {
      return NextResponse.json(
        { error: 'flightId is required' },
        { status: 400 }
      )
    }

    // Get flight details and associated images
    const { data: flight, error: flightError } = await supabaseAdmin
      .from('flights')
      .select(`
        id,
        flight_plan_id,
        images_captured,
        flight_plans (
          id,
          user_id,
          name,
          plot_id,
          plots (
            id,
            name
          )
        )
      `)
      .eq('id', flightId)
      .single()

    if (flightError || !flight) {
      return NextResponse.json(
        { error: 'Flight not found' },
        { status: 404 }
      )
    }

    // Get images for this flight
    const { data: images, error: imagesError } = await supabaseAdmin
      .from('flight_images')
      .select('storage_path')
      .eq('flight_id', flightId)

    if (imagesError || !images || images.length === 0) {
      return NextResponse.json(
        { error: 'No images found for this flight' },
        { status: 400 }
      )
    }

    // Get signed URLs for images
    const imageUrls: string[] = []
    for (const image of images) {
      const { data } = await supabaseAdmin.storage
        .from('flight-images')
        .createSignedUrl(image.storage_path, 3600) // 1 hour
      if (data?.signedUrl) {
        imageUrls.push(data.signedUrl)
      }
    }

    if (imageUrls.length === 0) {
      return NextResponse.json(
        { error: 'Could not generate image URLs' },
        { status: 500 }
      )
    }

    // Check WebODM availability
    const isAvailable = await webodm.healthCheck()
    if (!isAvailable) {
      return NextResponse.json(
        { error: 'WebODM is not available. Please ensure it is running.' },
        { status: 503 }
      )
    }

    // Create or get project in WebODM
    const projectName = `PLNT - ${(flight.flight_plans as any)?.plots?.name || 'Unknown Plot'}`
    let project

    const projects = await webodm.listProjects()
    project = projects.find(p => p.name === projectName)

    if (!project) {
      project = await webodm.createProject(projectName, `Auto-created for PLNT flight ${flightId}`)
    }

    // Select processing preset
    const processingOptions = quality === 'fast'
      ? PROCESSING_PRESETS.fast
      : quality === 'high'
      ? PROCESSING_PRESETS.highQuality
      : quality === 'plant-counting'
      ? PROCESSING_PRESETS.plantCounting
      : quality === 'height-mapping'
      ? PROCESSING_PRESETS.heightMapping
      : PROCESSING_PRESETS.balanced

    // Create task in WebODM
    const taskName = name || `Flight ${flightId.slice(0, 8)} - ${new Date().toISOString().split('T')[0]}`

    const task = await webodm.createTask({
      projectId: project.id,
      name: taskName,
      images: imageUrls,
      options: processingOptions,
    })

    // Create orthomosaic record in database
    const isHeightMapping = quality === 'height-mapping'
    const { data: orthomosaic, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .insert({
        flight_id: flightId,
        user_id: (flight.flight_plans as any)?.user_id,
        name: taskName,
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
      imagesCount: imageUrls.length,
      message: `Processing started with ${imageUrls.length} images`,
    })

  } catch (error) {
    console.error('Error creating WebODM task:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create processing task' },
      { status: 500 }
    )
  }
}
