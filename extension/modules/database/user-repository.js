// user-repository.js - Firestore CRUD operations for user data
// Saves profile, QA, search preferences, and settings per user in the cloud.

/**
 * Save all user settings to Firestore (cloud backup).
 * Called after any save action in the popup.
 * @param {string} section - 'profile' | 'search' | 'questions' | 'settings' | 'all'
 */
async function saveUserDataToCloud(section = 'all') {
  const user = getCurrentUser();
  if (!user) return; // Not logged in, skip cloud save

  const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
  const userRef = db.collection('users').doc(user.uid);

  try {
    if (section === 'profile' || section === 'all') {
      await userRef.collection('settings').doc('profile').set({
        firstName: data.firstName || '',
        middleName: data.middleName || '',
        lastName: data.lastName || '',
        phoneNumber: data.phoneNumber || '',
        currentCity: data.currentCity || '',
        street: data.street || '',
        state: data.state || '',
        zipcode: data.zipcode || '',
        country: data.country || '',
        ethnicity: data.ethnicity || '',
        gender: data.gender || '',
        disabilityStatus: data.disabilityStatus || '',
        veteranStatus: data.veteranStatus || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    if (section === 'search' || section === 'all') {
      await userRef.collection('settings').doc('search').set({
        searchTerms: data.searchTerms || [],
        searchLocation: data.searchLocation || '',
        datePosted: data.datePosted || '',
        experienceLevel: data.experienceLevel || [],
        jobType: data.jobType || [],
        workStyle: data.workStyle || [],
        easyApplyOnly: data.easyApplyOnly !== false,
        badWords: data.badWords || [],
        blacklistCompanies: data.blacklistCompanies || [],
        currentExperience: data.currentExperience || 3,
        switchNumber: data.switchNumber || 30,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    if (section === 'questions' || section === 'all') {
      await userRef.collection('settings').doc('questions').set({
        yearsOfExperience: data.yearsOfExperience || '',
        requireVisa: data.requireVisa || 'No',
        website: data.website || '',
        linkedInUrl: data.linkedInUrl || '',
        usCitizenship: data.usCitizenship || '',
        desiredSalary: data.desiredSalary || 0,
        currentCtc: data.currentCtc || 0,
        noticePeriod: data.noticePeriod || 0,
        recentEmployer: data.recentEmployer || '',
        confidenceLevel: data.confidenceLevel || '',
        linkedinHeadline: data.linkedinHeadline || '',
        linkedinSummary: data.linkedinSummary || '',
        coverLetter: data.coverLetter || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    if (section === 'settings' || section === 'all') {
      await userRef.collection('settings').doc('botSettings').set({
        pauseBeforeSubmit: data.pauseBeforeSubmit || false,
        followCompanies: data.followCompanies || false,
        messageRecruiter: data.messageRecruiter !== false,
        clickGap: data.clickGap || 2,
        useAI: data.useAI || false,
        aiProvider: data.aiProvider || '',
        aiApiUrl: data.aiApiUrl || '',
        aiModel: data.aiModel || '',
        hrMessageTemplate: data.hrMessageTemplate || '',
        hrDailyLimit: data.hrDailyLimit || 25,
        hrDelayBetween: data.hrDelayBetween || 30,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // Note: aiApiKey is NOT saved to cloud for security
    }

    // Always sync today's usage stats to cloud
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `usage_${today}`;
    const todayUsage = data[usageKey] || { applications: 0, hrMessages: 0 };
    await userRef.collection('dailyStats').doc(today).set({
      applications: todayUsage.applications || 0,
      hrMessages: todayUsage.hrMessages || 0,
      skipped: data.skippedCount || 0,
      failed: data.failedCount || 0,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[JobPilot] Saved ${section} to cloud.`);
  } catch (error) {
    console.error('[JobPilot] Cloud save error:', error);
  }
}

/**
 * Get user's subscription plan from Firestore.
 * @returns {Promise<{plan: string, expiresAt: Date|null}>}
 */
async function getUserPlan() {
  const user = getCurrentUser();
  if (!user) return { plan: 'free', expiresAt: null };

  try {
    const doc = await db.collection('users').doc(user.uid).get();
    if (doc.exists) {
      const data = doc.data();
      return {
        plan: data.plan || 'free',
        expiresAt: data.planExpiresAt?.toDate() || null,
      };
    }
  } catch (error) {
    console.error('[JobPilot] Error fetching plan:', error);
  }

  return { plan: 'free', expiresAt: null };
}

/**
 * Check if user's plan is active (not expired).
 * @returns {Promise<boolean>}
 */
async function isPlanActive() {
  const { plan, expiresAt } = await getUserPlan();
  if (plan === 'free') return true; // Free plan is always active
  if (!expiresAt) return false;
  return expiresAt > new Date();
}
