import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '@/lib/auth/api-auth'

// Admin-only read of the gated-link audit trail. share_access_log has RLS on
// with no policies, so the service role is the only way in — which is why this
// route re-checks admin rather than letting the browser query the table.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const { isAdmin, errorResponse } = await authenticateRequest(request, supabaseAdmin)
  if (errorResponse) return errorResponse
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit')) || 200, 500)
  const token = searchParams.get('token')
  const email = searchParams.get('email')

  let query = supabaseAdmin
    .from('share_access_log')
    .select('id, link_type, token, share_id, portal_id, email, outcome, ip, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (token) query = query.eq('token', token)
  if (email) query = query.eq('email', email.trim().toLowerCase())

  const { data: entries, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Resolve share ids to titles so the table reads as names, not UUIDs.
  const shareIds = Array.from(new Set((entries || []).map((e) => e.share_id).filter(Boolean)))
  const titles: Record<string, string> = {}
  if (shareIds.length) {
    const { data: shares } = await supabaseAdmin
      .from('property_shares')
      .select('id, title, client_name')
      .in('id', shareIds)
    for (const s of shares || []) {
      titles[s.id] = [s.client_name, s.title].filter(Boolean).join(' — ')
    }
  }

  return NextResponse.json({
    entries: (entries || []).map((e) => ({ ...e, share_label: e.share_id ? titles[e.share_id] ?? null : null })),
  })
}
