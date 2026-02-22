import { supabase } from '@/lib/supabase/client'

/**
 * Authenticated fetch helper.
 * Drop-in replacement for fetch() that auto-attaches the Bearer token
 * from the current Supabase session.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers = new Headers(options.headers)
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }

  return fetch(url, { ...options, headers })
}
