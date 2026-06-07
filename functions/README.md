# JobPilot AI - Payment Backend (Firebase Cloud Functions + Cashfree)

## Architecture

```
User clicks "Subscribe to Pro"
        ↓
Extension calls createPaymentSession (Cloud Function)
        ↓
Cloud Function creates order via Cashfree API → returns payment session
        ↓
Extension opens Cashfree checkout page in new tab
        ↓
User completes payment (UPI/Card/Netbanking)
        ↓
Cashfree sends webhook → handlePaymentWebhook (Cloud Function)
        ↓
Cloud Function verifies signature → updates Firestore (plan: 'pro')
        ↓
Extension reads updated plan on next open → shows "Pro" badge
```

## Setup Steps

### 1. Create Cashfree Account
1. Go to https://merchant.cashfree.com/merchants/signup
2. Complete KYC verification
3. Go to **Developers → API Keys**
4. Copy **App ID** and **Secret Key** (use TEST keys first)

### 2. Upgrade Firebase to Blaze Plan
Cloud Functions require the Blaze (pay-as-you-go) plan. It's still free for low usage:
- 2 million function invocations/month free
- 400,000 GB-seconds/month free

1. Go to https://console.firebase.google.com/project/linkedin-jobcopilot/usage/details
2. Click "Upgrade" → Select Blaze plan
3. Add a billing account (you won't be charged for normal usage)

### 3. Login to Firebase CLI
```bash
firebase login
```

### 4. Set Cashfree Credentials
```bash
# For TEST environment (use sandbox keys)
firebase functions:config:set cashfree.app_id="YOUR_TEST_APP_ID" cashfree.secret_key="YOUR_TEST_SECRET_KEY" cashfree.environment="sandbox"

# For PRODUCTION (after testing works)
firebase functions:config:set cashfree.app_id="YOUR_LIVE_APP_ID" cashfree.secret_key="YOUR_LIVE_SECRET_KEY" cashfree.environment="production"
```

### 5. Deploy Functions
```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

After deployment, you'll get URLs like:
- `https://us-central1-linkedin-jobcopilot.cloudfunctions.net/createPaymentSession`
- `https://us-central1-linkedin-jobcopilot.cloudfunctions.net/handlePaymentWebhook`

### 6. Configure Cashfree Webhook
1. Go to Cashfree Dashboard → **Developers → Webhooks**
2. Add webhook URL: `https://us-central1-linkedin-jobcopilot.cloudfunctions.net/handlePaymentWebhook`
3. Select events: `PAYMENT_SUCCESS_WEBHOOK`, `ORDER_PAID_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`
4. Save

### 7. Update Extension (for production)
In `extension/modules/subscription/payment-service.js`, the `CLOUD_FUNCTIONS_URL` variable points to the production Cloud Functions URL. No changes needed if deployed to `linkedin-jobcopilot`.

### 8. Test the Flow
1. Reload extension in Chrome
2. Go to Pricing tab → Select a plan → Click "Subscribe to Pro"
3. Complete payment on Cashfree's test page (use test cards)
4. Return to extension → Should show "Pro" badge

## Test Cards (Sandbox)
- Card: 4111 1111 1111 1111
- Expiry: Any future date
- CVV: 123
- OTP: 123456

## Costs
- **Cashfree**: 0% on UPI, 1.90% on cards
- **Firebase Functions**: Free for ~2M calls/month
- **Firestore**: Free for 50K reads/day, 20K writes/day
