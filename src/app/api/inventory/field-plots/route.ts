import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { BUCKETS } from '@/lib/supabase/storage'

// Inventory derived from viewer-drawn plots on the current user's property
// shares. Each drawn boundary's quantity is the number of AI-detected plants
// (the survey's points.json) that fall inside it. Rows are aggregated by
// species + container size.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface StoredLayer {
  type: 'rgb' | 'ndvi' | 'chm'
  points_path?: string
}

// Ray-casting point-in-polygon. `ring` is [[lng,lat], ...] (GeoJSON order),
// the test point is given as (lng, lat).
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Download a share's points.json ([[lat,lng], ...]); [] if missing/unreadable.
async function loadSharePoints(layers: StoredLayer[]): Promise<[number, number][]> {
  const withPoints = Array.isArray(layers) ? layers.find((l) => l?.points_path) : null
  if (!withPoints?.points_path) return []
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKETS.PROPERTY_SHARES)
      .download(withPoints.points_path)
    if (error || !data) return []
    const parsed = JSON.parse(await data.text())
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse

  try {
    // Shares owned by this user.
    const { data: shares, error: sharesErr } = await supabaseAdmin
      .from('property_shares')
      .select('id, title, layers')
      .eq('created_by', user.id)
    if (sharesErr) return NextResponse.json({ error: sharesErr.message }, { status: 500 })

    const shareIds = (shares || []).map((s) => s.id)
    if (shareIds.length === 0) return NextResponse.json({ fieldPlots: [] })

    // All plots drawn on those shares.
    const { data: plots, error: plotsErr } = await supabaseAdmin
      .from('share_plots')
      .select('id, share_id, boundary, area_acres, block, container_size, species, readiness_date')
      .in('share_id', shareIds)
    if (plotsErr) return NextResponse.json({ error: plotsErr.message }, { status: 500 })

    if (!plots || plots.length === 0) return NextResponse.json({ fieldPlots: [] })

    // Load each share's detected-plant points once (only for shares that have plots).
    const usedShareIds = [...new Set(plots.map((p) => p.share_id))]
    const sharesById = new Map((shares || []).map((s) => [s.id, s]))
    const pointsByShare = new Map<string, [number, number][]>()
    await Promise.all(
      usedShareIds.map(async (sid) => {
        const share = sharesById.get(sid)
        pointsByShare.set(sid, share ? await loadSharePoints(share.layers || []) : [])
      })
    )

    // One row per drawn plot. Quantity = AI-detected plants inside its boundary.
    const fieldPlots = plots.map((plot) => {
      const ring: number[][] | undefined = plot.boundary?.coordinates?.[0]
      let count = 0
      if (ring) {
        const points = pointsByShare.get(plot.share_id) || []
        for (const [lat, lng] of points) {
          if (pointInRing(lng, lat, ring)) count++
        }
      }
      return {
        id: `field-${plot.id}`,
        species: plot.species ?? null,
        size: plot.container_size ?? null,
        block: plot.block ?? null,
        count,
        areaAcres: Math.round((Number(plot.area_acres) || 0) * 100) / 100,
        readiness: plot.readiness_date ?? null,
        locationId: plot.share_id,
        locationName: sharesById.get(plot.share_id)?.title || 'Untitled survey',
      }
    })

    // Every location (share) the user owns, for the location switcher.
    const locations = (shares || []).map((s) => ({ id: s.id, title: s.title || 'Untitled survey' }))

    return NextResponse.json({ fieldPlots, locations })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load field plots' },
      { status: 500 }
    )
  }
}
