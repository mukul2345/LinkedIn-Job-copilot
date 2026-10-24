const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-domain.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/platforms/platform-adapter.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/platforms/linkedin-adapter.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/platforms/platform-registry.js'));
});

describe('platform registry', () => {
  it('should expose truthful application capabilities', () => {
    expect(PlatformRegistry.get(JobPlatform.LINKEDIN)).toMatchObject({
      jobDiscovery: true,
      application: ApplicationCapability.DIRECT_APPLY,
      recruiterOutreach: true,
    });
    expect(PlatformRegistry.get(JobPlatform.INDEED)).toMatchObject({
      application: ApplicationCapability.EXTERNAL_APPLY,
      recruiterOutreach: false,
    });
    expect(PlatformRegistry.get(JobPlatform.GLASSDOOR)).toMatchObject({
      application: ApplicationCapability.EXTERNAL_APPLY,
      recruiterOutreach: false,
    });
  });

  it('should keep ZipRecruiter unsupported and out of discovery platforms', () => {
    expect(PlatformRegistry.get(JobPlatform.ZIP_RECRUITER)).toMatchObject({
      jobDiscovery: false,
      jobDetails: false,
      application: ApplicationCapability.UNSUPPORTED,
    });
    expect(PlatformRegistry.getSupportedPlatforms()).not.toContain(JobPlatform.ZIP_RECRUITER);
  });

  it('should resolve only a platform that owns the URL', () => {
    expect(PlatformRegistry.getPlatformForUrl('https://jobs.indeed.com/viewjob/1')?.platform)
      .toBe(JobPlatform.INDEED);
    expect(PlatformRegistry.getPlatformForUrl('https://example.com/jobs/1')).toBeUndefined();
  });
});
