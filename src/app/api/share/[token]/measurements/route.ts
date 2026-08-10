import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAccessToken } from '@/lib/share/access-token'

// Field measurements taken against a flight's published targets — the
// ground-truth half of a height validation walk (see
// scripts/migrations/share_field_measurements.sql).
//
// Same auth model as the points/plots routes: every request is gated by the
// short-lived access token (`?k=`) a viewer only holds after clearing the email
// gate, and the token — not the client — supplies the share id.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TABLE = 'share_field_measurements'
// Postgres "relation does not exist" — the migration hasn't been run yet. Worth
// saying plainly instead of surfacing a raw driver error in the field.
const MISSING_TABLE = '42P01'
const MISSING_TABLE_MESSAGE =
  'Measurements table not found — run scripts/migrations/share_field_measurements.sql in the Supabase SQL editor.'

function shareIdFromRequest(request: NextRequest): string | null {
  const k = request.nextUrl.searchParams.get('k')
  if (!k) return null
  return verifyAccessToken(k)?.shareId ?? null
}

// supabase-js drops the Postgres error code on write-with-returning calls, so
// the HTTP status is the reliable signal there: PostgREST answers 404 when the
// relation doesn't exist. Always fall back to a message — an empty error body
// tells the field nothing.
const isMissingTable = (error: { code?: string } | null, status?: number) =>
  error?.code === MISSING_TABLE || status === 404

function fail(error: { code?: string; message?: string } | null, status?: number) {
  if (isMissingTable(error, status)) {
    return NextResponse.json({ error: MISSING_TABLE_MESSAGE }, { status: 501 })
  }
  return NextResponse.json({ error: error?.message || 'Could not reach the measurements store.' }, { status: 500 })
}

function toClient(row: any) {
  return {
    targetId: row.target_id,
    heightM: row.height_m,
    notes: row.notes,
    measuredAt: row.measured_at,
    measuredBy: row.measured_by_email,
  }
}

// GET — every measurement for this share+flight. Query: ?flight=<flightKey>
export async function GET(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const flightKey = request.nextUrl.searchParams.get('flight') ?? ''
  const { data, error, status } = await supabaseAdmin
    .from(TABLE)
    .select('target_id, height_m, notes, measured_at, measured_by_email')
    .eq('share_id', shareId)
    .eq('flight_key', flightKey)
  // A share with no measurements table yet simply has no measurements — don't
  // break the whole Field mode load over it.
  if (error) {
    if (isMissingTable(error, status)) return NextResponse.json({ measurements: [], unavailable: true })
    return fail(error, status)
  }
  return NextResponse.json({ measurements: (data || []).map(toClient) })
}

// POST — record (or overwrite) one target's reading.
//   { flightKey, targetId, heightM: number|null, notes?: string, email? }
export async function POST(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const targetId = typeof body?.targetId === 'string' ? body.targetId.trim() : ''
  if (!targetId) return NextResponse.json({ error: 'targetId is required.' }, { status: 400 })

  const flightKey = typeof body.flightKey === 'string' ? body.flightKey : ''
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null

  let heightM: number | null = null
  if (body.heightM !== null && body.heightM !== undefined && body.heightM !== '') {
    const n = Number(body.heightM)
    // 60 m is taller than any nursery stock — a bigger number is a typo or a
    // unit mix-up, and silently storing it would poison the validation set.
    if (!Number.isFinite(n) || n < 0 || n > 60) {
      return NextResponse.json({ error: 'heightM must be a number between 0 and 60 metres.' }, { status: 400 })
    }
    heightM = Math.round(n * 1000) / 1000
  }
  if (heightM === null && !notes) {
    return NextResponse.json({ error: 'Give a height, a note, or both.' }, { status: 400 })
  }

  const email =
    typeof body.email === 'string' && body.email.includes('@') ? body.email.trim().toLowerCase() : null

  const { data, error, status } = await supabaseAdmin
    .from(TABLE)
    .upsert(
      {
        share_id: shareId,
        flight_key: flightKey,
        target_id: targetId,
        height_m: heightM,
        notes,
        measured_by_email: email,
        measured_at: new Date().toISOString(),
      },
      { onConflict: 'share_id,flight_key,target_id' }
    )
    .select('target_id, height_m, notes, measured_at, measured_by_email')

  if (error || !data?.length) return fail(error, status)
  return NextResponse.json({ measurement: toClient(data[0]) })
}

// DELETE — clear one target's reading. Query: ?flight=<flightKey>&target=<id>
export async function DELETE(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = request.nextUrl.searchParams
  const targetId = params.get('target')
  if (!targetId) return NextResponse.json({ error: 'A target id is required.' }, { status: 400 })

  const { error, status } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq('share_id', shareId) // never let one share delete another's measurements
    .eq('flight_key', params.get('flight') ?? '')
    .eq('target_id', targetId)

  if (error) return fail(error, status)
  return NextResponse.json({ ok: true })
}
