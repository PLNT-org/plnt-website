import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/species/lookup?barcode=XXX - Find species by barcode
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
    const barcode = searchParams.get('barcode')

    if (!barcode) {
      return NextResponse.json({ error: 'Barcode parameter is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('species')
      .select('*')
      .eq('user_id', user.id)
      .eq('barcode_value', barcode)
      .maybeSingle()

    if (error) {
      console.error('Error looking up species:', error)
      return NextResponse.json({ error: 'Failed to lookup species' }, { status: 500 })
    }

    // Return null if no species found (user can create one)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in species lookup:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
