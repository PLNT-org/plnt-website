import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const userId = request.nextUrl.searchParams.get('user_id')

  let query = supabaseAdmin
    .from('shared_orthomosaics')
    .select('id, orthomosaic_id, shared_with_user_id, shared_by_user_id, created_at')
    .order('created_at', { ascending: false })

  if (userId) {
    query = query.eq('shared_with_user_id', userId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching shares:', error)
    return NextResponse.json({ error: 'Failed to fetch shares' }, { status: 500 })
  }

  return NextResponse.json({ shares: data || [] })
}
