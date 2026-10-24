// content.js - LinkedIn Auto Job Applier - Entry Point
// This is the main content script that initializes the bot and handles messaging.
//
// Module loading order (defined in manifest.json):
//   1. core/constants.js                 - App constants and admin config
//   2. modules/subscription/plan-config.js - Plan definitions and limits
//   3. modules/database/usage-repository.js - Usage tracking
//   4. modules/subscription/plan-service.js - Plan validation
//   5. modules/bot/utils.js              - Core utilities (sleep, log, storage, DOM helpers)
//   6. modules/bot/selectors.js          - Centralized LinkedIn DOM selectors
//   7. ui/components/upgrade-modal.js    - Upgrade prompt overlay
//   8. modules/bot/form-filler.js        - Easy Apply form question answering
//   9. modules/bot/hr-outreach.js        - HR/Recruiter DM outreach
//  10. modules/bot/recruiter-msg.js      - Post-apply recruiter messaging
//  11. modules/bot/job-processor.js      - Job card processing & Easy Apply modal
//  12. modules/bot/bot-core.js           - Bot state management & search loop
//  13. content/content.js                - This file (entry point & event listeners)

(function () {
  'use strict';

  // Verify modules loaded correctly
  if (typeof sleep !== 'function' || typeof SELECTORS !== 'object' || typeof startBot !== 'function') {
    console.error('[LinkedIn Auto Applier] Module loading failed. Some functions are not available.');
    return;
  }

  // Shared mutable state object passed to all modules
  const state = {
    botRunning: false,
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    config: {},
    applicationHistory: [],
    currentSearchIndex: 0,
    stopRequested: false,
    hrStopRequested: false,
  };

  // ===== MESSAGE LISTENERS =====
  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const validation = MessageProtocol.validate(message);
    if (!MessageProtocol.validateSender(sender) || !validation.valid) {
      sendResponse({ ok: false, error: validation.error || 'INVALID_SENDER' });
      return false;
    }
    try {
      if (message.type === MessageType.CONTENT_START_BOT) startBot(state);
      else if (message.type === MessageType.CONTENT_STOP_BOT) stopBot(state);
      else if (message.type === MessageType.CONTENT_START_HR) startHROutreach(state);
      else if (message.type === MessageType.CONTENT_STOP_HR) {
        state.hrStopRequested = true;
        log('HR outreach stop requested.', 'info');
      } else {
        sendResponse({ ok: false, error: 'MESSAGE_NOT_ALLOWED_IN_CONTENT' });
        return false;
      }
    } catch (error) {
      ExtensionLogger.error('Content message handling failed.', { code: error?.code });
      sendResponse({ ok: false, error: 'MESSAGE_FAILED' });
      return false;
    }
    sendResponse({ ok: true });
    return false;
  });

  // ===== AUTO-RESUME ON PAGE LOAD =====
  // Only auto-resume the job application bot (not HR outreach) after navigation.
  // HR outreach should NOT auto-resume on manual page reload — only on
  // programmatic navigation (when the bot itself navigates to the search page).
  chrome.storage.local.remove([
    'linkedinEmail',
    'linkedinPassword',
    'credentialsObfuscated',
    'credentialOwnerUid',
    'pendingAutoLogin',
  ]);

  chrome.storage.local.get(
    ['botRunning', 'botState', 'hrBotRunning', 'hrBotState', 'hrBotStateTimestamp'],
    (data) => {
      try {
        if (data.hrBotRunning && data.hrBotState === 'searching' && window.location.href.includes('search/results/people')) {
          // Only resume HR outreach if the bot itself triggered the navigation
          // (hrBotState === 'searching' means the bot navigated here, not the user)
          // Check if this is a fresh page load vs. bot-triggered navigation
          // using performance.navigation or Navigation Timing API
          const navType = performance.getEntriesByType('navigation')[0]?.type;

          // Also check staleness — if hrBotState was set more than 2 minutes ago, assume stale
          const hrStateTimestamp = data.hrBotStateTimestamp || 0;
          const isStale = Date.now() - hrStateTimestamp > 2 * 60 * 1000;

          if (navType === 'navigate' && !isStale) {
            // Bot-triggered navigation (window.location.href = ...)
            setTimeout(() => startHROutreach(state), 2000);
          } else {
            // User reloaded the page (reload) or back/forward, or state is stale — stop the bot
            log('Page reloaded by user or stale state. Stopping HR outreach.', 'info');
            chrome.storage.local.set({ hrBotRunning: false, hrBotState: null, hrBotStateTimestamp: null });
          }
        } else if (data.botRunning) {
          // Job application bot: check if this is a bot-triggered navigation
          const navType = performance.getEntriesByType('navigation')[0]?.type;
          if (navType === 'navigate') {
            // Restore state after bot-triggered page navigation
            if (data.botState) {
              state.currentSearchIndex = data.botState.currentSearchIndex || 0;
              state.appliedCount = data.botState.appliedCount || 0;
              state.skippedCount = data.botState.skippedCount || 0;
              state.failedCount = data.botState.failedCount || 0;
            }
            setTimeout(() => startBot(state), 2000);
          } else {
            // User reloaded — stop the bot
            log('Page reloaded by user. Stopping bot.', 'info');
            chrome.storage.local.set({ botRunning: false });
            chrome.storage.local.remove('botState');
          }
        }
      } catch (e) {
        console.error('[LinkedIn Auto Applier] Error during auto-resume:', e);
      }
    }
  );

  console.log('[LinkedIn Auto Applier] Content script loaded successfully.');

})();
