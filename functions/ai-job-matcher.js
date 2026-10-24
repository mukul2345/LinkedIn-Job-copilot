/** Resume profile extraction and validated AI job matching. */

const crypto = require('crypto');
const { callAI, parseJsonLoose } = require('./ai-provider');

const JOB_MATCHING_PROMPT_VERSION = 'JOB_MATCHING_V1';
const MAX_JOB_DESCRIPTION_CHARS = 4000;
const MAX_BATCH_SIZE = 10;
const MAX_CONCURRENT_BATCHES = 2;
const MATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MATCH_CACHE_ENTRIES = 1000;
const matchCache = new Map();
const inFlightBatches = new Map();

function stringArray(value, maximum = 30) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, maximum)
    : [];
}

function normalizeMatch(value) {
  const score = Number(value?.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('INVALID_AI_MATCH');
  }
  const normalizedScore = Math.round(score);
  return {
    score: normalizedScore,
    recommendation: normalizedScore >= 85 ? 'STRONG_MATCH' : normalizedScore >= 70
      ? 'MATCH' : normalizedScore >= 40 ? 'WEAK_MATCH' : 'NO_MATCH',
    matchedSkills: stringArray(value.matchedSkills),
    missingSkills: stringArray(value.missingSkills),
    reasons: stringArray(value.reasons, 10),
  };
}

/** Extract only professional matching fields; exclude contact/address PII. */
async function extractProfileFromResume(resumeText) {
  if (!resumeText?.trim()) throw new Error('RESUME_TEXT_REQUIRED');
  const prompt = [
    'Extract a job-search profile from this resume.',
    'Return JSON only: {"titles":[],"skills":[],"seniority":"","locations":[]}.',
    'Do not include name, email, phone, street address, or other contact information.',
    '',
    resumeText.slice(0, 20000),
  ].join('\n');
  const parsed = parseJsonLoose(await callAI(prompt, { jsonMode: true, maxTokens: 1000 }));
  return {
    titles: stringArray(parsed.titles, 15),
    skills: stringArray(parsed.skills, 100),
    seniority: typeof parsed.seniority === 'string' ? parsed.seniority.trim().slice(0, 80) : '',
    locations: stringArray(parsed.locations, 20),
  };
}

/** Compute one fit score through one AI request. */
async function computeFitScore(resumeText, jobDescription) {
  const matches = await computeFitScoresBatch(resumeText, [{ id: 'single', description: jobDescription }]);
  return matches[0].match;
}

/** Batch multiple descriptions per prompt to control cost and rate pressure. */
async function computeFitScoresBatch(resumeText, jobs) {
  if (!resumeText?.trim()) throw new Error('RESUME_TEXT_REQUIRED');
  if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > MAX_BATCH_SIZE) {
    throw new Error('INVALID_JOB_BATCH');
  }
  const safeJobs = jobs.map(job => ({
    id: String(job.id),
    title: String(job.title || '').slice(0, 200),
    description: String(job.description || '').slice(0, MAX_JOB_DESCRIPTION_CHARS),
  }));
  const prompt = [
    `Prompt version: ${JOB_MATCHING_PROMPT_VERSION}`,
    'Compare the professional resume with each job. Never invent candidate facts.',
    'Return JSON only as {"matches":[{"id":"...","score":0,"matchedSkills":[],"missingSkills":[],"reasons":[]}]}',
    'Scores must be integers from 0 through 100.',
    '',
    'PROFESSIONAL RESUME:',
    resumeText.slice(0, 16000),
    '',
    'JOBS:',
    JSON.stringify(safeJobs),
  ].join('\n');
  const parsed = parseJsonLoose(await callAI(prompt, {
    jsonMode: true,
    maxTokens: 3000,
    timeoutMs: 20000,
    ...(process.env.AI_JOB_MATCHING_MODEL
      ? { model: process.env.AI_JOB_MATCHING_MODEL }
      : {}),
  }));
  if (!Array.isArray(parsed.matches)) throw new Error('INVALID_AI_RESPONSE');
  const byId = new Map(parsed.matches.map(value => [String(value.id), value]));
  return safeJobs.map(job => {
    const rawMatch = byId.get(job.id);
    if (!rawMatch) throw new Error(`MISSING_AI_MATCH:${job.id}`);
    return { id: job.id, match: normalizeMatch(rawMatch) };
  });
}

/** Score a cache miss and coalesce an identical in-flight batch. */
async function scoreMissingBatch(resumeText, jobs) {
  const batchKey = jobs.map(job => buildMatchCacheKey(resumeText, job)).sort().join('|');
  if (inFlightBatches.has(batchKey)) return inFlightBatches.get(batchKey);

  const request = computeFitScoresBatch(resumeText, jobs)
    .then(scoredJobs => {
      for (const scoredJob of scoredJobs) {
        const job = jobs.find(candidate => String(candidate.id) === scoredJob.id);
        if (job) writeCachedMatch(buildMatchCacheKey(resumeText, job), scoredJob.match);
      }
      return scoredJobs;
    })
    .finally(() => inFlightBatches.delete(batchKey));
  inFlightBatches.set(batchKey, request);
  return request;
}

function buildMatchCacheKey(resumeText, job) {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const model = process.env.AI_JOB_MATCHING_MODEL || 'provider-default';
  const payload = [
    JOB_MATCHING_PROMPT_VERSION,
    provider,
    model,
    resumeText,
    String(job.id),
    String(job.title || ''),
    String(job.description || '').slice(0, MAX_JOB_DESCRIPTION_CHARS),
  ].join('\u001f');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function readCachedMatch(cacheKey) {
  const entry = matchCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= MATCH_CACHE_TTL_MS) {
    matchCache.delete(cacheKey);
    return null;
  }
  return { ...entry.match };
}

function writeCachedMatch(cacheKey, match) {
  if (matchCache.size >= MAX_MATCH_CACHE_ENTRIES) {
    matchCache.delete(matchCache.keys().next().value);
  }
  matchCache.set(cacheKey, { cachedAt: Date.now(), match: { ...match } });
}

async function runBatchesWithConcurrency(batches, worker) {
  const responses = new Array(batches.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < batches.length) {
      const currentIndex = nextIndex++;
      responses[currentIndex] = await worker(batches[currentIndex]);
    }
  }
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) },
    () => runWorker()
  );
  await Promise.all(workers);
  return responses;
}

/** Score any number of jobs with versioned caching and bounded concurrency. */
async function computeFitScores(resumeText, jobs, options = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  const resolved = new Map();
  const misses = [];
  for (const job of jobs) {
    const cachedMatch = readCachedMatch(buildMatchCacheKey(resumeText, job));
    if (cachedMatch) resolved.set(String(job.id), cachedMatch);
    else misses.push(job);
  }

  const batches = [];
  for (let index = 0; index < misses.length; index += MAX_BATCH_SIZE) {
    batches.push(misses.slice(index, index + MAX_BATCH_SIZE));
  }
  let completedBatches = 0;
  const scoredBatches = await runBatchesWithConcurrency(batches, async batch => {
    if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
      throw Object.assign(new Error('SEARCH_CANCELLED'), { code: 'SEARCH_CANCELLED' });
    }
    const scored = await scoreMissingBatch(resumeText, batch);
    completedBatches++;
    if (typeof options.onProgress === 'function') {
      await options.onProgress({ completedBatches, totalBatches: batches.length });
    }
    if (typeof options.shouldCancel === 'function' && await options.shouldCancel()) {
      throw Object.assign(new Error('SEARCH_CANCELLED'), { code: 'SEARCH_CANCELLED' });
    }
    return scored;
  });
  for (const scoredJob of scoredBatches.flat()) resolved.set(scoredJob.id, scoredJob.match);

  return jobs.map(job => ({ id: String(job.id), match: resolved.get(String(job.id)) }));
}

function clearMatchCache() {
  matchCache.clear();
  inFlightBatches.clear();
}

module.exports = {
  extractProfileFromResume,
  computeFitScore,
  computeFitScoresBatch,
  computeFitScores,
  normalizeMatch,
  buildMatchCacheKey,
  clearMatchCache,
  JOB_MATCHING_PROMPT_VERSION,
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_BATCH_SIZE,
  MAX_CONCURRENT_BATCHES,
  MATCH_CACHE_TTL_MS,
};
