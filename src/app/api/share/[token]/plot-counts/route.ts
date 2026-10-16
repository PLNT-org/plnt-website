import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAccessToken } from '@/lib/share/access-token'

// Count history for a plot on a gated share, and reviewer confirmations or
// corrections. A correction becomes the plot's current count; a confirmation
// only records who confirmed it and when. Gated by the `?k=` access token.

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function shareIdFromRequest(request: NextRequest): string | null {
  const k = request.nextUrl.searchParams.get('k')
  if (!k) return null
  return verifyAccessToken(k)?.shareId ?? null
}

const COLUMNS = 'id, plot_id, flight_key, version, plant_count, method, confidence, expected_error_pct, source, note, created_by_email, created_at'

function toClient(row: any) {
  return {
    id: row.id,
    plotId: row.plot_id,
    flightKey: row.flight_key,
    version: row.version,
    plantCount: row.plant_count,
    method: row.method,
    confidence: row.confidence,
    expectedErrorPct: row.expected_error_pct,
    source: row.source,
    note: row.note,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
  }
}

// GET ?plotId=… — that plot's count rows, newest first. Without plotId: the
// latest published row per plot for the share (for the inventory sheet).
export async function GET(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const plotId = request.nextUrl.searchParams.get('plotId')
  let q = supabaseAdmin.from('share_plot_counts').select(COLUMNS).eq('share_id', shareId).order('created_at', { ascending: false })
  if (plotId) q = q.eq('plot_id', plotId)
  const { data, error } = await q.limit(plotId ? 200 : 20000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (plotId) return NextResponse.json({ counts: (data ?? []).map(toClient) })
  const latest = new Map<string, any>()
  for (const row of data ?? []) if (!latest.has(row.plot_id)) latest.set(row.plot_id, toClient(row))
  return NextResponse.json({ counts: Array.from(latest.values()) })
}

// POST — a reviewer confirms the current count, or corrects it with a number.
// Body: { plotId, action: 'confirm' | 'correct', plantCount?, note?, email? }
export async function POST(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const plotId = typeof body?.plotId === 'string' ? body.plotId : ''
  const action = body?.action === 'confirm' || body?.action === 'correct' ? body.action : null
  if (!plotId || !action) return NextResponse.json({ error: 'plotId and action (confirm | correct) are required.' }, { status: 400 })
  const { data: plot, error: e0 } = await supabaseAdmin
    .from('share_plots')
    .select('id, plant_count, manual_count, count_method')
    .eq('share_id', shareId)
    .eq('id', plotId)
    .maybeSingle()
  if (e0) return NextResponse.json({ error: e0.message }, { status: 500 })
  if (!plot) return NextResponse.json({ error: 'Plot not found on this share.' }, { status: 404 })
  // The flight the correction belongs to: the share's latest flight key.
  const { data: share } = await supabaseAdmin.from('property_shares').select('flights').eq('id', shareId).maybeSingle()
  const flights: any[] = Array.isArray(share?.flights) ? share!.flights : []
  const flightKey = flights.length ? String(flights[flights.length - 1].key) : 'legacy'
  const email = typeof body.email === 'string' && body.email.includes('@') ? body.email.trim().toLowerCase() : null
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null
  let plantCount = plot.manual_count ?? plot.plant_count ?? 0
  if (action === 'correct') {
    const n = Number.parseInt(String(body.plantCount), 10)
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'plantCount must be a non-negative integer.' }, { status: 400 })
    plantCount = n
    const { error: e1 } = await supabaseAdmin
      .from('share_plots')
      .update({ plant_count: n, count_method: 'reviewer corrected', count_confidence: 'verified', updated_at: new Date().toISOString() })
      .eq('id', plotId)
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  } else {
    const { error: e1 } = await supabaseAdmin
      .from('share_plots')
      .update({ count_confidence: 'verified', updated_at: new Date().toISOString() })
      .eq('id', plotId)
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  }
  const { data, error } = await supabaseAdmin
    .from('share_plot_counts')
    .insert({
      share_id: shareId,
      plot_id: plotId,
      flight_key: flightKey,
      version: 'reviewer',
      plant_count: plantCount,
      method: action === 'correct' ? 'reviewer corrected' : plot.count_method ?? 'unknown',
      confidence: 'verified',
      expected_error_pct: 0,
      source: action === 'correct' ? 'reviewer_corrected' : 'reviewer_confirmed',
      note,
      created_by_email: email,
    })
    .select(COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ count: toClient(data) }, { status: 201 })
}
