// firestore-service.js - Centralized Firestore read/write layer for JobPilot AI
// All user data CRUD goes through this module.
// Reads: check cache-manager first, then Firestore on miss.
// Writes: write to Firestore, then update cache on success.

/**
 * Load the full user profile document from Firestore (with cache).
 * Returns the entire user document data.
 * Retries once after a short delay if document not found (handles race condition on signup).
 * @param {string} uid - Firebase Auth UID
 * @returns {Promise<object|null>} User document data or null if not found
 */
async function loadUserProfile(uid) {
  // Check cache first
  const cached = await getCached('fullProfile');
  if (cached) return cached;

  // Cache miss — fetch from Firestore
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) {
      // Doc might not be created yet (race condition on signup) — retry after 1.5s
      await new Promise(r => setTimeout(r, 1500));
      const retryDoc = await db.collection('users').doc(uid).get();
      if (!retryDoc.exists) return null;
      const data = retryDoc.data();
      await cacheFullProfile(data);
      return data;
    }

    const data = doc.data();
    await cacheFullProfile(data);
    return data;
  } catch (err) {
    console.warn('[Firestore Service] Failed to load profile:', err.message);
    return null;
  }
}

/**
 * Cache the full profile and individual sections.
 */
async function cacheFullProfile(data) {
  await setCache('fullProfile', data);
  if (data.profile) await setCache('profile', data.profile);
  if (data.skillMap) await setCache('skillMap', data.skillMap);
  if (data.templates) await setCache('templates', data.templates);
  if (data.preferences) await setCache('preferences', data.preferences);
  if (data.botSettings) await setCache('botSettings', data.botSettings);
  await setCache('plan', { plan: data.plan, planExpiresAt: data.planExpiresAt, role: data.role });
}

/**
 * Save user profile fields (personal info) to Firestore.
 * @param {string} uid - Firebase Auth UID
 * @param {object} profileData - Profile fields (firstName, lastName, phone, etc.)
 * @returns {Promise<boolean>} Success
 */
async function saveUserProfile(uid, profileData) {
  try {
    await db.collection('users').doc(uid).update({
      profile: profileData,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await setCache('profile', profileData);
    await invalidateCache('fullProfile'); // Invalidate full profile so next read gets fresh data
    return true;
  } catch (err) {
    console.error('[Firestore Service] Failed to save profile:', err.message);
    return false;
  }
}

/**
 * Save user preferences (search terms, filters, etc.) to Firestore.
 * @param {string} uid
 * @param {object} prefs - Preferences object
 * @returns {Promise<boolean>}
 */
async function savePreferences(uid, prefs) {
  try {
    await db.collection('users').doc(uid).update({
      preferences: prefs,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await setCache('preferences', prefs);
    await invalidateCache('fullProfile');
    return true;
  } catch (err) {
    console.error('[Firestore Service] Failed to save preferences:', err.message);
    return false;
  }
}

/**
 * Save the user's skill map to Firestore.
 * @param {string} uid
 * @param {object} skillMap - { skillName: yearsOfExperience, ... }
 * @returns {Promise<boolean>}
 */
async function saveSkillMap(uid, skillMap) {
  try {
    await db.collection('users').doc(uid).update({
      skillMap: skillMap,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await setCache('skillMap', skillMap);
    await invalidateCache('fullProfile');
    return true;
  } catch (err) {
    console.error('[Firestore Service] Failed to save skill map:', err.message);
    return false;
  }
}

/**
 * Save message templates to Firestore.
 * @param {string} uid
 * @param {object} templates - { hrMessage, recruiterMessage, coverLetter }
 * @returns {Promise<boolean>}
 */
async function saveTemplates(uid, templates) {
  try {
    await db.collection('users').doc(uid).update({
      templates: templates,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await setCache('templates', templates);
    await invalidateCache('fullProfile');
    return true;
  } catch (err) {
    console.error('[Firestore Service] Failed to save templates:', err.message);
    return false;
  }
}

/**
 * Save bot settings to Firestore.
 * @param {string} uid
 * @param {object} settings - Bot configuration
 * @returns {Promise<boolean>}
 */
async function saveBotSettings(uid, settings) {
  try {
    await db.collection('users').doc(uid).update({
      botSettings: settings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await setCache('botSettings', settings);
    await invalidateCache('fullProfile');
    return true;
  } catch (err) {
    console.error('[Firestore Service] Failed to save bot settings:', err.message);
    return false;
  }
}

/**
 * Append an entry to application history (capped at 500).
 * @param {string} uid
 * @param {object} entry - { jobId, title, company, jobLink, date, status }
 * @returns {Promise<boolean>}
 */
async function appendApplicationHistory(uid, entry) {
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return false;

    let history = doc.data().applicationHistory || [];
    history.push(entry);

    // Cap at 500 entries — remove oldest
    if (history.length > 500) {
      history = history.slice(history.length - 500);
    }

    await db.collection('users').doc(uid).update({
      applicationHistory: history,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    await invalidateCache('fullProfile');
    return true;
  } catch (err) {
    console.error('[Firestore Service] Failed to append history:', err.message);
    return false;
  }
}

/**
 * Get the user's plan status from cache or Firestore.
 * @param {string} uid
 * @returns {Promise<{plan: string, planExpiresAt: Date|null, role: string, isActive: boolean}>}
 */
async function getUserPlanFromFirestore(uid) {
  // Check cache
  const cached = await getCached('plan');
  if (cached) {
    const expiresAt = cached.planExpiresAt ? new Date(cached.planExpiresAt) : null;
    const isActive = cached.plan === 'free' || (expiresAt && expiresAt > new Date());
    return { plan: cached.plan, planExpiresAt: expiresAt, role: cached.role, isActive };
  }

  // Fetch from Firestore
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return { plan: 'free', planExpiresAt: null, role: 'user', isActive: true };

    const data = doc.data();
    const plan = data.plan || 'free';
    const role = data.role || 'user';
    const expiresAt = data.planExpiresAt?.toDate() || null;
    const isActive = plan === 'free' || (expiresAt && expiresAt > new Date());

    await setCache('plan', { plan, planExpiresAt: expiresAt ? expiresAt.toISOString() : null, role });

    return { plan, planExpiresAt: expiresAt, role, isActive };
  } catch (err) {
    console.warn('[Firestore Service] Failed to get plan:', err.message);
    return { plan: 'free', planExpiresAt: null, role: 'user', isActive: true };
  }
}

/**
 * Create an unprivileged initial user document on signup.
 * Admin/custom-claim assignment belongs exclusively to trusted Cloud Functions;
 * extension code is user-controlled and must never grant itself privileges.
 * @param {string} uid
 * @param {string} email
 * @param {string} displayName
 * @param {string} userId - Generated typed ID (USR@XXXXX)
 * @returns {Promise<boolean>}
 */
async function createUserDocument(uid, email, displayName, userId) {
  try {
    await db.collection('users').doc(uid).set({
      userId: userId,
      email: email,
      displayName: displayName,
      role: 'user',
      plan: 'free',
      planExpiresAt: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      profile: {},
      preferences: {},
      skillMap: {},
      templates: {},
      botSettings: {},
      applicationHistory: [],
      usage: {},
      onboardingComplete: false,
    });

    return true;
  } catch (err) {
    console.error('[Firestore Service] Failed to create user document:', err.message);
    return false;
  }
}
