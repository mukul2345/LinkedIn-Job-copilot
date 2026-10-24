const {
  SearchCancellationState,
  SearchSessionStatus,
  createSearchSession,
  validateSearchStatusTransition,
} = require('../../functions/lib/search-session-contracts');

describe('search session contracts', () => {
  it('should create a bounded versioned session without candidate secrets', () => {
    const session = createSearchSession({
      id: 'session-1',
      userId: 'user-1',
      criteria: { titles: ['Engineer'], platforms: ['linkedin'] },
      queryTasks: [{ id: 'query-1', query: 'Engineer', location: null }],
      now: new Date('2026-08-30T10:00:00.000Z'),
    });

    expect(session).toMatchObject({
      id: 'session-1',
      schemaVersion: 1,
      status: SearchSessionStatus.CREATED,
      cancellation: { state: SearchCancellationState.NONE },
      resultCount: 0,
    });
    expect(JSON.stringify(session)).not.toContain('resumeText');
  });

  it('should reject transitions out of terminal states', () => {
    expect(() => validateSearchStatusTransition(
      SearchSessionStatus.CANCELLED,
      SearchSessionStatus.COMPLETED,
    )).toThrow('INVALID_SEARCH_SESSION_TRANSITION');
  });
});
