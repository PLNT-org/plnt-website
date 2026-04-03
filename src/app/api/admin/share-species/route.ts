import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { species_ids, user_id } = await request.json()
  if (!species_ids?.length || !user_id) {
    return NextResponse.json({ error: 'species_ids and user_id required' }, { status: 400 })
  }

  // Fetch the source species
  const { data: sourceSpecies, error: fetchError } = await supabaseAdmin
    .from('species')
    .select('name, scientific_name, barcode_value, category, container_size, notes, photo_url')
    .in('id', species_ids)

  if (fetchError || !sourceSpecies?.length) {
    return NextResponse.json({ error: 'Failed to fetch species' }, { status: 500 })
  }

  // Copy with new user_id
  const copies = sourceSpecies.map(s => ({ ...s, user_id }))
  const { data, error: insertError } = await supabaseAdmin
    .from('species')
    .insert(copies)
    .select()

  if (insertError) {
    console.error('Error copying species:', insertError)
    return NextResponse.json({ error: 'Failed to copy species' }, { status: 500 })
  }

  return NextResponse.json({ copied: data?.length || 0 }, { status: 201 })
}
