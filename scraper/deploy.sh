#!/usr/bin/env bash
#
# Deploy the JobPilot scraper to Cloud Run and wire the Cloud Function to it.
#
# Prereqs: gcloud CLI authenticated, project selected, billing enabled.
#
# Usage:
#   ./deploy.sh                 # uses defaults below
#   PROJECT_ID=my-proj ./deploy.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-linkedin-jobcopilot}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-jobpilot-scraper}"

# Service account that the Cloud Function runs as (default App Engine SA).
FUNCTION_SA="${FUNCTION_SA:-${PROJECT_ID}@appspot.gserviceaccount.com}"

echo "==> Deploying ${SERVICE_NAME} to Cloud Run (project=${PROJECT_ID}, region=${REGION})"
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --memory 512Mi \
  --cpu 1 \
  --timeout 120 \
  --min-instances 0 \
  --max-instances 3 \
  --no-allow-unauthenticated

# Allow the Cloud Function's service account to invoke this private service.
echo "==> Granting run.invoker to ${FUNCTION_SA}"
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --member="serviceAccount:${FUNCTION_SA}" \
  --role="roles/run.invoker"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"

echo ""
echo "==> Deployed: ${SERVICE_URL}"
echo ""
echo "Next steps:"
echo "  1. Set SCRAPER_SERVICE_URL in functions/.env:"
echo "       SCRAPER_SERVICE_URL=${SERVICE_URL}"
echo "  2. Redeploy the Cloud Functions:  firebase deploy --only functions"
echo "  3. Smoke test:"
echo "       curl -s -H \"Authorization: Bearer \$(gcloud auth print-identity-token)\" \\"
echo "            -H 'Content-Type: application/json' \\"
echo "            -d '{\"query\":\"software developer\",\"boards\":[\"indeed\"]}' \\"
echo "            ${SERVICE_URL}/scrape | head -c 500"
