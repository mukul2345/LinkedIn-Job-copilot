// firebase-config.js - Firebase initialization for JobPilot AI
// Uses Firebase compat SDK (loaded via CDN in popup.html)

// Firebase is provided by the bundled compat SDK loaded before this file.
firebase.initializeApp(JOBPILOT_FIREBASE_CONFIG);

// Auth and Firestore references
const auth = firebase.auth();
const db = firebase.firestore();

// ======= LOCAL EMULATOR SUPPORT =======
// Set USE_EMULATORS to true to test with local Firebase emulators.
// Set to false (or remove) before deploying to production.
const USE_EMULATORS = false;

if (USE_EMULATORS) {
  auth.useEmulator('http://localhost:9099');
  db.useEmulator('localhost', 8081);
  console.log('[JobPilot] Using Firebase Emulators (Auth:9099, Firestore:8081)');
}
