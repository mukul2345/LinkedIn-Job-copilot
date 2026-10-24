const { SearchSessionRepository } = require('../../functions/search-session-repository');
const { SearchSessionStatus } = require('../../functions/lib/search-session-contracts');

class FakeDocumentReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
    this.id = path.split('/').pop();
  }

  async set(value, options = {}) {
    const previous = this.database.documents.get(this.path) || {};
    this.database.documents.set(this.path, options.merge ? { ...previous, ...value } : value);
  }

  async get() {
    const value = this.database.documents.get(this.path);
    return { exists: Boolean(value), data: () => value };
  }

  collection(name) {
    return new FakeCollectionReference(this.database, `${this.path}/${name}`);
  }
}

class FakeCollectionReference {
  constructor(database, path, offset = 0, limit = Number.MAX_SAFE_INTEGER) {
    this.database = database;
    this.path = path;
    this.start = offset;
    this.maximum = limit;
  }

  doc(id) {
    return new FakeDocumentReference(this.database, `${this.path}/${id}`);
  }

  orderBy() { return this; }
  offset(value) { return new FakeCollectionReference(this.database, this.path, value, this.maximum); }
  limit(value) { return new FakeCollectionReference(this.database, this.path, this.start, value); }

  async get() {
    const prefix = `${this.path}/`;
    const entries = [...this.database.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([, value]) => value)
      .sort((left, right) => left.rankIndex - right.rankIndex)
      .slice(this.start, this.start + this.maximum);
    return { docs: entries.map(value => ({ data: () => value })) };
  }
}

class FakeFirestore {
  constructor() { this.documents = new Map(); }
  collection(path) { return new FakeCollectionReference(this, path); }
  batch() {
    const writes = [];
    return {
      set: (reference, value) => writes.push([reference, value]),
      commit: async () => Promise.all(writes.map(([reference, value]) => reference.set(value))),
    };
  }

  async runTransaction(updateFunction) {
    const transaction = {
      get: reference => reference.get(),
      set: (reference, value, options) => reference.set(value, options),
    };
    return updateFunction(transaction);
  }
}

describe('search session repository snapshots', () => {
  it('should return stable non-overlapping pages from the immutable snapshot', async () => {
    const database = new FakeFirestore();
    const repository = new SearchSessionRepository({
      db: database,
      idFactory: () => 'session-1',
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    });
    const session = await repository.create('user-1', {
      criteria: { titles: ['Engineer'], platforms: ['linkedin'] },
      queryTasks: [{ id: 'query-1', query: 'Engineer', state: 'PENDING' }],
    });
    await repository.update('user-1', session.id, { status: SearchSessionStatus.RUNNING });
    const jobs = Array.from({ length: 30 }, (_, index) => ({ id: `job-${index}` }));
    await repository.writeResultSnapshot('user-1', session.id, jobs);
    await repository.update('user-1', session.id, {
      status: SearchSessionStatus.COMPLETED,
      resultCount: jobs.length,
    });
    jobs.reverse();

    const first = await repository.readResultPage('user-1', session.id, 1);
    const second = await repository.readResultPage('user-1', session.id, 2);

    expect(first.jobs).toHaveLength(25);
    expect(second.jobs).toHaveLength(5);
    expect(first.jobs[0].id).toBe('job-0');
    expect(second.jobs[0].id).toBe('job-25');
    expect(first.jobs.map(job => job.id)).not.toEqual(
      expect.arrayContaining(second.jobs.map(job => job.id)),
    );
  });
});

describe('search session terminal completion and leasing', () => {
  function buildRunningRepository() {
    const database = new FakeFirestore();
    const repository = new SearchSessionRepository({
      db: database,
      idFactory: () => 'session-1',
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    });
    return { database, repository };
  }

  it('should refuse completion and acknowledge cancellation when cancelled after the last check', async () => {
    const { repository } = buildRunningRepository();
    const session = await repository.create('user-1', {
      criteria: { titles: ['Engineer'], platforms: ['linkedin'] },
    });
    await repository.update('user-1', session.id, { status: SearchSessionStatus.RUNNING });
    await repository.requestCancellation('user-1', session.id);

    const outcome = await repository.completeIfNotCancelled('user-1', session.id, {
      status: SearchSessionStatus.COMPLETED,
      resultCount: 5,
    });

    expect(outcome.completed).toBe(false);
    expect(outcome.session.status).toBe(SearchSessionStatus.CANCELLED);
    const stored = await repository.get('user-1', session.id);
    expect(stored.status).toBe(SearchSessionStatus.CANCELLED);
    expect(stored.resultCount).not.toBe(5);
  });

  it('should complete atomically and release the lease when no cancellation is pending', async () => {
    const { repository } = buildRunningRepository();
    const session = await repository.create('user-1', {
      criteria: { titles: ['Engineer'], platforms: ['linkedin'] },
    });
    await repository.update('user-1', session.id, { status: SearchSessionStatus.RUNNING });

    const outcome = await repository.completeIfNotCancelled('user-1', session.id, {
      status: SearchSessionStatus.COMPLETED,
      resultCount: 3,
    });

    expect(outcome.completed).toBe(true);
    const stored = await repository.get('user-1', session.id);
    expect(stored.status).toBe(SearchSessionStatus.COMPLETED);
    expect(stored.resultCount).toBe(3);
    expect(stored.executionLease).toBeNull();
  });

  it('should grant an execution lease once and deny a concurrent second holder', async () => {
    const { repository } = buildRunningRepository();
    const session = await repository.create('user-1', {
      criteria: { titles: ['Engineer'], platforms: ['linkedin'] },
    });

    const first = await repository.acquireExecutionLease('user-1', session.id, 'owner-a');
    const second = await repository.acquireExecutionLease('user-1', session.id, 'owner-b');

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.leaseOwner).toBe('owner-a');

    await repository.releaseExecutionLease('user-1', session.id, 'owner-a');
    const third = await repository.acquireExecutionLease('user-1', session.id, 'owner-b');
    expect(third.acquired).toBe(true);
  });
});
