// deduplication.js - Job record deduplication for Cloud Functions
// Groups duplicate listings by normalized (title, company, location) and retains
// the record with the most complete data.

const { buildDeduplicationKey } = require('./normalization');

/**
 * Count non-null, non-undefined, non-empty-string fields in a job record.
 * Used to determine which duplicate record has the most complete data.
 * @param {Object} job - A job record object
 * @returns {number} Count of fields with meaningful values
 */
function countNonNullFields(job) {
  return Object.values(job).filter(
    (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
  ).length;
}

/**
 * Deduplicate job records by case-insensitive matching on (title, company, location).
 * For each group of duplicates, retains the record with the highest number of
 * non-null fields (most complete data). Tracks merged source URLs in deduplicatedFrom.
 *
 * Time complexity: O(n)
 * Space complexity: O(n)
 *
 * @param {Object[]} jobs - Array of normalized job records
 * @returns {Object[]} Deduplicated records
 */
function deduplicateJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return [];
  }

  const groups = new Map();

  for (const job of jobs) {
    const key = buildDeduplicationKey(job.title, job.company, job.location);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(job);
  }

  const results = [];
  for (const [, group] of groups) {
    // Pick the record with the most non-null fields
    const best = group.reduce((a, b) =>
      countNonNullFields(a) >= countNonNullFields(b) ? a : b
    );
    // Track which source URLs were merged into this record
    best.deduplicatedFrom = group
      .map((j) => j.url)
      .filter((u) => u && u !== best.url);
    results.push(best);
  }

  return results;
}

module.exports = {
  countNonNullFields,
  deduplicateJobs,
  buildDeduplicationKey,
};
