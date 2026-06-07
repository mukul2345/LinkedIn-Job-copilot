// sync-service.js - Cloud sync logic for user data
// Handles loading user settings from Firestore into chrome.storage.local.

/**
 * Load all user settings from Firestore into chrome.storage.local.
 * Called on login to restore user's saved configuration.
 * Has a 10-second timeout to prevent blocking the UI.
 */
async function loadUserDataFromCloud() {
  const user = getCurrentUser();
  if (!user) return;

  const userRef = db.collection('users').doc(user.uid);

  try {
    const sections = ['profile', 'search', 'questions', 'botSettings'];
    const localData = {};

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cloud load timeout')), 10000)
    );

    const loadPromise = (async () => {
      for (const section of sections) {
        const doc = await userRef.collection('settings').doc(section).get();
        if (doc.exists) {
          const data = doc.data();
          delete data.updatedAt;
          Object.assign(localData, data);
        }
      }

      // Also load today's stats from Firestore if available
      const today = new Date().toISOString().split('T')[0];
      const statsDoc = await userRef.collection('dailyStats').doc(today).get();
      if (statsDoc.exists) {
        const stats = statsDoc.data();
        const usageKey = `usage_${today}`;
        localData[usageKey] = {
          applications: stats.applications || 0,
          hrMessages: stats.hrMessages || 0,
        };
        // Also set the display counters
        localData.appliedCount = stats.applications || 0;
        localData.skippedCount = stats.skipped || 0;
        localData.failedCount = stats.failed || 0;
      }

      return localData;
    })();

    const result = await Promise.race([loadPromise, timeoutPromise]);

    if (Object.keys(result).length > 0) {
      await new Promise(resolve => chrome.storage.local.set(result, resolve));
      console.log('[JobPilot] Loaded user data from cloud.');
      return true;
    }

    return false;
  } catch (error) {
    console.warn('[JobPilot] Cloud load skipped:', error.message);
    return false;
  }
}
