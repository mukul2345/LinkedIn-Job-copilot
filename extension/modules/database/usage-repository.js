// usage-tracker.js - Track daily usage counts for feature gating
// Stores usage in chrome.storage.local with date-based keys.
// Resets automatically each day.

/**
 * Get today's date string (YYYY-MM-DD) for usage tracking.
 * @returns {string}
 */
function getUsageDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get today's usage counts.
 * @returns {Promise<{applications: number, hrMessages: number}>}
 */
async function getTodayUsage() {
  const key = `usage_${getUsageDate()}`;
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => {
      resolve(data[key] || { applications: 0, hrMessages: 0 });
    });
  });
}

/**
 * Increment the application count for today.
 * @returns {Promise<number>} new count
 */
async function incrementApplicationCount() {
  const key = `usage_${getUsageDate()}`;
  const usage = await getTodayUsage();
  usage.applications = (usage.applications || 0) + 1;
  await new Promise((resolve) => {
    chrome.storage.local.set({ [key]: usage }, resolve);
  });
  return usage.applications;
}

/**
 * Increment the HR message count for today.
 * @returns {Promise<number>} new count
 */
async function incrementHRMessageCount() {
  const key = `usage_${getUsageDate()}`;
  const usage = await getTodayUsage();
  usage.hrMessages = (usage.hrMessages || 0) + 1;
  await new Promise((resolve) => {
    chrome.storage.local.set({ [key]: usage }, resolve);
  });
  return usage.hrMessages;
}

/**
 * Check if user can perform an action based on their plan limits.
 * @param {'applications'|'hrMessages'} actionType
 * @param {object} limits - Plan limits from getPlanLimits()
 * @returns {Promise<{allowed: boolean, current: number, limit: number}>}
 */
async function checkUsageLimit(actionType, limits) {
  const usage = await getTodayUsage();
  const current = usage[actionType] || 0;

  let limit;
  if (actionType === 'applications') {
    limit = limits.applicationsPerDay;
  } else if (actionType === 'hrMessages') {
    limit = limits.hrMessagesPerDay;
  } else {
    limit = Infinity;
  }

  return {
    allowed: current < limit,
    current,
    limit: limit === Infinity ? '∞' : limit,
  };
}

/**
 * Clean up old usage data (older than 7 days) to save storage space.
 */
async function cleanupOldUsage() {
  const allData = await new Promise((resolve) => {
    chrome.storage.local.get(null, resolve);
  });

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().split('T')[0];

  const keysToRemove = Object.keys(allData).filter(key => {
    if (!key.startsWith('usage_')) return false;
    const date = key.replace('usage_', '');
    return date < cutoff;
  });

  if (keysToRemove.length > 0) {
    await new Promise((resolve) => {
      chrome.storage.local.remove(keysToRemove, resolve);
    });
  }
}
