// job-domain.js - Platform-neutral job and application domain definitions.

// eslint-disable-next-line no-var
var JobPlatform = Object.freeze({
  LINKEDIN: 'linkedin',
  INDEED: 'indeed',
  GLASSDOOR: 'glassdoor',
  ZIP_RECRUITER: 'zip_recruiter',
  UNKNOWN: 'unknown',
});

// eslint-disable-next-line no-var
var ApplicationCapability = Object.freeze({
  DIRECT_APPLY: 'DIRECT_APPLY',
  EXTERNAL_APPLY: 'EXTERNAL_APPLY',
  UNSUPPORTED: 'UNSUPPORTED',
  REQUIRES_USER: 'REQUIRES_USER',
});

// eslint-disable-next-line no-var
var ApplicationState = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  ANALYZING: 'ANALYZING',
  MATCHED: 'MATCHED',
  SKIPPED: 'SKIPPED',
  READY: 'READY',
  APPLYING: 'APPLYING',
  NEEDS_USER_INPUT: 'NEEDS_USER_INPUT',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  MANUAL_INTERVENTION: 'MANUAL_INTERVENTION',
  EXTERNAL_APPLICATION: 'EXTERNAL_APPLICATION',
  EXTERNAL_SUBMISSION_CONFIRMED: 'EXTERNAL_SUBMISSION_CONFIRMED',
  SUBMITTED: 'SUBMITTED',
  FAILED: 'FAILED',
});

// eslint-disable-next-line no-var
var MatchRecommendation = Object.freeze({
  STRONG_MATCH: 'STRONG_MATCH',
  MATCH: 'MATCH',
  WEAK_MATCH: 'WEAK_MATCH',
  NO_MATCH: 'NO_MATCH',
});

const JOB_SCHEMA_VERSION = 1;
const DEFAULT_MATCH_THRESHOLD = 70;

/** Return a canonical HTTPS URL without tracking/hash data. */
function canonicalizeJobUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return '';
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|trk|tracking|ref|source)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

/** Build a deterministic non-cryptographic fingerprint for storage identity. */
function buildJobFingerprint(value) {
  let hash = 2166136261;
  const normalized = String(value || '').trim().toLowerCase();
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `job_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Build identity using platform ID, canonical URL, then a stable fingerprint. */
function buildJobIdentity(input) {
  const platform = Object.values(JobPlatform).includes(input.platform)
    ? input.platform
    : JobPlatform.UNKNOWN;
  if (input.platformJobId) {
    return `${platform}:${String(input.platformJobId).trim()}`;
  }
  const canonicalUrl = canonicalizeJobUrl(input.url);
  if (canonicalUrl) return `${platform}:url:${buildJobFingerprint(canonicalUrl)}`;

  const fallback = [input.title, input.company, input.location]
    .map(value => String(value || '').trim().toLowerCase())
    .join('|');
  return `${platform}:fingerprint:${buildJobFingerprint(fallback)}`;
}

/** Create an immutable normalized job without inventing missing board fields. */
function createJob(input) {
  const platform = Object.values(JobPlatform).includes(input?.platform)
    ? input.platform
    : JobPlatform.UNKNOWN;
  const canonicalUrl = canonicalizeJobUrl(input?.url);
  const job = {
    schemaVersion: JOB_SCHEMA_VERSION,
    id: input?.id || buildJobIdentity({ ...input, platform, url: canonicalUrl }),
    platform,
    platformJobId: input?.platformJobId ? String(input.platformJobId) : null,
    title: String(input?.title || '').trim(),
    company: input?.company ? String(input.company).trim() : null,
    location: input?.location ? String(input.location).trim() : null,
    url: canonicalUrl,
    description: input?.description ? String(input.description).trim() : null,
    employmentType: input?.employmentType || null,
    remoteType: input?.remoteType || null,
    salary: input?.salary || null,
    postedAt: input?.postedAt || null,
    requiredSkills: Array.isArray(input?.requiredSkills) ? [...input.requiredSkills] : [],
    preferredSkills: Array.isArray(input?.preferredSkills) ? [...input.preferredSkills] : [],
    applicationCapability: Object.values(ApplicationCapability).includes(input?.applicationCapability)
      ? input.applicationCapability
      : null,
    metadata: input?.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  };
  return Object.freeze(job);
}

/** Validate data before it enters core job services. */
function validateJob(job) {
  const errors = [];
  if (!job || typeof job !== 'object') return { valid: false, errors: ['JOB_REQUIRED'] };
  if (!Object.values(JobPlatform).includes(job.platform) || job.platform === JobPlatform.UNKNOWN) {
    errors.push('PLATFORM_UNSUPPORTED');
  }
  if (!job.title?.trim()) errors.push('TITLE_REQUIRED');
  if (!canonicalizeJobUrl(job.url)) errors.push('HTTPS_URL_REQUIRED');
  return { valid: errors.length === 0, errors };
}

/** Infer a supported platform from an untrusted URL. */
function inferJobPlatform(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    if (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')) return JobPlatform.LINKEDIN;
    if (hostname === 'indeed.com' || hostname.endsWith('.indeed.com')) return JobPlatform.INDEED;
    if (hostname === 'glassdoor.com' || hostname.endsWith('.glassdoor.com')) return JobPlatform.GLASSDOOR;
    if (hostname === 'ziprecruiter.com' || hostname.endsWith('.ziprecruiter.com')) return JobPlatform.ZIP_RECRUITER;
  } catch (_) { /* Invalid URLs are unsupported. */ }
  return JobPlatform.UNKNOWN;
}
