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
    const verified = searchParams.get('verified')

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    // Build query
    let query = supabaseAdmin
      .from('aruco_markers')
      .select('*')
      .eq('orthomosaic_id', orthomosaicId)
      .order('marker_id', { ascending: true })

    // Filter by verified status if specified
    if (verified === 'true') {
      query = query.eq('verified', true)
    } else if (verified === 'false') {
      query = query.eq('verified', false)
    }

    const { data: markers, error } = await query

    if (error) {
      console.error('Error fetching markers:', error)
      return NextResponse.json(
        { error: 'Failed to fetch markers' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      count: markers?.length || 0,
      markers: markers || [],
    })

  } catch (error) {
    console.error('Error getting ArUco markers:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get markers' },
      { status: 500 }
    )
  }
}
