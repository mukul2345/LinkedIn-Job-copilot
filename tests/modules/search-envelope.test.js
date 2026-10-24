jest.mock('firebase-functions', () => ({
  runWith: jest.fn(() => ({ https: { onRequest: handler => handler } })),
}));
jest.mock('firebase-admin', () => ({
  apps: [{}],
  auth: jest.fn(),
  firestore: Object.assign(jest.fn(), { FieldValue: { serverTimestamp: jest.fn() } }),
}));

const { parseScraperPayload, paginateJobs, PAGE_SIZE } = require('../../functions/search');

describe('scraper response envelope validation', () => {
  it('should accept the current nested success envelope', () => {
    expect(parseScraperPayload({
      ok: true,
      data: { jobs: [], failed_boards: [{ board: 'indeed', error: 'timeout' }] },
    })).toEqual({ jobs: [], failed_boards: [{ board: 'indeed', error: 'timeout' }] });
  });

  it.each([null, 'invalid', {}, { ok: true, data: {} }, { jobs: 'invalid' }])(
    'should reject malformed scraper payload %p',
    payload => expect(() => parseScraperPayload(payload)).toThrow('INVALID_SCRAPER_RESPONSE'),
  );

  it('should preserve an explicit upstream error', () => {
    expect(() => parseScraperPayload({ ok: false, error: 'SCRAPER_RATE_LIMITED' }))
      .toThrow('SCRAPER_RATE_LIMITED');
  });

  it('should return authoritative backend page metadata without overlaps', () => {
    const jobs = Array.from({ length: PAGE_SIZE + 3 }, (_, index) => ({ id: `job-${index + 1}` }));
    const first = paginateJobs(jobs, 1);
    const second = paginateJobs(jobs, 2);

    expect(first).toMatchObject({
      total: PAGE_SIZE + 3,
      page: 1,
      pageSize: PAGE_SIZE,
      totalPages: 2,
      hasMore: true,
    });
    expect(second).toMatchObject({ page: 2, totalPages: 2, hasMore: false });
    expect(first.jobs).toHaveLength(PAGE_SIZE);
    expect(second.jobs).toHaveLength(3);
    expect(first.jobs.map(job => job.id)).not.toEqual(expect.arrayContaining(second.jobs.map(job => job.id)));
  });

  it('should clamp invalid and out-of-range backend pages', () => {
    const jobs = [{ id: 'one' }];
    expect(paginateJobs(jobs, -2).page).toBe(1);
    expect(paginateJobs(jobs, 99).page).toBe(1);
    expect(paginateJobs([], 5)).toMatchObject({ page: 1, totalPages: 1, total: 0 });
  });
});
