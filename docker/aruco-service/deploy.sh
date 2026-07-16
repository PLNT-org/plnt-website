#!/usr/bin/env bash
#
# Build (Cloud Build) + deploy (Cloud Run GPU) the PLNT aruco / plant-detection
# service. Safe to re-run — API enable and repo create are idempotent.
#
# Prereqs (do these ONCE, interactively, before running this script):
#   gcloud auth login
#   gcloud projects create <PROJECT_ID> --name="PLNT"      # or use an existing one
#   gcloud billing accounts list                            # find your billing acct id
#   gcloud billing projects link <PROJECT_ID> --billing-account=<BILLING_ID>
#   gcloud config set project <PROJECT_ID>
#
# Also: drop the model at  docker/aruco-service/weights/plnt_v3.pt  before building.
#
# Usage:  ./deploy.sh            (uses current gcloud project)
#         PROJECT_ID=my-proj REGION=us-central1 ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"          # must be a Cloud Run L4-GPU region
REPO="${REPO:-plnt}"                     # Artifact Registry repo name
SERVICE="${SERVICE:-plnt-aruco-service}"
TAG="${TAG:-plnt_v3}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: no project set. Run 'gcloud config set project <PROJECT_ID>' or pass PROJECT_ID=..." >&2
  exit 1
fi

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/aruco-service:${TAG}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${HERE}/weights/plnt_v3.pt" ]]; then
  echo "ERROR: ${HERE}/weights/plnt_v3.pt is missing. Download best.pt and place it there first." >&2
  exit 1
fi

echo ">> Project: ${PROJECT_ID}   Region: ${REGION}   Image: ${IMAGE}"

echo ">> Enabling APIs (run, cloudbuild, artifactregistry)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  --project "${PROJECT_ID}"

echo ">> Ensuring Artifact Registry repo '${REPO}' exists in ${REGION}..."
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker --location="${REGION}" --project "${PROJECT_ID}" \
  2>/dev/null || echo "   (repo already exists)"

echo ">> Building image with Cloud Build (amd64, ~10-20 min on first build)..."
gcloud builds submit "${HERE}" --tag "${IMAGE}" --project "${PROJECT_ID}"

# Pass ROBOFLOW_API_KEY through to the service (needed for the SAM 3 engine).
# --update-env-vars MERGES, so it won't clobber other env vars already set on the
# service. `source ../../.env.local` (or export it) before running to include it.
ENV_ARGS=()
if [ -n "${ROBOFLOW_API_KEY:-}" ]; then
  ENV_ARGS+=(--update-env-vars "ROBOFLOW_API_KEY=${ROBOFLOW_API_KEY}")
  echo ">> Passing ROBOFLOW_API_KEY to the service (SAM 3 enabled)."
else
  echo ">> NOTE: ROBOFLOW_API_KEY not set in this shell — SAM 3 engine will 500 until you set it."
fi

echo ">> Deploying to Cloud Run with an NVIDIA L4 GPU..."
# NOTE: a brand-new project usually has 0 L4 quota. If this step errors with a
# quota message, request "Total Nvidia L4 GPU allocation, per project per region"
# for ${REGION} in the Cloud console (IAM & Admin -> Quotas), then re-run.
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy \
  --no-cpu-throttling \
  --cpu 4 --memory 16Gi \
  --concurrency 1 \
  --timeout 600 \
  --min-instances 0 --max-instances 2 \
  --port 8001 \
  --allow-unauthenticated \
  ${ENV_ARGS[@]+"${ENV_ARGS[@]}"}

echo ">> Done. Service URL:"
gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --format='value(status.url)'
echo ">> Set ARUCO_SERVICE_URL to that URL in your Next.js app's env (e.g. Vercel)."
