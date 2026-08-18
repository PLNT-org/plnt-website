import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Append-only audit trail for gated client links. See
// supabase/migrations/20260817_add_share_access_log.sql.
//
// Logging is strictly best-effort: a client opening their map must never fail
// because we couldn't record that they did. Every write is swallowed.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type AccessOutcome =
  | 'granted'
  | 'denied_email'
  | 'expired'
  | 'not_found'
  | 'invalid_email'

interface LogArgs {
  request: NextRequest
  linkType: 'share' | 'portal'
  token: string
  outcome: AccessOutcome
  email?: string | null
  shareId?: string | null
  portalId?: string | null
}

// Vercel puts the real client IP in x-forwarded-for; take the first hop, since
// the rest are proxies. Truncated because a spoofed header can be arbitrarily
// long and this is only ever a hint, never an authorization input.
function clientIp(request: NextRequest): string | null {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim().slice(0, 100) || null
  return request.headers.get('x-real-ip')?.slice(0, 100) || null
}

export async function logShareAccess({
  request,
  linkType,
  token,
  outcome,
  email,
  shareId,
  portalId,
}: LogArgs): Promise<void> {
  try {
    const { error, status } = await supabaseAdmin.from('share_access_log').insert({
      link_type: linkType,
      token,
      share_id: shareId ?? null,
      portal_id: portalId ?? null,
      email: email ? email.trim().toLowerCase().slice(0, 320) : null,
      outcome,
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    })
    // supabase-js returns errors rather than throwing, so the catch below would
    // miss them — including "relation does not exist" before the migration runs.
    if (error) {
      // A 404 with an empty error body is PostgREST saying the table isn't in
      // its schema cache — i.e. the migration hasn't been run on this project.
      const hint =
        status === 404
          ? 'share_access_log not found — run supabase/migrations/20260817_add_share_access_log.sql'
          : error.message || JSON.stringify(error)
      console.error(`[share-access-log] insert failed (${status}):`, hint)
    }
  } catch (err) {
    console.error('[share-access-log] failed to record access:', err)
  }
}
