jest.mock('firebase-functions', () => ({
  runWith: jest.fn(() => ({ https: { onRequest: handler => handler } })),
}));
jest.mock('firebase-admin', () => ({ apps: [{}], auth: jest.fn(), firestore: jest.fn() }));

const {
  SearchCancellationState,
  SearchSessionStatus,
  createSearchSession,
} = require('../../functions/lib/search-session-contracts');
const { JobSearchOrchestrator } = require('../../functions/search-session-orchestrator');

class MemorySearchSessionRepository {
  constructor() {
    this.sessions = new Map();
    this.results = new Map();
    this.nextId = 1;
  }

  async create(userId, input) {
    const id = `session-${this.nextId++}`;
    const session = createSearchSession({
      ...input,
      id,
      userId,
      now: new Date('2026-08-30T10:00:00.000Z'),
    });
    this.sessions.set(id, session);
    return session;
  }

  async get(_userId, sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  async update(_userId, sessionId, changes) {
    const next = { ...this.sessions.get(sessionId), ...changes };
    this.sessions.set(sessionId, next);
    return next;
  }

  async requestCancellation(_userId, sessionId) {
    return this.update(null, sessionId, {
      cancellation: { state: SearchCancellationState.REQUESTED },
    });
  }

  async isCancellationRequested(_userId, sessionId) {
    return this.sessions.get(sessionId)?.cancellation?.state === SearchCancellationState.REQUESTED;
  }

  async acknowledgeCancellation(_userId, sessionId) {
    return this.update(null, sessionId, {
      status: SearchSessionStatus.CANCELLED,
      cancellation: { state: SearchCancellationState.ACKNOWLEDGED },
    });
  }

  async acquireExecutionLease(_userId, sessionId, leaseOwner = `lease-${this.nextId++}`) {
    const session = this.sessions.get(sessionId);
    const existing = session?.executionLease;
    if (existing && existing.owner !== leaseOwner) {
      return { acquired: false, leaseOwner: existing.owner, session };
    }
    const lease = { owner: leaseOwner };
    this.sessions.set(sessionId, { ...session, executionLease: lease });
    return { acquired: true, leaseOwner, session: { ...session, executionLease: lease } };
  }

  async releaseExecutionLease(_userId, sessionId, leaseOwner) {
    const session = this.sessions.get(sessionId);
    if (session?.executionLease?.owner === leaseOwner) {
      this.sessions.set(sessionId, { ...session, executionLease: null });
    }
  }

  async completeIfNotCancelled(_userId, sessionId, completion) {
    const current = this.sessions.get(sessionId);
    if (current?.cancellation?.state === SearchCancellationState.REQUESTED) {
      const cancelled = await this.acknowledgeCancellation(null, sessionId);
      return { completed: false, session: cancelled };
    }
    const session = await this.update(null, sessionId, { ...completion, executionLease: null });
    return { completed: true, session };
  }

  async writeResultSnapshot(_userId, sessionId, jobs) {
    this.results.set(sessionId, jobs.map(job => Object.freeze({ ...job })));
    return sessionId;
  }
}

function createDb() {
  return {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ preferences: {} }),
        }),
      })),
    })),
  };
}

function createRawJob() {
  return {
    id: 'job-1',
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote',
    description: 'Build reliable backend services.',
    job_url: 'https://www.linkedin.com/jobs/view/1',
    source_board: 'linkedin',
    search_query: 'Backend Engineer',
    search_location: 'Remote',
  };
}

describe('durable search orchestration', () => {
  it('should preserve jobs and provenance when AI and one source are unavailable', async () => {
    const repository = new MemorySearchSessionRepository();
    const search = jest.fn().mockResolvedValue({
      jobs: [createRawJob()],
      failed_boards: [{ board: 'linkedin', error: 'SCRAPER_TIMEOUT' }],
      failedQueries: [],
      requests: [{ query: 'Backend Engineer', location: 'Remote' }],
      truncated: false,
    });
    const orchestrator = new JobSearchOrchestrator({
      repository,
      db: createDb(),
      search,
      loadResume: jest.fn().mockResolvedValue('professional resume'),
      extractProfile: jest.fn().mockResolvedValue({ titles: [], locations: [] }),
      scoreJobs: jest.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'AI_UNAVAILABLE' })),
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    });

    const created = await orchestrator.create('user-1', {
      titles: ['Backend Engineer'],
      locations: ['Remote'],
      platforms: ['linkedin'],
    });
    const completed = await orchestrator.run('user-1', created.id);
    const jobs = repository.results.get(created.id);

    expect(completed).toMatchObject({
      status: SearchSessionStatus.PARTIAL,
      resultCount: 1,
      ai: { status: 'UNAVAILABLE', errorCode: 'AI_UNAVAILABLE' },
    });
    expect(jobs[0]).toMatchObject({
      match: null,
      matchStatus: 'AI_UNAVAILABLE',
      discovery: {
        searchSessionId: created.id,
        query: 'Backend Engineer',
        location: 'Remote',
        platform: 'linkedin',
      },
    });

    await orchestrator.run('user-1', created.id);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('should acknowledge cancellation and never publish a result snapshot', async () => {
    const repository = new MemorySearchSessionRepository();
    const search = jest.fn(async (_criteria, _scraper, options) => {
      await repository.requestCancellation('user-1', 'session-1');
      if (await options.shouldCancel()) {
        throw Object.assign(new Error('SEARCH_CANCELLED'), { code: 'SEARCH_CANCELLED' });
      }
      return null;
    });
    const orchestrator = new JobSearchOrchestrator({
      repository,
      db: createDb(),
      search,
      loadResume: jest.fn().mockResolvedValue('professional resume'),
      extractProfile: jest.fn().mockResolvedValue({}),
      scoreJobs: jest.fn(),
    });
    const created = await orchestrator.create('user-1', {
      titles: ['Engineer'], platforms: ['linkedin'],
    });

    const cancelled = await orchestrator.run('user-1', created.id);

    expect(cancelled.status).toBe(SearchSessionStatus.CANCELLED);
    expect(cancelled.cancellation.state).toBe(SearchCancellationState.ACKNOWLEDGED);
    expect(repository.results.has(created.id)).toBe(false);
  });

  it('should not run discovery twice when the same session is resumed concurrently', async () => {
    const repository = new MemorySearchSessionRepository();
    let leaseOwnerCounter = 0;
    // Force distinct lease owners so two runs contend for the same session.
    repository.acquireExecutionLease = async (userId, sessionId) => {
      const owner = `owner-${++leaseOwnerCounter}`;
      const session = repository.sessions.get(sessionId);
      if (session?.executionLease?.owner) {
        return { acquired: false, leaseOwner: session.executionLease.owner, session };
      }
      const lease = { owner };
      repository.sessions.set(sessionId, { ...session, executionLease: lease });
      return { acquired: true, leaseOwner: owner, session: { ...session, executionLease: lease } };
    };

    let resolveSearch;
    const searchGate = new Promise(resolve => { resolveSearch = resolve; });
    const search = jest.fn(async () => {
      await searchGate;
      return {
        jobs: [createRawJob()],
        failed_boards: [],
        failedQueries: [],
        requests: [{ query: 'Backend Engineer', location: 'Remote' }],
        truncated: false,
      };
    });
    const orchestrator = new JobSearchOrchestrator({
      repository,
      db: createDb(),
      search,
      loadResume: jest.fn().mockResolvedValue('resume'),
      extractProfile: jest.fn().mockResolvedValue({}),
      scoreJobs: jest.fn().mockResolvedValue([]),
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    });
    const created = await orchestrator.create('user-1', {
      titles: ['Backend Engineer'], locations: ['Remote'], platforms: ['linkedin'],
    });

    const firstRun = orchestrator.run('user-1', created.id);
    const secondRun = orchestrator.run('user-1', created.id);
    resolveSearch();
    await Promise.all([firstRun, secondRun]);

    expect(search).toHaveBeenCalledTimes(1);
  });
});
