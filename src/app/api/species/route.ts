import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/species - List user's species
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
    const category = searchParams.get('category')
    const search = searchParams.get('search')

    let query = supabase
      .from('species')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true })

    if (category) {
      query = query.eq('category', category)
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,scientific_name.ilike.%${search}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching species:', error)
      return NextResponse.json({ error: 'Failed to fetch species' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in species GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/species - Create new species
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
    const { name, scientific_name, barcode_value, category, container_size, notes } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('species')
      .insert({
        user_id: user.id,
        name,
        scientific_name,
        barcode_value,
        category,
        container_size,
        notes,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating species:', error)
      return NextResponse.json({ error: 'Failed to create species' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error in species POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
