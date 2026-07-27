import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAccessToken } from '@/lib/share/access-token'

// Viewer corrections to a gated share's plant count. Each row is a manual
// add/remove made on the link (see scripts/migrations/share_point_edits.sql).
// Same auth model as the plots route: every request is gated by the short-lived
// access token (`?k=`) a viewer only holds after clearing the email gate, and
// the token — not the client — supplies the share id.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function shareIdFromRequest(request: NextRequest): string | null {
  const k = request.nextUrl.searchParams.get('k')
  if (!k) return null
  return verifyAccessToken(k)?.shareId ?? null
}

// Match the 6-decimal rounding publish-survey uses when it writes points.json,
// so a 'remove' edit lines up exactly with the detected dot it hides.
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

function toClientEdit(row: any) {
  return { id: row.id, kind: row.kind, lat: row.lat, lng: row.lng }
}

// GET — list this share+flight's edits. Query: ?flight=<flightKey>
export async function GET(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const flightKey = request.nextUrl.searchParams.get('flight') ?? ''
  // Page past PostgREST's default 1000-row cap: a heavily-corrected flight can
  // have thousands of edits, and truncating at 1000 would silently revert the
  // viewer's corrected count on reload.
  const PAGE = 1000
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('share_point_edits')
      .select('id, kind, lat, lng')
      .eq('share_id', shareId)
      .eq('flight_key', flightKey)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return NextResponse.json({ edits: rows.map(toClientEdit) })
}

// Every 'remove' edit already on this share+flight, keyed by rounded lat/lng.
// Paged past PostgREST's 1000-row cap for the same reason GET is.
async function existingRemoveKeys(shareId: string, flightKey: string): Promise<Set<string>> {
  const PAGE = 1000
  const keys = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('share_point_edits')
      .select('lat, lng')
      .eq('share_id', shareId)
      .eq('flight_key', flightKey)
      .eq('kind', 'remove')
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const r of data) keys.add(`${round6(r.lat)},${round6(r.lng)}`)
    if (data.length < PAGE) break
  }
  return keys
}

// POST — record corrections. Either one point:
//   { flightKey, kind: 'add'|'remove', lat, lng, email? }
// or a batch (area-erase on the viewer map):
//   { flightKey, kind: 'remove', points: [{ lat, lng }, ...], email? }
export async function POST(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (Array.isArray(body?.points)) return bulkRemove(shareId, body)

  const kind = body?.kind
  if (kind !== 'add' && kind !== 'remove') {
    return NextResponse.json({ error: "kind must be 'add' or 'remove'." }, { status: 400 })
  }
  if (typeof body?.lat !== 'number' || typeof body?.lng !== 'number') {
    return NextResponse.json({ error: 'lat and lng are required numbers.' }, { status: 400 })
  }
  const flightKey = typeof body.flightKey === 'string' ? body.flightKey : ''
  const lat = round6(body.lat)
  const lng = round6(body.lng)
  const email =
    typeof body.email === 'string' && body.email.includes('@') ? body.email.trim().toLowerCase() : null

  // A given detected dot can only be removed once — a duplicate 'remove' would
  // wrongly decrement the count twice. Return the existing edit instead.
  if (kind === 'remove') {
    const { data: existing } = await supabaseAdmin
      .from('share_point_edits')
      .select('id, kind, lat, lng')
      .eq('share_id', shareId)
      .eq('flight_key', flightKey)
      .eq('kind', 'remove')
      .eq('lat', lat)
      .eq('lng', lng)
      .maybeSingle()
    if (existing) return NextResponse.json({ edit: toClientEdit(existing) })
  }

  const { data, error } = await supabaseAdmin
    .from('share_point_edits')
    .insert({ share_id: shareId, flight_key: flightKey, kind, lat, lng, created_by_email: email })
    .select('id, kind, lat, lng')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ edit: toClientEdit(data) })
}

// Record a 'remove' for every detected dot the viewer erased with the area tool.
// Points already removed are skipped (a second 'remove' would double-decrement
// the count), and the insert is chunked so a large area doesn't blow the request.
async function bulkRemove(shareId: string, body: any) {
  if (body.kind !== 'remove') {
    return NextResponse.json({ error: "Batched edits must use kind 'remove'." }, { status: 400 })
  }
  const flightKey = typeof body.flightKey === 'string' ? body.flightKey : ''
  const email =
    typeof body.email === 'string' && body.email.includes('@') ? body.email.trim().toLowerCase() : null

  const seen = await existingRemoveKeys(shareId, flightKey)
  const rows: { share_id: string; flight_key: string; kind: string; lat: number; lng: number; created_by_email: string | null }[] = []
  for (const p of body.points) {
    if (typeof p?.lat !== 'number' || typeof p?.lng !== 'number') continue
    const lat = round6(p.lat)
    const lng = round6(p.lng)
    const key = `${lat},${lng}`
    if (seen.has(key)) continue // already removed (or a duplicate within this batch)
    seen.add(key)
    rows.push({ share_id: shareId, flight_key: flightKey, kind: 'remove', lat, lng, created_by_email: email })
  }
  if (rows.length === 0) return NextResponse.json({ edits: [] })

  const CHUNK = 500
  const edits: any[] = []
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('share_point_edits')
      .insert(rows.slice(i, i + CHUNK))
      .select('id, kind, lat, lng')
    if (error) {
      // Report what did land so the client's state stays in sync with the DB.
      return NextResponse.json({ error: error.message, edits: edits.map(toClientEdit) }, { status: 500 })
    }
    if (data) edits.push(...data)
  }
  return NextResponse.json({ edits: edits.map(toClientEdit) })
}

// DELETE — undo. One edit (?id=), a batch (?ids=a,b,c), or all edits for a
// flight (?all=1&flight=).
export async function DELETE(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = request.nextUrl.searchParams
  const id = params.get('id')
  const ids = params.get('ids')
  const all = params.get('all')

  if (all === '1') {
    const flightKey = params.get('flight') ?? ''
    const { error } = await supabaseAdmin
      .from('share_point_edits')
      .delete()
      .eq('share_id', shareId)
      .eq('flight_key', flightKey)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Batched undo — the area tool erasing viewer-added plants.
  if (ids) {
    const list = ids.split(',').map((s) => s.trim()).filter(Boolean)
    if (list.length === 0) return NextResponse.json({ error: 'No edit ids given.' }, { status: 400 })
    const CHUNK = 200
    for (let i = 0; i < list.length; i += CHUNK) {
      const { error } = await supabaseAdmin
        .from('share_point_edits')
        .delete()
        .in('id', list.slice(i, i + CHUNK))
        .eq('share_id', shareId) // never let one share delete another's edits
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (!id) return NextResponse.json({ error: 'An edit id (or ids=/all=1) is required.' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('share_point_edits')
    .delete()
    .eq('id', id)
    .eq('share_id', shareId) // never let one share delete another's edits
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
