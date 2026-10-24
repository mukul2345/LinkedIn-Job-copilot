/**
 * checkAndConsumeQuota Cloud Function
 *
 * POST /checkAndConsumeQuota
 * Body: { type: 'application' | 'outreach', idempotencyKey?: string }
 * Application requests require a stable idempotencyKey so retrying the same
 * final-submit attempt cannot consume quota more than once.
 * Auth: Bearer token required
 *
 * Enforces plan-based monthly quotas for job applications and HR/recruiter
 * outreach. The read-check-increment is performed inside a Firestore
 * transaction so concurrent calls cannot race past the limit or bypass it.
 *
 * Usage is stored on the single per-user document (users/{uid}) under a
 * `usage` map keyed by type, alongside the period it belongs to:
 *
 *   usage: {
 *     period: '2026-08',
 *     application: 7,
 *     outreach: 3,
 *     applicationAttempts: { 'linkedin:123': '2026-08-30T10:00:00.000Z' },
 *   }
 *
 * When the stored period no longer matches the current month, the counters
 * are reset to zero (auto-reset on the 1st of the month).
 *
 * Fails CLOSED: any error reading plan/usage results in { allowed: false }.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Ensure admin is initialized (may already be from index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

const VALID_TYPES = ['application', 'outreach'];

/**
 * Monthly quota limits per plan and quota type.
 * Applications and outreach are tracked separately.
 */
const MONTHLY_LIMITS = {
  free: { application: 10, outreach: 10 },
  pro: { application: 50, outreach: 50 },
};

/**
 * Set CORS headers on the response.
 * @param {Object} res - Express-like response object
 */
function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id');
}

/**
 * Build a standardized error response matching the shared API envelope.
 * @param {Object} res - Response object
 * @param {number} status - HTTP status code
 * @param {string} code - Error code
 * @param {string} message - Human-readable error message
 * @param {string} requestId - Request correlation ID
 */
function sendError(res, status, code, message, requestId) {
  return res.status(status).json({
    ok: false,
    error: { code, message },
    meta: { requestId },
  });
}

/**
 * Current billing period key in the form YYYY-MM (UTC).
 * @param {Date} [now] - Reference date (defaults to now)
 * @returns {string}
 */
function getCurrentPeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Resolve the monthly limit for a plan/type combination.
 * Unknown plans fall back to the free tier (fail safe — never grant Pro limits).
 * @param {string} plan - 'free' | 'pro'
 * @param {string} type - 'application' | 'outreach'
 * @returns {number}
 */
function resolveLimit(plan, type) {
  const planLimits = MONTHLY_LIMITS[plan] || MONTHLY_LIMITS.free;
  return planLimits[type];
}

/**
 * Read the caller's plan and usage, then atomically consume one unit of the
 * given quota type if the limit has not been reached.
 *
 * Runs entirely inside a Firestore transaction to prevent concurrent calls
 * from bypassing the limit.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {string} type - 'application' | 'outreach'
 * @param {boolean} [isAdmin]
 * @param {string|null} [idempotencyKey]
 * @returns {Promise<{allowed: boolean, used: number, limit: number, plan: string, idempotent?: boolean}>}
 */
async function consumeQuota(db, uid, type, isAdmin = false, idempotencyKey = null) {
  const userRef = db.collection('users').doc(uid);
  const period = getCurrentPeriod();

  if (isAdmin) {
    return {
      allowed: true,
      used: 0,
      limit: Number.MAX_SAFE_INTEGER,
      plan: 'pro',
      period,
      quotaPeriod: 'month',
    };
  }

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(userRef);

    // Fail closed: if the user document is missing we cannot verify the plan.
    if (!snapshot.exists) {
      throw new Error('USER_NOT_FOUND');
    }

    const data = snapshot.data() || {};
    const plan = data.plan === 'pro' ? 'pro' : 'free';
    const limit = resolveLimit(plan, type);

    // Load existing usage, resetting counters when the period has rolled over.
    const existingUsage = data.usage || {};
    const usageForPeriod =
      existingUsage.period === period
        ? existingUsage
        : { period, application: 0, outreach: 0, applicationAttempts: {} };

    const currentCount = usageForPeriod[type] || 0;
    const applicationAttempts = usageForPeriod.applicationAttempts || {};

    // A retried final-submit attempt is authorized without consuming twice.
    if (type === 'application' && applicationAttempts[idempotencyKey]) {
      return {
        allowed: true,
        used: currentCount,
        limit,
        plan,
        period,
        quotaPeriod: 'month',
        idempotent: true,
      };
    }

    // Limit reached — do not consume.
    if (currentCount >= limit) {
      return { allowed: false, used: currentCount, limit, plan, period, quotaPeriod: 'month' };
    }

    const newCount = currentCount + 1;
    const updatedUsage = {
      period,
      application: type === 'application' ? newCount : usageForPeriod.application || 0,
      outreach: type === 'outreach' ? newCount : usageForPeriod.outreach || 0,
      applicationAttempts: type === 'application'
        ? { ...applicationAttempts, [idempotencyKey]: new Date().toISOString() }
        : applicationAttempts,
    };

    tx.set(userRef, { usage: updatedUsage }, { merge: true });

    return { allowed: true, used: newCount, limit, plan, period, quotaPeriod: 'month' };
  });
}

/**
 * checkAndConsumeQuota Cloud Function handler.
 */
const checkAndConsumeQuota = functions.https.onRequest(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  const requestId = req.headers['x-request-id'] || `req_${Date.now().toString(36)}`;
  res.set('x-request-id', requestId);

  if (req.method !== 'POST') {
    return sendError(res, 405, 'INVALID_REQUEST', 'Method not allowed. Use POST.', requestId);
  }

  // --- Auth validation (reject unauthenticated calls) ---
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
  }

  let uid;
  let hasAdminClaim = false;
  try {
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    uid = decodedToken.uid;
    hasAdminClaim = decodedToken.admin === true;
  } catch (err) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
  }

  // --- Input validation ---
  const { type, idempotencyKey = null } = req.body || {};
  if (!VALID_TYPES.includes(type)) {
    return sendError(
      res,
      400,
      'INVALID_REQUEST',
      `Invalid quota type. Expected one of: ${VALID_TYPES.join(', ')}.`,
      requestId
    );
  }
  if (type === 'application' &&
      (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(idempotencyKey))) {
    return sendError(
      res,
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'A stable application idempotency key is required.',
      requestId
    );
  }

  // --- Read-check-increment inside a transaction ---
  try {
    const db = admin.firestore();
    const result = await consumeQuota(db, uid, type, hasAdminClaim, idempotencyKey);

    return res.status(200).json({
      ok: true,
      data: result,
      meta: { requestId },
    });
  } catch (err) {
    console.error(`[checkAndConsumeQuota] Failed (requestId=${requestId}, type=${type}):`, err.message);

    // Fail closed — deny the action when plan/usage cannot be read reliably.
    return res.status(200).json({
      ok: true,
      data: {
        allowed: false,
        used: 0,
        limit: 0,
        plan: 'unknown',
        errorCode: 'QUOTA_UNAVAILABLE',
      },
      meta: { requestId },
    });
  }
});

module.exports = {
  checkAndConsumeQuota,
  consumeQuota,
  getCurrentPeriod,
  resolveLimit,
  MONTHLY_LIMITS,
  VALID_TYPES,
};
