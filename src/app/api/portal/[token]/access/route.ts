import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Portal front door. Verifies the email against the portal's allowlist, then
// returns every (non-expired) property_share that same email is authorized for.
// The viewer then opens any of them through the normal /api/share/<token>/access
// flow (which re-checks the per-share allowlist and mints the tile token), so a
// portal never widens access beyond what each share already grants.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { email } = await request.json()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const { data: portal, error } = await supabaseAdmin
      .from('client_portals')
      .select('label, allowed_emails, expires_at')
      .eq('token', params.token)
      .single()

    if (error || !portal) {
      return NextResponse.json({ error: 'This link is invalid.' }, { status: 404 })
    }
    if (portal.expires_at && new Date(portal.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
    }
    if (!(portal.allowed_emails || []).includes(normalizedEmail)) {
      return NextResponse.json({ error: 'This email is not authorized for this portal.' }, { status: 403 })
    }

    const { data: locShares } = await supabaseAdmin
      .from('property_shares')
      .select('token, title, client_name, expires_at')
      .contains('allowed_emails', [normalizedEmail])
    const now = Date.now()
    const locations = (locShares || [])
      .filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now)
      .map((s) => ({ token: s.token, title: s.title, client_name: s.client_name }))

    return NextResponse.json({ label: portal.label, locations })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to open portal' },
      { status: 500 }
    )
  }
}
