const admin = require('firebase-admin');
const path = require('path');
const sa = require(path.join(__dirname, 'service-account-key.json'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function check() {
  const user = await admin.auth().getUserByEmail('mukul798348@gmail.com');
  console.log('Auth UID:', user.uid);
  console.log('Display Name:', user.displayName);
  
  const doc = await db.collection('users').doc(user.uid).get();
  if (doc.exists) {
    const data = doc.data();
    console.log('\nFirestore document:');
    console.log('  userId:', data.userId);
    console.log('  email:', data.email);
    console.log('  role:', data.role);
    console.log('  plan:', data.plan);
    console.log('  planExpiresAt:', data.planExpiresAt);
  } else {
    console.log('NO Firestore document found for this UID!');
  }
}

check().then(() => process.exit(0)).catch(e => { console.error('Error:', e.message); process.exit(1); });
