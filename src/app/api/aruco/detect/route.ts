import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ArUcoClient } from '@/lib/aruco/client'
import { DEFAULT_ARUCO_DICTIONARY, ArUcoDictionary } from '@/lib/aruco/types'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ArUco client
const arucoClient = new ArUcoClient()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orthomosaicId, dictionary = DEFAULT_ARUCO_DICTIONARY } = body

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    // Get orthomosaic record
    const { data: ortho, error: orthoError } = await supabaseAdmin
      .from('orthomosaics')
      .select('id, orthomosaic_url, user_id, status, aruco_detection_status')
      .eq('id', orthomosaicId)
      .single()

    if (orthoError || !ortho) {
      return NextResponse.json(
        { error: 'Orthomosaic not found' },
        { status: 404 }
      )
    }

    // Check if orthomosaic is completed
    if (ortho.status !== 'completed') {
      return NextResponse.json(
        { error: 'Orthomosaic must be completed before running ArUco detection' },
        { status: 400 }
      )
    }

    // Check if detection is already in progress
    if (ortho.aruco_detection_status === 'processing') {
      return NextResponse.json(
        { error: 'ArUco detection already in progress' },
        { status: 409 }
      )
    }

    // Check if GeoTIFF URL is available
    if (!ortho.orthomosaic_url) {
      return NextResponse.json(
        { error: 'Orthomosaic URL not available' },
        { status: 400 }
      )
    }

    // Update status to processing
    await supabaseAdmin
      .from('orthomosaics')
      .update({
        aruco_detection_status: 'processing',
        aruco_error_message: null,
      })
      .eq('id', orthomosaicId)

    try {
      // Check if ArUco service is available
      const isAvailable = await arucoClient.isAvailable()
      if (!isAvailable) {
        throw new Error('ArUco detection service is not available')
      }

      // Run detection
      const result = await arucoClient.detect(
        ortho.orthomosaic_url,
        dictionary as ArUcoDictionary
      )

      if (!result.success) {
        throw new Error(result.error || 'Detection failed')
      }

      // Delete any existing markers for this orthomosaic
      await supabaseAdmin
        .from('aruco_markers')
        .delete()
        .eq('orthomosaic_id', orthomosaicId)

      // Insert detected markers
      if (result.markers.length > 0) {
        const markersToInsert = result.markers.map((marker) => ({
          orthomosaic_id: orthomosaicId,
          user_id: ortho.user_id,
          marker_id: marker.marker_id,
          dictionary: dictionary,
          latitude: marker.latitude,
          longitude: marker.longitude,
          pixel_x: marker.pixel_x,
          pixel_y: marker.pixel_y,
          confidence: marker.confidence,
          corner_pixels: marker.corner_pixels,
          corner_coords: marker.corner_coords,
          rotation_deg: marker.rotation_deg,
          verified: false,
          detected_at: new Date().toISOString(),
        }))

        const { error: insertError } = await supabaseAdmin
          .from('aruco_markers')
          .insert(markersToInsert)

        if (insertError) {
          console.error('Error inserting markers:', insertError)
          throw new Error('Failed to save detected markers')
        }
      }

      // Update orthomosaic with success status
      await supabaseAdmin
        .from('orthomosaics')
        .update({
          aruco_detection_status: 'completed',
          aruco_count: result.markers.length,
          aruco_detected_at: new Date().toISOString(),
          aruco_error_message: null,
        })
        .eq('id', orthomosaicId)

      return NextResponse.json({
        success: true,
        markerCount: result.markers.length,
        markers: result.markers,
        dictionary: result.dictionary,
      })

    } catch (detectionError) {
      // Update orthomosaic with failed status
      const errorMessage = detectionError instanceof Error
        ? detectionError.message
        : 'Detection failed'

      await supabaseAdmin
        .from('orthomosaics')
        .update({
          aruco_detection_status: 'failed',
          aruco_error_message: errorMessage,
        })
        .eq('id', orthomosaicId)

      throw detectionError
    }

  } catch (error) {
    console.error('Error in ArUco detection:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    )
  }
}
