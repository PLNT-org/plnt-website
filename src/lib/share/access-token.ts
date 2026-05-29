import { createHmac, timingSafeEqual } from 'crypto'

// Short-lived, stateless token proving a viewer cleared a share's email gate.
// Format: `${shareId}.${expMs}.${hmac}` — verified without a DB lookup so it can
// gate every tile request cheaply. Signed with the server-only service role key.

const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

function secret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign access tokens')
  return s
}

function hmac(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signAccessToken(shareId: string): string {
  const exp = Date.now() + TTL_MS
  const payload = `${shareId}.${exp}`
  return `${payload}.${hmac(payload)}`
}

export function verifyAccessToken(token: string): { shareId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [shareId, expStr, sig] = parts
  const expected = hmac(`${shareId}.${expStr}`)
  // Constant-time compare; lengths must match for timingSafeEqual.
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Date.now()) return null
  return { shareId }
}
