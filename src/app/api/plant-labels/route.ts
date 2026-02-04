import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - List labels for an orthomosaic
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orthomosaicId = searchParams.get('orthomosaicId')
    const source = searchParams.get('source') // 'manual', 'ai', or null for all
    const verified = searchParams.get('verified') // 'true', 'false', or null for all
    const label = searchParams.get('label') // filter by label type

    if (!orthomosaicId) {
      return NextResponse.json(
        { error: 'orthomosaicId is required' },
        { status: 400 }
      )
    }

    // Fetch labels in batches to bypass Supabase's default 1000 row limit
    const batchSize = 1000
    let allLabels: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      let query = supabaseAdmin
        .from('plant_labels')
        .select('*')
        .eq('orthomosaic_id', orthomosaicId)
        .order('created_at', { ascending: false })
        .range(offset, offset + batchSize - 1)

      if (source) {
        query = query.eq('source', source)
      }

      if (verified !== null) {
        query = query.eq('verified', verified === 'true')
      }

      if (label) {
        query = query.eq('label', label)
      }

      const { data, error } = await query

      if (error) {
        throw error
      }

      if (data && data.length > 0) {
        allLabels = [...allLabels, ...data]
        offset += batchSize
        hasMore = data.length === batchSize
      } else {
        hasMore = false
      }

      // Safety limit to prevent infinite loops
      if (allLabels.length >= 100000) {
        hasMore = false
      }
    }

    return NextResponse.json({
      labels: allLabels,
      count: allLabels.length,
    })

  } catch (error) {
    console.error('Error fetching labels:', error)
    return NextResponse.json(
      { error: 'Failed to fetch labels' },
      { status: 500 }
    )
  }
}

// POST - Create a new label
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      orthomosaicId,
      userId,
      latitude,
      longitude,
      pixelX,
      pixelY,
      source = 'manual',
      confidence,
      label = 'plant',
      notes,
    } = body

    if (!orthomosaicId || !latitude || !longitude) {
      return NextResponse.json(
        { error: 'orthomosaicId, latitude, and longitude are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('plant_labels')
      .insert({
        orthomosaic_id: orthomosaicId,
        user_id: userId,
        latitude,
        longitude,
        pixel_x: pixelX,
        pixel_y: pixelY,
        source,
        confidence: source === 'ai' ? confidence : null,
        label,
        notes,
        verified: source === 'manual', // Manual labels are auto-verified
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({
      success: true,
      label: data,
    })

  } catch (error) {
    console.error('Error creating label:', error)
    return NextResponse.json(
      { error: 'Failed to create label' },
      { status: 500 }
    )
  }
}

// PATCH - Update a label
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, label, notes, verified, verifiedBy } = body

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }

    const updates: any = {}
    if (label !== undefined) updates.label = label
    if (notes !== undefined) updates.notes = notes
    if (verified !== undefined) {
      updates.verified = verified
      updates.verified_at = verified ? new Date().toISOString() : null
      updates.verified_by = verifiedBy || null
    }

    const { data, error } = await supabaseAdmin
      .from('plant_labels')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({
      success: true,
      label: data,
    })

  } catch (error) {
    console.error('Error updating label:', error)
    return NextResponse.json(
      { error: 'Failed to update label' },
      { status: 500 }
    )
  }
}

// DELETE - Remove a label
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }

    const { error } = await supabaseAdmin
      .from('plant_labels')
      .delete()
      .eq('id', id)

    if (error) {
      throw error
    }

    return NextResponse.json({
      success: true,
    })

  } catch (error) {
    console.error('Error deleting label:', error)
    return NextResponse.json(
      { error: 'Failed to delete label' },
      { status: 500 }
    )
  }
}
