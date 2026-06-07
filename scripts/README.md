# Scripts

## seed-users.js — Set up test users in Firestore

This script configures user roles and plans in Firestore for testing.

### Prerequisites
1. Users must first sign up via the extension (creates their Firebase Auth account)
2. You need a Firebase Admin service account key

### Setup
```bash
npm install firebase-admin
```

Download your service account key:
- Go to [Firebase Console](https://console.firebase.google.com) → Project Settings → Service Accounts
- Click "Generate New Private Key"
- Save as `scripts/service-account-key.json`

### Run
```bash
node scripts/seed-users.js
```

### Manual Setup (Firebase Console)

If you prefer to set up users manually:

1. Go to Firebase Console → Firestore → `users` collection
2. Find the user document (by their UID from Authentication tab)
3. Add/update these fields:

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `role` | string | `admin` or `user` | Admin = unlimited access, owner |
| `plan` | string | `free` or `pro` | Current subscription plan |
| `planExpiresAt` | timestamp | date or null | When pro expires (null = never) |
| `planId` | string | `monthly`, `quarterly`, `half_yearly`, `yearly` | Billing period |

### Test User Configurations

| Email | Role | Plan | Expires | Purpose |
|-------|------|------|---------|---------|
| mukul798348@gmail.com | admin | pro | never | Extension owner |
| testpro@example.com | user | pro | +365 days | Yearly pro user |
| testpro-monthly@example.com | user | pro | +30 days | Monthly pro user |
| testfree@example.com | user | free | — | Free tier user |
| testexpired@example.com | user | pro | -7 days | Expired pro (should revert) |

### How Roles Work

- **admin**: Bypasses ALL plan limits. Unlimited applications, HR messages, AI answers. Shows "Admin" badge in the extension. Set via `role: 'admin'` in Firestore.
- **user** + **pro**: Subject to Pro plan limits (unlimited). Shows "Pro" badge. Requires valid `planExpiresAt` in the future.
- **user** + **free**: Subject to free plan limits (3 apps/day, 3 HR msgs/day). Shows "Free" badge.
