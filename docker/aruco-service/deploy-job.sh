#!/usr/bin/env bash
#
# Create/update the plnt-detect-job Cloud Run Job — runs plant detection to
# COMPLETION. Unlike the service's fire-after-response BackgroundTask (which
# Cloud Run reclaims when the instance goes idle, ~5 min), a Job runs the
# container until the task finishes, so large orthos (thousands of tiles,
# >10 min) can't be cut off mid-run.
#
# Build/push the image first (deploy.sh builds the same image), then run this.
# Per-run params (JOB_ID, GEOTIFF_URL, BOUNDS, ORTHO_ID, USER_ID) are supplied at
# execution time via `gcloud run jobs execute --update-env-vars` or, in prod, the
# Cloud Run Admin API overrides from the Next.js /api/detection-jobs route.
#
# Usage:
#   set -a; source ../../.env.local; set +a
#   ./deploy-job.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-plnt}"
JOB="${JOB:-plnt-detect-job}"
TAG="${TAG:-plnt_v3}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/aruco-service:${TAG}"

# Stable env (the per-ortho params come at execution time). Accept either the
# job's names or the app's .env.local names.
SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
: "${SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"

# `create` is not idempotent — update in place if the job already exists.
CMD=create
if gcloud run jobs describe "${JOB}" --region "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  CMD=update
fi

echo ">> ${CMD} job ${JOB} (image ${IMAGE})"
gcloud run jobs ${CMD} "${JOB}" \
  --image "${IMAGE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --cpu 4 --memory 16Gi \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy \
  --max-retries 0 --task-timeout 3600 --parallelism 1 --tasks 1 \
  --command python --args="-m,app.job_runner" \
  --set-env-vars "WEIGHTS_PATH=/app/weights/plnt_v3.pt,SUPABASE_URL=${SUPABASE_URL},SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}"

echo ">> Done. Execute per-ortho with (^@^ delimiter keeps commas in BOUNDS intact):"
echo "   gcloud run jobs execute ${JOB} --region ${REGION} --async \\"
echo "     --update-env-vars '^@^JOB_ID=<uuid>@GEOTIFF_URL=<url>@BOUNDS=<json>@ORTHO_ID=<uuid>@USER_ID=<uuid>'"
