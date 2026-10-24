// api-client.js - Centralized API call wrapper for JobPilot Enhanced Features
// Handles auth tokens, request IDs, structured errors, and retry logic.

// API base URL is defined once by core/runtime-config.js.
if (typeof RuntimeConfig === 'undefined') {
  throw new Error('RuntimeConfig must load before api-client.js.');
}
/**
 * Structured API error with code, message, and request ID.
 * @param {string} code - Error code (e.g. 'UNAUTHORIZED', 'NETWORK_ERROR')
 * @param {string} message - Human-readable error message
 * @param {string} [requestId] - Correlation request ID
 * @param {number|null} [status] - HTTP status when the server returned a response
 * @constructor
 */
// eslint-disable-next-line no-var
var ApiError = (function () {
  function ApiError(code, message, requestId, status) {
    const instance = new Error(message);
    instance.name = 'ApiError';
    instance.code = code;
    instance.message = message;
    instance.requestId = requestId || null;
    instance.status = status ?? null;
    Object.setPrototypeOf(instance, ApiError.prototype);
    return instance;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;
  return ApiError;
})();

/**
 * Default retry configuration per endpoint.
 * Keys are endpoint names; values define max retries, backoff, and retryable status codes.
 */
// eslint-disable-next-line no-var
var RETRY_CONFIG = {
  searchJobs: { maxRetries: 1, backoffMs: [5000], retryOn: [503, 408] },
  tailorResume: { maxRetries: 2, backoffMs: [3000, 6000], retryOn: [502, 503] },
  uploadResume: { maxRetries: 0, backoffMs: [], retryOn: [] },
  computeFitScore: { maxRetries: 1, backoffMs: [3000], retryOn: [502] },
  recomputeScores: { maxRetries: 0, backoffMs: [], retryOn: [] },
  scanGmail: { maxRetries: 0, backoffMs: [], retryOn: [] },
  classifySponsorship: { maxRetries: 1, backoffMs: [2000], retryOn: [502] },
  matchJobsForUser: { maxRetries: 1, backoffMs: [3000], retryOn: [502, 503] },
  matchCurrentJobForUser: { maxRetries: 1, backoffMs: [2000], retryOn: [502, 503] },
  generateAiAssistance: { maxRetries: 0, backoffMs: [], retryOn: [] },
  checkAndConsumeQuota: { maxRetries: 0, backoffMs: [], retryOn: [] },
};

/**
 * Generate a unique request ID for correlation.
 * @returns {string}
 */
function generateRequestId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

/** Get a Firebase token only in extension-owned Firebase contexts. */
async function getAuthToken() {
  try {
    return typeof auth !== 'undefined' && auth.currentUser
      ? await auth.currentUser.getIdToken(false)
      : null;
  } catch (_) {
    return null;
  }
}

/** Parse a backend envelope without assuming JSON on errors. */
async function parseBackendEnvelope(response, requestId) {
  let envelope;
  if (typeof response.text === 'function') {
    const rawBody = await response.text();
    try {
      envelope = rawBody ? JSON.parse(rawBody) : null;
    } catch (cause) {
      throw new ApiError('MALFORMED_RESPONSE', 'Server returned an unreadable response.', requestId, response.status);
    }
  } else if (typeof response.json === 'function') {
    try {
      envelope = await response.json();
    } catch (cause) {
      throw new ApiError('MALFORMED_RESPONSE', 'Server returned an unreadable response.', requestId, response.status);
    }
  }
  if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    throw new ApiError('MALFORMED_RESPONSE', 'Server returned an invalid response.', requestId, response.status);
  }
  return envelope;
}

/** Send an authenticated request through the service worker from content scripts. */
async function proxyBackendRequest(endpoint, body) {
  const message = MessageProtocol.create(MessageType.BACKEND_REQUEST, { endpoint, body });
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new ApiError(
      response?.error?.code || 'NETWORK_ERROR',
      response?.error?.message || 'Backend request failed.',
      response?.meta?.requestId,
      response?.error?.status
    );
  }
  return response.data;
}

/** Sleep for API retry backoffs. */
function apiSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Centralized API call wrapper with auth, request ID, and retry logic.
 *
 * @param {string} endpoint - Cloud Function name (e.g. 'searchJobs')
 * @param {Object} body - Request payload
 * @param {Object} [options] - Optional overrides
 * @param {number} [options.maxRetries] - Override default retry count
 * @param {number[]} [options.backoffMs] - Override backoff intervals
 * @param {number[]} [options.retryOn] - Override retryable status codes
 * @returns {Promise<Object>} - Response data from the backend
 * @throws {ApiError} - Structured error with code, message, requestId
 */
async function callBackend(endpoint, body, options = {}) {
  if (!MessageProtocol.allowedBackendEndpoints.includes(endpoint) || !body || typeof body !== 'object') {
    throw new ApiError('INVALID_REQUEST', 'Unsupported backend request.');
  }
  // Content scripts proxy through the worker and never receive Firebase tokens.
  if (typeof auth === 'undefined') return proxyBackendRequest(endpoint, body);

  const token = await getAuthToken();
  if (!token) throw new ApiError('UNAUTHORIZED', 'Not signed in. Please log in to continue.', null, 401);

  const requestId = generateRequestId();
  const config = RETRY_CONFIG[endpoint] || { maxRetries: 0, backoffMs: [], retryOn: [] };
  const maxRetries = options.maxRetries ?? config.maxRetries;
  const backoffMs = options.backoffMs ?? config.backoffMs;
  const retryOn = options.retryOn ?? config.retryOn;
  const timeoutMs = options.timeoutMs ?? RuntimeConfig.defaults.requestTimeoutMs;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(RuntimeConfig.buildEndpointUrl(endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-request-id': requestId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const envelope = await parseBackendEnvelope(response, requestId);
      if (!response.ok || !envelope.ok) {
        const status = response.status;
        const code = status === 401 || status === 403 ? 'UNAUTHORIZED'
          : status === 429 ? 'RATE_LIMITED'
            : envelope.error?.code || 'HTTP_ERROR';
        const error = new ApiError(code, envelope.error?.message || 'Backend request failed.', envelope.meta?.requestId || requestId, status);
        if (retryOn.includes(status) && attempt < maxRetries) {
          lastError = error;
          await apiSleep(backoffMs[attempt] || 1000);
          continue;
        }
        throw error;
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error?.name === 'AbortError'
        ? new ApiError('TIMEOUT', 'Server request timed out.', requestId)
        : new ApiError('NETWORK_ERROR', 'Unable to reach server. Check your connection.', requestId);
      if (attempt >= maxRetries) throw lastError;
      await apiSleep(backoffMs[attempt] || 1000);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || new ApiError('UNKNOWN_ERROR', 'Request failed.', requestId);
}

/**
 * Check and consume one unit of a plan-based monthly quota.
 *
 * Delegates to the checkAndConsumeQuota Cloud Function, which performs the
 * read-check-increment atomically inside a Firestore transaction. This is the
 * single source of truth for quota enforcement — the extension must never
 * increment counters locally.
 *
 * For all users, including admins, authorization is decided by the server from
 * the verified Firebase token and Firestore role. Client storage is never an
 * authority for privilege decisions.
 *
 * Fails CLOSED: any network/auth error resolves to { allowed: false } with an
 * errorCode so callers can show a service error rather than a payment prompt.
 *
 * @param {'application'|'outreach'} type - Quota bucket to consume
 * @param {string} [idempotencyKey] - Stable application attempt key
 * @returns {Promise<{allowed: boolean, used: number, limit: number, plan: string, idempotent?: boolean, errorCode?: string}>}
 */
async function consumeQuota(type, idempotencyKey) {
  if (type === 'application' &&
      (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(idempotencyKey))) {
    return {
      allowed: false,
      used: 0,
      limit: 0,
      plan: 'unknown',
      errorCode: 'INVALID_IDEMPOTENCY_KEY',
    };
  }
  try {
    const request = { type };
    if (idempotencyKey) request.idempotencyKey = idempotencyKey;
    const result = await callBackend('checkAndConsumeQuota', request);
    return {
      allowed: Boolean(result.allowed),
      used: result.used ?? 0,
      limit: result.limit ?? 0,
      plan: result.plan || 'free',
      ...(result.period ? { period: result.period } : {}),
      ...(result.quotaPeriod ? { quotaPeriod: result.quotaPeriod } : {}),
      ...(result.idempotent ? { idempotent: true } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    };
  } catch (err) {
    console.warn('[JobPilot API] Quota check failed, failing closed:', err.message);
    return {
      allowed: false,
      used: 0,
      limit: 0,
      plan: 'unknown',
      errorCode: err.code || 'QUOTA_CHECK_FAILED',
    };
  }
}
