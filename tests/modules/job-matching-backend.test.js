jest.mock('firebase-functions', () => ({
  runWith: jest.fn(() => ({ https: { onRequest: handler => handler } })),
}));
jest.mock('firebase-admin', () => ({ apps: [{}], auth: jest.fn(), firestore: jest.fn() }));
jest.mock('../../functions/search', () => ({
  callScraper: jest.fn(), VALID_BOARDS: ['linkedin', 'indeed', 'glassdoor'],
}));
jest.mock('../../functions/ai-job-matcher', () => ({
  extractProfileFromResume: jest.fn(), computeFitScores: jest.fn(),
}));

const {
  resolveMatchingCriteria,
  applyHardFilters,
  getHardFilterReasons,
  buildSearchRequests,
  searchAcrossCriteria,
  compareRankedJobs,
  MAX_CONCURRENT_SEARCHES,
} = require('../../functions/job-matching');

describe('backend matching criteria', () => {
  it('should resolve explicit values before persisted and extracted values', () => {
    const criteria = resolveMatchingCriteria(
      { titles: ['Explicit'], platforms: ['linkedin'], matchThreshold: 85 },
      { searchTerms: ['Persisted'], platforms: ['indeed'], minimumFitScore: 60 },
      { titles: ['Extracted'], locations: ['Remote'] },
    );
    expect(criteria).toMatchObject({ titles: ['Explicit'], platforms: ['linkedin'], matchThreshold: 85 });
  });

  it('should reject malformed arrays and score thresholds', () => {
    expect(() => resolveMatchingCriteria({ platforms: 'linkedin' }, {}, {})).toThrow('platforms must be an array');
    expect(() => resolveMatchingCriteria({ matchThreshold: 101 }, {}, {})).toThrow('matchThreshold is invalid');
  });

  it('should apply deterministic hard filters before AI scoring', () => {
    const criteria = resolveMatchingCriteria({
      platforms: ['linkedin'], excludedCompanies: ['blocked'], minimumSalary: 100000,
    }, {}, { titles: ['Engineer'], locations: [] });
    const jobs = [
      { id: 'blocked', platform: 'linkedin', company: 'Blocked Ltd', title: 'Engineer', description: '', salary: null },
      { id: 'low', platform: 'linkedin', company: 'Acme', title: 'Engineer', description: '', salary: { maximum: 90000 } },
      { id: 'eligible', platform: 'linkedin', company: 'Acme', title: 'Engineer', description: '', salary: { maximum: 120000 } },
    ];
    expect(applyHardFilters(jobs, criteria).map(job => job.id)).toEqual(['eligible']);
    expect(getHardFilterReasons(jobs[0], criteria)).toContain('COMPANY_EXCLUDED');
    expect(getHardFilterReasons(jobs[1], criteria)).toContain('SALARY_BELOW_MINIMUM');
  });

  it('should build independent query and location requests without OR-string coupling', () => {
    const criteria = resolveMatchingCriteria({
      titles: ['Backend Engineer', 'Platform Engineer'],
      keywords: ['Node.js'],
      locations: ['Remote', 'Toronto'],
      platforms: ['linkedin'],
    }, {}, {});

    expect(buildSearchRequests(criteria)).toEqual({
      requests: [
        { query: 'Backend Engineer', location: 'Remote' },
        { query: 'Backend Engineer', location: 'Toronto' },
        { query: 'Platform Engineer', location: 'Remote' },
        { query: 'Platform Engineer', location: 'Toronto' },
        { query: 'Node.js', location: 'Remote' },
        { query: 'Node.js', location: 'Toronto' },
      ],
      truncated: false,
    });
  });

  it('should continue after query failures and bound search concurrency', async () => {
    const criteria = resolveMatchingCriteria({
      titles: ['One', 'Two', 'Three', 'Four'],
      locations: ['Remote', 'Toronto'],
      platforms: ['linkedin'],
    }, {}, {});
    let active = 0;
    let maximumActive = 0;
    const scraper = jest.fn(async request => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      if (request.query === 'Two' && request.location === 'Toronto') {
        throw new Error('SCRAPER_TIMEOUT');
      }
      return {
        jobs: [{ id: `${request.query}-${request.location}`, source_board: 'linkedin' }],
        failed_boards: [],
      };
    });

    const response = await searchAcrossCriteria(criteria, scraper);

    expect(maximumActive).toBeLessThanOrEqual(MAX_CONCURRENT_SEARCHES);
    expect(response.jobs).toHaveLength(7);
    expect(response.failedQueries).toEqual([{
      query: 'Two', location: 'Toronto', error: 'SCRAPER_TIMEOUT',
    }]);
    expect(response.jobs[0]).toMatchObject({ search_query: 'One', search_location: 'Remote' });
  });

  it.each([100, 500, 1000])('should keep %i configured titles within query bounds', titleCount => {
    const criteria = resolveMatchingCriteria({
      titles: Array.from({ length: titleCount }, (_, index) => `Role ${index}`),
      locations: ['Remote', 'Toronto', 'London'],
      platforms: ['linkedin'],
    }, {}, {});

    expect(buildSearchRequests(criteria).requests.length).toBeLessThanOrEqual(20);
  });

  it('should use score, posting date, then stable identity as ranking order', () => {
    const jobs = [
      { id: 'b', postedAt: '2026-08-01', match: { score: 80 } },
      { id: 'a', postedAt: '2026-08-01', match: { score: 80 } },
      { id: 'c', postedAt: '2026-08-02', match: { score: 80 } },
      { id: 'd', postedAt: '2026-08-03', match: { score: 70 } },
    ];
    expect(jobs.sort(compareRankedJobs).map(job => job.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});
