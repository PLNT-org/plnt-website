import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/marker-registrations/batch - Get registrations for multiple ArUco marker IDs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { markerIds, userId } = body

    if (!markerIds || !Array.isArray(markerIds) || markerIds.length === 0) {
      return NextResponse.json({ error: 'markerIds array is required' }, { status: 400 })
    }

    // Build query - if userId provided, filter by user, otherwise get all
    let query = supabase
      .from('marker_registrations')
      .select(`
        id,
        aruco_marker_id,
        species_id,
        barcode_value,
        latitude,
        longitude,
        plot_name,
        species:species_id (
          id,
          name,
          scientific_name,
          category,
          container_size
        )
      `)
      .in('aruco_marker_id', markerIds)
      .eq('is_active', true)

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching registrations:', error)
      return NextResponse.json({ error: 'Failed to fetch registrations' }, { status: 500 })
    }

    // Convert to a map keyed by aruco_marker_id for easy lookup
    const registrationMap: Record<number, any> = {}
    data?.forEach((reg) => {
      registrationMap[reg.aruco_marker_id] = {
        registration_id: reg.id,
        species_id: reg.species_id,
        species_name: reg.species?.name || null,
        scientific_name: reg.species?.scientific_name || null,
        category: reg.species?.category || null,
        container_size: reg.species?.container_size || null,
        barcode_value: reg.barcode_value,
        plot_name: reg.plot_name,
        registered_lat: reg.latitude,
        registered_lng: reg.longitude,
      }
    })

    return NextResponse.json({ registrations: registrationMap })
  } catch (error) {
    console.error('Error in batch registration lookup:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
