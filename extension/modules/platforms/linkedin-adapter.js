// linkedin-adapter.js - LinkedIn platform capability adapter.

/** LinkedIn supports direct Easy Apply through the existing reviewed bot flow. */
// eslint-disable-next-line no-var
var LinkedInPlatformAdapter = new PlatformAdapter({
  platform: JobPlatform.LINKEDIN,
  jobDiscovery: true,
  jobDetails: true,
  application: ApplicationCapability.DIRECT_APPLY,
  recruiterOutreach: true,
  supports(url) { return inferJobPlatform(url) === JobPlatform.LINKEDIN; },
});
