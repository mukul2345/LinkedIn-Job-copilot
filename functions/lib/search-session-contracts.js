/** Versioned contracts and bounded limits for durable job-search sessions. */

const SEARCH_SESSION_SCHEMA_VERSION = 1;
const SEARCH_RESULT_SCHEMA_VERSION = 1;

const SearchSessionStatus = Object.freeze({
  CREATED: 'CREATED',
  RUNNING: 'RUNNING',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const SearchSessionStage = Object.freeze({
  CREATED: 'CREATED',
  DISCOVERING: 'DISCOVERING',
  FILTERING: 'FILTERING',
  SCORING: 'SCORING',
  SNAPSHOTTING: 'SNAPSHOTTING',
  COMPLETE: 'COMPLETE',
});

const SearchTaskState = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const SearchSourceState = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const SearchAiStatus = Object.freeze({
  PENDING: 'PENDING',
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_REQUESTED: 'NOT_REQUESTED',
});

const SearchCancellationState = Object.freeze({
  NONE: 'NONE',
  REQUESTED: 'REQUESTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
});

const ManualInterventionReason = Object.freeze({
  CAPTCHA: 'CAPTCHA',
  MFA: 'MFA',
  AUTH_WALL: 'AUTH_WALL',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  NEEDS_USER_INPUT: 'NEEDS_USER_INPUT',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  SUBMISSION_UNCONFIRMED: 'SUBMISSION_UNCONFIRMED',
});

const SEARCH_LIMITS = Object.freeze({
  maxQueriesPerSearch: 20,
  maxResultsPerQuery: 20,
  maxPagesPerQuery: 1,
  maxConcurrentQueries: 3,
  maxJobsToScore: 50,
  resultPageSize: 25,
  sessionTtlMs: 24 * 60 * 60 * 1000,
});

const TERMINAL_STATUSES = new Set([
  SearchSessionStatus.PARTIAL,
  SearchSessionStatus.COMPLETED,
  SearchSessionStatus.FAILED,
  SearchSessionStatus.CANCELLED,
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [SearchSessionStatus.CREATED]: new Set([
    SearchSessionStatus.RUNNING,
    SearchSessionStatus.FAILED,
    SearchSessionStatus.CANCELLED,
  ]),
  [SearchSessionStatus.RUNNING]: new Set([
    SearchSessionStatus.PARTIAL,
    SearchSessionStatus.COMPLETED,
    SearchSessionStatus.FAILED,
    SearchSessionStatus.CANCELLED,
  ]),
});

function isTerminalSearchStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function validateSearchStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw new Error('INVALID_SEARCH_SESSION_TRANSITION');
  }
  return true;
}

function createSearchSession({
  id,
  userId,
  criteria,
  criteriaVersion = null,
  candidateProfileVersion = null,
  queryTasks = [],
  sourceStatuses = [],
  searchRequestsTruncated = false,
  now = new Date(),
}) {
  if (!id || !userId || !criteria || typeof criteria !== 'object') {
    throw new Error('INVALID_SEARCH_SESSION');
  }
  if (queryTasks.length > SEARCH_LIMITS.maxQueriesPerSearch) {
    throw new Error('SEARCH_QUERY_LIMIT_EXCEEDED');
  }
  const timestamp = now.toISOString();
  return {
    id,
    schemaVersion: SEARCH_SESSION_SCHEMA_VERSION,
    status: SearchSessionStatus.CREATED,
    stage: SearchSessionStage.CREATED,
    criteria,
    criteriaVersion,
    candidateProfileVersion,
    queryTasks,
    completedQueries: 0,
    failedQueries: [],
    sourceStatuses,
    searchRequestsTruncated,
    ai: { status: SearchAiStatus.PENDING, errorCode: null },
    cancellation: {
      state: SearchCancellationState.NONE,
      requestedAt: null,
      acknowledgedAt: null,
    },
    resultSnapshotId: null,
    resultCount: 0,
    warningCodes: [],
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(now.getTime() + SEARCH_LIMITS.sessionTtlMs).toISOString(),
  };
}

module.exports = {
  SEARCH_SESSION_SCHEMA_VERSION,
  SEARCH_RESULT_SCHEMA_VERSION,
  SearchSessionStatus,
  SearchSessionStage,
  SearchTaskState,
  SearchSourceState,
  SearchAiStatus,
  SearchCancellationState,
  ManualInterventionReason,
  SEARCH_LIMITS,
  createSearchSession,
  isTerminalSearchStatus,
  validateSearchStatusTransition,
};
