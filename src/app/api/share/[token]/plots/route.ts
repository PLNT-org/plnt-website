import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAccessToken } from '@/lib/share/access-token'

// Viewer-drawn boundary plots on a gated property share. Every request is gated
// by the same short-lived access token used for tiles (`?k=`), which a viewer
// only holds after clearing the share's email gate. The token encodes the
// share id, so we never trust a client-supplied share id.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Resolve the share id from the `?k=` access token, or null if missing/invalid.
function shareIdFromRequest(request: NextRequest): string | null {
  const k = request.nextUrl.searchParams.get('k')
  if (!k) return null
  return verifyAccessToken(k)?.shareId ?? null
}

interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

function isValidPolygon(b: any): b is GeoJSONPolygon {
  return (
    b &&
    b.type === 'Polygon' &&
    Array.isArray(b.coordinates) &&
    Array.isArray(b.coordinates[0]) &&
    b.coordinates[0].length >= 4 && // 3 points + closing point
    b.coordinates[0].every(
      (pt: any) => Array.isArray(pt) && pt.length === 2 && pt.every((n: any) => typeof n === 'number')
    )
  )
}

// Columns every handler returns — kept in one place so a new field can't be
// added to some responses and forgotten in others.
const PLOT_COLUMNS = 'id, boundary, area_acres, block, container_size, species, readiness_date, manual_count'

// Map a DB row to the shape the client renders.
function toClientPlot(row: any) {
  return {
    id: row.id,
    boundary: row.boundary,
    areaAcres: row.area_acres,
    block: row.block,
    size: row.container_size,
    species: row.species,
    readinessDate: row.readiness_date,
    manualCount: row.manual_count,
  }
}

// An operator-entered plant count: a non-negative integer, or null to go back to
// deriving the count from the imagery. Anything unparseable becomes null rather
// than 0 — "I didn't enter a number" must not read as "there are zero plants".
function parseManualCount(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number.parseInt(String(v), 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// GET — list all plots for this share.
export async function GET(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('share_plots')
    .select(PLOT_COLUMNS)
    .eq('share_id', shareId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ plots: (data || []).map(toClientPlot) })
}

// POST — create a plot. Body: { boundary, areaAcres?, block?, size?, species?, readinessDate?, manualCount?, email? }
export async function POST(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!isValidPolygon(body?.boundary)) {
    return NextResponse.json({ error: 'A valid boundary polygon is required.' }, { status: 400 })
  }

  // Coerce numerics; allow null/empty. Keep block as an integer, size as numeric.
  const block =
    body.block === null || body.block === undefined || body.block === ''
      ? null
      : Number.parseInt(String(body.block), 10)
  const size =
    body.size === null || body.size === undefined || body.size === ''
      ? null
      : Number(body.size)
  const species = typeof body.species === 'string' && body.species.trim() ? body.species.trim() : null
  // Expect an ISO date string (yyyy-mm-dd) from the date input.
  const readinessDate =
    typeof body.readinessDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.readinessDate)
      ? body.readinessDate
      : null
  const email =
    typeof body.email === 'string' && body.email.includes('@') ? body.email.trim().toLowerCase() : null

  const { data, error } = await supabaseAdmin
    .from('share_plots')
    .insert({
      share_id: shareId,
      boundary: body.boundary,
      area_acres: typeof body.areaAcres === 'number' ? body.areaAcres : null,
      block: Number.isFinite(block as number) ? block : null,
      container_size: Number.isFinite(size as number) ? size : null,
      species,
      readiness_date: readinessDate,
      manual_count: parseManualCount(body.manualCount),
      created_by_email: email,
    })
    .select(PLOT_COLUMNS)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ plot: toClientPlot(data) })
}

// PATCH — update a plot's tagged fields (block/size/species/readinessDate/
// manualCount) by id, without touching its boundary. Only the keys present in
// the body change.
export async function PATCH(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const id = body?.id
  if (!id) {
    return NextResponse.json({ error: 'A plot id is required.' }, { status: 400 })
  }

  const update: Record<string, any> = { updated_at: new Date().toISOString() }
  if ('block' in body) {
    const n = body.block === null || body.block === '' ? null : Number.parseInt(String(body.block), 10)
    update.block = Number.isFinite(n as number) ? n : null
  }
  if ('size' in body) {
    const n = body.size === null || body.size === '' ? null : Number(body.size)
    update.container_size = Number.isFinite(n as number) ? n : null
  }
  if ('species' in body) {
    update.species = typeof body.species === 'string' && body.species.trim() ? body.species.trim() : null
  }
  if ('readinessDate' in body) {
    update.readiness_date =
      typeof body.readinessDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.readinessDate)
        ? body.readinessDate
        : null
  }
  // Clearing the input sends '' -> null, which restores the derived count.
  if ('manualCount' in body) {
    update.manual_count = parseManualCount(body.manualCount)
  }

  const { data, error } = await supabaseAdmin
    .from('share_plots')
    .update(update)
    .eq('id', id)
    .eq('share_id', shareId) // never let one share edit another's plots
    .select(PLOT_COLUMNS)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ plot: toClientPlot(data) })
}

// DELETE — remove a plot by id (scoped to this share). Body or query: { id }.
export async function DELETE(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'A plot id is required.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('share_plots')
    .delete()
    .eq('id', id)
    .eq('share_id', shareId) // never let one share delete another's plots

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
