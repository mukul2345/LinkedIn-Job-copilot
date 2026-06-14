# Implementation Tasks — Production-Ready Refactoring

## Phase 1: Infrastructure Foundation

### Task 1: Create Firestore Security Rules
- [ ] 1.1 Create `firestore.rules` at project root with:
  - Users can read/write own `users/{uid}` doc (where `auth.uid == uid`)
  - Block client-side changes to `role` and `plan` fields
  - `orders` collection: deny all client access
  - `system/counters`: deny all client access
  - Admin custom claim override for read access
- [ ] 1.2 Create `firestore.indexes.json` (empty for now — single-doc model needs no compound indexes)
- [ ] 1.3 Add deploy command to `firebase.json`: `"firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" }`

### Task 2: Create Cache Manager Module
- [ ] 2.1 Create `extension/modules/database/cache-manager.js` with:
  - `CACHE_TTLS` config object (profile: 10min, plan: 5min, templates: 1hr, skillMap: 1hr, preferences: 30min)
  - `getCached(key)` → returns data if TTL valid, else null
  - `setCache(key, data)` → stores data with `_cachedAt` timestamp
  - `invalidateCache(key)` → removes specific cache entry
  - `invalidateAll()` → clears all cached user data (on logout)
- [ ] 2.2 Add `cache-manager.js` to manifest.json content_scripts (before `firestore-service.js`)
- [ ] 2.3 Add `cache-manager.js` to popup.html script includes

### Task 3: Create Firestore Service Module
- [ ] 3.1 Create `extension/modules/database/firestore-service.js` with:
  - `loadUserProfile(uid)` → getDoc, cache full doc, return data
  - `saveUserProfile(uid, profileData)` → updateDoc with `profile` field + `updatedAt`
  - `savePreferences(uid, prefs)` → updateDoc with `preferences` field
  - `saveSkillMap(uid, skillMap)` → updateDoc with `skillMap` field
  - `saveTemplates(uid, templates)` → updateDoc with `templates` field
  - `saveBotSettings(uid, settings)` → updateDoc with `botSettings` field
  - `appendApplicationHistory(uid, entry)` → arrayUnion, cap at 500 via Cloud Function or client trim
  - `getUserPlan(uid)` → read `plan` + `planExpiresAt` from cache/Firestore
  - `saveLinkedinCredentials(uid, creds)` → updateDoc with obfuscated creds
  - All write functions update Local_Cache after successful Firestore write
  - All read functions check cache-manager first
- [ ] 3.2 Add to manifest.json content_scripts and popup.html script includes
- [ ] 3.3 Ensure it loads AFTER `cache-manager.js` and `firebase.js`

### Task 4: Create Environment Template
- [ ] 4.1 Rename root `.env` → `.env.example` with placeholder values
- [ ] 4.2 Update `functions/.env` content (keep gitignored) to include Razorpay placeholders:
  ```
  CASHFREE_APP_ID=
  CASHFREE_SECRET_KEY=
  CASHFREE_ENVIRONMENT=sandbox
  RAZORPAY_KEY_ID=
  RAZORPAY_KEY_SECRET=
  RAZORPAY_WEBHOOK_SECRET=
  AI_PROVIDER=gemini
  AI_API_KEY=
  SCRAPER_SERVICE_URL=http://localhost:8080
  ```
- [ ] 4.3 Create `functions/.env.example` with same structure but clearly marked placeholders
- [ ] 4.4 Update `.gitignore` to ensure: `functions/.env`, `.env`, `service-account*.json`, `*.key` are all listed

---

## Phase 2: Migrate Writes to Firestore

### Task 5: Migrate Popup Save Functions to Firestore
- [ ] 5.1 Refactor `saveProfile()` in popup.js → call `saveUserProfile(uid, data)` from firestore-service
- [ ] 5.2 Refactor `saveSearch()` → call `savePreferences(uid, data)`
- [ ] 5.3 Refactor `saveQuestions()` → merge into `saveUserProfile` (yearsOfExperience, visa, salary etc. are part of profile)
- [ ] 5.4 Refactor `saveSettings()` → call `saveBotSettings(uid, data)` for bot config + `saveTemplates(uid, data)` for templates
- [ ] 5.5 Refactor `saveLogin()` / `updateLogin()` → call `saveLinkedinCredentials(uid, creds)`
- [ ] 5.6 Remove all direct `chrome.storage.local.set` calls for user data in popup.js (keep only for Local_Cache updates via cache-manager)
- [ ] 5.7 Update `signUpUser()` in auth-service.js to create full Firestore doc structure with empty fields for profile, preferences, skillMap, templates, botSettings

### Task 6: Migrate Application History to Firestore
- [ ] 6.1 Update `bot-core.js` → after successful apply, call `appendApplicationHistory(uid, entry)` 
- [ ] 6.2 Implement history cap: if array length > 500, trim oldest entries on write
- [ ] 6.3 Update `exportHistory()` in popup.js → read from Firestore (via cache) instead of chrome.storage.local
- [ ] 6.4 Update usage tracking: write daily usage count to Firestore `usage` field instead of `usage_${date}` chrome.storage keys

---

## Phase 3: Migrate Reads to Cache Manager

### Task 7: Migrate Popup Reads
- [ ] 7.1 Refactor `loadAllSettings()` in popup.js → load from `loadUserProfile(uid)` (which uses cache-manager internally)
- [ ] 7.2 Refactor `loadActivityData()` → read from Firestore user doc
- [ ] 7.3 Refactor `checkOnboardingState()` → check if Firestore profile has `onboardingComplete` flag
- [ ] 7.4 Refactor `updateUserAccountUI()` → read plan/role from cache-manager
- [ ] 7.5 Remove `getStorageData()` usage for user data — replace with firestore-service calls

### Task 8: Migrate Bot (Content Script) Reads
- [ ] 8.1 Refactor `startBot()` in bot-core.js → load config from cache-manager (`getCached('profile')`) with fallback to Firestore read
- [ ] 8.2 Refactor `startHROutreach()` → read templates from cache instead of `getStorage(null)`
- [ ] 8.3 Refactor `answerFormQuestions()` → read skillMap from cache for form-filler
- [ ] 8.4 Refactor `messageRecruiter()` → read recruiterMessage template from cache
- [ ] 8.5 Update `content.js` auto-resume → check `botRunning` flag from cache (keep this in chrome.storage.local since it's bot-state, not user data)
- [ ] 8.6 Keep bot runtime state (`botRunning`, `hrBotRunning`, `botState`, `appliedCount`, etc.) in chrome.storage.local — these are ephemeral, not user profile data

---

## Phase 4: Remove Hardcoded Values

### Task 9: Implement Skill Map Editor UI
- [ ] 9.1 Create `extension/ui/components/skill-map-editor.js`:
  - `renderSkillMapEditor(container, skillMap)` → renders key-value rows with inputs
  - Each row: text input (skill name) + number input (years) + delete button
  - "Add Skill" button appends new empty row
  - `getSkillMapFromEditor(container)` → reads all rows into `{ skill: years }` object
- [ ] 9.2 Add skill-map-editor.js to popup.html script includes
- [ ] 9.3 Add a "Skills & Experience" section in the Q&A tab of popup.html with a container div for the editor
- [ ] 9.4 Add "Save Skills" button that calls `saveSkillMap(uid, getSkillMapFromEditor(container))`
- [ ] 9.5 On tab load, call `renderSkillMapEditor(container, cachedProfile.skillMap || {})`

### Task 10: Remove Hardcoded Skill Map from Form Filler
- [ ] 10.1 Delete the `getSkillExperience()` function and its hardcoded `skillMap` object from form-filler.js
- [ ] 10.2 Replace with: read `config.skillMap` (loaded from cache at bot start) → do case-insensitive key match against question label
- [ ] 10.3 Fallback: if no match in skillMap, use `config.yearsOfExperience || '0'`
- [ ] 10.4 Update `handleTextQuestion()` to use the new skill lookup logic

### Task 11: Remove Hardcoded Message Templates
- [ ] 11.1 In `hr-outreach.js` → remove the hardcoded default template string ("Hi {name}, I hope you're doing well! I'm a Backend Developer...")
- [ ] 11.2 Replace with: `const messageTemplate = config.templates?.hrMessage` — if null/empty, log warning and return early (don't send)
- [ ] 11.3 In `recruiter-msg.js` → remove `buildRecruiterMessage()` function's hardcoded text
- [ ] 11.4 Replace with: read `config.templates?.recruiterMessage` → substitute placeholders → if no template configured, skip messaging
- [ ] 11.5 Update `startBot()` validation: if `config.messageRecruiter === true` AND `!config.templates?.recruiterMessage`, show warning and disable recruiter messaging for this session
- [ ] 11.6 Remove the hardcoded default for `hrMessageTemplate` in popup.js `loadAllSettings()` — show empty textarea with placeholder text explaining the format

### Task 12: Remove Hardcoded Default in Popup Settings Load
- [ ] 12.1 In `loadAllSettings()` popup.js → remove the hardcoded HR template default string
- [ ] 12.2 Set `hrMessageTemplate` textarea placeholder to: `"Hi {name}, I'm [your role] with [X] years in [your field]... Use {name}, {jobTitle}, {company} placeholders"`
- [ ] 12.3 Set `recruiterMessage` textarea placeholder similarly
- [ ] 12.4 If user hasn't saved templates yet, show info banner: "Configure your outreach templates in Settings before using HR messaging"

---

## Phase 5: Payment — Add Razorpay

### Task 13: Create Razorpay Cloud Function
- [ ] 13.1 Create `functions/payments-razorpay.js` with:
  - `createRazorpayOrder(userId, userEmail, plan)` → calls Razorpay Orders API, stores order in Firestore, returns `{ orderId, keyId, amount, currency }`
  - `handleRazorpayWebhook(req, res)` → verifies webhook signature using `crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)`, checks idempotency, activates plan
- [ ] 13.2 Add `razorpay` npm package to `functions/package.json` (or use raw API calls with `node-fetch` to avoid extra dependency)
- [ ] 13.3 In `functions/index.js`:
  - Import and export `handleRazorpayWebhook`
  - Update `createPaymentSession` to accept `{ provider: 'cashfree' | 'razorpay' }` parameter and route accordingly
- [ ] 13.4 Share plan activation logic: extract `activateProPlan(userId, orderId, paymentId, provider)` helper used by both webhooks

### Task 14: Update Extension Payment UI
- [ ] 14.1 In `extension/ui/screens/pricing-screen.js` → add provider selection radio buttons (Cashfree / Razorpay) before the "Subscribe" button
- [ ] 14.2 In `extension/modules/subscription/payment-service.js`:
  - Update `createPaymentSession()` to send `{ provider }` to Cloud Function
  - Handle Razorpay response: open Razorpay checkout SDK (or redirect to hosted page)
- [ ] 14.3 For Razorpay: use their hosted checkout URL approach (simpler, no SDK needed in extension):
  - Cloud Function returns `{ shortUrl }` from Razorpay order
  - Extension opens it in new tab (same as Cashfree flow)
- [ ] 14.4 Add "Check Payment Status" button that calls `verifyPaymentStatus` Cloud Function for both providers

---

## Phase 6: Scraper Deployment

### Task 15: Create Scraper Service for Cloud Run
- [ ] 15.1 Create `scraper/requirements.txt`: `flask`, `python-jobspy`, `gunicorn`
- [ ] 15.2 Create `scraper/app.py`:
  - `GET /health` → returns `{"status": "ok"}`
  - `POST /scrape` → accepts `{ query, boards, location, job_type, results_wanted, hours_old }`
  - Calls `python-jobspy` scrape_jobs
  - Normalizes results into JSON: `[{ title, company, location, description, salary, url, board, date }]`
  - Timeout handling per board
  - Returns `{ jobs: [...], failedBoards: [...] }`
- [ ] 15.3 Create `scraper/Dockerfile`:
  ```dockerfile
  FROM python:3.11-slim
  WORKDIR /app
  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt
  COPY . .
  CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--timeout", "120", "app:app"]
  ```
- [ ] 15.4 Create `scraper/deploy.sh` (or document in README):
  ```bash
  gcloud run deploy jobpilot-scraper \
    --source . \
    --region us-central1 \
    --memory 512Mi \
    --cpu 1 \
    --timeout 120 \
    --min-instances 0 \
    --max-instances 2 \
    --no-allow-unauthenticated
  ```
- [ ] 15.5 Update `functions/search.js` → read `SCRAPER_SERVICE_URL` from env, add auth header for Cloud Run invocation

---

## Phase 7: Cleanup & Launch Prep

### Task 16: Delete Legacy Files
- [ ] 16.1 Delete `config/secrets.py` (data now in Firestore per-user)
- [ ] 16.2 Delete `config/personals.py` (same — legacy)
- [ ] 16.3 Delete root `.env` (replaced by `.env.example`)
- [ ] 16.4 Remove `app.py` Flask backend (fully replaced by Cloud Functions + Extension) — or move to `legacy/` folder if you want to keep for reference
- [ ] 16.5 Delete `coverage/` directory from repo (should not be tracked)

### Task 17: Rotate Leaked Credentials
- [ ] 17.1 Rotate Cashfree production keys (generate new ones in Cashfree dashboard)
- [ ] 17.2 Update `functions/.env` with new keys
- [ ] 17.3 Verify old keys are revoked/disabled in Cashfree dashboard
- [ ] 17.4 Set up Razorpay account and add keys to `functions/.env`

### Task 18: Update Manifest & Documentation
- [ ] 18.1 Update `manifest.json` OAuth2 `client_id` → document in README that this must be set to your Google Cloud Console OAuth client ID
- [ ] 18.2 Create/update README with:
  - Setup instructions (Firebase project, OAuth, payment providers)
  - Environment variable documentation
  - Deployment steps (Cloud Functions, Cloud Run, extension packaging)
  - Architecture diagram
- [ ] 18.3 Update manifest version to 2.0.0 (major refactor)
- [ ] 18.4 Remove `config/` directory references from any remaining Python scripts

### Task 19: End-to-End Validation
- [ ] 19.1 Test: New user signup → Firestore doc created with correct structure
- [ ] 19.2 Test: Fill profile → saved to Firestore, loads on extension reopen
- [ ] 19.3 Test: Add skills in editor → skillMap saved, form-filler uses them
- [ ] 19.4 Test: Configure templates → templates saved, bot uses them for messaging
- [ ] 19.5 Test: Start bot → validates templates/skills configured, applies to jobs, respects daily limits
- [ ] 19.6 Test: Hit free limit → upgrade prompt shown, blocks further actions
- [ ] 19.7 Test: Payment via Cashfree → plan activated, bot limits removed
- [ ] 19.8 Test: Payment via Razorpay → plan activated, bot limits removed
- [ ] 19.9 Test: Plan expiry → reverts to free limits
- [ ] 19.10 Test: Multi-board search → Cloud Run scraper returns results
- [ ] 19.11 Test: Security rules → user A cannot read user B's data
