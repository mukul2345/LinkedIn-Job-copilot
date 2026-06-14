# JobPilot AI — Deployment Guide

## Prerequisites

- Node.js 20+
- Python 3.11+
- Google Cloud CLI (`gcloud`)
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project (already set up: `linkedin-jobcopilot`)

---

## 1. Environment Setup

### Cloud Functions (`functions/.env`)
```bash
cp functions/.env.example functions/.env
# Fill in your actual keys:
```

| Variable | Where to get it |
|----------|----------------|
| `CASHFREE_APP_ID` | Cashfree Dashboard → Developers → API Keys |
| `CASHFREE_SECRET_KEY` | Same as above |
| `CASHFREE_ENVIRONMENT` | `sandbox` for testing, `production` for live |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Same as above |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Webhooks → Secret |
| `AI_PROVIDER` | `gemini` or `openai` |
| `AI_API_KEY` | Google AI Studio or OpenAI Platform |
| `SCRAPER_SERVICE_URL` | Cloud Run URL (after step 3) |

### Extension OAuth2 Client ID (`extension/manifest.json`)
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (type: Chrome Extension)
3. Add your extension ID (get from `chrome://extensions` in developer mode)
4. Replace `<GOOGLE_CLIENT_ID>` in `manifest.json` → `oauth2.client_id`

---

## 2. Deploy Firestore Security Rules

```bash
firebase deploy --only firestore:rules
```

---

## 3. Deploy Scraper Service (Cloud Run)

```bash
cd scraper/
./deploy.sh
```

After deployment:
1. Copy the Service URL from the output
2. Update `SCRAPER_SERVICE_URL` in `functions/.env`
3. Grant Cloud Functions permission to call it:
```bash
gcloud run services add-iam-policy-binding jobpilot-scraper \
  --region=us-central1 \
  --member='serviceAccount:linkedin-jobcopilot@appspot.gserviceaccount.com' \
  --role='roles/run.invoker'
```

---

## 4. Deploy Cloud Functions

```bash
cd functions/
npm install
firebase deploy --only functions
```

---

## 5. Configure Payment Webhooks

### Cashfree
- Dashboard → Webhooks → Add Endpoint
- URL: `https://us-central1-linkedin-jobcopilot.cloudfunctions.net/handlePaymentWebhook`
- Events: `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`

### Razorpay
- Dashboard → Settings → Webhooks → Add New
- URL: `https://us-central1-linkedin-jobcopilot.cloudfunctions.net/handleRazorpayWebhook`
- Events: `payment.captured`, `payment.failed`, `order.paid`
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET` in functions/.env

---

## 6. Firebase Console Configuration

### Authentication
- Enable: Email/Password, Google Sign-In
- Add authorized domain: `chrome-extension://<your-extension-id>`

### Firestore
- Rules deployed in step 2
- Create `system/counters` document manually: `{ userCount: 0 }`

---

## 7. Build & Package Extension

```bash
# From project root
cd extension/
zip -r ../jobpilot-extension.zip . -x "*.DS_Store"
```

Upload `jobpilot-extension.zip` to Chrome Web Store Developer Dashboard.

---

## 8. Post-Launch Checklist

- [ ] Rotate Cashfree credentials (old ones were in git history)
- [ ] Test full payment flow (Cashfree + Razorpay) in sandbox
- [ ] Test signup → profile → bot start → application → payment → pro upgrade
- [ ] Verify Firestore rules: User A cannot read User B's data
- [ ] Set up Gmail OAuth consent screen (Google Cloud Console)
- [ ] Monitor Cloud Functions logs: `firebase functions:log`

---

## Cost (Firebase Free Tier — Spark Plan)

| Resource | Free Limit | Expected Usage (100 MAU) |
|----------|-----------|-------------------------|
| Firestore reads | 50K/day | ~3K/day |
| Firestore writes | 20K/day | ~500/day |
| Firestore storage | 1 GB | ~50 MB |
| Cloud Functions | 2M/month | ~2K/month |
| Cloud Run | 2M requests/month | ~200/month |
| Firebase Auth | 10K users | 100 users |
| Firebase Storage | 5 GB | ~500 MB |

**Total: $0/month** for the first 100 users.
