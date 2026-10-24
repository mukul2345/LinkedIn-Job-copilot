# JobPilot AI - Multi-Platform Job Assistant

A Chromium browser extension for user-configured job discovery, matching, application assistance, and history across supported job platforms. LinkedIn Easy Apply is the current direct-application adapter; Indeed and Glassdoor are supported for search and human-reviewed external applications.

## Features

- **No Python/Selenium required** - Runs directly in your browser
- **Simple setup** - Configure through the extension popup UI
- **Fact-grounded form preparation** - Fills only answers resolved from saved candidate facts
- **Job filtering** - Skip jobs based on keywords, experience, and company blacklists
- **Mandatory final review** - Every LinkedIn submission requires explicit confirmation
- **Confirmed application history** - Server-owned records distinguish submission from opening/review
- **AI support** (optional) - Backend-only AI produces review drafts; unknown facts stay blank

## Installation

### Chrome / Comet / Brave / Edge (any Chromium browser)

1. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`, etc.)
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `extension/` folder from this project
5. The extension icon will appear in your browser toolbar

## Setup

1. **Click the extension icon** in your toolbar
2. Go to the **Profile** tab and fill in your personal information
3. Go to the **Search** tab and configure your job search terms and filters
4. Go to the **Q&A** tab and fill in your standard application answers
5. Go to the **Settings** tab to configure bot behavior

## Usage

1. **Log in to LinkedIn** in your browser first
2. Click the extension icon
3. Click **"▶ Start Applying"**
4. The bot will:
   - Navigate to LinkedIn Jobs search
   - Search for each of your configured search terms
   - Filter and skip irrelevant jobs
   - Click Easy Apply and fill out forms automatically
   - Stop for unresolved fields, legal consent, or verification challenges
   - Require your explicit review before every final submission

## Configuration Guide

### Profile Tab
- Name, phone, address - used to fill application forms
- Equal opportunity fields (ethnicity, gender, etc.)

### Search Tab
- **Search Terms** - Job titles to search for (one per line)
- **Location** - City/country to search in
- **Date Posted** - How recent the jobs should be
- **Easy Apply Only** - Only apply to Easy Apply jobs
- **Bad Words** - Skip jobs containing these words in description
- **Blacklist Companies** - Never apply to these companies
- **Current Experience** - Skip jobs requiring more experience than this + 2 years

### Q&A Tab
- Standard answers for common Easy Apply questions
- Salary, notice period, visa status, etc.
- Cover letter and professional summary

### Settings Tab
- **Final review** - Required before every LinkedIn submission and cannot be disabled
- **Click gap** - Delay between actions (increase if getting rate-limited)
- **AI settings** - Optional backend assistance; suggestions never supply unknown candidate facts

## Tips

- Review every prepared form carefully before confirming submission
- Keep your LinkedIn session active (don't log out in another tab)
- If the bot gets stuck, click "Stop" and restart
- Export your application history regularly as a backup

## Differences from Python Version

| Feature | Python (Selenium) | Extension |
|---------|-------------------|-----------|
| Setup | Python + pip + chromedriver | Load unpacked extension |
| Browser | Opens new browser window | Uses your existing browser |
| Login | Automated or manual | You log in normally |
| Resume upload | Supported | Uses LinkedIn's saved resume |
| Performance | Slower (external control) | Faster (native DOM access) |
| Stability | Prone to stale elements | More stable (same context) |

## Troubleshooting

- **Bot doesn't start**: Make sure you're logged into LinkedIn
- **Forms not filling**: Check your Q&A tab has answers configured
- **Getting rate-limited**: Increase the "Click gap" in Settings
- **Extension not loading**: Make sure Developer mode is enabled

## Privacy

All your data is stored locally in your browser using `chrome.storage.local`. Nothing is sent to any external server (except optional AI API calls if you configure them).

## License

GNU Affero General Public License - Same as the original project.
