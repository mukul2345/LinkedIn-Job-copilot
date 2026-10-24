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
const { SearchSessionRepository } = require('./search-session-repository');
const {
  SearchAiStatus,
  SearchSessionStage,
  SearchSessionStatus,
  SearchSourceState,
} = require('./lib/search-session-contracts');

// Ensure admin is initialized (may already be from index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ||
  (IS_FUNCTIONS_EMULATOR ? 'http://localhost:8080' : '');

// These are the sources implemented by the deployed python-jobspy scraper.
const VALID_BOARDS = ['linkedin', 'indeed', 'glassdoor'];

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
async function callScraper({ query, boards, location, job_type, results_wanted, hours_old }) {
  if (!SCRAPER_SERVICE_URL) {
    throw new Error('SCRAPER_NOT_CONFIGURED');
  }

  const payload = { query, boards };

  if (location) payload.location = location;
  if (job_type) payload.job_type = job_type;
  if (results_wanted) payload.results_wanted = results_wanted;
  if (hours_old) payload.hours_old = hours_old;

  const scrapeUrl = `${SCRAPER_SERVICE_URL}/scrape`;

  // The scraper runs on Cloud Run with --no-allow-unauthenticated, so requests
  // must carry a Google-signed identity token whose audience is the service URL.
  // Without this, Cloud Run rejects the call with 401/403 and search silently
  // reports "temporarily down". Token fetch is best-effort: if it fails (e.g. the
  // service is public in a local/dev setup) we proceed without the header.
  const headers = { 'Content-Type': 'application/json' };
  const identityToken = await getScraperIdentityToken(SCRAPER_SERVICE_URL);
  if (identityToken) {
    headers.Authorization = `Bearer ${identityToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000); // 50s timeout for scraper call

  try {
    const response = await fetch(scrapeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        `[searchJobs] Scraper call failed: status=${response.status} url=${scrapeUrl}`
      );
      const statusCodes = {
        400: 'SCRAPER_INVALID_REQUEST',
        401: 'SCRAPER_AUTHENTICATION_FAILED',
        403: 'SCRAPER_PERMISSION_DENIED',
        404: 'SCRAPER_NOT_FOUND',
        408: 'SCRAPER_TIMEOUT',
        429: 'SCRAPER_RATE_LIMITED',
        500: 'SCRAPER_UNAVAILABLE',
        502: 'SCRAPER_UNAVAILABLE',
        503: 'SCRAPER_UNAVAILABLE',
        504: 'SCRAPER_TIMEOUT',
      };
      const scraperError = new Error(statusCodes[response.status] || 'SCRAPER_UNAVAILABLE');
      scraperError.status = response.status;
      throw scraperError;
    }

    const raw = await response.json();
    return parseScraperPayload(raw);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch a Google-signed OIDC identity token for invoking the private Cloud Run
 * scraper. The token's audience must be the scraper's base URL.
 *
 * Uses the Metadata server available in the Cloud Functions runtime. Returns
 * null on any failure (e.g. running against the local emulator or a public
 * service) so the caller can proceed without auth.
 *
 * @param {string} audience - Scraper base URL (audience of the token)
 * @returns {Promise<string|null>}
 */
async function getScraperIdentityToken(audience) {
  // Don't attempt token minting for local/emulator targets.
  if (!audience || audience.startsWith('http://localhost') || audience.startsWith('http://127.')) {
    return null;
  }

  try {
    const metadataUrl =
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
      `?audience=${encodeURIComponent(audience)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(metadataUrl, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[searchJobs] Identity token fetch returned ${res.status}`);
        return null;
      }
      return (await res.text()).trim();
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn('[searchJobs] Identity token fetch failed:', err.message);
    return null;
  }
}

/**
 * Normalize the scraper's HTTP payload into a flat { jobs, failed_boards } shape.
 *
 * The scraper service wraps its results in a response envelope:
 *   { ok: true, data: { jobs, failed_boards, metadata }, meta: {...} }
 * Earlier/alternate shapes returned jobs at the top level. This helper is the
 * single source of truth for reading the scraper contract, so the handler never
 * needs to know how deeply the payload is nested. (Phase 1 fix: the handler used
 * to read scraperResponse.jobs directly, which is undefined under the enveloped
 * contract — causing every successful search to return zero jobs.)
 *
 * @param {Object} raw - Parsed JSON body from the scraper
 * @returns {{ jobs: Array, failed_boards: Array }}
 */
function parseScraperPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('INVALID_SCRAPER_RESPONSE');
  }

  if (raw.ok === false) {
    throw new Error(raw.error || 'SCRAPER_UNAVAILABLE');
  }

  const container = (raw.data && typeof raw.data === 'object') ? raw.data : raw;
  if (!Array.isArray(container.jobs)) {
    throw new Error('INVALID_SCRAPER_RESPONSE');
  }

  return {
    jobs: container.jobs,
    failed_boards: Array.isArray(container.failed_boards) ? container.failed_boards : [],
  };
}

function paginateJobs(jobs, requestedPage, pageSize = PAGE_SIZE) {
  const total = jobs.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);
  const startIndex = (page - 1) * pageSize;
  return {
    jobs: jobs.slice(startIndex, startIndex + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  };
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
    const { query, boards, location, jobType, datePosted, page, searchSessionId } = req.body || {};

    const validation = validateInput(query, boards);
    if (!validation.valid) {
      return sendError(res, 400, 'INVALID_REQUEST', validation.error, requestId);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const resultsWanted = Math.min(100, 100); // Cap at 100
    const hoursOld = mapDatePostedToHoursOld(datePosted);
    const searchSessionRepository = new SearchSessionRepository({ db: admin.firestore() });

    // Later pages always read the immutable first-search snapshot.
    if (pageNum > 1 && searchSessionId) {
      try {
        const [session, snapshotPage] = await Promise.all([
          searchSessionRepository.get(userId, searchSessionId),
          searchSessionRepository.readResultPage(userId, searchSessionId, pageNum, PAGE_SIZE),
        ]);
        if (!session) return sendError(res, 404, 'SEARCH_SESSION_NOT_FOUND', 'Search snapshot expired or was not found.', requestId);
        return res.status(200).json({
          ok: true,
          data: {
            ...snapshotPage,
            searchSessionId,
            failedBoards: (session.sourceStatuses || [])
              .filter(source => source.state !== SearchSourceState.COMPLETED)
              .map(source => ({ board: source.platform, error: source.errorCodes?.[0] || 'PARTIAL_SOURCE_FAILURE' })),
            normalizationErrorCount: session.normalizationErrorCount || 0,
            normalizationErrors: session.normalizationErrors || {},
          },
          meta: { requestId },
        });
      } catch (error) {
        const code = error.message === 'SEARCH_SESSION_NOT_FOUND'
          ? 'SEARCH_SESSION_NOT_FOUND' : 'SEARCH_SNAPSHOT_UNAVAILABLE';
        return sendError(res, code === 'SEARCH_SESSION_NOT_FOUND' ? 404 : 503, code,
          'The stable search snapshot is unavailable. Start a new search.', requestId);
      }
    }

    // --- Call scraper service ---
    let scraperResponse;
    try {
      scraperResponse = await callScraper({
        query: query.trim(),
        boards,
        location,
        job_type: jobType,
        results_wanted: resultsWanted,
        hours_old: hoursOld,
      });
    } catch (err) {
      const scraperCode = err.message || 'SCRAPER_UNAVAILABLE';
      if (scraperCode === 'SCRAPER_NOT_CONFIGURED') {
        console.error(`[searchJobs] Scraper URL is not configured (requestId=${requestId}).`);
        return sendError(res, 503, scraperCode, 'Job search backend is not configured. Contact the extension administrator.', requestId);
      }
      if (err.name === 'AbortError' || scraperCode === 'SCRAPER_TIMEOUT') {
        return sendError(res, 408, 'REQUEST_TIMEOUT', 'Some boards took too long to respond.', requestId);
      }
      if (scraperCode === 'SCRAPER_RATE_LIMITED') {
        return sendError(res, 429, scraperCode, 'Job search is temporarily rate limited. Try again later.', requestId);
      }
      if (scraperCode === 'SCRAPER_AUTHENTICATION_FAILED' || scraperCode === 'SCRAPER_PERMISSION_DENIED') {
        return sendError(res, 503, scraperCode, 'Job search backend authorization is unavailable.', requestId);
      }
      if (scraperCode === 'INVALID_SCRAPER_RESPONSE') {
        return sendError(res, 502, scraperCode, 'Job search backend returned an invalid response.', requestId);
      }
      console.error(`[searchJobs] Scraper error (requestId=${requestId}):`, scraperCode);
      return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Job search service is temporarily down.', requestId);
    }

    // --- Normalize results ---
    const rawJobs = scraperResponse.jobs || [];
    const failedBoards = scraperResponse.failed_boards || [];

    const normalizedJobs = [];
    const normalizationErrors = [];
    for (const rawJob of rawJobs) {
      const board = rawJob.source_board || rawJob.sourceBoard || rawJob.platform;
      try {
        const normalized = normalizeJobRecord(rawJob, board);
        normalized.searchId = requestId;
        normalized.retrievedAt = new Date().toISOString();
        normalizedJobs.push(normalized);
      } catch (err) {
        const code = err.code || 'NORMALIZATION_FAILED';
        normalizationErrors.push(code);
        console.error(`[searchJobs] Normalization failed (requestId=${requestId}, code=${code}):`, err.message);
      }
    }

    // --- Deduplicate and stabilize ordering for repeatable page boundaries ---
    const uniqueJobs = deduplicateJobs(normalizedJobs).sort((left, right) => {
      const postedDifference = (Date.parse(right.postedAt || '') || 0) -
        (Date.parse(left.postedAt || '') || 0);
      return postedDifference || String(left.id).localeCompare(String(right.id));
    });

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

    const normalizationErrorCounts = normalizationErrors.reduce((counts, code) => {
      counts[code] = (counts[code] || 0) + 1;
      return counts;
    }, {});
    let stableSearchSessionId = null;
    let snapshotWarning = null;
    try {
      const session = await searchSessionRepository.create(userId, {
        criteria: {
          titles: [query.trim()],
          platforms: boards,
          locations: location ? [location] : [],
          jobType: jobType || null,
        },
        queryTasks: [{ id: 'query-1', query: query.trim(), location: location || null, state: 'COMPLETED' }],
        sourceStatuses: boards.map(board => {
          const boardFailure = failedBoards.find(failure => failure.board === board);
          return {
            platform: board,
            state: boardFailure ? SearchSourceState.FAILED : SearchSourceState.COMPLETED,
            attemptCount: 1,
            errorCodes: boardFailure ? [boardFailure.error || 'SCRAPER_UNAVAILABLE'] : [],
          };
        }),
      });
      stableSearchSessionId = session.id;
      await searchSessionRepository.update(userId, session.id, {
        status: SearchSessionStatus.RUNNING,
        stage: SearchSessionStage.SNAPSHOTTING,
      });
      await searchSessionRepository.writeResultSnapshot(userId, session.id, uniqueJobs);
      await searchSessionRepository.update(userId, session.id, {
        status: failedBoards.length || normalizationErrors.length
          ? SearchSessionStatus.PARTIAL : SearchSessionStatus.COMPLETED,
        stage: SearchSessionStage.COMPLETE,
        ai: { status: SearchAiStatus.NOT_REQUESTED, errorCode: null },
        resultSnapshotId: session.id,
        resultCount: uniqueJobs.length,
        normalizationErrorCount: normalizationErrors.length,
        normalizationErrors: normalizationErrorCounts,
        warningCodes: [
          ...(failedBoards.length ? ['PARTIAL_SOURCE_FAILURE'] : []),
          ...(normalizationErrors.length ? ['NORMALIZATION_PARTIAL'] : []),
        ],
      });
    } catch (error) {
      snapshotWarning = 'SEARCH_SNAPSHOT_UNAVAILABLE';
      console.error(`[searchJobs] Snapshot write failed (requestId=${requestId}):`, error.message);
    }

    // Never expose fresh-scrape pagination as stable when persistence failed.
    const paginated = stableSearchSessionId
      ? paginateJobs(uniqueJobs, pageNum)
      : paginateJobs(uniqueJobs.slice(0, PAGE_SIZE), 1);

    return res.status(200).json({
      ok: true,
      data: {
        ...paginated,
        searchSessionId: stableSearchSessionId,
        warningCodes: snapshotWarning ? [snapshotWarning] : [],
        normalizationErrorCount: normalizationErrors.length,
        normalizationErrors: normalizationErrorCounts,
        failedBoards: failedBoards.map((fb) => ({
          board: fb.board,
          error: fb.error || 'Unknown error',
        })),
      },
      meta: { requestId },
    });
  });

module.exports = {
  searchJobs,
  callScraper,
  validateInput,
  mapDatePostedToHoursOld,
  parseScraperPayload,
  paginateJobs,
  VALID_BOARDS,
  PAGE_SIZE,
};
