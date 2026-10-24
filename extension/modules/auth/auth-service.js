// auth-service.js - Authentication service for JobPilot AI
// Handles signup, login, logout, forgot password, and auth state

/**
 * Sign up a new user with email and password.
 * @param {string} email
 * @param {string} password
 * @param {string} name - Display name
 * @returns {Promise<{success: boolean, error?: string, user?: object}>}
 */
async function signUpUser(email, password, name) {
  try {
    const credential = await auth.createUserWithEmailAndPassword(email, password);
    const user = credential.user;

    // Set display name
    await user.updateProfile({ displayName: name });

    // Send email verification
    await user.sendEmailVerification();

    // Generate a typed user ID (USR@00001 format)
    const userId = await generateUserId();

    // Create full user document in Firestore with all required fields
    await createUserDocument(user.uid, user.email, name, userId);

    // Cache role and userId locally (for content script access)
    await new Promise(resolve => {
      chrome.storage.local.set({
        userRole: USER_ROLES.USER,
        cachedUserEmail: user.email,
        cachedUserId: userId,
      }, resolve);
    });

    return { success: true, user };
  } catch (error) {
    console.error('[JobPilot Auth] Signup error:', error.code, error.message);
    return { success: false, error: getAuthErrorMessage(error.code) };
  }
}

/**
 * Generate a sequential typed user ID in format: USR@00001
 * Uses a Firestore counter document to ensure uniqueness.
 * @returns {Promise<string>}
 */
async function generateUserId() {
  try {
    const counterRef = db.collection('system').doc('counters');

    // Use a transaction to atomically increment the counter
    const newId = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);

      let nextNumber = 1;
      if (counterDoc.exists) {
        nextNumber = (counterDoc.data().userCount || 0) + 1;
      }

      transaction.set(counterRef, { userCount: nextNumber }, { merge: true });

      // Format: USR@00001 (5-digit zero-padded)
      return `${USER_ID_PREFIX}@${String(nextNumber).padStart(5, '0')}`;
    });

    return newId;
  } catch (error) {
    // Fallback: use timestamp-based ID if transaction fails
    console.warn('[JobPilot] Counter transaction failed, using fallback ID:', error.message);
    const timestamp = Date.now().toString(36).toUpperCase();
    return `${USER_ID_PREFIX}@${timestamp}`;
  }
}

/**
 * Sign in an existing user with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, error?: string, user?: object}>}
 */
async function signInUser(email, password) {
  try {
    const credential = await auth.signInWithEmailAndPassword(email, password);
    return { success: true, user: credential.user };
  } catch (error) {
    return { success: false, error: getAuthErrorMessage(error.code) };
  }
}

/**
 * Sign in with Google popup.
 * @returns {Promise<{success: boolean, error?: string, user?: object}>}
 */
async function signInWithGoogle() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const credential = await auth.signInWithPopup(provider);
    const user = credential.user;

    // Create/update user document
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists) {
      // New user — generate typed ID and create full document
      const userId = await generateUserId();
      await createUserDocument(user.uid, user.email, user.displayName, userId);
      await new Promise(resolve => {
        chrome.storage.local.set({
          userRole: USER_ROLES.USER,
          cachedUserEmail: user.email,
          cachedUserId: userId,
        }, resolve);
      });
    } else {
      // Existing user — cache role and userId from DB
      const data = userDoc.data();
      await new Promise(resolve => {
        chrome.storage.local.set({
          userRole: data.role || USER_ROLES.USER,
          cachedUserEmail: user.email,
          cachedUserId: data.userId || null,
        }, resolve);
      });
    }

    return { success: true, user };
  } catch (error) {
    return { success: false, error: getAuthErrorMessage(error.code) };
  }
}

/**
 * Sign out the current user.
 * Only clears auth-related and session data, NOT user settings.
 * User settings are preserved in Firestore and will be restored on next login.
 */
async function signOutUser() {
  try {
    const uid = auth.currentUser?.uid || null;
    if (typeof removeLegacyLinkedInCredentials === 'function') {
      await removeLegacyLinkedInCredentials(uid);
    } else {
      await new Promise(resolve => chrome.storage.local.remove([
        'linkedinEmail',
        'linkedinPassword',
        'credentialsObfuscated',
        'credentialOwnerUid',
        'pendingAutoLogin',
      ], resolve));
    }

    await auth.signOut();
    // Invalidate all cached user data
    if (typeof invalidateAllCache === 'function') {
      await invalidateAllCache();
    }
    // Clear session/auth/role data from chrome.storage.local
    const keysToRemove = [
      'linkedinEmail', 'linkedinPassword', 'credentialsObfuscated',
      'credentialOwnerUid',
      'userPlan', 'planExpiresAt', 'planCachedAt', 'userRole',
      'cachedUserEmail', 'cachedUserId',
      'botRunning', 'hrBotRunning', 'botState', 'hrBotState',
      'pendingAutoLogin', 'pendingPayment',
      'activityLog', 'onboardingComplete',
    ];
    await new Promise(resolve => chrome.storage.local.remove(keysToRemove, resolve));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send a password reset email.
 * @param {string} email
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function resetPassword(email) {
  try {
    await auth.sendPasswordResetEmail(email);
    return { success: true };
  } catch (error) {
    return { success: false, error: getAuthErrorMessage(error.code) };
  }
}

/**
 * Get the currently signed-in user.
 * @returns {object|null}
 */
function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Listen for auth state changes.
 * @param {function} callback - Called with (user) when auth state changes
 */
function onAuthStateChange(callback) {
  auth.onAuthStateChanged(callback);
}

/**
 * Convert Firebase error codes to user-friendly messages.
 */
function getAuthErrorMessage(code) {
  console.error('[JobPilot Auth] Error code:', code);
  const messages = {
    'auth/email-already-in-use': 'This email is already registered. Try logging in.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password. Try again or reset it.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed.',
    'auth/invalid-credential': 'Invalid credentials. Please check and try again.',
    'auth/operation-not-allowed': 'Email/Password sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method.',
    'auth/unauthorized-domain': 'This domain is not authorized. Add it in Firebase Console → Authentication → Settings → Authorized domains.',
  };
  return messages[code] || `Error: ${code || 'Unknown error'}`;
}
