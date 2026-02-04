import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orthomosaicId = searchParams.get('orthomosaicId')

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    // Get orthomosaic ArUco status
    const { data: ortho, error } = await supabaseAdmin
      .from('orthomosaics')
      .select('id, aruco_detection_status, aruco_count, aruco_detected_at, aruco_error_message')
      .eq('id', orthomosaicId)
      .single()

    if (error || !ortho) {
      return NextResponse.json(
        { error: 'Orthomosaic not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      orthomosaicId: ortho.id,
      status: ortho.aruco_detection_status || 'pending',
      markerCount: ortho.aruco_count || 0,
      detectedAt: ortho.aruco_detected_at,
      error: ortho.aruco_error_message,
      isComplete: ortho.aruco_detection_status === 'completed',
      isFailed: ortho.aruco_detection_status === 'failed',
      isProcessing: ortho.aruco_detection_status === 'processing',
    })

  } catch (error) {
    console.error('Error getting ArUco status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    )
  }
}
