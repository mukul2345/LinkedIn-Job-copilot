// platform-adapter.js - Platform adapter contract.

/** Contract implemented by job-board adapters. */
// eslint-disable-next-line no-var
var PlatformAdapter = (function () {
  function PlatformAdapter(definition) {
    if (!definition || !Object.values(JobPlatform).includes(definition.platform)) {
      throw new TypeError('A valid platform is required.');
    }
    if (typeof definition.supports !== 'function') throw new TypeError('supports(url) is required.');
    this.platform = definition.platform;
    this.jobDiscovery = definition.jobDiscovery === true;
    this.jobDetails = definition.jobDetails === true;
    this.application = definition.application;
    this.recruiterOutreach = definition.recruiterOutreach === true;
    this.supports = definition.supports;
    Object.freeze(this);
  }
  return PlatformAdapter;
})();
