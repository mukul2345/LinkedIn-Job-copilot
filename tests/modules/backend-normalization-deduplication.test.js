const {
  buildDeduplicationKey,
  normalizeJobRecord,
  parseSalaryRange,
} = require('../../functions/lib/normalization');
const { deduplicateJobs } = require('../../functions/lib/deduplication');

describe('backend job normalization', () => {
  it('should normalize flat scraper fields and canonicalize the URL', () => {
    const normalized = normalizeJobRecord({
      id: 'board-id-1',
      title: '  Backend Engineer ',
      company: ' Acme ',
      location: ' Remote ',
      description: 'Build APIs',
      salary: '$100k - $120k',
      url: 'https://jobs.example.com/1#details',
      posted_date: '2025-01-02T10:00:00Z',
    }, 'linkedin');

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      platform: 'linkedin',
      platformJobId: 'board-id-1',
      title: 'Backend Engineer',
      company: 'Acme',
      location: 'Remote',
      url: 'https://jobs.example.com/1',
      canonicalUrl: 'https://jobs.example.com/1',
      salary: { minimum: 100000, maximum: 120000, currency: 'USD' },
    });
  });

  it('should use raw board mappings when flat scraper fields are absent', () => {
    const normalized = normalizeJobRecord({
      job_title: 'Data Engineer',
      employer_name: 'Data Co',
      location: 'London',
      job_description: 'Pipelines',
      apply_url: 'https://glassdoor.com/job/2',
    }, 'glassdoor');

    expect(normalized).toMatchObject({ title: 'Data Engineer', company: 'Data Co' });
  });

  it('should reject unsupported boards, missing titles, and non-HTTPS URLs', () => {
    expect(() => normalizeJobRecord({}, 'zip_recruiter')).toThrow('Unsupported job platform');
    expect(() => normalizeJobRecord({ title: 'Engineer', url: 'https://naukri.com/job/1' }, 'naukri'))
      .toThrow('Unsupported job platform');
    expect(() => normalizeJobRecord({ title: '', url: 'https://example.com/1' }, 'indeed'))
      .toThrow('Job title is required');
    expect(() => normalizeJobRecord({ title: 'Engineer', url: 'http://example.com/1' }, 'indeed'))
      .toThrow('valid HTTPS URL');
  });

  it('should remove tracking parameters and sort identity-relevant query parameters', () => {
    const normalized = normalizeJobRecord({
      id: 'board-id-tracking',
      title: 'Engineer',
      url: 'https://jobs.example.com/view?utm_source=email&job=42&z=2&a=1&ref=feed',
    }, 'indeed');

    expect(normalized.canonicalUrl).toBe('https://jobs.example.com/view?a=1&job=42&z=2');
  });

  it('should parse only explicit salary values and normalize identity text', () => {
    expect(parseSalaryRange('₹12-18 LPA')).toMatchObject({
      minimum: 1200000,
      maximum: 1800000,
      currency: 'INR',
    });
    expect(parseSalaryRange('Competitive')).toBeNull();
    expect(buildDeduplicationKey(' Engineer ', 'ACME', 'New   York'))
      .toBe('engineer|acme|new york');
  });
});

describe('backend job deduplication', () => {
  function createBackendJob(overrides = {}) {
    return {
      id: 'job-1',
      platform: 'linkedin',
      platformJobId: 'platform-1',
      title: 'Backend Engineer',
      company: 'Acme Corp',
      location: 'Remote',
      description: 'Build reliable distributed platform services with JavaScript',
      url: 'https://linkedin.com/jobs/1',
      canonicalUrl: 'https://linkedin.com/jobs/1',
      salary: null,
      ...overrides,
    };
  }

  it('should merge high-confidence duplicates and retain source listings', () => {
    const duplicate = createBackendJob({
      id: 'job-2',
      url: 'https://linkedin.com/jobs/1?ref=email',
      canonicalUrl: 'https://linkedin.com/jobs/1?ref=email',
      salary: { minimum: 100000, maximum: 120000 },
    });

    const deduplicated = deduplicateJobs([createBackendJob(), duplicate]);

    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].sourceListings).toEqual([
      { platform: 'linkedin', url: 'https://linkedin.com/jobs/1' },
      { platform: 'linkedin', url: 'https://linkedin.com/jobs/1?ref=email' },
    ]);
  });

  it('should keep merged identity stable regardless of input order', () => {
    const complete = createBackendJob({ id: 'job-z', salary: { minimum: 100000 } });
    const sparse = createBackendJob({ id: 'job-a', salary: null });

    expect(deduplicateJobs([complete, sparse])[0].id).toBe('job-a');
    expect(deduplicateJobs([sparse, complete])[0].id).toBe('job-a');
    expect(deduplicateJobs([sparse, complete])[0].salary).toEqual({ minimum: 100000 });
  });

  it('should preserve ambiguous same-title listings without high-confidence evidence', () => {
    const ambiguous = createBackendJob({
      id: 'job-2',
      platform: 'indeed',
      platformJobId: 'platform-2',
      url: 'https://indeed.com/viewjob/2',
      canonicalUrl: 'https://indeed.com/viewjob/2',
      description: 'A materially different role focused on customer support',
    });

    expect(deduplicateJobs([createBackendJob(), ambiguous])).toHaveLength(2);
  });

  it('should return an empty list for invalid input', () => {
    expect(deduplicateJobs(null)).toEqual([]);
    expect(deduplicateJobs([])).toEqual([]);
  });
});
