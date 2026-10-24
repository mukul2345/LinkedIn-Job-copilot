const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-domain.js'));
});

describe('job domain', () => {
  it('should canonicalize HTTPS URLs without tracking or fragments', () => {
    expect(canonicalizeJobUrl('https://www.linkedin.com/jobs/1/?utm_source=x&keep=yes#details'))
      .toBe('https://www.linkedin.com/jobs/1/?keep=yes');
    expect(canonicalizeJobUrl('http://www.linkedin.com/jobs/1')).toBe('');
  });

  it('should prefer the platform job id for stable identity', () => {
    expect(buildJobIdentity({ platform: JobPlatform.LINKEDIN, platformJobId: ' 42 ' }))
      .toBe('linkedin:42');
  });

  it('should create an immutable job without inventing optional fields', () => {
    const job = createJob({
      platform: JobPlatform.INDEED,
      title: '  Engineer  ',
      url: 'https://indeed.com/viewjob?id=1&utm_source=email',
    });

    expect(job).toMatchObject({ title: 'Engineer', company: null, description: null });
    expect(job.url).toBe('https://indeed.com/viewjob?id=1');
    expect(Object.isFrozen(job)).toBe(true);
  });

  it('should reject invalid and unsupported jobs with field diagnostics', () => {
    expect(validateJob({ platform: JobPlatform.UNKNOWN, title: '', url: 'http://bad.test' }))
      .toEqual({
        valid: false,
        errors: ['PLATFORM_UNSUPPORTED', 'TITLE_REQUIRED', 'HTTPS_URL_REQUIRED'],
      });
  });

  it('should infer only supported platform hostnames', () => {
    expect(inferJobPlatform('https://jobs.glassdoor.com/role/1')).toBe(JobPlatform.GLASSDOOR);
    expect(inferJobPlatform('https://linkedin.com.evil.test/jobs/1')).toBe(JobPlatform.UNKNOWN);
  });
});
