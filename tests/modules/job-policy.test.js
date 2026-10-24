const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-domain.js'));
  global.DEFAULT_MATCH_THRESHOLD = 70;
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-policy.js'));
});

function createPolicyJob(overrides = {}) {
  return createJob({
    platform: JobPlatform.LINKEDIN,
    platformJobId: 'job-1',
    title: 'Backend Engineer',
    company: 'Acme Corp',
    location: 'Remote',
    url: 'https://linkedin.com/jobs/1',
    description: 'Build reliable distributed platform services with JavaScript',
    ...overrides,
  });
}

describe('job policy', () => {
  it('should resolve explicit criteria before persisted values and defaults', () => {
    const criteria = resolveJobSearchCriteria(
      { locations: [], matchThreshold: 90 },
      { locations: ['London'], titles: ['Engineer'] },
      { matchThreshold: 60, keywords: ['Node'] },
    );

    expect(criteria).toMatchObject({
      locations: [], titles: ['Engineer'], keywords: ['Node'], matchThreshold: 90,
    });
    expect(Object.isFrozen(criteria)).toBe(true);
  });

  it('should return every deterministic hard-filter rejection', () => {
    const filter = evaluateHardFilters(createPolicyJob({
      company: 'Blocked Company', remoteType: 'remote', salary: { maximum: 80000 },
    }), resolveJobSearchCriteria({
      excludedCompanies: ['blocked'], excludedKeywords: ['distributed'],
      remoteTypes: ['onsite'], minimumSalary: 100000,
    }));

    expect(filter).toEqual({
      eligible: false,
      reasons: ['COMPANY_EXCLUDED', 'KEYWORD_EXCLUDED', 'REMOTE_TYPE_MISMATCH', 'SALARY_BELOW_MINIMUM'],
    });
  });

  it('should merge only high-confidence duplicates', () => {
    const original = createPolicyJob();
    const sameListing = createPolicyJob({ requiredSkills: ['Node.js'] });
    const ambiguous = createPolicyJob({
      platformJobId: 'job-2', url: 'https://linkedin.com/jobs/2', description: 'Different role content',
    });

    expect(deduplicateCrossPlatformJobs([original, sameListing])).toHaveLength(1);
    expect(deduplicateCrossPlatformJobs([original, ambiguous])).toHaveLength(2);
  });
});
