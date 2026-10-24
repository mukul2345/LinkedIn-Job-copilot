// tests/helpers/load-modules.js
// Loads extension modules into the test environment in the correct order.
// Simulates how Chrome injects content scripts into the same global scope.

const fs = require('fs');
const path = require('path');

const EXT_DIR = path.resolve(__dirname, '../../extension');

// Shared extension module order used by production classic-script contexts.
const CONTENT_SCRIPT_ORDER = [
  'core/constants.js',
  'core/runtime-config.js',
  'modules/shared/errors.js',
  'modules/shared/logger.js',
  'modules/shared/storage-provider.js',
  'modules/shared/message-protocol.js',
  'modules/jobs/job-domain.js',
  'modules/jobs/job-normalizers.js',
  'modules/jobs/job-policy.js',
  'modules/jobs/ai-match-validator.js',
  'modules/platforms/platform-adapter.js',
  'modules/platforms/linkedin-adapter.js',
  'modules/platforms/platform-registry.js',
  'modules/applications/application-state.js',
  'modules/applications/application-orchestrator.js',
  'modules/subscription/plan-config.js',
  'modules/database/usage-repository.js',
  'modules/subscription/plan-service.js',
  'modules/bot/utils.js',
  'modules/bot/selectors.js',
  'ui/components/upgrade-modal.js',
  'modules/bot/form-filler.js',
  'modules/bot/hr-outreach.js',
  'modules/bot/recruiter-msg.js',
  'modules/bot/job-processor.js',
  'modules/bot/safety.js',
  'modules/bot/bot-core.js',
];

/**
 * Load all content script modules in manifest order.
 */
function loadAllModules() {
  for (const relPath of CONTENT_SCRIPT_ORDER) {
    loadModuleByPath(relPath);
  }
}

/**
 * Load a module by its path relative to extension/ root.
 */
function loadModuleByPath(relPath) {
  const filePath = path.join(EXT_DIR, relPath);
  const code = fs.readFileSync(filePath, 'utf8');
  (0, eval)(code);
}

/**
 * Load specific bot modules by filename (for backward compatibility).
 * @param {string[]} filenames - e.g., ['utils.js', 'selectors.js']
 */
function loadModules(filenames) {
  const sharedSeams = [
    'core/runtime-config.js',
    'modules/shared/errors.js',
    'modules/shared/logger.js',
    'modules/shared/storage-provider.js',
    'modules/shared/message-protocol.js',
  ];
  sharedSeams.forEach(loadModuleByPath);
  for (const filename of filenames) {
    // Map old names to new paths
    const pathMap = {
      'constants.js': 'core/constants.js',
      'utils.js': 'modules/bot/utils.js',
      'selectors.js': 'modules/bot/selectors.js',
      'linkedin-selectors.js': 'modules/bot/selectors.js',
      'form-filler.js': 'modules/bot/form-filler.js',
      'hr-outreach.js': 'modules/bot/hr-outreach.js',
      'recruiter-msg.js': 'modules/bot/recruiter-msg.js',
      'job-processor.js': 'modules/bot/job-processor.js',
      'safety.js': 'modules/bot/safety.js',
      'bot-core.js': 'modules/bot/bot-core.js',
      'plan-config.js': 'modules/subscription/plan-config.js',
      'plan-service.js': 'modules/subscription/plan-service.js',
      'payment-service.js': 'modules/subscription/payment-service.js',
      'usage-repository.js': 'modules/database/usage-repository.js',
      'upgrade-modal.js': 'ui/components/upgrade-modal.js',
    };

    const relPath = pathMap[filename] || `modules/bot/${filename}`;
    loadModuleByPath(relPath);
  }
}

/**
 * Load a single module by filename (backward compat).
 */
function loadModule(filename) {
  loadModules([filename]);
}

/**
 * Load a file from an arbitrary absolute path.
 */
function loadFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  (0, eval)(code);
}

module.exports = { loadAllModules, loadModule, loadModules, loadModuleByPath, loadFile };
