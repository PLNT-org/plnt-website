import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { unstable_noStore as noStore } from 'next/cache'
import { authenticateRequest } from '@/lib/auth/api-auth'

// Must be dynamic — returns live data from the database
export const dynamic = 'force-dynamic'

// Use service role to bypass RLS, with no-store to defeat Next.js data cache
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    global: {
      fetch: (url: string | URL | Request, options: RequestInit = {}) =>
        fetch(url, { ...options, cache: 'no-store' }),
    },
  }
)

export async function GET(request: NextRequest) {
  noStore()

  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    let query = supabaseAdmin
      .from('orthomosaics')
      .select('*')
      .order('created_at', { ascending: false })

    if (!isAdmin) {
      // Get IDs of orthomosaics shared with this user
      const { data: shares } = await supabaseAdmin
        .from('shared_orthomosaics')
        .select('orthomosaic_id')
        .eq('shared_with_user_id', user.id)

      const sharedIds = (shares || []).map(s => s.orthomosaic_id)

      if (sharedIds.length > 0) {
        query = query.or(`user_id.eq.${user.id},id.in.(${sharedIds.join(',')})`)
      } else {
        query = query.eq('user_id', user.id)
      }
    }

    const { data: orthomosaics, error } = await query

    if (error) {
      console.error('Error fetching orthomosaics:', error)
      return NextResponse.json(
        { error: 'Failed to fetch orthomosaics' },
        { status: 500 }
      )
    }

    // Mark shared orthomosaics for non-admin users
    let result = orthomosaics || []
    if (!isAdmin) {
      const { data: shares } = await supabaseAdmin
        .from('shared_orthomosaics')
        .select('orthomosaic_id')
        .eq('shared_with_user_id', user.id)
      const sharedSet = new Set((shares || []).map(s => s.orthomosaic_id))
      result = result.map(o => ({ ...o, shared: sharedSet.has(o.id) }))
    }

    return NextResponse.json(
      { orthomosaics: result },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        },
      }
    )

  } catch (error) {
    console.error('Error in orthomosaic list:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
