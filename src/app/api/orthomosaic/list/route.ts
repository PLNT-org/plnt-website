import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { unstable_noStore as noStore } from 'next/cache'

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
    const { data: orthomosaics, error } = await supabaseAdmin
      .from('orthomosaics')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching orthomosaics:', error)
      return NextResponse.json(
        { error: 'Failed to fetch orthomosaics' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { orthomosaics: orthomosaics || [] },
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
