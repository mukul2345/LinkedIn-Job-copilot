const admin = require('firebase-admin');
const path = require('path');
const sa = require(path.join(__dirname, 'service-account-key.json'));

admin.initializeApp({ credential: admin.credential.cert(sa) });

const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

async function setRules() {
  const securityRules = admin.securityRules();
  
  // First, list current rulesets to see what's active
  console.log('📋 Checking current rules...');
  try {
    const rulesets = await securityRules.listRulesets();
    console.log(`   Found ${rulesets.rulesets.length} existing rulesets`);
  } catch (e) {
    console.log('   Could not list rulesets:', e.message);
  }

  console.log('\n🔧 Publishing new rules...');
  console.log('   Rule: Allow all read/write for authenticated users\n');
  
  try {
    await securityRules.releaseFirestoreRulesetFromSource(rules);
    console.log('✅ Firestore rules published successfully!');
    console.log('\n   Any authenticated user can now read/write any document.');
    console.log('   This is permissive — tighten it later for production.');
    console.log('\n⚡ Now reload the extension and log in again.');
  } catch (error) {
    console.error('❌ Failed:', error.message);
    
    if (error.message.includes('PERMISSION_DENIED') || error.message.includes('permission')) {
      console.log('\n🔑 Your service account needs the "Firebase Rules Admin" role.');
      console.log('   Go to: https://console.cloud.google.com/iam-admin/iam?project=linkedin-jobcopilot');
      console.log('   Find your service account and add role: "Firebase Rules Admin"');
      console.log('\n   OR set rules manually:');
      console.log('   1. Go to https://console.firebase.google.com/project/linkedin-jobcopilot/firestore/rules');
      console.log('   2. Paste this:\n');
      console.log(rules);
    } else {
      console.log('\n📋 Set rules manually:');
      console.log('   1. Go to https://console.firebase.google.com/project/linkedin-jobcopilot/firestore/rules');
      console.log('   2. Paste this:\n');
      console.log(rules);
    }
  }
}

setRules().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
