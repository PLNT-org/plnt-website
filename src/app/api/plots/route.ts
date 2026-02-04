import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/plots - List user's plots with species info
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let query = supabase
      .from('plots')
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
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching plots:', error)
      return NextResponse.json({ error: 'Failed to fetch plots' }, { status: 500 })
    }

    return NextResponse.json({ plots: data })
  } catch (error) {
    console.error('Error in plots GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/plots - Create new plot
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, species_id, plant_type, location, boundaries, area_acres, status } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('plots')
      .insert({
        user_id: user.id,
        name,
        species_id,
        plant_type,
        location,
        boundaries,
        area_acres: area_acres || 0,
        status: status || 'active',
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
      console.error('Error creating plot:', error)
      return NextResponse.json({ error: 'Failed to create plot' }, { status: 500 })
    }

    return NextResponse.json({ plot: data }, { status: 201 })
  } catch (error) {
    console.error('Error in plots POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
