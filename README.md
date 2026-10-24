# ⚡ JobPilot AI — Human-Reviewed Job Copilot

A Chrome extension for supported job discovery, deterministic filtering, AI-assisted matching, and user-controlled application workflows.

## What It Does

- **Searches** LinkedIn, Indeed, and Glassdoor through a configured backend
- **Prepares LinkedIn Easy Apply forms** from explicitly saved candidate facts and always pauses for final review
- **Opens Indeed and Glassdoor applications externally** without claiming that opening is submission
- **Requires user input** for unknown facts, legal consent, CAPTCHA, MFA, and login challenges
- **Provides optional AI assistance** from backend-only providers; low-confidence answers are never auto-applied
- **Tracks confirmed outcomes** separately from discovered, opened, and uncertain applications
- **Enforces server-authoritative monthly quota** — Free 10 and Pro 50 direct LinkedIn submissions

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
- **Free:** 10 confirmed direct LinkedIn submissions per month
- **Pro:** 50 confirmed direct LinkedIn submissions per month
- Discovery, scoring, external opening, and form review consume no application quota
- Payment via configured Cashfree or Razorpay integration
- Plan changes are verified server-side

### User Roles
- **Admin:** Bypass is accepted only from verified Firebase custom claims
- **User:** Subject to the server-authoritative Free or Pro monthly limit
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
