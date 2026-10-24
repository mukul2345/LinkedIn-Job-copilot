jest.mock('firebase-functions', () => ({
  runWith: jest.fn(() => ({ https: { onRequest: handler => handler } })),
}));
jest.mock('firebase-admin', () => ({ apps: [{}], auth: jest.fn(), firestore: jest.fn() }));

const crypto = require('crypto');
const {
  createLedgerEntry,
  checkAlreadyApplied,
  setFirestoreProvider,
} = require('../../functions/application-history');

describe('confirmed application ledger', () => {
  it('should create a stable minimal record without candidate facts', () => {
    const entry = createLedgerEntry('user-1', {
      jobId: 'linkedin:1',
      platform: 'linkedin',
      outcome: 'SUBMITTED_CONFIRMED',
      confirmed: true,
      attemptId: 'attempt-1',
      title: 'Engineer',
      candidateFacts: { email: 'not-stored@example.com' },
    }, new Date('2026-08-30T10:00:00.000Z'));

    expect(entry).toMatchObject({ confirmed: true, outcome: 'SUBMITTED_CONFIRMED' });
    expect(entry).not.toHaveProperty('candidateFacts');
    expect(entry.id).toHaveLength(64);
  });

  it('should reject unconfirmed and unsupported outcomes', () => {
    expect(() => createLedgerEntry('user-1', {
      jobId: 'indeed:1', platform: 'indeed', outcome: 'EXTERNAL_CONFIRMED', confirmed: false,
    })).toThrow('CONFIRMATION_REQUIRED');
  });
});

describe('cross-device already-applied protection', () => {
  afterEach(() => setFirestoreProvider(() => {
    throw new Error('Firestore provider not configured for this test.');
  }));

  it('should report only the attempt identities confirmed in the server ledger', async () => {
    const appliedDocId = crypto.createHash('sha256')
      .update('user-1:linkedin:applied')
      .digest('hex');
    const documents = { [appliedDocId]: { jobId: 'linkedin:applied' } };
    setFirestoreProvider(() => ({
      collection: () => ({
        doc: id => ({
          get: async () => ({ exists: Boolean(documents[id]), data: () => documents[id] }),
        }),
      }),
    }));

    const result = await checkAlreadyApplied('user-1', {
      attemptIds: ['linkedin:applied', 'linkedin:fresh', 'linkedin:applied'],
    });

    expect(result.appliedAttemptIds).toEqual(['linkedin:applied']);
  });

  it('should reject a request with no attempt identities', async () => {
    await expect(checkAlreadyApplied('user-1', { attemptIds: [] }))
      .rejects.toThrow('INVALID_REQUEST');
  });
});
