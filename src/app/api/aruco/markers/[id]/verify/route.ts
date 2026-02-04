import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: markerId } = await params
    const body = await request.json()
    const { verified } = body

    if (typeof verified !== 'boolean') {
      return NextResponse.json(
        { error: 'verified must be a boolean' },
        { status: 400 }
      )
    }

    // Get user from auth if available (for verified_by tracking)
    let userId: string | null = null
    const cookies = request.headers.get('cookie') || ''
    const accessTokenMatch = cookies.match(/sb-[^-]+-auth-token=([^;]+)/)

    if (accessTokenMatch) {
      try {
        const tokenData = JSON.parse(decodeURIComponent(accessTokenMatch[1]))
        if (tokenData.access_token) {
          const { data } = await supabaseAdmin.auth.getUser(tokenData.access_token)
          userId = data.user?.id || null
        }
      } catch {
        // Token parsing failed - continue without user
      }
    }

    // Update marker verification status
    const updates: Record<string, unknown> = {
      verified,
      updated_at: new Date().toISOString(),
    }

    if (verified) {
      updates.verified_at = new Date().toISOString()
      if (userId) {
        updates.verified_by = userId
      }
    } else {
      updates.verified_at = null
      updates.verified_by = null
    }

    const { data: marker, error } = await supabaseAdmin
      .from('aruco_markers')
      .update(updates)
      .eq('id', markerId)
      .select()
      .single()

    if (error) {
      console.error('Error updating marker:', error)
      return NextResponse.json(
        { error: 'Failed to update marker' },
        { status: 500 }
      )
    }

    if (!marker) {
      return NextResponse.json(
        { error: 'Marker not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      marker,
    })

  } catch (error) {
    console.error('Error verifying marker:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to verify marker' },
      { status: 500 }
    )
  }
}
