// application-history-service.js - Server-owned confirmed outcome ledger client.

/** Record only a provider-confirmed direct or user-confirmed external outcome. */
async function recordConfirmedApplication({ job, outcome, attemptId, receiptId }) {
  if (!job || !['SUBMITTED_CONFIRMED', 'EXTERNAL_CONFIRMED'].includes(outcome)) {
    throw new TypeError('A confirmed application outcome is required.');
  }
  return callBackend('recordApplicationOutcome', {
    jobId: job.id,
    platform: job.platform,
    title: job.title || null,
    company: job.company || null,
    sourceUrl: job.url || null,
    outcome,
    confirmed: true,
    attemptId: attemptId || null,
    receiptId: receiptId || null,
    searchSessionId: job.discovery?.searchSessionId || null,
    matchProvenance: job.match ? {
      status: job.matchStatus || 'AVAILABLE',
      score: job.match.score,
    } : { status: job.matchStatus || 'NOT_SCORED', score: null },
  });
}

/** Read recent confirmed outcomes. */
async function getConfirmedApplicationHistory(limit = 50) {
  return callBackend('getApplicationHistory', { limit });
}

/**
 * Resolve which of the supplied stable attempt identities are already confirmed
 * in the server-owned ledger. Enables cross-device already-applied protection.
 * @param {string[]} attemptIds
 * @returns {Promise<Set<string>>}
 */
async function fetchAppliedAttemptIds(attemptIds) {
  const ids = [...new Set((attemptIds || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const response = await callBackend('checkApplicationApplied', { attemptIds: ids });
  return new Set(Array.isArray(response?.appliedAttemptIds) ? response.appliedAttemptIds : []);
}
