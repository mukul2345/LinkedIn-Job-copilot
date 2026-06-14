/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  // Allow resolving modules from functions/node_modules for Cloud Function tests
  modulePaths: ['<rootDir>/functions/node_modules'],
  // Note: Coverage instrumentation doesn't work with eval()-loaded scripts.
  // The content script modules are loaded via eval() to simulate Chrome's
  // content script injection (shared global scope). Coverage is verified
  // through comprehensive test assertions instead.
  //
  // To get coverage reports, run individual module tests with:
  //   npx jest --coverage --collectCoverageFrom='extension/content/modules/utils.js'
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
};
