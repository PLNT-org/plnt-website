import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/marker-registrations - List user's registrations
export async function GET(request: NextRequest) {
  try {
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') !== 'false'
    const plotName = searchParams.get('plot_name')

    let query = supabase
      .from('marker_registrations')
      .select(`
        *,
        species:species_id (
          id,
          name,
          scientific_name,
          category,
          container_size
        )
      `)
      .eq('user_id', user.id)
      .order('registered_at', { ascending: false })

    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    if (plotName) {
      query = query.eq('plot_name', plotName)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching registrations:', error)
      return NextResponse.json({ error: 'Failed to fetch registrations' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in registrations GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/marker-registrations - Create new registration
export async function POST(request: NextRequest) {
  try {
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const body = await request.json()
    const {
      aruco_marker_id,
      marker_code,
      label_photo_url,
      aruco_dictionary,
      species_id,
      barcode_value,
      latitude,
      longitude,
      gps_accuracy_meters,
      plot_name,
      notes,
    } = body

    // A marker is identified by a scanned barcode (marker_code), an ArUco ID, or
    // a label photo (failsafe when the barcode can't be scanned).
    const hasMarkerCode = marker_code !== undefined && marker_code !== null && marker_code !== ''
    const hasArucoId = aruco_marker_id !== undefined && aruco_marker_id !== null
    const hasLabelPhoto =
      label_photo_url !== undefined && label_photo_url !== null && label_photo_url !== ''

    if (
      (!hasMarkerCode && !hasArucoId && !hasLabelPhoto) ||
      latitude === undefined ||
      longitude === undefined
    ) {
      return NextResponse.json(
        {
          error:
            'A marker identifier (marker_code, aruco_marker_id, or label_photo_url) plus latitude and longitude are required',
        },
        { status: 400 }
      )
    }

    // Deactivate any existing active registration for this marker. Only ArUco
    // markers are physically unique; product barcodes (SKUs) are shared across
    // many plants, so multiple active registrations of the same marker_code are
    // allowed — each scan is its own plant at its own location. Photo-only
    // registrations have no stable identifier to dedup on, so each one is kept.
    if (hasArucoId) {
      await supabase
        .from('marker_registrations')
        .update({ is_active: false })
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('aruco_marker_id', aruco_marker_id)
    }

    // Create new registration
    const { data, error } = await supabase
      .from('marker_registrations')
      .insert({
        user_id: user.id,
        aruco_marker_id: hasArucoId ? aruco_marker_id : null,
        marker_code: hasMarkerCode ? marker_code : null,
        label_photo_url: hasLabelPhoto ? label_photo_url : null,
        aruco_dictionary: aruco_dictionary || 'DICT_7X7_1000',
        species_id,
        barcode_value,
        latitude,
        longitude,
        gps_accuracy_meters,
        plot_name,
        notes,
        is_active: true,
      })
      .select(`
        *,
        species:species_id (
          id,
          name,
          scientific_name,
          category,
          container_size
        )
      `)
      .single()

    if (error) {
      console.error('Error creating registration:', error)
      return NextResponse.json({ error: 'Failed to create registration' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error in registrations POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
