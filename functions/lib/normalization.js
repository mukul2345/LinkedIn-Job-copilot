// normalization.js - Job record normalization for Cloud Functions
// Transforms raw listings from various job boards into standardized JobRecord format.

const crypto = require('crypto');

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
 * Normalize a raw job listing from a specific board into a standardized JobRecord.
 * Ensures required fields (id, title, company, location, url, sourceBoard) are always
 * non-null strings. Optional fields (salary, postedDate, description) may be null.
 *
 * @param {Object} raw - Raw listing object from scraper
 * @param {string} board - Source board identifier (linkedin, indeed, glassdoor, naukri, uplers, adzuna)
 * @returns {Object} Normalized JobRecord
 */
function normalizeJobRecord(raw, board) {
  const fieldMap = BOARD_FIELD_MAPS[board] || BOARD_FIELD_MAPS.indeed;

  const title = String(getNestedValue(raw, fieldMap.title) || '').trim();
  const company = String(getNestedValue(raw, fieldMap.company) || '').trim();
  const location = String(getNestedValue(raw, fieldMap.location) || '').trim();
  const description = String(getNestedValue(raw, fieldMap.description) || '').trim();
  const salaryRaw = getNestedValue(raw, fieldMap.salary);
  const salary = salaryRaw != null && salaryRaw !== '' ? String(salaryRaw).trim() : null;
  const url = String(getNestedValue(raw, fieldMap.url) || '').trim();
  const postedDate = parseDate(getNestedValue(raw, fieldMap.postedDate));

  const id = generateJobId(title, company, location);

  return {
    id,
    title: title || 'Untitled',
    company: company || 'Unknown Company',
    location: location || 'Unknown Location',
    description: description || null,
    salary,
    url: url || '',
    sourceBoard: board,
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
  getNestedValue,
  parseDate,
  buildDeduplicationKey,
  generateJobId,
  normalizeJobRecord,
};
