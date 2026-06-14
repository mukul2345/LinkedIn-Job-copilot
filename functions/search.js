/**
 * searchJobs Cloud Function
 *
 * POST /searchJobs
 * Body: { query, boards[], location?, jobType?, datePosted?, page? }
 * Auth: Bearer token required
 * Timeout: 60s
 *
 * Orchestrates multi-board job search:
 * 1. Validates auth and input
 * 2. Calls Python scraper service
 * 3. Normalizes and deduplicates results
 * 4. Stores in Firestore
 * 5. Returns paginated response
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { normalizeJobRecord } = require('./lib/normalization');
const { deduplicateJobs } = require('./lib/deduplication');

// Ensure admin is initialized (may already be from index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:8080';

const VALID_BOARDS = ['linkedin', 'indeed', 'glassdoor', 'naukri', 'uplers', 'adzuna'];

const PAGE_SIZE = 20;

/**
 * Map datePosted filter values to hours_old for scraper service.
 * @param {string|undefined} datePosted - Filter value from client
 * @returns {number|undefined} hours_old value or undefined
 */
function mapDatePostedToHoursOld(datePosted) {
  const mapping = {
    '24h': 24,
    'week': 168,
    'month': 720,
  };
  return mapping[datePosted] || undefined;
}

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
 * Generate a request ID (simple unique string).
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

/**
 * Validate search input.
 * @param {string} query - Search query
 * @param {string[]} boards - Selected boards
 * @returns {{valid: boolean, error?: string}}
 */
function validateInput(query, boards) {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Search query is required.' };
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2 || trimmedQuery.length > 200) {
    return {
      valid: false,
      error: 'Please enter a search query (2-200 characters) and select at least one job board.',
    };
  }

  if (!Array.isArray(boards) || boards.length === 0) {
    return {
      valid: false,
      error: 'Please enter a search query (2-200 characters) and select at least one job board.',
    };
  }

  const invalidBoards = boards.filter((b) => !VALID_BOARDS.includes(b));
  if (invalidBoards.length > 0) {
    return {
      valid: false,
      error: `Invalid boards: ${invalidBoards.join(', ')}. Valid options: ${VALID_BOARDS.join(', ')}.`,
    };
  }

  return { valid: true };
}

/**
 * Call the Python scraper service.
 * @param {Object} params - Scraper parameters
 * @param {string} params.query - Search query
 * @param {string[]} params.boards - Boards to scrape
 * @param {string} [params.location] - Location filter
 * @param {number} [params.results_wanted] - Max results
 * @param {number} [params.hours_old] - Filter by posting age
 * @returns {Promise<Object>} Scraper response
 */
async function callScraper({ query, boards, location, results_wanted, hours_old }) {
  const payload = { query, boards };

  if (location) payload.location = location;
  if (results_wanted) payload.results_wanted = results_wanted;
  if (hours_old) payload.hours_old = hours_old;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000); // 50s timeout for scraper call

  try {
    const response = await fetch(`${SCRAPER_SERVICE_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 503) {
        throw new Error('SERVICE_UNAVAILABLE');
      }
      throw new Error(`Scraper returned ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * searchJobs Cloud Function handler.
 * Exported for use in functions/index.js.
 */
const searchJobs = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
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
    const { query, boards, location, jobType, datePosted, page } = req.body || {};

    const validation = validateInput(query, boards);
    if (!validation.valid) {
      return sendError(res, 400, 'INVALID_REQUEST', validation.error, requestId);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const resultsWanted = Math.min(100, 100); // Cap at 100
    const hoursOld = mapDatePostedToHoursOld(datePosted);

    // --- Call scraper service ---
    let scraperResponse;
    try {
      scraperResponse = await callScraper({
        query: query.trim(),
        boards,
        location,
        results_wanted: resultsWanted,
        hours_old: hoursOld,
      });
    } catch (err) {
      if (err.message === 'SERVICE_UNAVAILABLE') {
        return sendError(
          res,
          503,
          'SERVICE_UNAVAILABLE',
          'Job search service is temporarily down.',
          requestId
        );
      }
      if (err.name === 'AbortError') {
        return sendError(
          res,
          408,
          'REQUEST_TIMEOUT',
          'Some boards took too long to respond.',
          requestId
        );
      }
      console.error(`[searchJobs] Scraper error (requestId=${requestId}):`, err.message);
      return sendError(
        res,
        503,
        'SERVICE_UNAVAILABLE',
        'Job search service is temporarily down.',
        requestId
      );
    }

    // --- Normalize results ---
    const rawJobs = scraperResponse.jobs || [];
    const failedBoards = scraperResponse.failed_boards || [];

    const normalizedJobs = [];
    for (const rawJob of rawJobs) {
      const board = rawJob.source_board || rawJob.sourceBoard || 'indeed';
      try {
        const normalized = normalizeJobRecord(rawJob, board);
        normalized.searchId = requestId;
        normalized.retrievedAt = new Date().toISOString();
        normalizedJobs.push(normalized);
      } catch (err) {
        // Skip jobs that fail normalization
        console.error(`[searchJobs] Normalization failed (requestId=${requestId}):`, err.message);
      }
    }

    // --- Deduplicate ---
    const uniqueJobs = deduplicateJobs(normalizedJobs);

    // --- Firestore batch write ---
    try {
      const db = admin.firestore();
      const jobsCollectionPath = `users/${userId}/jobs`;

      // Firestore batch write limit is 500 operations
      const batchSize = 500;
      for (let i = 0; i < uniqueJobs.length; i += batchSize) {
        const batch = db.batch();
        const chunk = uniqueJobs.slice(i, i + batchSize);

        for (const job of chunk) {
          const docRef = db.collection(jobsCollectionPath).doc(job.id);
          batch.set(docRef, {
            ...job,
            retrievedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        await batch.commit();
      }
    } catch (err) {
      // Log but don't fail the request - still return results to user
      console.error(`[searchJobs] Firestore write error (requestId=${requestId}):`, err.message);
    }

    // --- Paginated response ---
    const total = uniqueJobs.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(pageNum, totalPages);
    const startIdx = (safePage - 1) * PAGE_SIZE;
    const pageJobs = uniqueJobs.slice(startIdx, startIdx + PAGE_SIZE);

    return res.status(200).json({
      ok: true,
      data: {
        jobs: pageJobs,
        total,
        page: safePage,
        totalPages,
        failedBoards: failedBoards.map((fb) => ({
          board: fb.board,
          error: fb.error || 'Unknown error',
        })),
      },
      meta: { requestId },
    });
  });

module.exports = { searchJobs, validateInput, mapDatePostedToHoursOld, VALID_BOARDS, PAGE_SIZE };
