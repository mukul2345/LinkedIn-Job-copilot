// platform-registry.js - Truthful platform capability registry.

// eslint-disable-next-line no-var
var PlatformRegistry = (function () {
  const registry = new Map();

  /** Register one immutable adapter. */
  function register(adapter) {
    if (!(adapter instanceof PlatformAdapter)) throw new TypeError('PlatformAdapter is required.');
    if (registry.has(adapter.platform)) throw new Error('PLATFORM_ALREADY_REGISTERED');
    registry.set(adapter.platform, adapter);
    return adapter;
  }

  register(LinkedInPlatformAdapter);
  register(new PlatformAdapter({
    platform: JobPlatform.INDEED,
    jobDiscovery: true,
    jobDetails: true,
    application: ApplicationCapability.EXTERNAL_APPLY,
    recruiterOutreach: false,
    supports: url => inferJobPlatform(url) === JobPlatform.INDEED,
  }));
  register(new PlatformAdapter({
    platform: JobPlatform.GLASSDOOR,
    jobDiscovery: true,
    jobDetails: true,
    application: ApplicationCapability.EXTERNAL_APPLY,
    recruiterOutreach: false,
    supports: url => inferJobPlatform(url) === JobPlatform.GLASSDOOR,
  }));
  register(new PlatformAdapter({
    platform: JobPlatform.ZIP_RECRUITER,
    jobDiscovery: false,
    jobDetails: false,
    application: ApplicationCapability.UNSUPPORTED,
    recruiterOutreach: false,
    supports: url => inferJobPlatform(url) === JobPlatform.ZIP_RECRUITER,
  }));

  return Object.freeze({
    register,
    get(platform) { return registry.get(platform); },
    getPlatformForUrl(url) { return [...registry.values()].find(adapter => adapter.supports(url)); },
    getSupportedPlatforms() {
      return [...registry.values()].filter(adapter => adapter.jobDiscovery).map(adapter => adapter.platform);
    },
  });
})();
