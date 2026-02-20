import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: List flights that have uploaded images
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  try {
    // Get distinct flight_ids from flight_images
    const { data: imageRows, error: imgError } = await supabase
      .from('flight_images')
      .select('flight_id')

    if (imgError) {
      console.error('[flight-detection/flights] Error querying flight_images:', imgError)
      return NextResponse.json({ error: imgError.message }, { status: 500 })
    }

    if (!imageRows || imageRows.length === 0) {
      return NextResponse.json({ flights: [] })
    }

    // Count images per flight
    const flightCounts: Record<string, number> = {}
    for (const row of imageRows) {
      if (row.flight_id) {
        flightCounts[row.flight_id] = (flightCounts[row.flight_id] || 0) + 1
      }
    }

    const flightIds = Object.keys(flightCounts)
    if (flightIds.length === 0) {
      return NextResponse.json({ flights: [] })
    }

    // Fetch flight details
    let query = supabase
      .from('flights')
      .select('id, name, created_at, user_id')
      .in('id', flightIds)
      .order('created_at', { ascending: false })

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data: flights, error: flightError } = await query

    if (flightError) {
      console.error('[flight-detection/flights] Error querying flights:', flightError)
      return NextResponse.json({ error: flightError.message }, { status: 500 })
    }

    const result = (flights || []).map(f => ({
      id: f.id,
      name: f.name || `Flight ${new Date(f.created_at).toLocaleDateString()}`,
      imageCount: flightCounts[f.id] || 0,
    }))

    return NextResponse.json({ flights: result })
  } catch (error) {
    console.error('[flight-detection/flights] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch flights' }, { status: 500 })
  }
}
