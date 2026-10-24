// job-matching-service.js - Authenticated server-side discovery and AI matching.

/** Discover and rank jobs without consuming application quota. */
async function matchJobsForCurrentUser(criteria = {}) {
  const response = await callBackend('matchJobsForUser', { criteria });
  const jobs = [];
  const normalizationErrors = [];
  for (const rawJob of response.jobs || []) {
    const normalized = normalizeJob(rawJob, rawJob.platform || rawJob.sourceBoard);
    if (!normalized.ok) {
      normalizationErrors.push(normalized.error);
      continue;
    }
    let validatedMatch = null;
    if (rawJob.match) {
      validatedMatch = validateAiMatchResponse(rawJob.match);
      if (!validatedMatch.available) {
        normalizationErrors.push({ code: validatedMatch.errorCode, jobId: normalized.job.id });
        validatedMatch = null;
      }
    }
    jobs.push({
      ...normalized.job,
      match: validatedMatch,
      matchStatus: rawJob.matchStatus || (validatedMatch ? 'AVAILABLE' : 'AI_UNAVAILABLE'),
    });
  }
  return {
    jobs: deduplicateCrossPlatformJobs(jobs),
    criteria: resolveJobSearchCriteria(response.criteria || criteria),
    failedBoards: response.failedBoards || [],
    normalizationErrors,
    matchThreshold: response.matchThreshold,
    ai: response.ai || { status: 'AVAILABLE', errorCode: null },
  };
}

/** Create a durable search session without starting external work. */
async function createJobSearchSession(criteria = {}) {
  return callBackend('createSearchSession', { criteria });
}

/** Resume a durable session. Safe to call after an MV3 worker restart. */
async function resumeJobSearchSession(sessionId) {
  return callBackend('resumeSearchSession', { sessionId });
}

/** Read durable progress and one immutable result-snapshot page. */
async function getJobSearchSession(sessionId, page = 1) {
  const response = await callBackend('getSearchSession', { sessionId, page });
  const jobs = [];
  const normalizationErrors = [];
  for (const rawJob of response.jobs || []) {
    const normalized = normalizeJob(rawJob, rawJob.platform || rawJob.sourceBoard);
    if (!normalized.ok) {
      normalizationErrors.push(normalized.error);
      continue;
    }
    let match = null;
    if (rawJob.match) {
      const validatedMatch = validateAiMatchResponse(rawJob.match);
      if (!validatedMatch.available) {
        normalizationErrors.push({ code: validatedMatch.errorCode, jobId: normalized.job.id });
      } else {
        match = validatedMatch;
      }
    }
    jobs.push({
      ...normalized.job,
      match,
      matchStatus: rawJob.matchStatus || (match ? 'AVAILABLE' : 'NOT_SCORED'),
      discovery: rawJob.discovery || null,
      rankIndex: rawJob.rankIndex,
    });
  }
  return { ...response, jobs, normalizationErrors };
}

/** Request cooperative cancellation; late work cannot complete the session. */
async function cancelJobSearchSession(sessionId) {
  return callBackend('cancelSearchSession', { sessionId });
}
