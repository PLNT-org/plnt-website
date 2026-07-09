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
  const { data, error } = await supabaseAdmin
    .from('share_point_edits')
    .select('id, kind, lat, lng')
    .eq('share_id', shareId)
    .eq('flight_key', flightKey)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ edits: (data || []).map(toClientEdit) })
}

// POST — record one correction. Body: { flightKey, kind: 'add'|'remove', lat, lng, email? }
export async function POST(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

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

// DELETE — undo. Either one edit (?id=) or all edits for a flight (?all=1&flight=).
export async function DELETE(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = request.nextUrl.searchParams
  const id = params.get('id')
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

  if (!id) return NextResponse.json({ error: 'An edit id (or all=1) is required.' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('share_point_edits')
    .delete()
    .eq('id', id)
    .eq('share_id', shareId) // never let one share delete another's edits
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
