import { NextRequest, NextResponse } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Authenticate an API request using the Bearer token pattern.
 * Returns the authenticated user, admin status, or an error response.
 */
export async function authenticateRequest(
  request: NextRequest,
  supabase: SupabaseClient
): Promise<{ user: any; isAdmin: boolean; errorResponse: NextResponse | null }> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return {
      user: null,
      isAdmin: false,
      errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)

  if (authError || !user) {
    return {
      user: null,
      isAdmin: false,
      errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // Check admin role from profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  return { user, isAdmin, errorResponse: null }
}

/**
 * Verify that an orthomosaic belongs to the requesting user or is shared with them.
 * Admins bypass the ownership check entirely.
 * Returns an error response if ownership check fails, null if OK.
 */
export async function verifyOrthomosaicOwnership(
  supabase: SupabaseClient,
  orthomosaicId: string,
  userId: string,
  isAdmin = false
): Promise<NextResponse | null> {
  if (isAdmin) return null

  const { data: ortho, error } = await supabase
    .from('orthomosaics')
    .select('id, user_id')
    .eq('id', orthomosaicId)
    .single()

  if (error || !ortho) {
    return NextResponse.json({ error: 'Orthomosaic not found' }, { status: 404 })
  }

  if (ortho.user_id !== userId) {
    // Check if orthomosaic is shared with this user
    const { data: share } = await supabase
      .from('shared_orthomosaics')
      .select('id')
      .eq('orthomosaic_id', orthomosaicId)
      .eq('shared_with_user_id', userId)
      .single()

    if (!share) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  return null
}
