#!/bin/bash
# Deploy the JobPilot scraper service to Google Cloud Run.
#
# Prerequisites:
#   1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
#   2. Authenticate: gcloud auth login
#   3. Set project: gcloud config set project linkedin-jobcopilot
#   4. Enable Cloud Run API: gcloud services enable run.googleapis.com
#
# Usage:
#   cd scraper/
#   chmod +x deploy.sh
#   ./deploy.sh
#
# After deployment, copy the Service URL and set it as SCRAPER_SERVICE_URL in functions/.env

set -e

PROJECT_ID="linkedin-jobcopilot"
REGION="us-central1"
SERVICE_NAME="jobpilot-scraper"

echo "🚀 Deploying JobPilot Scraper to Cloud Run..."
echo "   Project: $PROJECT_ID"
echo "   Region:  $REGION"
echo "   Service: $SERVICE_NAME"
echo ""

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --memory 512Mi \
  --cpu 1 \
  --timeout 120 \
  --min-instances 0 \
  --max-instances 2 \
  --no-allow-unauthenticated \
  --set-env-vars "PYTHONUNBUFFERED=1"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Copy the Service URL from above"
echo "   2. Set SCRAPER_SERVICE_URL in functions/.env"
echo "   3. Grant Cloud Functions permission to invoke this service:"
echo "      gcloud run services add-iam-policy-binding $SERVICE_NAME \\"
echo "        --region=$REGION \\"
echo "        --member='serviceAccount:$PROJECT_ID@appspot.gserviceaccount.com' \\"
echo "        --role='roles/run.invoker'"
echo ""
echo "   4. Redeploy Cloud Functions: cd ../functions && firebase deploy --only functions"
