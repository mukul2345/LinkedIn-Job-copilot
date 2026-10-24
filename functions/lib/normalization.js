// normalization.js - Job record normalization for Cloud Functions
// Transforms raw listings from various job boards into standardized JobRecord format.

const crypto = require('crypto');
const SUPPORTED_JOB_PLATFORMS = Object.freeze(['linkedin', 'indeed', 'glassdoor']);
const TRACKING_QUERY_PARAMETER = /^(?:utm_.+|trk|tracking|ref|source|src|campaign)$/i;

/**
 * Board-specific field mappings for normalization.
 * Each board returns data in different structures; these maps provide
 * the path to each canonical field in the raw response object.
 */
const BOARD_FIELD_MAPS = {
  linkedin: {
    title: 'title',
    company: 'company_name',
    location: 'location',
    description: 'description',
    salary: 'salary',
    url: 'job_url',
    postedDate: 'date_posted',
  },
  indeed: {
    title: 'title',
    company: 'company',
    location: 'location',
    description: 'description',
    salary: 'salary_text',
    url: 'url',
    postedDate: 'posted_date',
  },
  glassdoor: {
    title: 'job_title',
    company: 'employer_name',
    location: 'location',
    description: 'job_description',
    salary: 'salary_estimate',
    url: 'apply_url',
    postedDate: 'listing_date',
  },
  naukri: {
    title: 'title',
    company: 'company',
    location: 'location',
    description: 'jobDescription',
    salary: 'salary',
    url: 'url',
    postedDate: 'createdDate',
  },
  uplers: {
    title: 'job_title',
    company: 'company_name',
    location: 'location',
    description: 'description',
    salary: 'compensation',
    url: 'apply_link',
    postedDate: 'posted_on',
  },
  adzuna: {
    title: 'title',
    company: 'company.display_name',
    location: 'location.display_name',
    description: 'description',
    salary: 'salary_max',
    url: 'redirect_url',
    postedDate: 'created',
  },
};

/**
 * Access a nested object value via dot-notation path.
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path (e.g. "company.display_name")
 * @returns {*} The resolved value, or undefined if path is invalid
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

/**
 * Parse a date value into an ISO date string.
 * Handles Date objects, ISO strings, epoch numbers, and common date formats.
 * @param {*} value - Raw date value from scraper
 * @returns {string|null} ISO date string or null if unparseable
 */
function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

/**
 * Build a normalized deduplication key from job fields.
 * Case-insensitive, trimmed, whitespace-collapsed, pipe-delimited.
 * @param {string} title - Job title
 * @param {string} company - Company name
 * @param {string} location - Job location
 * @returns {string} Normalized pipe-delimited key
 */
function buildDeduplicationKey(title, company, location) {
  const normalize = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return `${normalize(title)}|${normalize(company)}|${normalize(location)}`;
}

/**
 * Generate a deterministic job ID using SHA-256 hash of normalized (title, company, location).
 * Uses Node.js crypto module (runs in Cloud Functions environment).
 * @param {string} title - Job title
 * @param {string} company - Company name
 * @param {string} location - Job location
 * @returns {string} 16-character hex string (first 16 chars of SHA-256 digest)
 */
function generateJobId(title, company, location) {
  const key = buildDeduplicationKey(title, company, location);
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
}

/**
 * Canonical field map matching the scraper service's pre-normalized output.
 *
 * scraper/main.py `_normalize_job()` already flattens EVERY board's raw listing
 * into this consistent shape before returning. The Cloud Function therefore
 * receives these keys regardless of source board, so they are tried first during
 * normalization. The per-board BOARD_FIELD_MAPS below are kept as a fallback for
 * any caller that passes a raw, un-normalized board listing.
 */
const SCRAPER_FIELD_MAP = {
  title: 'title',
  company: 'company',
  location: 'location',
  description: 'description',
  salary: 'salary',
  url: 'url',
  postedDate: 'posted_date',
};

/**
 * Resolve a canonical field, preferring the scraper's flat key and falling back
 * to the raw board-specific key. Objects from the scraper key are ignored so a
 * nested raw structure (e.g. adzuna's `company.display_name`) still resolves via
 * its board-specific path.
 *
 * @param {Object} raw - Raw listing object
 * @param {string} scraperKey - Key in the scraper's flat schema
 * @param {string} boardKey - Dot-notation path in the raw board schema
 * @returns {*} The resolved value, or undefined
 */
function resolveField(raw, scraperKey, boardKey) {
  const fromScraper = getNestedValue(raw, scraperKey);
  if (fromScraper != null && fromScraper !== '' && typeof fromScraper !== 'object') {
    return fromScraper;
  }
  return getNestedValue(raw, boardKey);
}

/** Parse a salary string only when a numeric range is explicit. */
function parseSalaryRange(value) {
  if (value && typeof value === 'object') return value;
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const values = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map(match => Number(match[0].replace(/,/g, '')))
    .filter(Number.isFinite);
  if (!values.length) return null;
  const multiplier = /\b(?:lakh|lakhs|lpa)\b/i.test(text) ? 100000
    : /\d(?:\.\d+)?\s*k\b/i.test(text) ? 1000 : 1;
  const normalizedValues = values.slice(0, 2).map(number => number * multiplier);
  const currency = /₹|\bINR\b/i.test(text) ? 'INR'
    : /\$|\bUSD\b/i.test(text) ? 'USD'
      : /£|\bGBP\b/i.test(text) ? 'GBP'
        : /€|\bEUR\b/i.test(text) ? 'EUR' : null;
  return {
    minimum: Math.min(...normalizedValues),
    maximum: Math.max(...normalizedValues),
    currency,
    text,
  };
}

function extractRequiredExperienceYears(text) {
  const pattern = /(?:^|[^\d])\(?(\d{1,2})\)?\s*(?:\+|[-–]\s*\d{1,2}|to\s+\d{1,2})?\s*years?\b/gi;
  const years = [];
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const value = Number.parseInt(match[1], 10);
    if (value > 0 && value <= 15) years.push(value);
  }
  return years.length ? Math.max(...years) : null;
}

function canonicalizeJobUrl(rawUrl) {
  const parsedUrl = new URL(rawUrl);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('HTTPS_REQUIRED');
  }
  parsedUrl.hash = '';
  for (const parameterName of [...parsedUrl.searchParams.keys()]) {
    if (TRACKING_QUERY_PARAMETER.test(parameterName)) parsedUrl.searchParams.delete(parameterName);
  }
  parsedUrl.searchParams.sort();
  return parsedUrl.toString().replace(/\/$/, '');
}

/**
 * Normalize a raw job listing from a specific board into a standardized JobRecord.
 * Ensures required fields (id, title, company, location, url, sourceBoard) are always
 * non-null strings. Optional fields (salary, postedDate, description) may be null.
 *
 * @param {Object} raw - Raw listing object from scraper
 * @param {string} board - Supported source board: linkedin, indeed, or glassdoor
 * @returns {Object} Normalized JobRecord
 */
function normalizeJobRecord(raw, board) {
  const fieldMap = BOARD_FIELD_MAPS[board];
  if (!SUPPORTED_JOB_PLATFORMS.includes(board) || !fieldMap) {
    const error = new Error(`Unsupported job platform: ${board}`);
    error.code = 'UNSUPPORTED_PLATFORM';
    throw error;
  }

  const title = String(resolveField(raw, SCRAPER_FIELD_MAP.title, fieldMap.title) || '').trim();
  const company = String(resolveField(raw, SCRAPER_FIELD_MAP.company, fieldMap.company) || '').trim();
  const location = String(resolveField(raw, SCRAPER_FIELD_MAP.location, fieldMap.location) || '').trim();
  const description = String(resolveField(raw, SCRAPER_FIELD_MAP.description, fieldMap.description) || '').trim();
  const salaryRaw = resolveField(raw, SCRAPER_FIELD_MAP.salary, fieldMap.salary);
  const salary = parseSalaryRange(salaryRaw);
  const rawUrl = String(resolveField(raw, SCRAPER_FIELD_MAP.url, fieldMap.url) || '').trim();
  const postedDate = parseDate(resolveField(raw, SCRAPER_FIELD_MAP.postedDate, fieldMap.postedDate));
  const platformJobId = String(raw.platform_job_id || raw.job_id || raw.id || '').trim() || null;

  let url;
  try {
    url = canonicalizeJobUrl(rawUrl);
  } catch (_) {
    const error = new Error('Job URL must be a valid HTTPS URL.');
    error.code = 'INVALID_JOB_URL';
    throw error;
  }
  if (!title) {
    const error = new Error('Job title is required.');
    error.code = 'MISSING_JOB_TITLE';
    throw error;
  }

  const identity = platformJobId ? `${board}:${platformJobId}` : `${board}:${url}`;
  const id = crypto.createHash('sha256').update(identity).digest('hex').substring(0, 16);

  return {
    id,
    schemaVersion: 1,
    platform: board,
    platformJobId,
    title,
    company: company || null,
    location: location || null,
    description: description || null,
    salary,
    url,
    canonicalUrl: url,
    employmentType: raw.employment_type || raw.job_type || null,
    remoteType: raw.remote_type || null,
    requiredSkills: [],
    preferredSkills: [],
    applicationCapability: board === 'linkedin' ? 'DIRECT_APPLY' : 'EXTERNAL_APPLY',
    metadata: {
      salaryText: salaryRaw != null ? String(salaryRaw).trim() : null,
      requiredExperienceYears: extractRequiredExperienceYears(description),
    },
    sourceBoard: board,
    postedAt: postedDate,
    postedDate,
    fitScore: null,
    fitExplanation: null,
    fitExcludedDimensions: [],
    sponsorship: null,
    sponsorshipConfidence: 'full',
  };
}

module.exports = {
  BOARD_FIELD_MAPS,
  SUPPORTED_JOB_PLATFORMS,
  SCRAPER_FIELD_MAP,
  getNestedValue,
  resolveField,
  parseDate,
  buildDeduplicationKey,
  generateJobId,
  parseSalaryRange,
  extractRequiredExperienceYears,
  canonicalizeJobUrl,
  normalizeJobRecord,
};
