/**
 * seed-users.js - Firestore seed script for test users
 * 
 * This script creates/updates user documents in Firestore with different
 * roles, plans, and typed user IDs for testing purposes.
 * 
 * USAGE:
 *   1. Install Firebase Admin SDK: npm install firebase-admin
 *   2. Download your service account key from Firebase Console:
 *      Project Settings → Service Accounts → Generate New Private Key
 *   3. Save it as ./scripts/service-account-key.json (DO NOT commit this file!)
 *   4. Run: node scripts/seed-users.js
 * 
 * IMPORTANT: 
 *   - Users must first sign up via the extension (this creates their Auth account)
 *   - This script only updates their Firestore document (role, plan, userId, etc.)
 *   - You can also run this directly in Firebase Console → Firestore
 * 
 * FIRESTORE USER DOCUMENT SCHEMA:
 * {
 *   userId: string,             // Typed ID: "USR@00001" format
 *   email: string,              // User's email
 *   displayName: string,        // Display name
 *   role: 'admin' | 'user',     // User role (admin = owner/unlimited access)
 *   plan: 'free' | 'pro',       // Subscription plan
 *   planExpiresAt: Timestamp,   // When pro plan expires (null for free/admin)
 *   planId: string,             // Which billing period (monthly/quarterly/yearly)
 *   planActivatedAt: Timestamp, // When plan was activated
 *   createdAt: Timestamp,       // Account creation date
 * }
 * 
 * SYSTEM COUNTER DOCUMENT (system/counters):
 * {
 *   userCount: number           // Last assigned user number (for USR@XXXXX generation)
 * }
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, 'service-account-key.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (e) {
  console.error('❌ Could not load service-account-key.json');
  console.error('   Download it from Firebase Console → Project Settings → Service Accounts');
  console.error(`   Save it to: ${serviceAccountPath}`);
  process.exit(1);
}

const db = admin.firestore();

// ============================================================
// TEST USER CONFIGURATIONS
// ============================================================
// These users must already have Auth accounts (signed up via extension).
// This script updates their Firestore documents with the specified config.
// 
// To add your own users:
//   1. Sign up in the extension with the email
//   2. Add the email + desired config below
//   3. Run this script
// ============================================================

const TEST_USERS = [
  {
    email: 'mukul798348@gmail.com',
    displayName: 'Mukul Gupta',
    userId: 'USR@00001',         // First user — extension owner
    role: 'admin',               // Owner/Admin - unlimited everything
    plan: 'pro',
    planExpiresAt: null,         // Admin never expires
    description: 'Extension owner - full admin access, unlimited features',
  },
  {
    email: 'testpro@example.com',
    displayName: 'Pro User',
    userId: 'USR@00002',
    role: 'user',
    plan: 'pro',
    planExpiresAt: futureDate(365),  // Pro for 1 year
    planId: 'yearly',
    description: 'Regular user with yearly Pro subscription',
  },
  {
    email: 'testpro-monthly@example.com',
    displayName: 'Monthly Pro',
    userId: 'USR@00003',
    role: 'user',
    plan: 'pro',
    planExpiresAt: futureDate(30),   // Pro for 1 month
    planId: 'monthly',
    description: 'Regular user with monthly Pro subscription',
  },
  {
    email: 'testfree@example.com',
    displayName: 'Free User',
    userId: 'USR@00004',
    role: 'user',
    plan: 'free',
    planExpiresAt: null,
    description: 'Regular user on free plan (3 apps/day, 3 HR msgs/day)',
  },
  {
    email: 'testexpired@example.com',
    displayName: 'Expired Pro',
    userId: 'USR@00005',
    role: 'user',
    plan: 'pro',
    planExpiresAt: pastDate(7),      // Expired 7 days ago
    planId: 'monthly',
    description: 'User whose Pro plan expired (should revert to free on next check)',
  },
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return admin.firestore.Timestamp.fromDate(d);
}

function pastDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return admin.firestore.Timestamp.fromDate(d);
}

// ============================================================
// MAIN SEED FUNCTION
// ============================================================

async function seedUsers() {
  console.log('🌱 Seeding Firestore users...\n');

  let maxUserNumber = 0;

  for (const testUser of TEST_USERS) {
    const { email, description, ...userData } = testUser;

    try {
      // Find the user by email in Auth
      let authUser;
      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          console.log(`⚠️  ${email} — Auth account not found. User must sign up first.`);
          console.log(`   Config: ${description}`);
          console.log(`   Assigned ID: ${userData.userId}\n`);
          continue;
        }
        throw e;
      }

      // Build the Firestore document
      const docData = {
        userId: userData.userId,
        email: email,
        displayName: userData.displayName,
        role: userData.role,
        plan: userData.plan,
        planExpiresAt: userData.planExpiresAt || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (userData.planId) {
        docData.planId = userData.planId;
      }

      if (userData.plan === 'pro' && userData.planExpiresAt) {
        docData.planActivatedAt = admin.firestore.FieldValue.serverTimestamp();
      }

      // Update (merge) the user document
      await db.collection('users').doc(authUser.uid).set(docData, { merge: true });

      // Track highest user number for counter
      const num = parseInt(userData.userId.split('@')[1]);
      if (num > maxUserNumber) maxUserNumber = num;

      const roleIcon = userData.role === 'admin' ? '👑' : '👤';
      const planIcon = userData.plan === 'pro' ? '⭐' : '🆓';
      console.log(`✅ ${roleIcon} ${planIcon} ${userData.userId} — ${email}`);
      console.log(`   Role: ${userData.role} | Plan: ${userData.plan} | ${description}\n`);

    } catch (error) {
      console.error(`❌ ${email} — Error: ${error.message}\n`);
    }
  }

  // Update the system counter to match the highest seeded user number
  if (maxUserNumber > 0) {
    const counterRef = db.collection('system').doc('counters');
    const counterDoc = await counterRef.get();
    const currentCount = counterDoc.exists ? (counterDoc.data().userCount || 0) : 0;

    if (maxUserNumber > currentCount) {
      await counterRef.set({ userCount: maxUserNumber }, { merge: true });
      console.log(`📊 Updated system counter: userCount = ${maxUserNumber}`);
    } else {
      console.log(`📊 System counter already at ${currentCount} (no update needed)`);
    }
  }

  console.log('\n✨ Seeding complete!\n');
  console.log('═══════════════════════════════════════════════════════');
  console.log('FIRESTORE SCHEMA');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Collection: users/{firebaseAuthUID}');
  console.log('─────────────────────────────────────────────────────');
  console.log(JSON.stringify({
    userId: "USR@00001 (typed sequential ID)",
    email: 'string',
    displayName: 'string',
    role: "'admin' | 'user'",
    plan: "'free' | 'pro'",
    planExpiresAt: 'Timestamp | null',
    planId: "'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | null",
    planActivatedAt: 'Timestamp | null',
    createdAt: 'Timestamp',
    updatedAt: 'Timestamp',
  }, null, 2));
  console.log('\nCollection: system/counters');
  console.log('─────────────────────────────────────────────────────');
  console.log(JSON.stringify({
    userCount: "number (last assigned user number, e.g. 5 → next user gets USR@00006)",
  }, null, 2));
}

seedUsers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
