/** Server-owned Firestore repository for durable search state and immutable results. */

const crypto = require('crypto');
const {
  SEARCH_SESSION_SCHEMA_VERSION,
  SearchCancellationState,
  SearchSessionStatus,
  SEARCH_LIMITS,
  createSearchSession,
  isTerminalSearchStatus,
  validateSearchStatusTransition,
} = require('./lib/search-session-contracts');

/** Milliseconds an execution lease remains valid before another run may claim it. */
const EXECUTION_LEASE_TTL_MS = 2 * 60 * 1000;

class SearchSessionRepository {
  constructor({ db, now = () => new Date(), idFactory = () => crypto.randomUUID() }) {
    if (!db) throw new TypeError('Firestore is required.');
    this.db = db;
    this.now = now;
    this.idFactory = idFactory;
  }

  sessionRef(userId, sessionId) {
    return this.db.collection(`users/${userId}/searchSessions`).doc(sessionId);
  }

  async create(userId, input) {
    const sessionId = this.idFactory();
    const session = createSearchSession({
      ...input,
      id: sessionId,
      userId,
      now: this.now(),
    });
    await this.sessionRef(userId, sessionId).set(session);
    return session;
  }

  async get(userId, sessionId) {
    const snapshot = await this.sessionRef(userId, sessionId).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  async update(userId, sessionId, changes) {
    const reference = this.sessionRef(userId, sessionId);
    const current = await this.get(userId, sessionId);
    if (!current) throw new Error('SEARCH_SESSION_NOT_FOUND');
    if (isTerminalSearchStatus(current.status) && changes.status !== current.status) return current;
    if (changes.status) validateSearchStatusTransition(current.status, changes.status);
    const next = {
      ...changes,
      schemaVersion: SEARCH_SESSION_SCHEMA_VERSION,
      updatedAt: this.now().toISOString(),
    };
    await reference.set(next, { merge: true });
    return { ...current, ...next };
  }

  async requestCancellation(userId, sessionId) {
    const current = await this.get(userId, sessionId);
    if (!current) throw new Error('SEARCH_SESSION_NOT_FOUND');
    if (isTerminalSearchStatus(current.status)) return current;
    return this.update(userId, sessionId, {
      cancellation: {
        state: SearchCancellationState.REQUESTED,
        requestedAt: this.now().toISOString(),
        acknowledgedAt: null,
      },
    });
  }

  async isCancellationRequested(userId, sessionId) {
    const session = await this.get(userId, sessionId);
    return session?.cancellation?.state === SearchCancellationState.REQUESTED;
  }

  async acknowledgeCancellation(userId, sessionId) {
    return this.update(userId, sessionId, {
      status: SearchSessionStatus.CANCELLED,
      cancellation: {
        state: SearchCancellationState.ACKNOWLEDGED,
        requestedAt: (await this.get(userId, sessionId))?.cancellation?.requestedAt || null,
        acknowledgedAt: this.now().toISOString(),
      },
    });
  }

  /**
   * Atomically claim exclusive execution of a session so concurrent resume calls
   * cannot run the same session twice. An expired lease may be reclaimed.
   * @returns {Promise<{acquired: boolean, leaseOwner: string|null, session: object}>}
   */
  async acquireExecutionLease(userId, sessionId, leaseOwner = this.idFactory()) {
    const reference = this.sessionRef(userId, sessionId);
    const nowMs = this.now().getTime();
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error('SEARCH_SESSION_NOT_FOUND');
      const session = snapshot.data();
      const existing = session.executionLease;
      const leaseIsActive = existing?.owner &&
        Number(existing.expiresAtMs) > nowMs &&
        existing.owner !== leaseOwner;
      if (leaseIsActive) {
        return { acquired: false, leaseOwner: existing.owner, session };
      }
      const lease = {
        owner: leaseOwner,
        acquiredAt: this.now().toISOString(),
        expiresAtMs: nowMs + EXECUTION_LEASE_TTL_MS,
      };
      transaction.set(reference, {
        executionLease: lease,
        updatedAt: this.now().toISOString(),
      }, { merge: true });
      return { acquired: true, leaseOwner, session: { ...session, executionLease: lease } };
    });
  }

  /** Release a lease only if still owned by the caller. */
  async releaseExecutionLease(userId, sessionId, leaseOwner) {
    const reference = this.sessionRef(userId, sessionId);
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return;
      const session = snapshot.data();
      if (session.executionLease?.owner !== leaseOwner) return;
      transaction.set(reference, {
        executionLease: null,
        updatedAt: this.now().toISOString(),
      }, { merge: true });
    });
  }

  /**
   * Atomically complete a session, refusing completion when cancellation was
   * requested between the last cooperative check and the terminal write. This
   * closes the race where a late cancellation could be lost.
   * @returns {Promise<{completed: boolean, session: object}>}
   */
  async completeIfNotCancelled(userId, sessionId, completion) {
    const reference = this.sessionRef(userId, sessionId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error('SEARCH_SESSION_NOT_FOUND');
      const current = snapshot.data();
      if (isTerminalSearchStatus(current.status)) {
        return { completed: current.status === completion.status, session: current };
      }
      if (current.cancellation?.state === SearchCancellationState.REQUESTED) {
        const cancelled = {
          status: SearchSessionStatus.CANCELLED,
          cancellation: {
            state: SearchCancellationState.ACKNOWLEDGED,
            requestedAt: current.cancellation.requestedAt || null,
            acknowledgedAt: this.now().toISOString(),
          },
          executionLease: null,
          schemaVersion: SEARCH_SESSION_SCHEMA_VERSION,
          updatedAt: this.now().toISOString(),
        };
        transaction.set(reference, cancelled, { merge: true });
        return { completed: false, session: { ...current, ...cancelled } };
      }
      validateSearchStatusTransition(current.status, completion.status);
      const next = {
        ...completion,
        executionLease: null,
        schemaVersion: SEARCH_SESSION_SCHEMA_VERSION,
        updatedAt: this.now().toISOString(),
      };
      transaction.set(reference, next, { merge: true });
      return { completed: true, session: { ...current, ...next } };
    });
  }

  async writeResultSnapshot(userId, sessionId, jobs) {
    const reference = this.sessionRef(userId, sessionId).collection('results');
    for (let offset = 0; offset < jobs.length; offset += 400) {
      const batch = this.db.batch();
      for (const [chunkIndex, job] of jobs.slice(offset, offset + 400).entries()) {
        const rankIndex = offset + chunkIndex;
        const documentId = crypto.createHash('sha256')
          .update(`${sessionId}:${job.id}`)
          .digest('hex');
        batch.set(reference.doc(documentId), {
          ...job,
          schemaVersion: 1,
          searchSessionId: sessionId,
          rankIndex,
          snapshotCreatedAt: this.now().toISOString(),
        });
      }
      await batch.commit();
    }
    return sessionId;
  }

  async readResultPage(
    userId,
    sessionId,
    requestedPage = 1,
    pageSize = SEARCH_LIMITS.resultPageSize,
  ) {
    const session = await this.get(userId, sessionId);
    if (!session) throw new Error('SEARCH_SESSION_NOT_FOUND');
    const total = Number(session.resultCount) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);
    const snapshot = await this.sessionRef(userId, sessionId)
      .collection('results')
      .orderBy('rankIndex', 'asc')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    return {
      jobs: snapshot.docs.map(document => document.data()),
      page,
      pageSize,
      total,
      totalPages,
      hasMore: page < totalPages,
    };
  }
}

module.exports = { SearchSessionRepository };
