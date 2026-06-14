// filters.js - Job filtering and sorting functions for JobPilot Enhanced Features
// Supports multi-criteria filtering (AND logic) and fit-score-based sorting.

/**
 * Filter jobs by multiple criteria simultaneously.
 * All active criteria must be satisfied (AND logic).
 *
 * @param {JobRecord[]} jobs - Array of job records to filter
 * @param {Object} filters - Filter criteria object
 * @param {string[]} [filters.boards] - Source boards to include
 * @param {string} [filters.location] - Location substring match (case-insensitive)
 * @param {string} [filters.jobType] - Job type exact match (case-insensitive)
 * @param {string} [filters.datePosted] - "24h"|"week"|"month"
 * @param {number} [filters.minFitScore] - Minimum score threshold (0-100)
 * @param {string[]} [filters.sponsorshipStatuses] - Visa statuses to include
 * @returns {JobRecord[]} - Filtered array of jobs satisfying all active criteria
 */
// eslint-disable-next-line no-var
var filterJobs = function filterJobs(jobs, filters) {
  if (!Array.isArray(jobs)) return [];
  if (!filters || typeof filters !== 'object') return jobs;

  return jobs.filter(function (job) {
    // Board filter
    if (filters.boards && filters.boards.length > 0) {
      if (!filters.boards.includes(job.sourceBoard)) {
        return false;
      }
    }

    // Location filter (case-insensitive substring)
    if (filters.location) {
      var jobLocation = (job.location || '').toLowerCase();
      if (!jobLocation.includes(filters.location.toLowerCase())) {
        return false;
      }
    }

    // Job type filter (exact match, case-insensitive)
    if (filters.jobType) {
      var jobType = (job.jobType || '').toLowerCase();
      if (jobType !== filters.jobType.toLowerCase()) {
        return false;
      }
    }

    // Date posted filter
    if (filters.datePosted && job.postedDate) {
      var cutoff = getDateCutoff(filters.datePosted);
      if (new Date(job.postedDate) < cutoff) {
        return false;
      }
    }

    // Fit score threshold
    if (filters.minFitScore != null && filters.minFitScore > 0) {
      if (job.fitScore == null || job.fitScore < filters.minFitScore) {
        return false;
      }
    }

    // Sponsorship status filter
    if (filters.sponsorshipStatuses && filters.sponsorshipStatuses.length > 0) {
      if (!job.sponsorship || !filters.sponsorshipStatuses.includes(job.sponsorship)) {
        return false;
      }
    }

    return true;
  });
};

/**
 * Sort jobs by fit score in descending order.
 * Jobs with null scores are placed at the end.
 *
 * @param {JobRecord[]} jobs - Array of job records to sort
 * @returns {JobRecord[]} - New sorted array (does not mutate input)
 */
// eslint-disable-next-line no-var
var sortByFitScore = function sortByFitScore(jobs) {
  if (!Array.isArray(jobs)) return [];

  return jobs.slice().sort(function (a, b) {
    if (a.fitScore == null && b.fitScore == null) return 0;
    if (a.fitScore == null) return 1;
    if (b.fitScore == null) return -1;
    return b.fitScore - a.fitScore;
  });
};

/**
 * Get cutoff date for "date posted" filter.
 *
 * @param {string} period - "24h"|"week"|"month"
 * @returns {Date} - Cutoff date; jobs older than this should be filtered out
 */
// eslint-disable-next-line no-var
var getDateCutoff = function getDateCutoff(period) {
  var now = new Date();
  switch (period) {
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(0); // no cutoff
  }
};
