import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST - Verify all unverified labels for an orthomosaic
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const body = await request.json()
    const { orthomosaicId } = body

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

    // Count unverified labels first
    const { count: unverifiedCount } = await supabaseAdmin
      .from('plant_labels')
      .select('id', { count: 'exact', head: true })
      .eq('orthomosaic_id', orthomosaicId)
      .eq('verified', false)

    // Bulk update all unverified labels
    const { error } = await supabaseAdmin
      .from('plant_labels')
      .update({
        verified: true,
        verified_at: new Date().toISOString(),
        verified_by: user.id,
      })
      .eq('orthomosaic_id', orthomosaicId)
      .eq('verified', false)

    if (error) {
      throw error
    }

    return NextResponse.json({
      success: true,
      verifiedCount: unverifiedCount || 0,
    })
  } catch (error) {
    console.error('Error bulk verifying labels:', error)
    return NextResponse.json(
      { error: 'Failed to verify labels' },
      { status: 500 }
    )
  }
}
