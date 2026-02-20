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
    // Get flights with their image counts
    let query = supabase
      .from('flights')
      .select('id, name, created_at, flight_images(count)')
      .order('created_at', { ascending: false })

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data: flights, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Filter to only flights that have images
    const flightsWithImages = (flights || [])
      .map((f: any) => ({
        id: f.id,
        name: f.name || `Flight ${new Date(f.created_at).toLocaleDateString()}`,
        imageCount: f.flight_images?.[0]?.count || 0,
      }))
      .filter((f: any) => f.imageCount > 0)

    return NextResponse.json({ flights: flightsWithImages })
  } catch (error) {
    console.error('Error fetching flights:', error)
    return NextResponse.json({ error: 'Failed to fetch flights' }, { status: 500 })
  }
}
