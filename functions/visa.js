/**
 * classifySponsorship Cloud Function
 *
 * POST /classifySponsorship
 * Body: { jobId } or { jobIds: string[] }
 * Auth: Bearer token required
 * Timeout: 5s per job
 *
 * Classifies visa sponsorship status for one or more jobs:
 * 1. Validates auth and input
 * 2. Reads job description(s) from Firestore
 * 3. Applies keyword-based classification with priority logic
 * 4. Falls back to AI for ambiguous cases (placeholder)
 * 5. Updates sponsorship fields on job documents
 * 6. Returns classification results
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {
  classifySponsorshipStatus,
  POSITIVE_INDICATORS,
  NEGATIVE_INDICATORS,
  VISA_RELATED_TERMS,
} = require('./lib/sponsorship');

// Ensure admin is initialized (may already be from index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

// ============================================================
// Helpers (same patterns as search.js)
// ============================================================

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
 * Generate a request ID.
 * @returns {string}
 */
function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Build a standardized error response.
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

// ============================================================
// AI Classification Helper (placeholder)
// ============================================================

/**
 * Classify sponsorship status using AI for ambiguous cases.
 * This is a placeholder that can be replaced with a real AI call.
 *
 * @param {string} description - Full job description text
 * @returns {Promise<string>} - Classification: 'available', 'unlikely', or 'unknown'
 */
async function classifyWithAI(description) {
  // Placeholder: In production, this would call an AI engine
  // (OpenAI/Gemini/DeepSeek) to analyze the ambiguous text.
  // For now, return 'unknown' as a safe default for ambiguous cases.
  return 'unknown';
}

/**
 * Check if the AI engine is currently available.
 * @returns {boolean}
 */
function isAIAvailable() {
  // Placeholder: Check if AI API key is configured and service is reachable.
  // Returns true if the AI engine can be used for classification.
  return Boolean(process.env.AI_API_KEY);
}

// ============================================================
// Cloud Function Handler
// ============================================================

/**
 * Classify a single job with a 5s timeout.
 * @param {string} userId - Authenticated user ID
 * @param {string} jobId - Job document ID
 * @param {boolean} aiAvailable - Whether AI is available
 * @returns {Promise<{jobId: string, status: string, confidence: string} | {jobId: string, error: string}>}
 */
async function classifySingleJob(userId, jobId, aiAvailable) {
  return Promise.race([
    (async () => {
      const db = admin.firestore();
      const jobRef = db.collection(`users/${userId}/jobs`).doc(jobId);
      const jobDoc = await jobRef.get();

      if (!jobDoc.exists) {
        return { jobId, error: 'Job not found' };
      }

      const jobData = jobDoc.data();
      const description = jobData.description || '';

      const result = await classifySponsorshipStatus(
        description,
        aiAvailable,
        aiAvailable ? classifyWithAI : undefined
      );

      // Update the job document with classification results
      await jobRef.update({
        sponsorship: result.status,
        sponsorshipConfidence: result.confidence,
      });

      return { jobId, status: result.status, confidence: result.confidence };
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 5000)
    ),
  ]).catch((err) => {
    if (err.message === 'TIMEOUT') {
      return { jobId, error: 'Classification timed out' };
    }
    return { jobId, error: err.message || 'Classification failed' };
  });
}

/**
 * classifySponsorship Cloud Function handler.
 */
const classifySponsorship = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCorsHeaders(res);

    // Handle preflight OPTIONS
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    // Get or generate request ID
    const requestId = req.headers['x-request-id'] || generateRequestId();
    res.set('x-request-id', requestId);

    // Only accept POST
    if (req.method !== 'POST') {
      return sendError(res, 405, 'INVALID_REQUEST', 'Method not allowed. Use POST.', requestId);
    }

    // --- Auth validation ---
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
    }

    let userId;
    try {
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      userId = decodedToken.uid;
    } catch (err) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
    }

    // --- Input validation ---
    const { jobId, jobIds } = req.body || {};

    // Support single jobId or batch jobIds array
    let idsToProcess = [];

    if (jobIds && Array.isArray(jobIds)) {
      idsToProcess = jobIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
    } else if (jobId && typeof jobId === 'string') {
      idsToProcess = [jobId.trim()];
    }

    if (idsToProcess.length === 0) {
      return sendError(
        res,
        400,
        'INVALID_REQUEST',
        'Provide a jobId string or jobIds array.',
        requestId
      );
    }

    // --- Classify jobs ---
    const aiAvailable = isAIAvailable();
    const results = await Promise.all(
      idsToProcess.map((id) => classifySingleJob(userId, id, aiAvailable))
    );

    // Separate successes from errors
    const classifications = [];
    const errors = [];

    for (const result of results) {
      if (result.error) {
        errors.push({ jobId: result.jobId, error: result.error });
      } else {
        classifications.push({
          jobId: result.jobId,
          status: result.status,
          confidence: result.confidence,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        classifications,
        errors: errors.length > 0 ? errors : undefined,
      },
      meta: { requestId },
    });
  });

module.exports = {
  classifySponsorship,
  classifySponsorshipStatus,
  POSITIVE_INDICATORS,
  NEGATIVE_INDICATORS,
  VISA_RELATED_TERMS,
};
