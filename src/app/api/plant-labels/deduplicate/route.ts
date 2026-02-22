import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest, verifyOrthomosaicOwnership } from '@/lib/auth/api-auth'
import { applyGPSNMS } from '@/lib/detection/gps-nms'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST - Deduplicate AI labels for an orthomosaic using GPS NMS
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
    if (errorResponse) return errorResponse

    const body = await request.json()
    const { orthomosaicId, distance = 0.3 } = body as {
      orthomosaicId?: string
      distance?: number
    }

    if (!orthomosaicId) {
      return NextResponse.json({ error: 'orthomosaicId is required' }, { status: 400 })
    }

    const ownershipError = await verifyOrthomosaicOwnership(supabaseAdmin, orthomosaicId, user.id, isAdmin)
    if (ownershipError) return ownershipError

    // Fetch all AI labels for this orthomosaic
    const pageSize = 1000
    let allLabels: Array<{
      id: string
      latitude: number
      longitude: number
      confidence: number
    }> = []

    let offset = 0
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('plant_labels')
        .select('id, latitude, longitude, confidence')
        .eq('orthomosaic_id', orthomosaicId)
        .eq('source', 'ai')
        .order('confidence', { ascending: false })
        .range(offset, offset + pageSize - 1)

      if (error) {
        console.error('[Deduplicate] Error fetching labels:', error)
        return NextResponse.json({ error: 'Failed to fetch labels' }, { status: 500 })
      }

      if (!data || data.length === 0) break
      allLabels.push(...data)
      if (data.length < pageSize) break
      offset += pageSize
    }

    if (allLabels.length === 0) {
      return NextResponse.json({ message: 'No AI labels found', before: 0, after: 0, removed: 0 })
    }

    console.log(`[Deduplicate] Found ${allLabels.length} AI labels, applying GPS NMS with ${distance}m threshold`)

    // Run GPS NMS
    const suppressedIds = applyGPSNMS(
      allLabels.map(l => ({
        id: l.id,
        latitude: l.latitude,
        longitude: l.longitude,
        confidence: l.confidence,
      })),
      distance
    )

    const remaining = allLabels.length - suppressedIds.length
    console.log(`[Deduplicate] GPS NMS: ${allLabels.length} → ${remaining} (removing ${suppressedIds.length})`)

    // Delete suppressed labels in batches
    if (suppressedIds.length > 0) {
      const batchSize = 500
      for (let i = 0; i < suppressedIds.length; i += batchSize) {
        const batch = suppressedIds.slice(i, i + batchSize)
        const { error: deleteError } = await supabaseAdmin
          .from('plant_labels')
          .delete()
          .in('id', batch)

        if (deleteError) {
          console.error(`[Deduplicate] Delete batch error:`, deleteError)
        }
      }
    }

    return NextResponse.json({
      success: true,
      before: allLabels.length,
      after: remaining,
      removed: suppressedIds.length,
      distance,
    })
  } catch (error) {
    console.error('[Deduplicate] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
