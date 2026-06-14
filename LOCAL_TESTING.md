# Local Testing Guide — JobPilot AI

This guide lets you test everything locally before deploying anywhere.

## What You'll Run Locally

| Service | Port | Purpose |
|---------|------|---------|
| Firebase Emulator UI | http://localhost:4000 | See all data, auth, functions |
| Firestore Emulator | localhost:8081 | Fake database (no real Firebase needed) |
| Auth Emulator | localhost:9099 | Fake auth (sign up/login works locally) |
| Functions Emulator | localhost:5001 | Cloud Functions (payment, search, etc.) |
| Python Scraper | localhost:8080 | Job search scraper |

## Step 1: Set Up Environment

```bash
# From the project root:

# 1. Create functions/.env with test values
cp functions/.env.example functions/.env

# 2. Edit functions/.env — for local testing, these can be dummy values:
#    CASHFREE_APP_ID=test
#    CASHFREE_SECRET_KEY=test
#    CASHFREE_ENVIRONMENT=sandbox
#    RAZORPAY_KEY_ID=rzp_test_dummy
#    RAZORPAY_KEY_SECRET=test
#    RAZORPAY_WEBHOOK_SECRET=test
#    AI_PROVIDER=gemini
#    AI_API_KEY=test (or a real key if you want AI to work)
#    SCRAPER_SERVICE_URL=http://localhost:8080
```

## Step 2: Start the Scraper (Terminal 1)

```bash
cd scraper/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

You should see: `Running on http://0.0.0.0:8080`

Test it: `curl http://localhost:8080/health`
Should return: `{"status": "healthy", ...}`

## Step 3: Start Firebase Emulators (Terminal 2)

```bash
# From project root:
export JAVA_HOME=/opt/homebrew/Cellar/openjdk/25.0.1/libexec/openjdk.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH

firebase emulators:start
```

You should see:
- Emulator UI: http://localhost:4000
- Auth: localhost:9099
- Functions: localhost:5001
- Firestore: localhost:8081

## Step 4: Point Extension to Local Emulators

The extension currently points to production Firebase. To test locally, you need to temporarily tell it to use emulators.

Open `extension/core/firebase.js` and add these lines AFTER `firebase.initializeApp(firebaseConfig)`:

```javascript
// === LOCAL TESTING ONLY — REMOVE BEFORE DEPLOYING ===
if (location.hostname === 'localhost' || location.protocol === 'chrome-extension:') {
  // Uncomment these lines to use local emulators:
  // auth.useEmulator('http://localhost:9099');
  // db.useEmulator('localhost', 8081);
}
```

Also update `extension/modules/shared/api-client.js` — change the API_BASE_URL back to localhost:
```javascript
var API_BASE_URL = 'http://localhost:5001/linkedin-jobcopilot/us-central1';
```

**IMPORTANT:** Change it back to the production URL before deploying!

## Step 5: Load the Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension/` folder
5. The JobPilot AI icon should appear in your toolbar

## Step 6: Test the Full Flow

### Test Signup:
1. Click the extension icon → Sign Up
2. Enter name, email, password → Create Account
3. Check Firebase Emulator UI (localhost:4000) → Firestore → `users/` collection
4. You should see a new document with your profile

### Test Profile Save:
1. Fill in your profile (name, city, phone, etc.)
2. Click "Save Profile"
3. Check Firestore emulator → your user doc should have `profile` field updated

### Test Skill Map:
1. Go to Q&A tab
2. Add skills (e.g., Python: 3, AWS: 2)
3. Click "Save Skills"
4. Check Firestore → `skillMap` field should have your entries

### Test Message Templates:
1. Go to Settings tab
2. Write your HR message template (use {name}, {company} placeholders)
3. Write recruiter message template
4. Save Settings
5. Check Firestore → `templates` field

### Test Bot Start:
1. Make sure you have: search terms, at least 1 skill, templates configured
2. Open LinkedIn in a tab
3. Click "Start Applying"
4. Watch the Activity Log in the popup

### Test Job Search (Enhanced):
1. Go to "Jobs" tab in popup
2. Enter a search query, select boards
3. Click Search
4. This calls Cloud Function → Scraper → returns results

### Test Payment (Sandbox):
1. Go to "Pricing" tab
2. Select a plan and provider
3. Since we're using sandbox keys, it will open Cashfree/Razorpay test checkout
4. After "payment", check Firestore `orders/` collection

## Troubleshooting

### "Module loading failed" in console
- Check that all JS files exist in the `extension/` folder
- Check manifest.json content_scripts order

### "Cannot reach server" errors
- Make sure Firebase emulators are running (terminal 2)
- Make sure API_BASE_URL in api-client.js points to localhost

### Scraper returns empty results
- Make sure scraper is running (terminal 1)
- Try: `curl -X POST http://localhost:8080/scrape -H "Content-Type: application/json" -d '{"query":"software engineer","boards":["indeed"]}'`

### Firestore permission denied
- When using emulators, security rules still apply
- Make sure you're authenticated (signed up/in via the extension)
- Check the emulator UI for auth errors

## When You're Ready to Deploy

1. Remove any emulator config from `extension/core/firebase.js`
2. Change `API_BASE_URL` in `api-client.js` back to production URL
3. Follow `DEPLOYMENT.md` for full production deployment steps
