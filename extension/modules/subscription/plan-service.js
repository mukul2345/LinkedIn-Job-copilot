// plan-service.js - Plan status management and validation
// Handles checking user's plan, caching it locally, and validating expiry.
// NOTE: This file runs in BOTH popup and content script contexts.
// Firebase (getCurrentUser, db) is only available in popup context.

/**
 * Get the user's current plan from local cache.
 * In content scripts, ONLY uses local cache (no Firebase access).
 * In popup contexts, the cached value may be refreshed from Firestore.
 * Cached roles are display metadata only and never grant privileged access.
 * @returns {Promise<{plan: string, expiresAt: Date|null, isActive: boolean, role: string}>}
 */
async function getUserPlanStatus() {
  const cached = await new Promise((resolve) => {
    chrome.storage.local.get(['userPlan', 'planExpiresAt', 'planCachedAt', 'userRole'], resolve);
  });

  // Use cached plan value if available
  if (cached.userPlan) {
    const expiresAt = cached.planExpiresAt ? new Date(cached.planExpiresAt) : null;
    const isActive = cached.userPlan === 'free' || Boolean(expiresAt && expiresAt > new Date());
    return { plan: cached.userPlan || 'free', expiresAt, isActive, role: cached.userRole || 'user' };
  }

  // No cache — try Firestore (only works in popup context where Firebase is loaded)
  if (typeof getCurrentUser === 'function' && typeof db !== 'undefined') {
    return await refreshPlanFromCloud();
  }

  // Default: free plan
  return { plan: 'free', expiresAt: null, isActive: true, role: 'user' };
}

/**
 * Refresh plan status from Firestore and update local cache.
 * Only works in popup context where Firebase is available.
 * @returns {Promise<{plan: string, expiresAt: Date|null, isActive: boolean, role: string}>}
 */
async function refreshPlanFromCloud() {
  try {
    if (typeof getCurrentUser !== 'function' || typeof db === 'undefined') {
      return { plan: 'free', expiresAt: null, isActive: true, role: 'user' };
    }

    const user = getCurrentUser();
    if (!user) {
      return { plan: 'free', expiresAt: null, isActive: true, role: 'user' };
    }

    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists) {
      return { plan: 'free', expiresAt: null, isActive: true, role: 'user' };
    }

    const data = doc.data();
    const role = data.role || 'user';
    const plan = data.plan || 'free';
    const expiresAt = data.planExpiresAt?.toDate() || null;
    const isActive = plan === 'free' || (expiresAt && expiresAt > new Date());

    // If plan expired, revert to free in Firestore
    if (plan === 'pro' && !isActive) {
      await db.collection('users').doc(user.uid).update({ plan: 'free' });
      await cacheUserRoleAndPlan(role, 'free', null);
      return { plan: 'free', expiresAt: null, isActive: true, role };
    }

    // Cache locally
    await cacheUserRoleAndPlan(role, plan, expiresAt);

    return { plan, expiresAt, isActive, role };
  } catch (error) {
    console.warn('[JobPilot] Failed to refresh plan from cloud:', error.message);
    const cached = await new Promise((resolve) => {
      chrome.storage.local.get(['userPlan', 'userRole'], resolve);
    });
    return { plan: cached.userPlan || 'free', expiresAt: null, isActive: true, role: cached.userRole || 'user' };
  }
}

/**
 * Cache user role and plan status locally for quick access.
 */
async function cacheUserRoleAndPlan(role, plan, expiresAt) {
  await new Promise((resolve) => {
    chrome.storage.local.set({
      userRole: role,
      userPlan: plan,
      planExpiresAt: expiresAt ? expiresAt.toISOString() : null,
      planCachedAt: new Date().toISOString(),
    }, resolve);
  });
}

/**
 * Legacy wrapper - kept for backward compatibility
 */
async function cachePlanLocally(plan, expiresAt) {
  const cached = await new Promise(resolve => {
    chrome.storage.local.get('userRole', resolve);
  });
  await cacheUserRoleAndPlan(cached.userRole || 'user', plan, expiresAt);
}

/**
 * Check whether local UI may begin an action. Final count-based authorization
 * always occurs through the server immediately before the irreversible action.
 * Cached roles and daily counters never grant or deny server quota.
 * @param {'applications'|'hrMessages'|'aiAnswers'} action
 * @returns {Promise<{allowed: boolean, reason?: string, current?: number|null, limit?: number}>}
 */
async function canPerformAction(action) {
  const { plan, isActive } = await getUserPlanStatus();
  const effectivePlan = plan === 'pro' && isActive ? 'pro' : 'free';
  const limits = getPlanLimits(effectivePlan);

  if (action === 'aiAnswers') {
    return {
      allowed: limits.aiAnswers,
      reason: limits.aiAnswers ? null : 'AI answers require Pro plan.',
    };
  }

  const limit = action === 'applications'
    ? limits.applicationsPerMonth
    : limits.hrMessagesPerMonth;
  return {
    allowed: true,
    current: null,
    limit,
    reason: 'Monthly quota is verified by the server immediately before the action.',
  };
}

/**
 * Check if the cached plan is an active Pro subscription.
 * Cached role values never upgrade the plan.
 * @returns {Promise<boolean>}
 */
async function isProUser() {
  const { plan, isActive } = await getUserPlanStatus();
  return plan === 'pro' && isActive;
}
