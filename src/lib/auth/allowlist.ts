/**
 * Account allowlist.
 *
 * Only these emails may sign in. Everyone else is rejected at every layer:
 * middleware (page routes), authenticateRequest (API routes), and the client
 * auth context (which signs out any session that slips through).
 *
 * Self-serve sign up is disabled — see src/app/auth/signup/page.tsx.
 */
export const ALLOWED_EMAILS = [
  'pcomstock@colgate.edu',
  'porter@plnt.net',
]

export const ACCESS_DENIED_MESSAGE =
  'This account does not have access to PLNT. Contact porter@plnt.net if you think this is a mistake.'

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return ALLOWED_EMAILS.includes(email.trim().toLowerCase())
}
