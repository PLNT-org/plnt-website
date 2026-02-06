// WebODM JWT Token Manager
// Auto-fetches tokens using username/password, caches with 5h TTL, retries on 401

const TOKEN_TTL_MS = 5 * 60 * 60 * 1000 // 5 hours (tokens expire at 6h)

let cachedToken: string | null = null
let tokenExpiresAt = 0
let pendingFetch: Promise<string> | null = null

function getBaseUrl(): string {
  const url = process.env.WEBODM_URL
  if (!url) {
    console.error('[WebODM] WEBODM_URL is not set! Falling back to localhost:8000')
  } else {
    console.log('[WebODM] Using URL:', url)
  }
  return (url || 'http://localhost:8000').replace(/\/$/, '')
}

export async function getWebODMToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken
  }

  // Deduplicate concurrent fetches
  if (pendingFetch) {
    return pendingFetch
  }

  pendingFetch = fetchNewToken()
  try {
    const token = await pendingFetch
    return token
  } finally {
    pendingFetch = null
  }
}

async function fetchNewToken(): Promise<string> {
  const username = process.env.WEBODM_USERNAME
  const password = process.env.WEBODM_PASSWORD

  if (!username || !password) {
    throw new Error('WEBODM_USERNAME and WEBODM_PASSWORD must be set')
  }

  const response = await fetch(`${getBaseUrl()}/api/token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`WebODM auth failed: ${response.status} - ${text}`)
  }

  const data = await response.json()
  cachedToken = data.token
  tokenExpiresAt = Date.now() + TOKEN_TTL_MS

  return cachedToken!
}

export function invalidateToken(): void {
  cachedToken = null
  tokenExpiresAt = 0
}

/**
 * Drop-in fetch() replacement that injects WebODM JWT auth and retries once on 401.
 */
export async function fetchWithWebODMAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getWebODMToken()
  const headers = new Headers(options.headers)
  headers.set('Authorization', `JWT ${token}`)

  let response = await fetch(url, { ...options, headers })

  if (response.status === 401) {
    invalidateToken()
    const freshToken = await getWebODMToken()
    headers.set('Authorization', `JWT ${freshToken}`)
    response = await fetch(url, { ...options, headers })
  }

  return response
}
