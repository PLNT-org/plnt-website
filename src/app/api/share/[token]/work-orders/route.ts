import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAccessToken } from '@/lib/share/access-token'

// Work orders on a gated property share: a flagged bay with a task, a note and
// a status. Gated by the same `?k=` access token as plots and tiles; the token
// carries the share id, so a client can never address another share's orders.

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function shareIdFromRequest(request: NextRequest): string | null {
  const k = request.nextUrl.searchParams.get('k')
  if (!k) return null
  return verifyAccessToken(k)?.shareId ?? null
}

const TASKS = ['water', 'prune', 'space', 'relocate', 'upsize', 'pull', 'spray_ipm', 'other'] as const
const STATUSES = ['open', 'done', 'cancelled'] as const

const COLUMNS =
  'id, plot_id, bay_ref, task, note, photo_path, location, plant_count_at_creation, created_by_email, assigned_to, due_date, status, done_at, done_by_email, created_at, updated_at'

function toClient(row: any) {
  return {
    id: row.id,
    plotId: row.plot_id,
    bayRef: row.bay_ref,
    task: row.task,
    note: row.note,
    photoPath: row.photo_path,
    location: row.location,
    plantCountAtCreation: row.plant_count_at_creation,
    createdByEmail: row.created_by_email,
    assignedTo: row.assigned_to,
    dueDate: row.due_date,
    status: row.status,
    doneAt: row.done_at,
    doneByEmail: row.done_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function cleanEmail(v: any): string | null {
  return typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : null
}

// GET — every work order on the share, newest first. `?status=open` filters.
export async function GET(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const status = request.nextUrl.searchParams.get('status')
  let q = supabaseAdmin.from('share_work_orders').select(COLUMNS).eq('share_id', shareId).order('created_at', { ascending: false })
  if (status && (STATUSES as readonly string[]).includes(status)) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ orders: (data ?? []).map(toClient) })
}

// POST — create an order for a plot (by id) or a bay reference.
export async function POST(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const task = typeof body?.task === 'string' ? body.task.trim().toLowerCase() : ''
  if (!(TASKS as readonly string[]).includes(task)) {
    return NextResponse.json({ error: `task must be one of ${TASKS.join(', ')}` }, { status: 400 })
  }
  const plotId = typeof body.plotId === 'string' && body.plotId ? body.plotId : null
  let bayRef = typeof body.bayRef === 'string' && body.bayRef.trim() ? body.bayRef.trim() : null
  let plantCount: number | null = null
  if (plotId) {
    // The plot must belong to this share; take its bay reference and current count from it.
    const { data: plot, error } = await supabaseAdmin
      .from('share_plots')
      .select('id, bay_ref, plant_count, manual_count')
      .eq('share_id', shareId)
      .eq('id', plotId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!plot) return NextResponse.json({ error: 'Plot not found on this share.' }, { status: 404 })
    bayRef = bayRef ?? plot.bay_ref ?? null
    plantCount = plot.manual_count ?? plot.plant_count ?? null
  }
  const location =
    body.location && typeof body.location.lat === 'number' && typeof body.location.lng === 'number'
      ? { lat: body.location.lat, lng: body.location.lng }
      : null
  const dueDate = typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null
  const { data, error } = await supabaseAdmin
    .from('share_work_orders')
    .insert({
      share_id: shareId,
      plot_id: plotId,
      bay_ref: bayRef,
      task,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null,
      photo_path: typeof body.photoPath === 'string' && body.photoPath ? body.photoPath : null,
      location,
      plant_count_at_creation: plantCount,
      created_by_email: cleanEmail(body.email),
      assigned_to: typeof body.assignedTo === 'string' && body.assignedTo.trim() ? body.assignedTo.trim().slice(0, 200) : null,
      due_date: dueDate,
    })
    .select(COLUMNS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ order: toClient(data) }, { status: 201 })
}

// PATCH — change status, assignee, due date or note of one order (`id` in the body).
export async function PATCH(request: NextRequest) {
  const shareId = shareIdFromRequest(request)
  if (!shareId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof body?.id !== 'string' || !body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status)) return NextResponse.json({ error: 'Bad status.' }, { status: 400 })
    patch.status = body.status
    patch.done_at = body.status === 'done' ? new Date().toISOString() : null
    patch.done_by_email = body.status === 'done' ? cleanEmail(body.email) : null
  }
  if (body.assignedTo !== undefined) patch.assigned_to = typeof body.assignedTo === 'string' && body.assignedTo.trim() ? body.assignedTo.trim().slice(0, 200) : null
  if (body.dueDate !== undefined) patch.due_date = typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null
  if (body.note !== undefined) patch.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null
  const { data, error } = await supabaseAdmin
    .from('share_work_orders')
    .update(patch)
    .eq('share_id', shareId)
    .eq('id', body.id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Order not found on this share.' }, { status: 404 })
  return NextResponse.json({ order: toClient(data) })
}
