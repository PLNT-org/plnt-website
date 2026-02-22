import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/species/[id] - Get single species
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const { data, error } = await supabase
      .from('species')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Species not found' }, { status: 404 })
      }
      console.error('Error fetching species:', error)
      return NextResponse.json({ error: 'Failed to fetch species' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in species GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/species/[id] - Update species
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const body = await request.json()
    const { name, scientific_name, barcode_value, category, container_size, notes } = body

    const { data, error } = await supabase
      .from('species')
      .update({
        ...(name !== undefined && { name }),
        ...(scientific_name !== undefined && { scientific_name }),
        ...(barcode_value !== undefined && { barcode_value }),
        ...(category !== undefined && { category }),
        ...(container_size !== undefined && { container_size }),
        ...(notes !== undefined && { notes }),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Species not found' }, { status: 404 })
      }
      console.error('Error updating species:', error)
      return NextResponse.json({ error: 'Failed to update species' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in species PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/species/[id] - Delete species
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const { error } = await supabase
      .from('species')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting species:', error)
      return NextResponse.json({ error: 'Failed to delete species' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in species DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
