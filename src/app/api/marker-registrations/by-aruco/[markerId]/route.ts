import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/marker-registrations/by-aruco/[markerId] - Find active registration by ArUco marker ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ markerId: string }> }
) {
  try {
    const { markerId } = await params
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const arucoId = parseInt(markerId, 10)
    if (isNaN(arucoId)) {
      return NextResponse.json({ error: 'Invalid marker ID' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('marker_registrations')
      .select(`
        *,
        species:species_id (
          id,
          name,
          scientific_name,
          category,
          container_size,
          barcode_value
        )
      `)
      .eq('user_id', user.id)
      .eq('aruco_marker_id', arucoId)
      .eq('is_active', true)
      .maybeSingle()

    if (error) {
      console.error('Error looking up registration:', error)
      return NextResponse.json({ error: 'Failed to lookup registration' }, { status: 500 })
    }

    // Return null if no registration found
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in registration lookup:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
