/** Durable discovery pipeline composed from existing normalization and matching services. */

const crypto = require('crypto');
const {
  resolveMatchingCriteria,
  searchAcrossCriteria,
  getHardFilterReasons,
  compareRankedJobs,
  loadLatestResume,
} = require('./job-matching');
const { extractProfileFromResume, computeFitScores } = require('./ai-job-matcher');
const { normalizeJobRecord } = require('./lib/normalization');
const { deduplicateJobs } = require('./lib/deduplication');
const {
  SearchAiStatus,
  SearchSessionStage,
  SearchSessionStatus,
  SearchSourceState,
  SEARCH_LIMITS,
} = require('./lib/search-session-contracts');

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function countCodes(codes) {
  return codes.reduce((counts, code) => {
    counts[code] = (counts[code] || 0) + 1;
    return counts;
  }, {});
}

function buildSourceStatuses(criteria, scraperResult) {
  return criteria.platforms.map(platform => {
    const failures = scraperResult.failed_boards.filter(item => item.board === platform);
    const hasQueryFailures = scraperResult.failedQueries.length > 0;
    return {
      platform,
      state: failures.length || hasQueryFailures ? SearchSourceState.PARTIAL : SearchSourceState.COMPLETED,
      attemptCount: scraperResult.requests.length,
      errorCodes: [
        ...failures.map(item => item.error || 'SCRAPER_UNAVAILABLE'),
        ...(hasQueryFailures ? ['PARTIAL_QUERY_FAILURE'] : []),
      ],
    };
  });
}

class SearchCancelledError extends Error {
  constructor() {
    super('SEARCH_CANCELLED');
    this.name = 'SearchCancelledError';
    this.code = 'SEARCH_CANCELLED';
  }
}

class JobSearchOrchestrator {
  constructor({
    repository,
    db,
    search = searchAcrossCriteria,
    extractProfile = extractProfileFromResume,
    scoreJobs = computeFitScores,
    loadResume = loadLatestResume,
    now = () => new Date(),
  }) {
    if (!repository || !db) throw new TypeError('Repository and Firestore are required.');
    this.repository = repository;
    this.db = db;
    this.search = search;
    this.extractProfile = extractProfile;
    this.scoreJobs = scoreJobs;
    this.loadResume = loadResume;
    this.now = now;
  }

  async create(userId, explicitCriteria = {}) {
    const userSnapshot = await this.db.collection('users').doc(userId).get();
    if (!userSnapshot.exists) throw new Error('USER_NOT_FOUND');
    const userDocument = userSnapshot.data() || {};
    const criteria = resolveMatchingCriteria(
      explicitCriteria,
      userDocument.preferences || {},
      {},
    );
    const { requests, truncated } = require('./job-matching').buildSearchRequests(criteria);
    return this.repository.create(userId, {
      criteria,
      criteriaVersion: digest(criteria),
      candidateProfileVersion: digest(userDocument.profile || userDocument.updatedAt || {}),
      queryTasks: requests.map((request, index) => ({
        id: `query-${index + 1}`,
        ...request,
        state: 'PENDING',
      })),
      searchRequestsTruncated: truncated,
      sourceStatuses: criteria.platforms.map(platform => ({
        platform,
        state: SearchSourceState.PENDING,
        attemptCount: 0,
        errorCodes: [],
      })),
    });
  }

  async throwIfCancelled(userId, sessionId) {
    if (await this.repository.isCancellationRequested(userId, sessionId)) {
      throw new SearchCancelledError();
    }
  }

  normalizeDiscoveredJobs(rawJobs, sessionId) {
    const discoveredAt = this.now().toISOString();
    const normalizedJobs = [];
    const normalizationErrors = [];
    for (const rawJob of rawJobs) {
      try {
        const job = normalizeJobRecord(rawJob, rawJob.source_board || rawJob.sourceBoard);
        const query = rawJob.search_query || null;
        const location = rawJob.search_location || null;
        job.discovery = {
          platform: job.platform,
          queryId: digest({ query, location }).slice(0, 16),
          query,
          location,
          searchSessionId: sessionId,
          discoveredAt,
          sourceUrl: job.url,
          platformJobId: job.platformJobId || null,
        };
        job.searchProvenance = [{ query, location }];
        normalizedJobs.push(job);
      } catch (error) {
        normalizationErrors.push(error.code || 'NORMALIZATION_FAILED');
      }
    }
    return { jobs: deduplicateJobs(normalizedJobs), normalizationErrors };
  }

  async scoreEligibleJobs(resumeText, eligibleJobs, criteria, options = {}) {
    const jobsToScore = eligibleJobs
      .filter(job => job.description)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .slice(0, SEARCH_LIMITS.maxJobsToScore);
    if (!resumeText || !jobsToScore.length) {
      return {
        jobs: eligibleJobs.map(job => ({ ...job, match: null, matchStatus: 'AI_UNAVAILABLE' })),
        ai: { status: SearchAiStatus.UNAVAILABLE, errorCode: 'PROFILE_INCOMPLETE' },
      };
    }
    try {
      const scores = await this.scoreJobs(resumeText, jobsToScore, options);
      const scoreMap = new Map(scores.map(result => [result.id, result.match]));
      const jobs = eligibleJobs.map(job => ({
        ...job,
        match: scoreMap.get(String(job.id)) || null,
        matchStatus: scoreMap.has(String(job.id)) ? 'AVAILABLE' : 'NOT_SCORED',
      }));
      return {
        jobs: jobs.filter(job => !job.match || job.match.score >= criteria.matchThreshold),
        ai: { status: SearchAiStatus.AVAILABLE, errorCode: null },
      };
    } catch (error) {
      if (error.code === 'SEARCH_CANCELLED') throw error;
      return {
        jobs: eligibleJobs.map(job => ({ ...job, match: null, matchStatus: 'AI_UNAVAILABLE' })),
        ai: { status: SearchAiStatus.UNAVAILABLE, errorCode: error.code || error.message || 'AI_UNAVAILABLE' },
      };
    }
  }

  async run(userId, sessionId) {
    const initial = await this.repository.get(userId, sessionId);
    if (!initial) throw new Error('SEARCH_SESSION_NOT_FOUND');
    if ([SearchSessionStatus.COMPLETED, SearchSessionStatus.PARTIAL,
      SearchSessionStatus.CANCELLED].includes(initial.status)) return initial;

    const lease = await this.repository.acquireExecutionLease(userId, sessionId);
    if (!lease.acquired) {
      // Another run already owns this session; return current state rather than
      // executing the same discovery pipeline concurrently.
      return this.repository.get(userId, sessionId);
    }
    const leaseOwner = lease.leaseOwner;

    try {
      await this.throwIfCancelled(userId, sessionId);
      await this.repository.update(userId, sessionId, {
        status: SearchSessionStatus.RUNNING,
        stage: SearchSessionStage.DISCOVERING,
      });
      const userSnapshot = await this.db.collection('users').doc(userId).get();
      if (!userSnapshot.exists) throw new Error('USER_NOT_FOUND');
      const userDocument = userSnapshot.data() || {};
      let resumeText = '';
      let extractedProfile = {};
      try {
        resumeText = await this.loadResume(this.db, userId);
        extractedProfile = await this.extractProfile(resumeText);
      } catch (_) {
        // Discovery can continue from explicit/persisted criteria without AI.
      }
      const criteria = resolveMatchingCriteria(
        initial.criteria,
        userDocument.preferences || {},
        extractedProfile,
      );
      if (!criteria.titles.length || !criteria.platforms.length) {
        throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' });
      }

      const scraperResult = await this.search(criteria, undefined, {
        shouldCancel: () => this.repository.isCancellationRequested(userId, sessionId),
        onProgress: progress => this.repository.update(userId, sessionId, {
          completedQueries: progress.completedQueries,
          queryTasks: progress.queryTasks,
        }),
      });
      await this.throwIfCancelled(userId, sessionId);
      await this.repository.update(userId, sessionId, {
        stage: SearchSessionStage.FILTERING,
        criteria,
        completedQueries: scraperResult.requests.length - scraperResult.failedQueries.length,
        failedQueries: scraperResult.failedQueries,
        sourceStatuses: buildSourceStatuses(criteria, scraperResult),
      });

      const normalized = this.normalizeDiscoveredJobs(scraperResult.jobs, sessionId);
      const excludedJobs = [];
      const eligibleJobs = [];
      for (const job of normalized.jobs) {
        const reasonCodes = getHardFilterReasons(job, criteria);
        if (reasonCodes.length) excludedJobs.push({ id: job.id, reasonCodes });
        else eligibleJobs.push({ ...job, hardFilter: { eligible: true, reasonCodes: [] } });
      }

      await this.throwIfCancelled(userId, sessionId);
      await this.repository.update(userId, sessionId, { stage: SearchSessionStage.SCORING });
      const scored = await this.scoreEligibleJobs(resumeText, eligibleJobs, criteria, {
        shouldCancel: () => this.repository.isCancellationRequested(userId, sessionId),
        onProgress: progress => this.repository.update(userId, sessionId, {
          ai: { status: SearchAiStatus.PENDING, errorCode: null, ...progress },
        }),
      });
      const rankedJobs = scored.jobs.sort((left, right) => {
        if (left.match && right.match) return compareRankedJobs(left, right);
        if (left.match) return -1;
        if (right.match) return 1;
        const rightDate = Date.parse(right.postedAt || '') || 0;
        const leftDate = Date.parse(left.postedAt || '') || 0;
        return rightDate - leftDate || String(left.id).localeCompare(String(right.id));
      });

      await this.throwIfCancelled(userId, sessionId);
      await this.repository.update(userId, sessionId, { stage: SearchSessionStage.SNAPSHOTTING });
      const snapshotId = await this.repository.writeResultSnapshot(userId, sessionId, rankedJobs);
      await this.throwIfCancelled(userId, sessionId);

      const warningCodes = [];
      if (scraperResult.failedQueries.length) warningCodes.push('PARTIAL_QUERY_FAILURE');
      if (scraperResult.failed_boards.length) warningCodes.push('PARTIAL_SOURCE_FAILURE');
      if (scored.ai.status === SearchAiStatus.UNAVAILABLE) warningCodes.push('AI_UNAVAILABLE');
      if (scraperResult.truncated) warningCodes.push('SEARCH_REQUESTS_TRUNCATED');
      if (normalized.normalizationErrors.length) warningCodes.push('NORMALIZATION_PARTIAL');
      const status = warningCodes.length
        ? SearchSessionStatus.PARTIAL
        : SearchSessionStatus.COMPLETED;
      const { session } = await this.repository.completeIfNotCancelled(userId, sessionId, {
        status,
        stage: SearchSessionStage.COMPLETE,
        ai: scored.ai,
        resultSnapshotId: snapshotId,
        resultCount: rankedJobs.length,
        excludedJobs,
        warningCodes,
        normalizationErrorCount: normalized.normalizationErrors.length,
        normalizationErrors: countCodes(normalized.normalizationErrors),
      });
      return session;
    } catch (error) {
      if (error instanceof SearchCancelledError || error.code === 'SEARCH_CANCELLED') {
        return this.repository.acknowledgeCancellation(userId, sessionId);
      }
      await this.repository.update(userId, sessionId, {
        status: SearchSessionStatus.FAILED,
        stage: SearchSessionStage.COMPLETE,
        errorCode: error.code || error.message || 'SEARCH_SESSION_FAILED',
      });
      throw error;
    } finally {
      await this.repository.releaseExecutionLease(userId, sessionId, leaseOwner).catch(() => {});
    }
  }
}

module.exports = {
  JobSearchOrchestrator,
  SearchCancelledError,
  buildSourceStatuses,
  digest,
};
