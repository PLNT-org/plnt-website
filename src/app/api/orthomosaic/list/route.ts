import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Must be dynamic — returns live data from the database
export const dynamic = 'force-dynamic'

// Use service role to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    // For now, fetch all orthomosaics (local dev - no strict auth required)
    // In production, you'd want to properly authenticate

    // Fetch all orthomosaics
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

    return NextResponse.json({ orthomosaics: orthomosaics || [] })

  } catch (error) {
    console.error('Error in orthomosaic list:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
