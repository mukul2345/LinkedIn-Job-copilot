// bot-core.js - Core bot logic (search loop, state management, job application flow)

/**
 * Start the main job application bot.
 * @param {object} state - Shared mutable state object
 */
async function startBot(state) {
  if (state.botRunning) return;
  state.botRunning = true;
  state.stopRequested = false;

  showStatusBadge();
  log('Bot started! Loading configuration...', 'info');

  const config = await getStorage(null);
  state.config = config;
  state.applicationHistory = config.applicationHistory || [];

  // Restore state if resuming after navigation
  if (config.botState) {
    state.currentSearchIndex = config.botState.currentSearchIndex || 0;
    state.appliedCount = config.botState.appliedCount || state.appliedCount;
    state.skippedCount = config.botState.skippedCount || state.skippedCount;
    state.failedCount = config.botState.failedCount || state.failedCount;
  }

  // Safety: Check daily application limit
  const today = new Date().toISOString().split('T')[0];
  const todayApplied = state.applicationHistory.filter(h => h.date && h.date.startsWith(today)).length;
  if (todayApplied >= 80) {
    log('Daily safety limit reached (80 applications). Stopping to protect your account.', 'warning');
    stopBot(state);
    return;
  }

  // LinkedIn safety check - show warning if approaching limits
  const safetyCheck = await checkLinkedInSafety('applications');
  if (safetyCheck.level === 'danger') {
    log(safetyCheck.message, 'error');
    showSafetyAlert(safetyCheck.message, 'danger');
    stopBot(state);
    return;
  } else if (safetyCheck.message) {
    log(safetyCheck.message, 'warning');
    showSafetyAlert(safetyCheck.message, 'warning');
  }

  if (!config.searchTerms || config.searchTerms.length === 0) {
    log('No search terms configured!', 'error');
    stopBot(state);
    return;
  }

  try {
    await runSearchLoop(state);
  } catch (e) {
    log(`Bot error: ${e.message}. Restarting...`, 'error');
    await sleep(3000);
    try {
      await runSearchLoop(state);
    } catch (e2) {
      log(`Bot failed again: ${e2.message}. Stopping.`, 'error');
    }
  }

  stopBot(state);
}

/**
 * Stop the bot and save state.
 * @param {object} state - Shared mutable state object
 */
function stopBot(state) {
  state.botRunning = false;
  state.stopRequested = true;
  removeStatusBadge();
  log(`Bot stopped. Applied: ${state.appliedCount}, Skipped: ${state.skippedCount}, Failed: ${state.failedCount}`, 'info');

  chrome.storage.local.set({
    botRunning: false,
    appliedCount: state.appliedCount,
    skippedCount: state.skippedCount,
    failedCount: state.failedCount,
    applicationHistory: state.applicationHistory
  });
  chrome.storage.local.remove('botState');

  sendStatus(state.appliedCount, state.skippedCount, state.failedCount);
  chrome.runtime.sendMessage({ type: 'stopped' }).catch(() => {});
}

/**
 * Main search loop - iterates through search terms and processes jobs.
 */
async function runSearchLoop(state) {
  const { config } = state;
  const searchTerms = config.searchTerms;
  const maxPerTerm = config.switchNumber || 30;

  for (let i = state.currentSearchIndex; i < searchTerms.length; i++) {
    if (state.stopRequested) return;
    state.currentSearchIndex = i;
    const term = searchTerms[i];
    log(`Searching for: "${term}"`, 'info');

    await saveState(state);

    // Check if we're already on the correct search page
    const currentUrl = window.location.href;
    const isOnJobSearch = currentUrl.includes('jobs/search');
    const termLower = term.toLowerCase().replace(/\s+/g, '');
    const urlDecoded = decodeURIComponent(currentUrl).toLowerCase().replace(/\s+/g, '').replace(/\+/g, '');
    const alreadyOnCorrectSearch = isOnJobSearch && urlDecoded.includes(termLower);

    if (!alreadyOnCorrectSearch) {
      const searchUrl = buildSearchUrl(term, config);
      window.location.href = searchUrl;
      return; // Script will be destroyed and re-created on navigation
    }

    await sleep(2000);

    let appliedThisTerm = 0;
    let pageNum = 1;
    let hasMorePages = true;

    while (appliedThisTerm < maxPerTerm && hasMorePages && !state.stopRequested) {
      const jobListLoaded = await waitForElement(SELECTORS.jobCards, 10000);
      if (!jobListLoaded) {
        log('Job listings did not load. Moving to next term.', 'warning');
        break;
      }
      await sleep(1500);

      const jobCards = document.querySelectorAll(SELECTORS.jobCards);
      if (jobCards.length === 0) {
        log('No job listings found on this page.', 'warning');
        break;
      }

      for (const card of jobCards) {
        if (state.stopRequested || appliedThisTerm >= maxPerTerm) break;

        // Check subscription plan limit before applying
        const limitCheck = await canPerformAction('applications');
        if (!limitCheck.allowed) {
          log(limitCheck.reason, 'warning');
          showUpgradeModal(limitCheck.reason, limitCheck.current, limitCheck.limit);
          state.stopRequested = true;
          break;
        }

        // Enforce daily safety limit (hard cap regardless of plan)
        const today = new Date().toISOString().split('T')[0];
        const todayTotal = state.applicationHistory.filter(h => h.date && h.date.startsWith(today)).length;
        if (todayTotal >= 80) {
          log('Daily safety limit reached (80). Stopping.', 'warning');
          state.stopRequested = true;
          break;
        }

        try {
          const result = await processJobCard(card, config, state.applicationHistory);
          if (result === 'applied') {
            appliedThisTerm++;
            state.appliedCount++;
            await incrementApplicationCount(); // Track for plan limits
          } else if (result === 'skipped') {
            state.skippedCount++;
          } else if (result === 'failed') {
            state.failedCount++;
          }
        } catch (e) {
          state.failedCount++;
          log(`Job error (continuing): ${e.message}`, 'error');
        }
        sendStatus(state.appliedCount, state.skippedCount, state.failedCount);
        // Adaptive delay between jobs (increases as daily count grows)
        const baseGap = (config.clickGap || 1) * 1000;
        const adaptiveGap = await getAdaptiveDelay('applications', baseGap);
        await sleep(adaptiveGap);

        // Re-check safety after each application
        const midSafety = await checkLinkedInSafety('applications');
        if (midSafety.level === 'danger') {
          log(midSafety.message, 'error');
          showSafetyAlert(midSafety.message, 'danger');
          state.stopRequested = true;
          break;
        } else if (midSafety.level === 'warning' && midSafety.current % 10 === 0) {
          // Show warning every 10 applications
          showSafetyAlert(midSafety.message, 'warning');
        }
      }

      // Try next page
      hasMorePages = await goToJobNextPage(++pageNum);
      if (hasMorePages) {
        await sleep(2000);
      }
    }

    log(`Finished "${term}": Applied ${appliedThisTerm} jobs`, 'info');
    state.currentSearchIndex = i + 1;
    await saveState(state);
  }

  chrome.storage.local.remove('botState');
  log('All search terms processed!', 'success');
}

/**
 * Save current bot state to chrome.storage for resume after navigation.
 */
async function saveState(state) {
  await new Promise(resolve => {
    chrome.storage.local.set({
      botState: {
        currentSearchIndex: state.currentSearchIndex,
        appliedCount: state.appliedCount,
        skippedCount: state.skippedCount,
        failedCount: state.failedCount
      },
      applicationHistory: state.applicationHistory
    }, resolve);
  });
}

/**
 * Build a LinkedIn job search URL from a search term and config.
 */
function buildSearchUrl(term, config) {
  let url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(term)}`;

  if (config.searchLocation) {
    url += `&location=${encodeURIComponent(config.searchLocation)}`;
  }
  if (config.easyApplyOnly !== false) {
    url += '&f_AL=true';
  }

  // Date posted filter
  if (config.datePosted) {
    const dateMap = { 'Past 24 hours': 'r86400', 'Past week': 'r604800', 'Past month': 'r2592000' };
    if (dateMap[config.datePosted]) url += `&f_TPR=${dateMap[config.datePosted]}`;
  }

  // Experience level filter
  if (config.experienceLevel && config.experienceLevel.length > 0) {
    const expMap = { 'Internship': '1', 'Entry level': '2', 'Associate': '3', 'Mid-Senior level': '4', 'Director': '5', 'Executive': '6' };
    const levels = config.experienceLevel.map(l => expMap[l.trim()]).filter(Boolean);
    if (levels.length) url += `&f_E=${levels.join(',')}`;
  }

  // Job type filter
  if (config.jobType && config.jobType.length > 0) {
    const typeMap = { 'Full-time': 'F', 'Part-time': 'P', 'Contract': 'C', 'Temporary': 'T', 'Internship': 'I', 'Volunteer': 'V', 'Other': 'O' };
    const types = config.jobType.map(t => typeMap[t.trim()]).filter(Boolean);
    if (types.length) url += `&f_JT=${types.join(',')}`;
  }

  // Work style filter
  if (config.workStyle && config.workStyle.length > 0) {
    const styleMap = { 'On-site': '1', 'Remote': '2', 'Hybrid': '3' };
    const styles = config.workStyle.map(s => styleMap[s.trim()]).filter(Boolean);
    if (styles.length) url += `&f_WT=${styles.join(',')}`;
  }

  return url;
}

/**
 * Navigate to the next page of job search results.
 * @param {number} pageNum - Target page number
 * @returns {boolean}
 */
async function goToJobNextPage(pageNum) {
  let nextBtn = null;

  // Method 1: artdeco pagination buttons
  const paginationBtns = document.querySelectorAll(SELECTORS.paginationButtons);
  for (const btn of paginationBtns) {
    if (btn.textContent.trim() === String(pageNum)) {
      nextBtn = btn;
      break;
    }
  }

  // Method 2: aria-label
  if (!nextBtn) {
    nextBtn = document.querySelector(`button[aria-label="Page ${pageNum}"]`);
  }

  // Method 3: "Next" button
  if (!nextBtn) {
    const allBtns = document.querySelectorAll('button, a');
    for (const btn of allBtns) {
      const label = btn.getAttribute('aria-label') || btn.textContent.trim();
      if (label === 'Next' || label === 'Forward') {
        nextBtn = btn;
        break;
      }
    }
  }

  if (nextBtn) {
    nextBtn.scrollIntoView({ block: 'center' });
    await sleep(500);
    nextBtn.click();
    await waitForElement(SELECTORS.jobCards, 10000);
    await sleep(1500);
    return true;
  }
  return false;
}
