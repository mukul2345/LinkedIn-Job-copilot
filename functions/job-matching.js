/** Authenticated multi-board discovery, hard filtering, and AI ranking. */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { callScraper, VALID_BOARDS } = require('./search');
const { normalizeJobRecord } = require('./lib/normalization');
const { deduplicateJobs } = require('./lib/deduplication');
const { extractProfileFromResume, computeFitScores } = require('./ai-job-matcher');
const { COLLECTION_PATHS } = require('./lib/schema');
const { SEARCH_LIMITS } = require('./lib/search-session-contracts');

if (!admin.apps.length) admin.initializeApp();

const DEFAULT_MATCH_THRESHOLD = 70;
const MAX_JOBS_TO_SCORE = SEARCH_LIMITS.maxJobsToScore;
const MAX_SEARCH_REQUESTS = SEARCH_LIMITS.maxQueriesPerSearch;
const MAX_CONCURRENT_SEARCHES = SEARCH_LIMITS.maxConcurrentQueries;
const RESULTS_PER_SEARCH = SEARCH_LIMITS.maxResultsPerQuery;

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id');
}

function sendError(res, status, code, message, requestId) {
  return res.status(status).json({ ok: false, error: { code, message }, meta: { requestId } });
}

async function authenticate(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw Object.assign(new Error('Unauthorized'), { code: 'UNAUTHORIZED' });
  return admin.auth().verifyIdToken(header.slice(7));
}

async function loadLatestResume(db, uid) {
  const snapshot = await db.collection(COLLECTION_PATHS.userResumes(uid))
    .where('type', '==', 'base').orderBy('createdAt', 'desc').limit(1).get();
  if (snapshot.empty) throw Object.assign(new Error('No base resume found.'), { code: 'RESUME_NOT_FOUND' });
  const resumeText = snapshot.docs[0].data().parsedContent;
  if (!resumeText?.trim()) throw Object.assign(new Error('Resume has no parsed text.'), { code: 'RESUME_NOT_FOUND' });
  return resumeText;
}

function normalizeStringArray(value, fallback, fieldName) {
  const selected = value === undefined ? fallback : value;
  if (!Array.isArray(selected)) {
    throw Object.assign(new Error(`${fieldName} must be an array.`), { code: 'INVALID_REQUEST' });
  }
  return selected
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeOptionalNumber(value, fieldName, minimum, maximum) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw Object.assign(new Error(`${fieldName} is invalid.`), { code: 'INVALID_REQUEST' });
  }
  return number;
}

function resolveMatchingCriteria(explicit = {}, preferences = {}, extractedProfile = {}) {
  const platforms = normalizeStringArray(
    explicit.platforms,
    preferences.platforms ?? VALID_BOARDS,
    'platforms'
  ).filter(platform => VALID_BOARDS.includes(platform));
  const persistedTitles = Array.isArray(preferences.searchTerms) ? preferences.searchTerms : extractedProfile.titles || [];
  const persistedLocations = preferences.searchLocation ? [preferences.searchLocation] : extractedProfile.locations || [];
  const thresholdValue = explicit.matchThreshold ?? preferences.minimumFitScore ?? DEFAULT_MATCH_THRESHOLD;
  const matchThreshold = normalizeOptionalNumber(thresholdValue, 'matchThreshold', 0, 100);
  return {
    titles: normalizeStringArray(explicit.titles, persistedTitles, 'titles'),
    keywords: normalizeStringArray(explicit.keywords, preferences.keywords || [], 'keywords'),
    locations: normalizeStringArray(explicit.locations, persistedLocations, 'locations'),
    remoteTypes: normalizeStringArray(explicit.remoteTypes, preferences.workStyle || [], 'remoteTypes'),
    employmentTypes: normalizeStringArray(explicit.employmentTypes, preferences.jobType || [], 'employmentTypes'),
    excludedCompanies: normalizeStringArray(explicit.excludedCompanies, preferences.blacklistCompanies || [], 'excludedCompanies'),
    excludedKeywords: normalizeStringArray(explicit.excludedKeywords, preferences.badWords || [], 'excludedKeywords'),
    platforms,
    matchThreshold,
    minimumSalary: normalizeOptionalNumber(explicit.minimumSalary, 'minimumSalary', 0, Number.MAX_SAFE_INTEGER),
    maximumSalary: normalizeOptionalNumber(explicit.maximumSalary, 'maximumSalary', 0, Number.MAX_SAFE_INTEGER),
    experienceYears: normalizeOptionalNumber(explicit.experienceYears, 'experienceYears', 0, 80),
    postedWithinDays: normalizeOptionalNumber(explicit.postedWithinDays, 'postedWithinDays', 0, 365),
    jobType: typeof explicit.jobType === 'string' ? explicit.jobType.trim().slice(0, 80) : preferences.jobType?.[0],
  };
}

function includesAny(value, candidates) {
  const normalized = String(value || '').toLowerCase();
  return candidates.some(candidate => normalized.includes(String(candidate).toLowerCase()));
}

function getHardFilterReasons(job, criteria, now = Date.now()) {
  const reasons = [];
  const searchableText = `${job.title || ''} ${job.description || ''}`;
  if (criteria.platforms.length && !criteria.platforms.includes(job.platform)) reasons.push('PLATFORM_EXCLUDED');
  if (criteria.excludedCompanies.length && includesAny(job.company, criteria.excludedCompanies)) reasons.push('COMPANY_EXCLUDED');
  if (criteria.excludedKeywords.length && includesAny(searchableText, criteria.excludedKeywords)) reasons.push('KEYWORD_EXCLUDED');
  if (criteria.locations.length && job.location && !includesAny(job.location, criteria.locations)) reasons.push('LOCATION_EXCLUDED');
  if (criteria.remoteTypes.length && job.remoteType && !criteria.remoteTypes.includes(job.remoteType)) reasons.push('REMOTE_TYPE_EXCLUDED');
  if (criteria.employmentTypes.length && job.employmentType && !criteria.employmentTypes.includes(job.employmentType)) reasons.push('EMPLOYMENT_TYPE_EXCLUDED');
  if (criteria.minimumSalary != null && job.salary?.maximum != null && job.salary.maximum < criteria.minimumSalary) reasons.push('SALARY_BELOW_MINIMUM');
  if (criteria.maximumSalary != null && job.salary?.minimum != null && job.salary.minimum > criteria.maximumSalary) reasons.push('SALARY_ABOVE_MAXIMUM');
  if (criteria.experienceYears != null && job.metadata?.requiredExperienceYears != null &&
      job.metadata.requiredExperienceYears > criteria.experienceYears) reasons.push('EXPERIENCE_REQUIREMENT_EXCEEDED');
  if (criteria.postedWithinDays != null && job.postedAt) {
    const postedAt = new Date(job.postedAt).getTime();
    const cutoff = now - criteria.postedWithinDays * 86400000;
    if (Number.isFinite(postedAt) && postedAt < cutoff) reasons.push('POSTING_TOO_OLD');
  }
  return reasons;
}

function applyHardFilters(jobs, criteria) {
  return jobs.filter(job => getHardFilterReasons(job, criteria).length === 0);
}

function buildSearchRequests(criteria) {
  const searchTerms = [...new Set([...criteria.titles, ...criteria.keywords])].slice(0, 8);
  const locations = criteria.locations.length ? [...new Set(criteria.locations)] : [undefined];
  const requests = [];
  for (const query of searchTerms) {
    for (const location of locations) requests.push({ query, location });
  }
  return {
    requests: requests.slice(0, MAX_SEARCH_REQUESTS),
    truncated: requests.length > MAX_SEARCH_REQUESTS,
  };
}

async function searchAcrossCriteria(criteria, scraper = callScraper, options = {}) {
  const { requests, truncated } = buildSearchRequests(criteria);
  const responses = new Array(requests.length);
  let nextIndex = 0;
  let isCancelled = false;

  async function publishProgress() {
    if (typeof options.onProgress !== 'function') return;
    const completedQueries = responses.filter(Boolean).length;
    await options.onProgress({
      completedQueries,
      totalQueries: requests.length,
      queryTasks: requests.map((request, index) => ({
        id: `query-${index + 1}`,
        ...request,
        state: !responses[index] ? 'PENDING'
          : responses[index].error ? 'FAILED' : 'COMPLETED',
      })),
    });
  }

  async function runWorker() {
    while (nextIndex < requests.length && !isCancelled) {
      if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
        isCancelled = true;
        break;
      }
      const currentIndex = nextIndex++;
      const request = requests[currentIndex];
      try {
        const response = await scraper({
          query: request.query,
          boards: criteria.platforms,
          location: request.location,
          job_type: criteria.jobType,
          results_wanted: RESULTS_PER_SEARCH,
        });
        responses[currentIndex] = { request, response };
      } catch (error) {
        responses[currentIndex] = { request, error };
      }
      await publishProgress();
      if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
        isCancelled = true;
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_SEARCHES, requests.length) },
    () => runWorker()
  ));
  if (isCancelled) {
    throw Object.assign(new Error('SEARCH_CANCELLED'), { code: 'SEARCH_CANCELLED' });
  }

  const jobs = [];
  const failedBoards = [];
  const failedQueries = [];
  for (const entry of responses) {
    if (entry.error) {
      failedQueries.push({
        query: entry.request.query,
        location: entry.request.location || null,
        error: entry.error.message || 'SCRAPER_UNAVAILABLE',
      });
      continue;
    }
    for (const job of entry.response.jobs || []) {
      jobs.push({
        ...job,
        search_query: entry.request.query,
        search_location: entry.request.location || null,
      });
    }
    for (const failedBoard of entry.response.failed_boards || []) {
      failedBoards.push({
        ...failedBoard,
        query: entry.request.query,
        location: entry.request.location || null,
      });
    }
  }
  if (!jobs.length && failedQueries.length === requests.length && failedQueries.length) {
    throw Object.assign(new Error(failedQueries[0].error), { code: failedQueries[0].error });
  }
  return { jobs, failed_boards: failedBoards, failedQueries, requests, truncated };
}

function compareRankedJobs(left, right) {
  const scoreDifference = right.match.score - left.match.score;
  if (scoreDifference) return scoreDifference;
  const leftDate = Date.parse(left.postedAt || '') || 0;
  const rightDate = Date.parse(right.postedAt || '') || 0;
  if (rightDate !== leftDate) return rightDate - leftDate;
  return String(left.id).localeCompare(String(right.id));
}

const matchJobsForUser = functions.runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    const requestId = req.headers['x-request-id'] || `req_${Date.now().toString(36)}`;
    if (req.method !== 'POST') return sendError(res, 405, 'INVALID_REQUEST', 'Use POST.', requestId);

    let token;
    try {
      token = await authenticate(req);
    } catch (_) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
    }

    try {
      const db = admin.firestore();
      const [resumeText, userSnapshot] = await Promise.all([
        loadLatestResume(db, token.uid),
        db.collection('users').doc(token.uid).get(),
      ]);
      if (!userSnapshot.exists) return sendError(res, 404, 'USER_NOT_FOUND', 'User profile not found.', requestId);

      const userDocument = userSnapshot.data() || {};
      let extractedProfile = { titles: [], skills: [], seniority: '', locations: [] };
      let aiStatus = 'AVAILABLE';
      let aiErrorCode = null;
      try {
        extractedProfile = await extractProfileFromResume(resumeText);
      } catch (error) {
        aiStatus = 'UNAVAILABLE';
        aiErrorCode = error.code || error.message || 'AI_UNAVAILABLE';
      }
      const criteria = resolveMatchingCriteria(req.body?.criteria || {}, userDocument.preferences || {}, extractedProfile);
      if (!criteria.titles.length || !criteria.platforms.length) {
        return sendError(res, 400, 'INVALID_REQUEST', 'At least one title and supported platform are required.', requestId);
      }

      const scraperResult = await searchAcrossCriteria(criteria);
      const normalized = [];
      const normalizationErrors = [];
      for (const rawJob of scraperResult.jobs) {
        try {
          const normalizedJob = normalizeJobRecord(rawJob, rawJob.source_board || rawJob.sourceBoard);
          normalizedJob.searchProvenance = [{
            query: rawJob.search_query,
            location: rawJob.search_location || null,
          }];
          normalized.push(normalizedJob);
        } catch (error) {
          normalizationErrors.push(error.code || 'NORMALIZATION_FAILED');
        }
      }
      const uniqueJobs = deduplicateJobs(normalized);
      const excludedJobs = uniqueJobs
        .map(job => ({ job, reasonCodes: getHardFilterReasons(job, criteria) }))
        .filter(entry => entry.reasonCodes.length > 0);
      const eligibleJobs = uniqueJobs
        .filter(job => getHardFilterReasons(job, criteria).length === 0)
        .filter(job => job.description)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .slice(0, MAX_JOBS_TO_SCORE);
      let scoreMap = new Map();
      if (aiStatus === 'AVAILABLE') {
        try {
          const scores = await computeFitScores(resumeText, eligibleJobs);
          scoreMap = new Map(scores.map(result => [result.id, result.match]));
        } catch (error) {
          aiStatus = 'UNAVAILABLE';
          aiErrorCode = error.code || error.message || 'AI_UNAVAILABLE';
        }
      }
      const matches = eligibleJobs.map(job => ({
        ...job,
        match: scoreMap.get(job.id) || null,
        matchStatus: aiStatus === 'AVAILABLE' && scoreMap.has(job.id)
          ? 'AVAILABLE' : 'AI_UNAVAILABLE',
        hardFilter: { eligible: true, reasonCodes: [] },
      }))
        .filter(job => !job.match || job.match.score >= criteria.matchThreshold)
        .sort((left, right) => {
          if (left.match && right.match) return compareRankedJobs(left, right);
          if (left.match) return -1;
          if (right.match) return 1;
          return String(left.id).localeCompare(String(right.id));
        })
        .slice(0, 25);

      return res.status(200).json({
        ok: true,
        data: {
          jobs: matches,
          profile: extractedProfile,
          failedBoards: scraperResult.failed_boards,
          failedQueries: scraperResult.failedQueries,
          searchRequestCount: scraperResult.requests.length,
          searchRequestsTruncated: scraperResult.truncated,
          excludedJobs: excludedJobs.map(entry => ({
            id: entry.job.id,
            title: entry.job.title,
            reasonCodes: entry.reasonCodes,
          })),
          normalizationErrorCount: normalizationErrors.length,
          normalizationErrors: normalizationErrors.reduce((counts, code) => {
            counts[code] = (counts[code] || 0) + 1;
            return counts;
          }, {}),
          criteria,
          matchThreshold: criteria.matchThreshold,
          ai: { status: aiStatus, errorCode: aiErrorCode },
        },
        meta: { requestId },
      });
    } catch (error) {
      const code = error.code || error.message;
      if (code === 'RESUME_NOT_FOUND') return sendError(res, 404, code, error.message, requestId);
      if (code === 'INVALID_REQUEST') return sendError(res, 400, code, error.message, requestId);
      if (code === 'SCRAPER_NOT_CONFIGURED') return sendError(res, 503, code, 'Job discovery is not configured.', requestId);
      console.error('[matchJobsForUser] Request failed.', { requestId, error: error.stack || error });
      return sendError(res, 502, 'MATCHING_UNAVAILABLE', 'Job matching is temporarily unavailable.', requestId);
    }
  });

const matchCurrentJobForUser = functions.runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    const requestId = req.headers['x-request-id'] || `req_${Date.now().toString(36)}`;
    if (req.method !== 'POST') return sendError(res, 405, 'INVALID_REQUEST', 'Use POST.', requestId);

    let token;
    try { token = await authenticate(req); }
    catch (_) { return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId); }

    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (description.length < 100 || description.length > 5000) {
      return sendError(res, 400, 'INVALID_REQUEST', 'A job description between 100 and 5000 characters is required.', requestId);
    }
    try {
      const resumeText = await loadLatestResume(admin.firestore(), token.uid);
      const match = await computeFitScores(resumeText, [{
        id: 'current-job',
        title: typeof req.body?.title === 'string' ? req.body.title.slice(0, 200) : '',
        description,
      }]);
      return res.status(200).json({ ok: true, data: { match: match[0].match }, meta: { requestId } });
    } catch (error) {
      const code = error.code || error.message;
      if (code === 'RESUME_NOT_FOUND') return sendError(res, 404, code, error.message, requestId);
      console.error('[matchCurrentJobForUser] Request failed.', { requestId, error: error.stack || error });
      return sendError(res, 502, 'MATCHING_UNAVAILABLE', 'Job matching is temporarily unavailable.', requestId);
    }
  });

module.exports = {
  matchJobsForUser,
  matchCurrentJobForUser,
  resolveMatchingCriteria,
  getHardFilterReasons,
  applyHardFilters,
  buildSearchRequests,
  searchAcrossCriteria,
  compareRankedJobs,
  loadLatestResume,
  normalizeStringArray,
  normalizeOptionalNumber,
  DEFAULT_MATCH_THRESHOLD,
  MAX_JOBS_TO_SCORE,
  MAX_SEARCH_REQUESTS,
  MAX_CONCURRENT_SEARCHES,
};
