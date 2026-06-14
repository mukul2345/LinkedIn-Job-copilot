// api-client.js - Centralized API call wrapper for JobPilot Enhanced Features
// Handles auth tokens, request IDs, structured errors, and retry logic.

/**
 * Base URL for Firebase Cloud Functions.
 * Toggle USE_LOCAL_FUNCTIONS to test with local emulators.
 * Set to false before deploying to production.
 */
// eslint-disable-next-line no-var
var USE_LOCAL_FUNCTIONS = false;
// eslint-disable-next-line no-var
var API_BASE_URL = USE_LOCAL_FUNCTIONS
  ? 'http://localhost:5001/linkedin-jobcopilot/us-central1'
  : 'https://us-central1-linkedin-jobcopilot.cloudfunctions.net';
/**
 * Structured API error with code, message, and request ID.
 * @param {string} code - Error code (e.g. 'UNAUTHORIZED', 'NETWORK_ERROR')
 * @param {string} message - Human-readable error message
 * @param {string} [requestId] - Correlation request ID
 * @constructor
 */
// eslint-disable-next-line no-var
var ApiError = (function () {
  function ApiError(code, message, requestId) {
    const instance = new Error(message);
    instance.name = 'ApiError';
    instance.code = code;
    instance.message = message;
    instance.requestId = requestId || null;
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

/**
 * Get the current user's Firebase Auth ID token.
 * Uses the global `auth` object from Firebase SDK loaded in the extension.
 * @returns {Promise<string|null>}
 */
async function getAuthToken() {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(/* forceRefresh */ false);
  } catch (err) {
    console.warn('[JobPilot API] Failed to get auth token:', err.message);
    return null;
  }
}

/**
 * Sleep for a given number of milliseconds (no jitter — used for API retry backoffs).
 * Named differently from the content-script sleep() to avoid overwriting.
 * @param {number} ms
 * @returns {Promise<void>}
 */
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
  const token = await getAuthToken();
  if (!token) {
    throw new ApiError('UNAUTHORIZED', 'Not signed in. Please log in to continue.');
  }

  const requestId = generateRequestId();
  const config = RETRY_CONFIG[endpoint] || { maxRetries: 0, backoffMs: [], retryOn: [] };
  const maxRetries = options.maxRetries ?? config.maxRetries;
  const backoffMs = options.backoffMs ?? config.backoffMs;
  const retryOn = options.retryOn ?? config.retryOn;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-request-id': requestId,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.ok) {
        const errorCode = result.error?.code || 'UNKNOWN_ERROR';
        const errorMessage = result.error?.message || 'An unexpected error occurred.';
        const responseRequestId = result.meta?.requestId || requestId;

        // Check if this status code is retryable
        if (retryOn.includes(response.status) && attempt < maxRetries) {
          lastError = new ApiError(errorCode, errorMessage, responseRequestId);
          await apiSleep(backoffMs[attempt] || 1000);
          continue;
        }

        throw new ApiError(errorCode, errorMessage, responseRequestId);
      }

      return result.data;
    } catch (err) {
      if (err instanceof ApiError) {
        // ApiError from a non-OK response — check if the HTTP status is retryable
        // Note: err.code is a string like 'UNKNOWN_ERROR', not a status code.
        // We should always retry ApiErrors if we haven't exhausted retries,
        // since the retryOn check already happened in the response handling above.
        if (attempt >= maxRetries) {
          throw err;
        }
        lastError = err;
      } else {
        // Network or parsing error — always retryable
        lastError = new ApiError(
          'NETWORK_ERROR',
          'Unable to reach server. Check your connection.',
          requestId
        );
        if (attempt >= maxRetries) {
          throw lastError;
        }
      }

      // Wait before retrying
      if (attempt < maxRetries) {
        await apiSleep(backoffMs[attempt] || 1000);
      }
    }
  }

  // Should not reach here, but just in case
  throw lastError || new ApiError('UNKNOWN_ERROR', 'Request failed after retries.', requestId);
}
