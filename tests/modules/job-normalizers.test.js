const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-domain.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-normalizers.js'));
});

describe('job normalizers', () => {
  it('should map board fields into a canonical immutable job', () => {
    const normalized = normalizeGlassdoorJob({
      id: 'source-1',
      job_title: 'Platform Engineer',
      employer_name: 'Acme',
      location: 'Remote',
      apply_url: 'https://glassdoor.com/job/1?utm_source=mail',
      salary: '$100k-$120k',
    });

    expect(normalized.ok).toBe(true);
    expect(normalized.job).toMatchObject({
      id: 'source-1',
      platform: JobPlatform.GLASSDOOR,
      title: 'Platform Engineer',
      company: 'Acme',
      url: 'https://glassdoor.com/job/1',
      salary: null,
      metadata: { sourceRecordId: 'source-1', salaryText: '$100k-$120k' },
    });
  });

  it('should reject malformed and invalid jobs', () => {
    expect(normalizeJob(null)).toEqual({ ok: false, error: { code: 'MALFORMED_JOB' } });
    expect(normalizeLinkedInJob({ title: '', url: 'http://linkedin.com/jobs/1' }))
      .toEqual({
        ok: false,
        error: { code: 'INVALID_JOB', fields: ['TITLE_REQUIRED', 'HTTPS_URL_REQUIRED'] },
      });
  });

  it('should report unsupported inferred platforms', () => {
    expect(normalizeJob({ title: 'Engineer', url: 'https://example.com/job/1' }))
      .toEqual({ ok: false, error: { code: 'UNSUPPORTED_PLATFORM', platform: 'unknown' } });
  });

  it('should truthfully report ZipRecruiter discovery as unimplemented', () => {
    expect(normalizeZipRecruiterJob()).toEqual({
      ok: false,
      error: { code: 'DISCOVERY_NOT_IMPLEMENTED', platform: JobPlatform.ZIP_RECRUITER },
    });
  });
});
