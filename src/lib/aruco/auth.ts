/**
 * Auth for calling the private aruco / plant-detection Cloud Run service.
 *
 * The service is deployed privately (the org blocks public Cloud Run access and
 * SA keys). Vercel mints short-lived OIDC tokens that GCP Workload Identity
 * Federation trusts; we exchange one for a Google ID token (audience = the
 * service URL) and send it as a Bearer token. No long-lived keys involved.
 *
 * Required Vercel env vars (see docker/aruco-service/WIF-SETUP.md):
 *   GCP_PROJECT_NUMBER
 *   GCP_SERVICE_ACCOUNT_EMAIL
 *   GCP_WORKLOAD_IDENTITY_POOL_ID
 *   GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
 *
 * When these are unset (e.g. local dev hitting http://localhost:8001), no token
 * is attached — local runs don't need auth.
 */
import { getVercelOidcToken } from '@vercel/oidc'
import { ExternalAccountClient, Impersonated } from 'google-auth-library'

const GCP_PROJECT_NUMBER = process.env.GCP_PROJECT_NUMBER
const GCP_SERVICE_ACCOUNT_EMAIL = process.env.GCP_SERVICE_ACCOUNT_EMAIL
const GCP_WORKLOAD_IDENTITY_POOL_ID = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID
const GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID

let impersonated: Impersonated | null = null

function getClient(): Impersonated | null {
  if (impersonated) return impersonated
  if (
    !GCP_PROJECT_NUMBER ||
    !GCP_SERVICE_ACCOUNT_EMAIL ||
    !GCP_WORKLOAD_IDENTITY_POOL_ID ||
    !GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
  ) {
    return null
  }

  // Federated source identity: exchanges the Vercel OIDC token at GCP STS.
  const sourceClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    subject_token_supplier: {
      // Vercel's per-request OIDC token is the federated subject token.
      // Wrapped so the signature matches google-auth-library's supplier callback.
      getSubjectToken: () => getVercelOidcToken(),
    },
  })
  if (!sourceClient) return null

  // Impersonate the invoker SA so we can mint ID tokens (audience = service URL)
  // that the private Cloud Run service will accept.
  impersonated = new Impersonated({
    sourceClient,
    targetPrincipal: GCP_SERVICE_ACCOUNT_EMAIL,
    targetScopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  return impersonated
}

/**
 * Returns an `Authorization` header for the given Cloud Run service URL, or an
 * empty object when federation isn't configured / the target isn't an https
 * Cloud Run URL (local dev). The ID token's audience is the service URL.
 */
export async function getArucoAuthHeaders(serviceUrl: string): Promise<Record<string, string>> {
  if (!serviceUrl || !serviceUrl.startsWith('https://')) return {}
  const client = getClient()
  if (!client) {
    console.warn('[aruco-auth] WIF env not set — calling aruco service without an auth token')
    return {}
  }
  // Cloud Run validates the ID token audience against the service URL.
  const idToken = await client.fetchIdToken(serviceUrl)
  return { Authorization: `Bearer ${idToken}` }
}
