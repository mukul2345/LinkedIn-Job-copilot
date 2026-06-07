// safety.js - LinkedIn safety limits and subscription expiry alerts
// Protects user's LinkedIn account from being flagged/restricted.

/**
 * LinkedIn Safety Limits (based on community guidelines and known thresholds)
 * These are conservative limits to keep accounts safe.
 */
var LINKEDIN_SAFETY_LIMITS = {
  // Applications per day - LinkedIn may flag accounts above these
  applications: {
    safe: 25,        // Completely safe, no risk
    warning: 50,     // Moderate risk, slow down
    danger: 80,      // High risk, stop immediately
  },
  // Connection requests / DMs per day
  messages: {
    safe: 20,        // Safe for DMs
    warning: 35,     // Getting risky
    danger: 50,      // LinkedIn may restrict messaging
  },
  // Minimum delay between actions (seconds)
  minDelay: {
    betweenApps: 30,     // 30s minimum between applications
    betweenMessages: 45, // 45s minimum between DMs
    betweenPages: 5,     // 5s between page navigations
  },
};

/**
 * Check LinkedIn safety status and return warnings.
 * Called before each action to alert the user.
 * @param {'applications'|'hrMessages'} actionType
 * @returns {Promise<{level: 'safe'|'warning'|'danger', message: string|null, current: number}>}
 */
async function checkLinkedInSafety(actionType) {
  const usage = await getTodayUsage();
  const limits = LINKEDIN_SAFETY_LIMITS[actionType === 'applications' ? 'applications' : 'messages'];
  const current = actionType === 'applications' ? (usage.applications || 0) : (usage.hrMessages || 0);

  if (current >= limits.danger) {
    return {
      level: 'danger',
      message: `⚠️ STOP! You've sent ${current} ${actionType} today. LinkedIn may restrict your account. Stopping for safety.`,
      current,
    };
  }

  if (current >= limits.warning) {
    return {
      level: 'warning',
      message: `⚡ Caution: ${current} ${actionType} today. Approaching LinkedIn's daily limit. Consider stopping soon.`,
      current,
    };
  }

  if (current >= limits.safe) {
    return {
      level: 'warning',
      message: `📊 ${current} ${actionType} today. You're past the safe zone (${limits.safe}). Bot will add extra delays.`,
      current,
    };
  }

  return { level: 'safe', message: null, current };
}

/**
 * Get adaptive delay based on current usage.
 * Increases delay as user approaches limits to reduce detection risk.
 * @param {'applications'|'hrMessages'} actionType
 * @param {number} baseDelay - Base delay in ms from user config
 * @returns {Promise<number>} - Adjusted delay in ms
 */
async function getAdaptiveDelay(actionType, baseDelay) {
  const usage = await getTodayUsage();
  const limits = LINKEDIN_SAFETY_LIMITS[actionType === 'applications' ? 'applications' : 'messages'];
  const current = actionType === 'applications' ? (usage.applications || 0) : (usage.hrMessages || 0);

  // Base minimum delay
  const minDelay = actionType === 'applications'
    ? LINKEDIN_SAFETY_LIMITS.minDelay.betweenApps * 1000
    : LINKEDIN_SAFETY_LIMITS.minDelay.betweenMessages * 1000;

  let delay = Math.max(baseDelay, minDelay);

  // Increase delay as we approach limits
  if (current >= limits.safe) {
    // Add 50% more delay in warning zone
    delay = delay * 1.5;
  }
  if (current >= limits.warning) {
    // Double the delay in danger zone
    delay = delay * 2;
  }

  // Add randomization (±30%) to appear more human
  const jitter = delay * 0.3;
  delay += (Math.random() * jitter * 2) - jitter;

  return Math.round(delay);
}

/**
 * Check subscription expiry and show alerts.
 * Called when extension popup opens.
 * @returns {Promise<{expiring: boolean, daysLeft: number|null, message: string|null}>}
 */
async function checkSubscriptionExpiry() {
  const { plan, expiresAt, isActive, role } = await getUserPlanStatus();

  // Admins never expire
  if (role === USER_ROLES.ADMIN) {
    return { expiring: false, daysLeft: null, message: null };
  }

  // Free users don't have expiry
  if (plan === 'free') {
    return { expiring: false, daysLeft: null, message: null };
  }

  if (!expiresAt) {
    return { expiring: false, daysLeft: null, message: null };
  }

  const now = new Date();
  const expiry = new Date(expiresAt);
  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  // Already expired
  if (daysLeft <= 0) {
    return {
      expiring: true,
      daysLeft: 0,
      message: '⚠️ Your Pro plan has expired. You\'re now on the Free plan (3 apps/day). Renew to continue unlimited access.',
    };
  }

  // Expiring in 1 day
  if (daysLeft <= 1) {
    return {
      expiring: true,
      daysLeft,
      message: '🔔 Your Pro plan expires tomorrow! Renew now to avoid interruption.',
    };
  }

  // Expiring in 3 days
  if (daysLeft <= 3) {
    return {
      expiring: true,
      daysLeft,
      message: `🔔 Your Pro plan expires in ${daysLeft} days. Renew to keep unlimited access.`,
    };
  }

  // Expiring in 7 days
  if (daysLeft <= 7) {
    return {
      expiring: true,
      daysLeft,
      message: `📅 Pro plan expires in ${daysLeft} days.`,
    };
  }

  return { expiring: false, daysLeft, message: null };
}

/**
 * Show a safety alert banner on the LinkedIn page.
 * @param {string} message
 * @param {'warning'|'danger'|'info'} level
 */
function showSafetyAlert(message, level) {
  removeSafetyAlert();

  const colors = {
    warning: { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', text: '#f59e0b' },
    danger: { bg: 'rgba(239, 68, 68, 0.15)', border: '#ef4444', text: '#ef4444' },
    info: { bg: 'rgba(99, 102, 241, 0.15)', border: '#6366f1', text: '#6366f1' },
  };
  const color = colors[level] || colors.info;

  const alert = document.createElement('div');
  alert.id = 'jp-safety-alert';
  alert.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: ${color.bg};
    border: 1px solid ${color.border};
    color: ${color.text};
    padding: 10px 20px;
    border-radius: 8px;
    font-family: -apple-system, sans-serif;
    font-size: 13px;
    font-weight: 500;
    z-index: 99998;
    max-width: 500px;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: jpSlideDown 0.3s ease;
  `;
  alert.textContent = message;

  // Add dismiss button
  const dismiss = document.createElement('span');
  dismiss.textContent = ' ✕';
  dismiss.style.cssText = 'cursor: pointer; margin-left: 10px; opacity: 0.7;';
  dismiss.onclick = removeSafetyAlert;
  alert.appendChild(dismiss);

  // Add animation keyframes
  if (!document.getElementById('jp-safety-styles')) {
    const style = document.createElement('style');
    style.id = 'jp-safety-styles';
    style.textContent = '@keyframes jpSlideDown { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }';
    document.head.appendChild(style);
  }

  document.body.appendChild(alert);

  // Auto-dismiss after 10 seconds for warnings, keep danger alerts
  if (level !== 'danger') {
    setTimeout(removeSafetyAlert, 10000);
  }
}

/**
 * Remove the safety alert banner.
 */
function removeSafetyAlert() {
  const alert = document.getElementById('jp-safety-alert');
  if (alert) alert.remove();
}
