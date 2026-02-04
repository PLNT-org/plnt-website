import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/marker-registrations/[id] - Get single registration
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
          container_size
        )
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
      }
      console.error('Error fetching registration:', error)
      return NextResponse.json({ error: 'Failed to fetch registration' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in registration GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/marker-registrations/[id] - Update registration
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
    const { species_id, barcode_value, plot_name, notes, is_active } = body

    const { data, error } = await supabase
      .from('marker_registrations')
      .update({
        ...(species_id !== undefined && { species_id }),
        ...(barcode_value !== undefined && { barcode_value }),
        ...(plot_name !== undefined && { plot_name }),
        ...(notes !== undefined && { notes }),
        ...(is_active !== undefined && { is_active }),
      })
      .eq('id', id)
      .eq('user_id', user.id)
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
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
      }
      console.error('Error updating registration:', error)
      return NextResponse.json({ error: 'Failed to update registration' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in registration PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/marker-registrations/[id] - Delete registration
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('marker_registrations')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting registration:', error)
      return NextResponse.json({ error: 'Failed to delete registration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in registration DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
