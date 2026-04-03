import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { orthomosaic_id, user_id } = await request.json()
  if (!orthomosaic_id || !user_id) {
    return NextResponse.json({ error: 'orthomosaic_id and user_id required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('shared_orthomosaics')
    .insert({
      orthomosaic_id,
      shared_with_user_id: user_id,
      shared_by_user_id: user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Orthomosaic already shared with this user' }, { status: 409 })
    }
    console.error('Error sharing orthomosaic:', error)
    return NextResponse.json({ error: 'Failed to share orthomosaic' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { orthomosaic_id, user_id } = await request.json()
  if (!orthomosaic_id || !user_id) {
    return NextResponse.json({ error: 'orthomosaic_id and user_id required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('shared_orthomosaics')
    .delete()
    .eq('orthomosaic_id', orthomosaic_id)
    .eq('shared_with_user_id', user_id)

  if (error) {
    console.error('Error removing share:', error)
    return NextResponse.json({ error: 'Failed to remove share' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
