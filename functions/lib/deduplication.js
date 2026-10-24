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
  const { sourceListings: _sourceListings, searchProvenance: _searchProvenance, ...sourceFields } = job;
  return Object.values(sourceFields).filter(
    (value) => value != null && value !== '' && !(Array.isArray(value) && value.length === 0)
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
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  const normalizedText = value => String(value || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const descriptionSimilarity = (left, right) => {
    if (!left || !right) return 0;
    const leftTokens = new Set(normalizedText(left).split(' ').filter(token => token.length > 3));
    const rightTokens = new Set(normalizedText(right).split(' ').filter(token => token.length > 3));
    if (!leftTokens.size || !rightTokens.size) return 0;
    let shared = 0;
    for (const token of leftTokens) if (rightTokens.has(token)) shared++;
    return shared / new Set([...leftTokens, ...rightTokens]).size;
  };
  const isHighConfidenceDuplicate = (left, right) => {
    if (left.platform === right.platform && left.platformJobId && left.platformJobId === right.platformJobId) return true;
    if (left.canonicalUrl && left.canonicalUrl === right.canonicalUrl) return true;
    return normalizedText(left.title) === normalizedText(right.title) &&
      normalizedText(left.company) === normalizedText(right.company) &&
      normalizedText(left.location) === normalizedText(right.location) &&
      descriptionSimilarity(left.description, right.description) >= 0.8;
  };

  const results = [];
  for (const job of jobs) {
    const duplicateIndex = results.findIndex(existing => isHighConfidenceDuplicate(existing, job));
    if (duplicateIndex === -1) {
      results.push({
        ...job,
        sourceListings: [{ platform: job.platform, url: job.url }],
        searchProvenance: job.searchProvenance || [],
      });
      continue;
    }
    const existing = results[duplicateIndex];
    const existingCompleteness = countNonNullFields(existing);
    const incomingCompleteness = countNonNullFields(job);
    const best = incomingCompleteness > existingCompleteness ||
      (incomingCompleteness === existingCompleteness && String(job.id) < String(existing.id))
      ? job
      : existing;
    const stableId = [existing.id, job.id].filter(Boolean).sort()[0] || best.id;
    const sourceListings = [
      ...(existing.sourceListings || [{ platform: existing.platform, url: existing.url }]),
      { platform: job.platform, url: job.url },
    ].filter((listing, index, listings) => listings.findIndex(candidate =>
      candidate.platform === listing.platform && candidate.url === listing.url
    ) === index);
    const searchProvenance = [
      ...(existing.searchProvenance || []),
      ...(job.searchProvenance || []),
    ].filter((entry, index, entries) => entries.findIndex(candidate =>
      candidate.query === entry.query && candidate.location === entry.location
    ) === index);
    results[duplicateIndex] = { ...best, id: stableId, sourceListings, searchProvenance };
  }
  return results;
}

module.exports = {
  countNonNullFields,
  deduplicateJobs,
  buildDeduplicationKey,
};
