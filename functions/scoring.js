/**
 * Job Fit Scoring Cloud Functions
 *
 * POST /computeFitScore
 * Body: { jobId } or { jobIds: string[] }
 * Auth: Bearer token required
 * Timeout: 10s per job
 *
 * POST /recomputeScores
 * Body: {} (uses all cached jobs for the authenticated user)
 * Auth: Bearer token required
 * Timeout: 60s
 *
 * Computes AI-powered fit scores comparing job descriptions against user profile:
 * 1. Validates auth and input
 * 2. Reads job description(s) and user profile from Firestore
 * 3. Builds AI prompt evaluating 5 dimensions
 * 4. Parses AI response, normalizes score to [0, 100] integer
 * 5. Fails fast when no candidate dimensions are available
 * 6. Updates job documents with score results
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { COLLECTION_PATHS } = require('./lib/schema');
const { callAI, parseJsonLoose } = require('./ai-provider');

// Ensure admin is initialized (may already be from index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

// ============================================================
// Constants
// ============================================================

const SCORING_DIMENSIONS = [
  'skills',
  'experience',
  'education',
  'location',
  'salary',
];

const SCORING_TIMEOUT_MS = 10000; // 10s per job
const MAX_CONCURRENT_SCORING_JOBS = 3;

// ============================================================
// Helpers (same patterns as search.js / visa.js)
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
// Score Normalization
// ============================================================

/**
 * Normalize a finite model score to an integer in [0, 100].
 * Invalid or out-of-range output is rejected instead of receiving a fallback.
 *
 * @param {*} rawScore - The raw score from AI response
 * @returns {number} Rounded integer in [0, 100]
 * @throws {Error} INVALID_AI_SCORE
 */
function normalizeScore(rawScore) {
  const score = Number(rawScore);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('INVALID_AI_SCORE');
  }
  return Math.round(score);
}

// ============================================================
// Profile Dimension Detection
// ============================================================

/**
 * Determine which scoring dimensions are available in the user profile.
 * Returns the available dimensions and lists missing ones.
 *
 * @param {Object} profile - User profile document
 * @returns {{available: string[], missing: string[]}}
 */
function detectProfileDimensions(profile) {
  const available = [];
  const missing = [];

  // Skills
  if (Array.isArray(profile.skills) && profile.skills.length > 0) {
    available.push('skills');
  } else {
    missing.push('skills');
  }

  // Experience (based on profile having experience-related data)
  if (profile.experienceYears || profile.experienceLevel || profile.experience) {
    available.push('experience');
  } else {
    missing.push('experience');
  }

  // Education
  if (profile.educationLevel && profile.educationLevel.trim().length > 0) {
    available.push('education');
  } else {
    missing.push('education');
  }

  // Location
  if (Array.isArray(profile.preferredLocations) && profile.preferredLocations.length > 0) {
    available.push('location');
  } else {
    missing.push('location');
  }

  // Salary
  if (profile.salaryMin > 0 || profile.salaryMax > 0) {
    available.push('salary');
  } else {
    missing.push('salary');
  }

  return { available, missing };
}

// ============================================================
// AI Prompt Construction
// ============================================================

/**
 * Build the AI prompt for fit score computation.
 * Only includes dimensions that are available in the profile.
 *
 * @param {Object} jobData - Job document data
 * @param {Object} profile - User profile data
 * @param {string[]} availableDimensions - Dimensions to evaluate
 * @returns {string} The constructed prompt
 */
function buildFitScorePrompt(jobData, profile, availableDimensions) {
  if (detectProfileDimensions(profile).available.length === 0) {
    throw new Error('PROFILE_INCOMPLETE');
  }

  const parts = [];

  parts.push('Evaluate how well this candidate matches the job posting.');
  parts.push('Use only the supplied profile fields. Never infer or invent candidate facts.');
  parts.push('Score from 0 (no match) to 100 (perfect match).');
  parts.push('');
  parts.push('=== JOB POSTING ===');
  parts.push(`Title: ${jobData.title}`);
  parts.push(`Company: ${jobData.company}`);
  parts.push(`Location: ${jobData.location}`);
  if (jobData.salary) {
    parts.push(`Salary: ${jobData.salary}`);
  }
  parts.push(`Description: ${jobData.description}`);
  parts.push('');
  parts.push('=== CANDIDATE PROFILE ===');

  if (availableDimensions.includes('skills')) {
    parts.push(`Skills: ${profile.skills.join(', ')}`);
  }

  if (availableDimensions.includes('experience')) {
    const expInfo = profile.experienceYears
      ? `${profile.experienceYears} years`
      : profile.experienceLevel || profile.experience || '';
    parts.push(`Experience: ${expInfo}`);
  }

  if (availableDimensions.includes('education')) {
    parts.push(`Education: ${profile.educationLevel}`);
  }

  if (availableDimensions.includes('location')) {
    parts.push(`Preferred Locations: ${profile.preferredLocations.join(', ')}`);
  }

  if (availableDimensions.includes('salary')) {
    const salaryRange = `${profile.salaryMin} - ${profile.salaryMax}`;
    parts.push(`Salary Expectation: ${profile.salaryCurrency ? `${profile.salaryCurrency} ` : ''}${salaryRange}`);
  }

  parts.push('');
  parts.push(`Evaluate ONLY these dimensions: ${availableDimensions.join(', ')}`);
  parts.push('');
  parts.push('Respond ONLY with valid JSON in this exact format:');
  parts.push('{');
  parts.push('  "score": <integer 0-100>,');
  parts.push('  "explanation": "<2-3 sentence explanation of primary factors>",');
  parts.push(`  "dimensions_evaluated": ${JSON.stringify(availableDimensions)},`);
  parts.push('  "dimensions_missing": []');
  parts.push('}');

  return parts.join('\n');
}

// ============================================================
// Server-only AI scoring
// ============================================================

/**
 * Call the configured server AI provider and strictly validate its JSON output.
 * Invalid or unavailable model output is an error, never a fabricated score.
 *
 * @param {string} prompt - The constructed scoring prompt
 * @returns {Promise<{score: number, explanation: string, dimensions_evaluated: string[], dimensions_missing: string[]}>}
 */
async function callAIForScoring(prompt) {
  const parsed = parseJsonLoose(await callAI(prompt, {
    jsonMode: true,
    maxTokens: 1000,
    timeoutMs: SCORING_TIMEOUT_MS,
  }));
  const score = normalizeScore(parsed.score);
  if (typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) {
    throw new Error('INVALID_AI_EXPLANATION');
  }
  const stringArray = value => Array.isArray(value)
    ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : [];
  return {
    score,
    explanation: parsed.explanation.trim().slice(0, 1000),
    dimensions_evaluated: stringArray(parsed.dimensions_evaluated),
    dimensions_missing: stringArray(parsed.dimensions_missing),
  };
}

// ============================================================
// Single Job Scoring
// ============================================================

/**
 * Score a single job against the user's profile with a timeout.
 *
 * @param {string} userId - Authenticated user ID
 * @param {string} jobId - Job document ID
 * @param {Object} profile - User profile data (pre-fetched)
 * @param {{available: string[], missing: string[]}} dimensions - Profile dimensions info
 * @returns {Promise<{jobId: string, score: number, explanation: string, excludedDimensions: string[]} | {jobId: string, error: string}>}
 */
async function scoreSingleJob(userId, jobId, profile, dimensions) {
  return Promise.race([
    (async () => {
      const db = admin.firestore();
      const jobRef = db.collection(COLLECTION_PATHS.userJobs(userId)).doc(jobId);
      const jobDoc = await jobRef.get();

      if (!jobDoc.exists) {
        return { jobId, error: 'Job not found' };
      }

      const jobData = jobDoc.data();

      if (!jobData.description || jobData.description.trim().length === 0) {
        return { jobId, error: 'Job has no description to score against' };
      }

      // Build prompt and call AI
      const prompt = buildFitScorePrompt(jobData, profile, dimensions.available);
      const aiResponse = await callAIForScoring(prompt);

      // Normalize the score
      const normalizedScore = normalizeScore(aiResponse.score);

      // Update Firestore
      await jobRef.update({
        fitScore: normalizedScore,
        fitExplanation: aiResponse.explanation || '',
        fitExcludedDimensions: dimensions.missing,
      });

      return {
        jobId,
        score: normalizedScore,
        explanation: aiResponse.explanation || '',
        excludedDimensions: dimensions.missing,
      };
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), SCORING_TIMEOUT_MS)
    ),
  ]).catch((err) => {
    if (err.message === 'TIMEOUT') {
      return { jobId, error: 'Scoring timed out' };
    }
    return { jobId, error: err.message || 'Scoring failed' };
  });
}

async function runWithConcurrency(items, worker, maximumConcurrency = MAX_CONCURRENT_SCORING_JOBS) {
  const responses = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      responses[currentIndex] = await worker(items[currentIndex]);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(maximumConcurrency, items.length) },
    () => runWorker()
  ));
  return responses;
}

// ============================================================
// Cloud Function: computeFitScore
// ============================================================

/**
 * POST /computeFitScore
 * Body: { jobId } or { jobIds: string[] }
 * Auth: Bearer token required
 * Timeout: 10s per job
 */
const computeFitScore = functions
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

    // --- Fetch user profile ---
    let profile;
    try {
      const db = admin.firestore();
      const profileRef = db.doc(COLLECTION_PATHS.userProfile(userId));
      const profileDoc = await profileRef.get();
      profile = profileDoc.exists ? profileDoc.data() : {};
    } catch (err) {
      console.error(`[computeFitScore] Profile fetch error (requestId=${requestId}):`, err.message);
      return sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Failed to load user profile.',
        requestId
      );
    }

    // --- Detect available dimensions ---
    const dimensions = detectProfileDimensions(profile);

    if (dimensions.available.length === 0) {
      return sendError(
        res,
        422,
        'PROFILE_INCOMPLETE',
        'Add at least one professional profile dimension before scoring jobs.',
        requestId
      );
    }

    // --- Score jobs ---
    const results = await runWithConcurrency(
      idsToProcess,
      id => scoreSingleJob(userId, id, profile, dimensions)
    );

    // Separate successes from errors
    const scores = [];
    const errors = [];

    for (const result of results) {
      if (result.error) {
        errors.push({ jobId: result.jobId, error: result.error });
      } else {
        scores.push({
          jobId: result.jobId,
          score: result.score,
          explanation: result.explanation,
          excludedDimensions: result.excludedDimensions,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        scores,
        errors: errors.length > 0 ? errors : undefined,
      },
      meta: { requestId },
    });
  });

// ============================================================
// Cloud Function: recomputeScores
// ============================================================

/**
 * POST /recomputeScores
 * Body: {} (uses authenticated user's cached jobs)
 * Auth: Bearer token required
 * Timeout: 60s
 */
const recomputeScores = functions
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

    // --- Fetch user profile ---
    let profile;
    try {
      const db = admin.firestore();
      const profileRef = db.doc(COLLECTION_PATHS.userProfile(userId));
      const profileDoc = await profileRef.get();
      profile = profileDoc.exists ? profileDoc.data() : {};
    } catch (err) {
      console.error(`[recomputeScores] Profile fetch error (requestId=${requestId}):`, err.message);
      return sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Failed to load user profile.',
        requestId
      );
    }

    // --- Detect available dimensions ---
    const dimensions = detectProfileDimensions(profile);

    if (dimensions.available.length === 0) {
      return sendError(
        res,
        422,
        'PROFILE_INCOMPLETE',
        'Add at least one professional profile dimension before recomputing scores.',
        requestId
      );
    }

    // --- Fetch all cached jobs for user ---
    let jobIds = [];
    try {
      const db = admin.firestore();
      const jobsCollection = db.collection(COLLECTION_PATHS.userJobs(userId));
      const snapshot = await jobsCollection.select().get(); // Only fetch doc IDs
      jobIds = snapshot.docs.map((doc) => doc.id);
    } catch (err) {
      console.error(`[recomputeScores] Jobs fetch error (requestId=${requestId}):`, err.message);
      return sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Failed to load cached jobs.',
        requestId
      );
    }

    if (jobIds.length === 0) {
      return res.status(200).json({
        ok: true,
        data: { scores: [], recomputedCount: 0 },
        meta: { requestId },
      });
    }

    // --- Score all jobs ---
    const results = await runWithConcurrency(
      jobIds,
      id => scoreSingleJob(userId, id, profile, dimensions)
    );

    const scores = [];
    const errors = [];

    for (const result of results) {
      if (result.error) {
        errors.push({ jobId: result.jobId, error: result.error });
      } else {
        scores.push({
          jobId: result.jobId,
          score: result.score,
          explanation: result.explanation,
          excludedDimensions: result.excludedDimensions,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        scores,
        recomputedCount: scores.length,
        errors: errors.length > 0 ? errors : undefined,
      },
      meta: { requestId },
    });
  });

// ============================================================
// Exports
// ============================================================

module.exports = {
  computeFitScore,
  recomputeScores,
  // Exported for testing
  normalizeScore,
  detectProfileDimensions,
  buildFitScorePrompt,
  callAIForScoring,
  runWithConcurrency,
  SCORING_DIMENSIONS,
  SCORING_TIMEOUT_MS,
  MAX_CONCURRENT_SCORING_JOBS,
};
