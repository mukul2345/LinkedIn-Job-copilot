// visa-service.js - Visa sponsorship detection module for JobPilot Enhanced Features
// Retrieves sponsorship status from backend, provides badge rendering helpers,
// confidence notes, and client-side filtering by sponsorship status.

/**
 * Badge configuration for each sponsorship status.
 * Maps status to label, CSS class, and color hex value.
 */
// eslint-disable-next-line no-var
var SPONSORSHIP_BADGE_CONFIG = {
  available: { label: 'Sponsorship', cssClass: 'badge-available', color: '#10b981' },
  unlikely: { label: 'No Sponsor', cssClass: 'badge-unlikely', color: '#ef4444' },
  unknown: { label: 'Unknown', cssClass: 'badge-unknown', color: '#6b7280' },
};

/**
 * Get sponsorship status for a single job.
 * Calls the backend 'classifySponsorship' endpoint with the job ID.
 *
 * @param {string} jobId - The Job_Record ID to classify
 * @returns {Promise<{status: 'available'|'unlikely'|'unknown', confidence: 'full'|'reduced'}>}
 * @throws {ApiError} On authentication failure or backend error
 */
async function getSponsorshipStatus(jobId) {
  var result = await callBackend('classifySponsorship', { jobId: jobId });
  return {
    status: result.status,
    confidence: result.confidence,
  };
}

/**
 * Get sponsorship status for multiple jobs in a single batch request.
 * Calls the backend 'classifySponsorship' endpoint with an array of job IDs.
 *
 * @param {string[]} jobIds - Array of Job_Record IDs to classify
 * @returns {Promise<Object.<string, {status: 'available'|'unlikely'|'unknown', confidence: 'full'|'reduced'}>>}
 *   Map of jobId → SponsorshipResult
 * @throws {ApiError} On authentication failure or backend error
 */
async function getBatchSponsorshipStatus(jobIds) {
  var result = await callBackend('classifySponsorship', { jobIds: jobIds });
  return result;
}

/**
 * Filter jobs by one or more sponsorship statuses (client-side convenience filter).
 * Returns only jobs whose sponsorship field matches one of the provided statuses.
 *
 * @param {JobRecord[]} jobs - Array of job records to filter
 * @param {string[]} statuses - Array of statuses to include (e.g. ['available', 'unknown'])
 * @returns {JobRecord[]} - Filtered array containing only jobs matching the given statuses
 */
function filterBySponsorshipStatus(jobs, statuses) {
  if (!Array.isArray(jobs)) return [];
  if (!Array.isArray(statuses) || statuses.length === 0) return jobs;

  return jobs.filter(function (job) {
    return job.sponsorship && statuses.includes(job.sponsorship);
  });
}

/**
 * Get badge rendering details for a given sponsorship status.
 * Returns label text, CSS class name, and color hex for UI display.
 *
 * @param {'available'|'unlikely'|'unknown'} status - Sponsorship classification status
 * @returns {{label: string, cssClass: string, color: string}} Badge configuration object
 */
function getSponsorshipBadge(status) {
  var config = SPONSORSHIP_BADGE_CONFIG[status];
  if (!config) {
    return SPONSORSHIP_BADGE_CONFIG.unknown;
  }
  return {
    label: config.label,
    cssClass: config.cssClass,
    color: config.color,
  };
}

/**
 * Get a human-readable confidence note for reduced-confidence classifications.
 * Returns empty string when confidence is 'full' (no note needed).
 *
 * @param {'full'|'reduced'} confidence - Classification confidence level
 * @returns {string} Note text for display, or empty string if full confidence
 */
function getSponsorshipConfidenceNote(confidence) {
  if (confidence === 'reduced') {
    return 'Classification based on keyword matching only. AI analysis was unavailable.';
  }
  return '';
}

/**
 * Save the user's active visa filter selection to chrome.storage.local.
 *
 * @param {string[]} statuses - Selected sponsorship statuses for filtering
 * @returns {Promise<void>}
 */
async function saveVisaFilterPreference(statuses) {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ visaFilterStatuses: statuses }, function () {
      resolve();
    });
  });
}

/**
 * Read the user's saved visa filter selection from chrome.storage.local.
 *
 * @returns {Promise<string[]>} Saved statuses array, or empty array if none saved
 */
async function getVisaFilterPreference() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['visaFilterStatuses'], function (data) {
      resolve(data.visaFilterStatuses || []);
    });
  });
}
