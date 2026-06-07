# ⚡ JobPilot AI — LinkedIn Auto Job Applier

A Chrome extension that automates LinkedIn job applications, messages recruiters, and helps you land interviews faster.

## What It Does

- **Auto-applies** to LinkedIn Easy Apply jobs based on your search criteria
- **Fills forms** automatically using your saved profile, Q&A answers, and smart defaults
- **Messages recruiters** after applying (personalized DMs to hiring managers)
- **HR outreach** — bulk-messages HR/recruiters from your 1st connections
- **AI answers** (optional) — uses OpenAI/Gemini/DeepSeek to answer unknown questions
- **Safety system** — adaptive delays and daily limits to protect your LinkedIn account
- **Subscription system** — free tier (3 apps/day) and Pro tier (unlimited) with Cashfree payments

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Chrome Manifest V3, vanilla JavaScript |
| Auth | Firebase Authentication (email/password + Google) |
| Database | Cloud Firestore |
| Backend | Firebase Cloud Functions (Node.js 20) |
| Payments | Cashfree Payment Gateway |
| Hosting | Chrome Web Store + GitHub Pages |
| Tests | Jest + jsdom |

## Project Structure

```
├── extension/                  # Chrome extension source
│   ├── manifest.json           # Extension config (permissions, scripts)
│   ├── core/
│   │   ├── constants.js        # App constants, user roles, plan types
│   │   └── firebase.js         # Firebase client initialization
│   ├── modules/
│   │   ├── auth/
│   │   │   └── auth-service.js # Signup, login, logout, user ID generation
│   │   ├── bot/
│   │   │   ├── bot-core.js     # Main bot loop, search, state management
│   │   │   ├── job-processor.js# Easy Apply modal handling, form submission
│   │   │   ├── form-filler.js  # Auto-fills application form fields
│   │   │   ├── hr-outreach.js  # Bulk HR/recruiter messaging
│   │   │   ├── recruiter-msg.js# Post-apply recruiter DM
│   │   │   ├── safety.js       # LinkedIn safety limits & expiry alerts
│   │   │   ├── selectors.js    # LinkedIn DOM selectors (centralized)
│   │   │   └── utils.js        # Sleep, DOM helpers, logging
│   │   ├── database/
│   │   │   ├── user-repository.js  # Firestore CRUD for user settings
│   │   │   ├── sync-service.js     # Cloud ↔ local data sync
│   │   │   └── usage-repository.js # Daily usage tracking
│   │   └── subscription/
│   │       ├── plan-config.js      # Plan definitions & pricing
│   │       ├── plan-service.js     # Plan validation, admin bypass
│   │       └── payment-service.js  # Cashfree checkout integration
│   ├── ui/
│   │   ├── popup.html          # Extension popup UI
│   │   ├── popup.css           # Dark theme styles
│   │   ├── popup.js            # Popup logic, settings, auth UI
│   │   ├── screens/
│   │   │   └── pricing-screen.js   # Pricing tab rendering
│   │   └── components/
│   │       └── upgrade-modal.js    # Upgrade prompt overlay
│   ├── content/
│   │   ├── content.js          # Content script entry point
│   │   └── content.css         # Status badge styles
│   ├── background/
│   │   └── service-worker.js   # Background service worker
│   └── assets/                 # Icons, Firebase SDK bundles
├── functions/                  # Firebase Cloud Functions (backend)
│   ├── index.js                # Payment session, webhook, verification
│   ├── package.json
│   └── .env                    # Cashfree credentials (gitignored)
├── scripts/                    # Admin/setup scripts
│   ├── seed-users.js           # Seed Firestore with test users
│   ├── check-user.js           # Debug: check user data
│   └── set-firestore-rules.js  # Deploy Firestore security rules
├── docs/                       # Landing page (GitHub Pages)
│   ├── index.html
│   └── privacy.html
├── tests/                      # Jest test suite
│   ├── setup.js                # Chrome API mocks
│   ├── helpers/
│   │   └── load-modules.js     # Module loader for tests
│   └── modules/                # Unit tests per module
├── config/                     # Legacy Python bot config (deprecated)
├── app.py                      # Legacy Python Flask server (deprecated)
├── firebase.json               # Firebase project config
└── .firebaserc                 # Firebase project alias
```

## Features

### Bot Behavior
- Searches LinkedIn jobs by your configured terms, location, filters
- Skips jobs with blacklisted companies or bad words in description
- Skips jobs requiring more experience than you have
- Handles multi-step Easy Apply forms (text, select, radio, checkbox, textarea)
- Unchecks "Follow company" if you haven't enabled it in settings
- Dismisses post-apply popups (resume prompts, promotions)
- Messages the hiring manager after each application (optional)

### Safety System
| Daily Count | Level | Action |
|-------------|-------|--------|
| 0–25 apps | ✅ Safe | Normal speed |
| 25–50 apps | ⚡ Warning | 1.5× slower, warning shown |
| 50–80 apps | ⚠️ Caution | 3× slower, alert banner |
| 80+ apps | 🛑 Danger | Bot stops immediately |

Same limits apply to HR messages (0–20 safe, 50 danger).

### Subscription & Payments
- **Free:** 3 applications/day, 3 HR messages/day, 3 search terms
- **Pro:** Unlimited everything + AI answers
- Pricing: ₹299/month, ₹699/3mo, ₹1499/6mo, ₹2999/year
- Payment via Cashfree (0% fee on UPI)
- Auto-activates Pro via webhook after payment
- Auto-reverts to Free when plan expires
- Expiry alerts at 7, 3, and 1 day before

### User Roles (DB-driven)
- **Admin** — Unlimited access, no expiry, "Admin" badge
- **User** — Subject to plan limits (free or pro)
- Roles stored in Firestore, not hardcoded
- Each user gets a typed ID: `USR@00001`

## Setup (Development)

```bash
# Install dependencies
npm install

# Run tests
npx jest

# Load extension in Chrome
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" → select the extension/ folder
```

## Deployment

### Extension → Chrome Web Store
```bash
zip -r jobpilot-extension.zip extension/ -x "*.DS_Store"
# Upload to https://chrome.google.com/webstore/devconsole
```

### Backend → Firebase Cloud Functions
```bash
firebase login
firebase deploy --only functions
```

### Landing Page → GitHub Pages
Push to GitHub → Settings → Pages → Source: `/docs` from `main` branch.

## Environment Variables

**`functions/.env`** (never commit):
```
CASHFREE_APP_ID=your_app_id
CASHFREE_SECRET_KEY=your_secret_key
CASHFREE_ENVIRONMENT=production
```

## Admin Setup

```bash
# After signing up with your email in the extension:
node scripts/seed-users.js
```

This sets `role: admin` in Firestore for configured emails. See `scripts/README.md` for details.

## Tests

```bash
npx jest              # Run all 345 tests
npx jest --coverage   # With coverage report
```

## License

MIT

## Author

Built by [Mukul Gupta](https://www.linkedin.com/in/mukul---gupta/)
