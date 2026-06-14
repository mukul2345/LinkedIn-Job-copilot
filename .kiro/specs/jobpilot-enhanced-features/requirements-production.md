# Production-Ready Requirements Document (Bootstrap Edition)

## Introduction

Production requirements for JobPilot AI — a Chrome Extension + Firebase backend that automates LinkedIn job applications. This is a **bootstrap launch** targeting 50–100 monthly active users with minimal infrastructure cost.

**Cost constraints:**
- Firebase Spark (free tier): 50K reads/day, 20K writes/day, 1GB Firestore, 5GB Storage — sufficient for 100 users
- Cloud Functions: 2M invocations/month free — sufficient
- Cloud Run: 2M requests/month free — sufficient if cold-start acceptable
- No paid monitoring, no multi-region, no CDN

**Architecture (simplified for cost):**
```
Extension → Cloud Functions → Firestore (writes)
Extension → Firestore direct (reads, with local cache)
```

## Glossary

- **Extension**: JobPilot AI Chrome Extension (Manifest V3)
- **Cloud_Functions**: Firebase Cloud Functions (Node.js 20) — free tier
- **Firestore**: Google Firestore — free tier (1GB storage, 50K reads/day)
- **Local_Cache**: `chrome.storage.local` as read-through cache to minimize Firestore reads
- **Skill_Map**: User-defined skill → years of experience mapping
- **Payment_Provider**: Cashfree or Razorpay for subscription payments

---

## Requirements

### Requirement 1: Cloud-First Data Storage

**User Story:** As a user, I want my data saved in the cloud so I don't lose settings if I reinstall the extension.

#### Acceptance Criteria

1. All user data (profile, preferences, skill maps, templates, history) SHALL be stored in Firestore under `users/{uid}`
2. THE Extension SHALL use Local_Cache aggressively (TTL: 10 minutes for profile, 1 hour for templates/skills) to stay within Firestore free-tier read limits
3. WHEN the user saves settings, THE Extension SHALL write to Firestore directly (using Firebase JS SDK with security rules), then update the Local_Cache
4. WHEN the user logs in, THE Extension SHALL fetch their full profile from Firestore once and cache it locally
5. THE Extension SHALL batch reads where possible (single `getDoc` for the whole user document instead of multiple subcollection reads)

> **Cost note:** Direct Firestore reads from Extension (not via Cloud Functions) save Cloud Function invocations. Security rules protect data instead.

---

### Requirement 2: User-Configurable Skill Map

**User Story:** As a user, I want to define my own skills and experience years so the bot fills forms accurately for me.

#### Acceptance Criteria

1. THE Extension SHALL provide a UI (key-value editor) for adding skills and their years of experience
2. THE form-filler SHALL look up skills from the user's stored Skill_Map
3. IF a skill isn't in the user's map, fall back to their general `yearsOfExperience` value
4. NO hardcoded skill mappings SHALL exist in source code
5. Skill_Map SHALL be stored as a field in the user's Firestore document: `skillMap: { "python": 3, "aws": 2, ... }`

---

### Requirement 3: User-Configurable Message Templates

**User Story:** As a user, I want to write my own outreach messages so they reflect my background.

#### Acceptance Criteria

1. THE Extension SHALL provide textarea fields for: HR message template, recruiter message template, cover letter template
2. Templates SHALL support placeholders: `{name}`, `{jobTitle}`, `{company}`, `{experience}`, `{headline}`, `{myName}`
3. IF a user hasn't configured a template, THE Extension SHALL show a warning and NOT send any message — no hardcoded fallback
4. Templates SHALL be stored in Firestore under `users/{uid}` in a `templates` field
5. Source code SHALL NOT contain any default message text referencing specific technologies

---

### Requirement 4: Payment (Cashfree + Razorpay)

**User Story:** As a user, I want to upgrade to Pro by paying online using my preferred payment method.

#### Acceptance Criteria

1. THE Cloud_Functions SHALL support creating payment sessions via both Cashfree and Razorpay
2. THE Extension SHALL present a payment provider choice (Cashfree or Razorpay) when user clicks "Upgrade to Pro"
3. THE Cloud_Functions SHALL expose webhook endpoints for both providers: `handleCashfreeWebhook` and `handleRazorpayWebhook`
4. EACH webhook handler SHALL verify the payment signature using the respective provider's method before activating the plan
5. THE webhook handlers SHALL be idempotent — processing the same event twice SHALL NOT duplicate activation
6. Plan activation SHALL: set `plan='pro'`, set `planExpiresAt` to 30 days from payment, store order record with `provider` field
7. ALL payment credentials (Cashfree keys, Razorpay key_id + key_secret) SHALL be in `functions/.env` only — never in source code
8. THE Extension SHALL show payment status and redirect user to the selected provider's checkout page

> **Cost note:** Both providers have zero platform fees for the integration itself. Only transaction fees apply when users actually pay. No extra infrastructure cost.

---

### Requirement 5: Secrets & Configuration Management

**User Story:** As a developer, I want no secrets in source code so the repo can be public.

#### Acceptance Criteria

1. `functions/.env` SHALL contain: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENVIRONMENT`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `AI_PROVIDER`, `AI_API_KEY`, `SCRAPER_SERVICE_URL`
2. `manifest.json` OAuth2 `client_id` is a public identifier — stays in source (required by Chrome)
3. `firebase.js` config is a public identifier — stays in source (secured by Firestore rules)
4. `.gitignore` SHALL include: `functions/.env`, `service-account*.json`, `*.key`
5. ALL previously leaked credentials SHALL be rotated before launch
6. Root `.env` SHALL be a template file (`.env.example`) with placeholder values

---

### Requirement 6: Authentication & Basic Authorization

**User Story:** As a user, I want my account secure and my data private.

#### Acceptance Criteria

1. THE Extension SHALL support Email/Password and Google Sign-In via Firebase Auth
2. THE Cloud_Functions (payment, resume upload) SHALL validate Firebase ID tokens — reject unauthenticated requests with 401
3. Firestore security rules SHALL ensure users can only read/write their own `users/{uid}` document
4. Admin access SHALL be granted only via Firebase Console custom claims (no self-service admin)
5. THE Extension SHALL handle token refresh automatically (Firebase SDK does this)

---

### Requirement 7: Basic Usage Limits (Free vs Pro)

**User Story:** As a product owner, I want free users limited so they have a reason to upgrade.

#### Acceptance Criteria

1. Feature limits:

| Feature | Free | Pro |
|---------|------|-----|
| Job Applications/day | 3 | 80 (LinkedIn safety cap) |
| HR Messages/day | 5 | 25 |
| Resume Tailoring/month | 0 | Unlimited |
| AI Form Answers | No | Yes |

2. Usage tracking SHALL be stored in the user's Firestore document under `usage/{date}` (auto-resets daily)
3. THE Extension SHALL check limits client-side before executing actions (fast UX)
4. THE Cloud_Functions SHALL validate limits server-side for premium operations (resume tailoring)
5. WHEN limit is reached, THE Extension SHALL show upgrade prompt with current count

> **Cost note:** Client-side enforcement for most limits (saves Cloud Function calls). Server-side only for expensive operations.

---

### Requirement 8: Error Handling (Pragmatic)

**User Story:** As a user, I want to understand what went wrong instead of seeing blank screens.

#### Acceptance Criteria

1. THE Extension SHALL show user-friendly error messages (never raw errors/stack traces)
2. WHEN Firestore is unreachable, THE Extension SHALL continue with cached data and show a warning banner
3. WHEN payment webhook is delayed, THE Extension SHALL provide a "Check Status" button
4. Cloud_Functions SHALL return: `{ ok: false, error: { code: string, message: string } }` on failure
5. THE Extension SHALL log errors to `console.error` with context for debugging (no external error service needed at this scale)

> **Cost note:** No Sentry or paid error tracking. Console logs + Firestore audit for payments only.

---

### Requirement 9: Scraper Deployment (Cloud Run — Free Tier)

**User Story:** As a developer, I want the scraper deployed cheaply and only running when needed.

#### Acceptance Criteria

1. THE Scraper_Service SHALL be deployed to Cloud Run with: min instances=0 (scale to zero), max instances=2
2. THE Scraper_Service SHALL expose `/health` (GET, returns 200) and `/scrape` (POST)
3. THE Cloud_Functions SHALL call the Scraper_Service URL from `SCRAPER_SERVICE_URL` env var
4. Cold starts are acceptable (user sees "Searching..." spinner for 5-10s on first request)
5. THE Scraper_Service SHALL timeout at 60 seconds per request
6. Cloud Run SHALL be configured with 512MB memory, 1 vCPU

> **Cost note:** Scale-to-zero means $0 when no one is searching. Free tier covers ~2M requests/month.

---

### Requirement 10: Firestore Data Model

**User Story:** As a developer, I want a clear schema so the codebase is consistent.

#### Acceptance Criteria

1. Schema:

```
users/{uid}
  ├── plan: "free" | "pro"
  ├── role: "user" | "admin"
  ├── userId: "USR@00001"
  ├── email: string
  ├── displayName: string
  ├── createdAt: timestamp
  ├── updatedAt: timestamp
  ├── profile: { firstName, lastName, phone, city, state, zipcode, country, ethnicity, gender, disability, veteran }
  ├── preferences: { searchTerms[], searchLocation, datePosted, experienceLevel[], jobType[], workStyle[], easyApplyOnly, badWords[], blacklistCompanies[], currentExperience, switchNumber }
  ├── skillMap: { [skill]: years }  // e.g. { "python": 3, "aws": 2 }
  ├── templates: { hrMessage, recruiterMessage, coverLetter }
  ├── botSettings: { clickGap, pauseBeforeSubmit, followCompanies, messageRecruiter, useAI, aiProvider, aiApiUrl, aiApiKey, aiModel }
  ├── linkedinCredentials: { email: obfuscated, password: obfuscated }
  ├── planExpiresAt: timestamp | null
  ├── usage: { [date]: { applications, hrMessages } }
  └── applicationHistory: [ { jobId, title, company, jobLink, date, status } ]  // last 500 entries

orders/{orderId}
  ├── userId, plan, amount, currency, provider ("cashfree"|"razorpay"), status, paymentId, createdAt, paidAt

system/counters
  ├── userCount: number
```

2. User document is a single document (not subcollections) to minimize reads — one `getDoc` loads everything
3. `applicationHistory` is capped at 500 entries (oldest pruned on write)

> **Cost note:** Single document per user = 1 read to load everything. Keeps within 50K reads/day free tier easily with 100 users.

---

### Requirement 11: Firestore Security Rules

**User Story:** As a user, I want assurance that other users cannot access my data.

#### Acceptance Criteria

1. Users can READ their own `users/{uid}` document only (where `request.auth.uid == uid`)
2. Users can WRITE their own `users/{uid}` document only (with field validation: cannot change `role` or `plan`)
3. `orders` collection: NO client read/write — Cloud Functions only
4. `system/counters`: NO client read/write — Cloud Functions only
5. Admin users (custom claim `admin: true`) can read any user document

---

### Requirement 12: End-to-End Flow

**User Story:** As a user, I want everything to work: signup → configure → apply → upgrade.

#### Acceptance Criteria

1. Signup → creates Firestore user doc (plan=free, role=user, generated userId)
2. Profile fill → saved to Firestore, validated (firstName + lastName required)
3. Skill map + templates → saved to Firestore, loaded by bot at runtime
4. Start bot → checks: search terms configured, skill map has ≥1 entry OR yearsOfExperience set, templates configured (if messaging enabled)
5. Payment → Cashfree checkout → webhook → plan activated → Extension reads updated plan
6. Bot respects limits → free users stopped at daily cap with upgrade prompt
