import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { LightningClient } from '@/lib/webodm/lightning-client'
import { PROCESSING_PRESETS } from '@/lib/webodm/types'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    const quality = (formData.get('quality') as string) || 'balanced'
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

    // Initialize Lightning client
    const lightning = new LightningClient()

    // Check Lightning availability
    const isAvailable = await lightning.healthCheck()
    if (!isAvailable) {
      return NextResponse.json(
        { error: 'WebODM Lightning is not available. Please check your token and try again.' },
        { status: 503 }
      )
    }

    // Select processing options based on quality
    const processingOptions =
      quality === 'fast'
        ? PROCESSING_PRESETS.fast
        : quality === 'high'
        ? PROCESSING_PRESETS.plantCounting
        : quality === 'height-mapping'
        ? PROCESSING_PRESETS.heightMapping
        : PROCESSING_PRESETS.balanced

    // Create task in Lightning
    const { uuid } = await lightning.createTask({
      name: `PLNT - ${name}`,
      images,
      options: processingOptions,
    })

    // Create orthomosaic record in database
    const isHeightMapping = quality === 'height-mapping'
    const { data: orthomosaic, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .insert({
        flight_id: null, // Direct upload, no associated flight
        user_id: user?.id || null,
        name: name,
        webodm_task_id: uuid,
        webodm_project_id: 'lightning', // Marker to indicate Lightning was used
        status: 'processing',
        processing_type: isHeightMapping ? 'height-mapping' : 'orthomosaic',
        has_dsm: isHeightMapping,
        has_dtm: isHeightMapping,
      })
      .select()
      .single()

    if (orthoError) {
      console.error('Error creating orthomosaic record:', orthoError)
      // Don't fail - task is already created in Lightning
    }

    return NextResponse.json({
      success: true,
      taskId: uuid,
      orthomosaicId: orthomosaic?.id,
      imagesCount: images.length,
      message: `Processing started with ${images.length} images via WebODM Lightning`,
      backend: 'lightning',
    })
  } catch (error) {
    console.error('Error creating Lightning task:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    )
  }
}
