# Vercel → GCP Workload Identity Federation (keyless auth to the Cloud Run service)

The aruco / plant-detection Cloud Run service is **private** (the org blocks public
access and SA keys). The Vercel app authenticates to it with short-lived Google ID
tokens minted via Workload Identity Federation — no keys.

Flow: Vercel issues an OIDC token per request → GCP STS trusts it (provider below) →
impersonates the `aruco-invoker` SA → mints an ID token (audience = service URL) →
sent as `Authorization: Bearer` to Cloud Run. Implemented in `src/lib/aruco/auth.ts`.

## Already done (GCP side)

- Project `plnt-prod-1234` (number `783619498943`), region `us-central1`.
- Service account `aruco-invoker@plnt-prod-1234.iam.gserviceaccount.com` with
  `roles/run.invoker` on the `plnt-aruco-service` service.
- Workload Identity **pool** `vercel`:
  `projects/783619498943/locations/global/workloadIdentityPools/vercel`
- App code: `src/lib/aruco/auth.ts` + all 5 callers attach the token
  (plant-detection, detection-jobs, lightning/sync, admin/convert-to-cog,
  lib/aruco/client.ts). Deps `google-auth-library` + `@vercel/oidc` added.

## Still to do

### 1. Enable OIDC in Vercel (you)
Vercel project → **Settings → Security → OIDC Federation** → enable, **Team** issuer mode.

### 2. Create the OIDC provider (needs your team slug)
```bash
gcloud iam workload-identity-pools providers create-oidc vercel \
  --location=global --workload-identity-pool=vercel --project=plnt-prod-1234 \
  --display-name="Vercel" \
  --issuer-uri="https://oidc.vercel.com/TEAM_SLUG" \
  --allowed-audiences="https://vercel.com/TEAM_SLUG" \
  --attribute-mapping="google.subject=assertion.sub"
```

### 3. Let the Vercel identity impersonate the SA (needs team slug + project name + env)
```bash
PRINCIPAL="principal://iam.googleapis.com/projects/783619498943/locations/global/workloadIdentityPools/vercel/subject/owner:TEAM_SLUG:project:PROJECT_NAME:environment:production"
gcloud iam service-accounts add-iam-policy-binding \
  aruco-invoker@plnt-prod-1234.iam.gserviceaccount.com --project=plnt-prod-1234 \
  --role=roles/iam.workloadIdentityUser --member="$PRINCIPAL"
gcloud iam service-accounts add-iam-policy-binding \
  aruco-invoker@plnt-prod-1234.iam.gserviceaccount.com --project=plnt-prod-1234 \
  --role=roles/iam.serviceAccountTokenCreator --member="$PRINCIPAL"
```
(Add another principal with `environment:preview` to allow preview deployments too.)

### 4. Set Vercel env vars (you), then redeploy the app
| Env var | Value |
| --- | --- |
| `ARUCO_SERVICE_URL` | `https://plnt-aruco-service-hilq227iqq-uc.a.run.app` |
| `GCP_PROJECT_NUMBER` | `783619498943` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `aruco-invoker@plnt-prod-1234.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | `vercel` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | `vercel` |
