// firebase-config.js - Firebase initialization for JobPilot AI
// Uses Firebase compat SDK (loaded via CDN in popup.html)

const firebaseConfig = {
  apiKey: "AIzaSyAZFTGy_cgAmrJUHiyDtAFwEVbguf13nVY",
  authDomain: "linkedin-jobcopilot.firebaseapp.com",
  projectId: "linkedin-jobcopilot",
  storageBucket: "linkedin-jobcopilot.firebasestorage.app",
  messagingSenderId: "796475015510",
  appId: "1:796475015510:web:b55d2d2d2a16e7632556f7",
  measurementId: "G-6Q966JZ48W"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

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
