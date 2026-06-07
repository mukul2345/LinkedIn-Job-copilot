// plan-service.js - Plan status management and validation
// Handles checking user's plan, caching it locally, and validating expiry.
// NOTE: This file runs in BOTH popup and content script contexts.
// Firebase (getCurrentUser, db) is only available in popup context.

/**
 * Get the user's current plan from local cache.
 * In content scripts, ONLY uses local cache (no Firebase access).
 * In popup, can refresh from Firestore if cache is stale.
 * Admin users always get unlimited Pro access.
 * @returns {Promise<{plan: string, expiresAt: Date|null, isActive: boolean, role: string}>}
 */
async function getUserPlanStatus() {
  // Check cached role first (works in both popup and content script)
  const cached = await new Promise((resolve) => {
    chrome.storage.local.get(['userPlan', 'planExpiresAt', 'planCachedAt', 'userRole'], resolve);
  });

  // Admin role = unlimited Pro, no expiry
  if (cached.userRole === USER_ROLES.ADMIN) {
    return { plan: 'pro', expiresAt: null, isActive: true, role: 'admin' };
  }

  // Use cached plan value if available
  if (cached.userPlan) {
    const expiresAt = cached.planExpiresAt ? new Date(cached.planExpiresAt) : null;
    const isActive = cached.userPlan === 'free' || (expiresAt && expiresAt > new Date());
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

    // Admin users always have active Pro
    if (role === USER_ROLES.ADMIN) {
      await cacheUserRoleAndPlan(role, 'pro', null);
      return { plan: 'pro', expiresAt: null, isActive: true, role };
    }

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
 * Check if user can perform a specific action.
 * Returns { allowed, reason } — if not allowed, reason explains why.
 * Admin users always have unlimited access.
 * @param {'applications'|'hrMessages'|'aiAnswers'} action
 * @returns {Promise<{allowed: boolean, reason?: string, current?: number, limit?: number|string}>}
 */
async function canPerformAction(action) {
  // Check cached role — admin bypasses all limits
  const cached = await new Promise(resolve => {
    chrome.storage.local.get('userRole', resolve);
  });
  if (cached.userRole === USER_ROLES.ADMIN) {
    return { allowed: true, current: 0, limit: '∞' };
  }

  const { plan } = await getUserPlanStatus();
  const limits = getPlanLimits(plan);

  // AI answers check (boolean, not count-based)
  if (action === 'aiAnswers') {
    return {
      allowed: limits.aiAnswers,
      reason: limits.aiAnswers ? null : 'AI answers require Pro plan.',
    };
  }

  // Count-based checks
  const result = await checkUsageLimit(action, limits);
  if (!result.allowed) {
    return {
      allowed: false,
      reason: `Daily ${action === 'applications' ? 'application' : 'HR message'} limit reached (${result.limit}/day). Upgrade to Pro for unlimited.`,
      current: result.current,
      limit: result.limit,
    };
  }

  return { allowed: true, current: result.current, limit: result.limit };
}

/**
 * Check if user is on Pro plan (or is admin).
 * @returns {Promise<boolean>}
 */
async function isProUser() {
  const { plan, isActive, role } = await getUserPlanStatus();
  if (role === USER_ROLES.ADMIN) return true;
  return plan === 'pro' && isActive;
}
