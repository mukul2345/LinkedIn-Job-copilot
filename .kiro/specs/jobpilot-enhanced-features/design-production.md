# Technical Design — Production-Ready Refactoring

## Overview

This design transforms JobPilot AI from a prototype (hardcoded values, chrome.storage.local primary, single payment provider) into a production SaaS running entirely on Firebase free tier, supporting 50–100 MAU at $0 infrastructure cost.

**Key architectural decisions:**
- Firestore single-document-per-user model (1 read = entire profile loaded)
- Direct Firestore reads from Extension (secured by rules, saves Cloud Function invocations)
- Cloud Functions only for: payments, resume upload, scraper proxy, userId generation
- Local cache with TTL to minimize Firestore reads (stay under 50K/day free limit)
- Scale-to-zero Cloud Run for scraper ($0 when idle)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                          │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Popup UI │  │ Content  │  │ Background│  │ Local Cache  │   │
│  │ (popup.js│  │ Scripts  │  │ (service- │  │ (chrome.     │   │
│  │  + HTML) │  │ (bot)    │  │  worker)  │  │  storage)    │   │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────┬───────┘  │
│       │              │              │                │           │
└───────┼──────────────┼──────────────┼────────────────┼───────────┘
        │              │              │                │
        ▼              ▼              │                ▼
┌───────────────────────────────┐    │    ┌─────────────────────┐
│      Firebase Auth            │    │    │   Firestore (reads) │
│  (Email/Password + Google)    │    │    │   Security Rules     │
└───────────────────────────────┘    │    │   protect access     │
                                     │    └─────────────────────┘
                                     │              ▲
                                     ▼              │ (writes)
                            ┌────────────────────────────────┐
                            │      Cloud Functions            │
                            │                                 │
                            │  ├── createPaymentSession       │
                            │  ├── handleCashfreeWebhook      │
                            │  ├── handleRazorpayWebhook      │
                            │  ├── verifyPaymentStatus        │
                            │  ├── searchJobs (→ Cloud Run)   │
                            │  ├── uploadResume               │
                            │  ├── tailorResume               │
                            │  ├── computeFitScore            │
                            │  ├── scanGmail                  │
                            │  └── classifySponsorship        │
                            └────────────────┬───────────────┘
                                             │
                                             ▼
                            ┌────────────────────────────────┐
                            │    Cloud Run (Scraper)          │
                            │    Python + python-jobspy       │
                            │    Scale-to-zero                │
                            │    POST /scrape                 │
                            │    GET  /health                 │
                            └────────────────────────────────┘
```

---

## Data Flow Patterns

### Pattern A: User reads data (profile, settings, templates)
```
Extension Popup opens
  → Check Local_Cache (chrome.storage.local)
    → If cache hit + TTL valid → use cached data
    → If cache miss or expired → Firestore getDoc("users/{uid}")
      → Update Local_Cache with TTL timestamp
      → Render UI
```

### Pattern B: User writes data (save profile, save templates)
```
User clicks "Save"
  → Extension validates input client-side
  → Extension calls Firestore updateDoc("users/{uid}", { ... })
    → Firestore security rules verify: auth.uid == uid AND cannot change role/plan
    → Write succeeds
  → Extension updates Local_Cache
  → Show success notification
```

### Pattern C: Payment flow
```
User clicks "Upgrade to Pro" → selects Cashfree or Razorpay
  → Extension calls Cloud Function: createPaymentSession({ provider, plan })
    → CF validates auth token
    → CF creates order in Firestore (status: 'created')
    → CF calls Cashfree/Razorpay API to create session
    → CF returns checkoutUrl
  → Extension opens checkoutUrl in new tab
  → User pays on provider's hosted page
  → Provider sends webhook to CF: handleCashfreeWebhook or handleRazorpayWebhook
    → CF verifies signature
    → CF checks idempotency (order not already 'paid')
    → CF updates order status to 'paid'
    → CF updates user doc: plan='pro', planExpiresAt=now+30days
  → User returns to extension → reads updated plan from Firestore
```

### Pattern D: Bot reads config at runtime
```
Bot starts (content script)
  → getStorage(null) from Local_Cache
  → If profileCachedAt + TTL < now:
    → Fetch from Firestore (1 read)
    → Update Local_Cache
  → Bot uses: skillMap, templates, preferences, botSettings
```

---

## File Changes

### New Files to Create

| File | Purpose |
|------|---------|
| `extension/modules/database/firestore-service.js` | Centralized Firestore read/write with caching logic |
| `extension/modules/database/cache-manager.js` | Local cache TTL management |
| `extension/ui/components/skill-map-editor.js` | UI component for skill-map key-value editing |
| `functions/payments-razorpay.js` | Razorpay payment session + webhook handler |
| `functions/.env.example` | Template env file with placeholder values |
| `firestore.rules` | Firestore security rules |
| `scraper/Dockerfile` | Container definition for Cloud Run deployment |
| `scraper/requirements.txt` | Python dependencies |
| `scraper/app.py` | Flask scraper service (health + scrape endpoints) |
| `cloudbuild.yaml` or deploy script | Cloud Run deployment configuration |

### Files to Modify

| File | Change |
|------|--------|
| `extension/core/firebase.js` | Keep as-is (public config, secured by rules) |
| `extension/manifest.json` | Replace placeholder OAuth client_id with real one at deploy time (documented in README) |
| `extension/modules/bot/form-filler.js` | Remove `getSkillExperience()` hardcoded map → read from user's skillMap |
| `extension/modules/bot/hr-outreach.js` | Remove hardcoded template fallback → require user-configured template |
| `extension/modules/bot/recruiter-msg.js` | Remove `buildRecruiterMessage` hardcoded text → use user's template |
| `extension/ui/popup.js` | Replace `chrome.storage.local.set` save calls → Firestore writes via firestore-service |
| `extension/ui/popup.js` | Add skill-map editor UI section |
| `extension/ui/popup.html` | Add skill-map editor section, payment provider selector |
| `extension/modules/subscription/payment-service.js` | Add Razorpay flow alongside Cashfree |
| `extension/ui/screens/pricing-screen.js` | Add provider selector (Cashfree/Razorpay) |
| `extension/content/content.js` | Load config from cache-manager instead of raw getStorage |
| `extension/modules/bot/bot-core.js` | Validate templates exist before starting outreach |
| `functions/index.js` | Add Razorpay exports, update createPaymentSession for dual provider |
| `functions/.env` | Add Razorpay keys (already gitignored) |
| `.gitignore` | Ensure `functions/.env`, `*.key`, `service-account*.json` are listed |
| `.env` → `.env.example` | Rename to template with placeholders |

### Files to Delete

| File | Reason |
|------|--------|
| `config/secrets.py` | Legacy Python config — no longer needed |
| `config/personals.py` | Legacy — all personal data now in Firestore |
| `.env` (root) | Replaced by `.env.example` template |

---

## Component Designs

### 1. Firestore Service (`extension/modules/database/firestore-service.js`)

```javascript
// Centralized Firestore access layer for the Extension
// All reads go through cache-manager; writes go directly to Firestore

async function loadUserProfile(uid) { /* getDoc → cache */ }
async function saveUserProfile(uid, data) { /* updateDoc → refresh cache */ }
async function saveSkillMap(uid, skillMap) { /* updateDoc field */ }
async function saveTemplates(uid, templates) { /* updateDoc field */ }
async function savePreferences(uid, prefs) { /* updateDoc field */ }
async function saveBotSettings(uid, settings) { /* updateDoc field */ }
async function appendApplicationHistory(uid, entry) { /* arrayUnion, cap at 500 */ }
async function getUserPlan(uid) { /* read plan + expiry from cache/Firestore */ }
```

### 2. Cache Manager (`extension/modules/database/cache-manager.js`)

```javascript
// TTL-based read-through cache using chrome.storage.local

const CACHE_TTLS = {
  profile: 10 * 60 * 1000,      // 10 minutes
  plan: 5 * 60 * 1000,          // 5 minutes  
  templates: 60 * 60 * 1000,    // 1 hour
  skillMap: 60 * 60 * 1000,     // 1 hour
  preferences: 30 * 60 * 1000,  // 30 minutes
};

async function getCached(key) { /* check TTL, return data or null */ }
async function setCache(key, data) { /* store with timestamp */ }
async function invalidateCache(key) { /* remove from cache */ }
async function invalidateAll() { /* clear all cached user data */ }
```

### 3. Skill Map Editor (`extension/ui/components/skill-map-editor.js`)

```javascript
// Renders a dynamic key-value list editor in the Settings tab
// Each row: [skill name input] [years input] [delete button]
// "Add Skill" button at bottom
// "Save Skills" persists to Firestore via firestore-service

function renderSkillMapEditor(container, skillMap) { /* renders UI */ }
function getSkillMapFromEditor(container) { /* reads current values */ }
```

### 4. Razorpay Payment Handler (`functions/payments-razorpay.js`)

```javascript
// Razorpay payment integration

exports.createRazorpayOrder = async (userId, plan) => {
  // Create Razorpay order via API
  // Store in Firestore orders collection
  // Return order_id + key_id for frontend checkout
};

exports.handleRazorpayWebhook = functions.https.onRequest(async (req, res) => {
  // Verify webhook signature using RAZORPAY_WEBHOOK_SECRET
  // Check idempotency
  // Activate plan
  // Update order status
});
```

### 5. Firestore Security Rules (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users can read/write their own doc
    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if request.auth != null && request.auth.uid == uid
                   && !('role' in request.resource.data.diff(resource.data))
                   && !('plan' in request.resource.data.diff(resource.data));
    }
    
    // Orders: Cloud Functions only (no client access)
    match /orders/{orderId} {
      allow read, write: if false;
    }
    
    // System: Cloud Functions only
    match /system/{doc} {
      allow read, write: if false;
    }
    
    // Admin override via custom claims
    match /{document=**} {
      allow read: if request.auth != null && request.auth.token.admin == true;
    }
  }
}
```

### 6. Scraper Service (`scraper/app.py`)

```python
from flask import Flask, request, jsonify
from jobspy import scrape_jobs

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"}), 200

@app.route('/scrape', methods=['POST'])
def scrape():
    data = request.json
    # Validate input
    # Call python-jobspy with: site_name, search_term, location, job_type, results_wanted, hours_old
    # Normalize results into Job_Record format
    # Return JSON array
```

---

## Environment Variables

### `functions/.env` (production — never committed)
```
# Payment: Cashfree
CASHFREE_APP_ID=your-app-id
CASHFREE_SECRET_KEY=your-secret-key
CASHFREE_ENVIRONMENT=production

# Payment: Razorpay
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=your-razorpay-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# AI Provider
AI_PROVIDER=gemini
AI_API_KEY=your-gemini-or-openai-key

# Scraper
SCRAPER_SERVICE_URL=https://jobpilot-scraper-xxxxx-uc.a.run.app
```

### `functions/.env.example` (committed to repo — placeholders only)
```
CASHFREE_APP_ID=your-cashfree-app-id
CASHFREE_SECRET_KEY=your-cashfree-secret
CASHFREE_ENVIRONMENT=sandbox
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your-razorpay-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
AI_PROVIDER=gemini
AI_API_KEY=your-ai-api-key
SCRAPER_SERVICE_URL=http://localhost:8080
```

---

## Migration Plan

Since we have existing users (even if few), the migration must be non-breaking:

1. **Phase 1: Add new infrastructure** (Firestore service, cache manager, security rules, Razorpay handler)
2. **Phase 2: Migrate saves** — Change popup.js save functions to write to Firestore instead of chrome.storage.local only
3. **Phase 3: Migrate reads** — Change content scripts to read from cache-manager (which reads Firestore on cache miss)
4. **Phase 4: Remove hardcoded values** — Skill map editor, template enforcement, remove getSkillExperience()
5. **Phase 5: Deploy scraper** — Dockerfile, Cloud Run, wire up searchJobs Cloud Function
6. **Phase 6: Cleanup** — Delete legacy files, rotate credentials, update README

---

## Cost Estimate (100 MAU)

| Resource | Usage | Cost |
|----------|-------|------|
| Firestore reads | ~3,000/day (30 users × 3 sessions × ~33 reads) | Free (limit: 50K) |
| Firestore writes | ~500/day (settings saves + application history) | Free (limit: 20K) |
| Firestore storage | ~50MB (100 users × 500KB each) | Free (limit: 1GB) |
| Cloud Functions | ~2,000/month (payments + resume + scraper proxy) | Free (limit: 2M) |
| Cloud Run | ~200 requests/month (job searches) | Free (limit: 2M) |
| Firebase Auth | 100 users | Free (limit: 10K) |
| Firebase Storage | ~500MB (100 resumes × 5MB) | Free (limit: 5GB) |
| **Total** | | **$0/month** |
