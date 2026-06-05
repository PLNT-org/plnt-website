import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/barcode-scans - List user's raw scans (newest first)
export async function GET(request: NextRequest) {
  try {
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 1000)

    const { data, error } = await supabase
      .from('barcode_scans')
      .select('*')
      .eq('user_id', user.id)
      .order('scanned_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Error fetching barcode scans:', error)
      return NextResponse.json({ error: 'Failed to fetch scans' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in barcode-scans GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/barcode-scans - Log a raw scan (fired on every successful decode)
export async function POST(request: NextRequest) {
  try {
    const { user, errorResponse } = await authenticateRequest(request, supabase)
    if (errorResponse) return errorResponse

    const body = await request.json()
    const { raw_value, format, latitude, longitude, gps_accuracy_meters, source } = body

    if (!raw_value || typeof raw_value !== 'string') {
      return NextResponse.json({ error: 'raw_value is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('barcode_scans')
      .insert({
        user_id: user.id,
        raw_value,
        format: format || null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        gps_accuracy_meters: gps_accuracy_meters ?? null,
        source: source || 'register-marker',
      })
      .select()
      .single()

    if (error) {
      console.error('Error logging barcode scan:', error)
      return NextResponse.json({ error: 'Failed to log scan' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error in barcode-scans POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
