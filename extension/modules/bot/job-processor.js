// job-processor.js - Process individual job cards and handle Easy Apply modal

/**
 * Process a single job card - click, check eligibility, apply.
 * @param {Element} card - The job card DOM element
 * @param {object} config - User configuration
 * @param {Array} applicationHistory - History of applied jobs
 * @returns {'applied'|'skipped'|'failed'}
 */
async function processJobCard(card, config, applicationHistory) {
  try {
    const jobId = card.getAttribute('data-occludable-job-id');
    if (!jobId) return 'skipped';

    // Check if already applied (badge on card)
    const appliedBadge = card.querySelector(SELECTORS.appliedBadge);
    if (appliedBadge && appliedBadge.textContent.trim() === 'Applied') {
      return 'skipped';
    }

    // Check if in application history
    if (applicationHistory.some(h => h.jobId === jobId)) {
      return 'skipped';
    }

    // Get job details
    const titleLink = card.querySelector(SELECTORS.jobTitleLink);
    const subtitleEl = card.querySelector(SELECTORS.jobSubtitle);
    const title = titleLink ? titleLink.textContent.trim().split('\n')[0] : 'Unknown';
    const subtitle = subtitleEl ? subtitleEl.textContent.trim() : '';
    const company = subtitle.split(' · ')[0] || 'Unknown';

    // Check blacklisted companies
    if (config.blacklistCompanies && config.blacklistCompanies.length > 0) {
      const companyLower = company.toLowerCase();
      if (config.blacklistCompanies.some(b => companyLower.includes(b.toLowerCase()))) {
        log(`Skipped: "${title}" at ${company} (blacklisted)`, 'warning');
        return 'skipped';
      }
    }

    // Click on the job card to load details
    if (titleLink) {
      titleLink.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await sleep(300);
      titleLink.click();
      // Wait for job detail panel to load (description area)
      await waitForAnyElement(
        ['.jobs-box__html-content', '.jobs-description__content', '.jobs-search__job-details'],
        8000
      );
      await sleep(500); // Brief extra wait for button rendering
    }

    // Check job description for bad words
    const descEl = document.querySelector(SELECTORS.jobDescription);
    if (descEl && config.badWords && config.badWords.length > 0) {
      const descText = descEl.textContent.toLowerCase();
      const foundBadWord = config.badWords.find(w => descText.includes(w.toLowerCase()));
      if (foundBadWord) {
        log(`Skipped: "${title}" (bad word: "${foundBadWord}")`, 'warning');
        return 'skipped';
      }
    }

    // Check experience requirement
    if (descEl && config.currentExperience >= 0) {
      const descText = descEl.textContent;
      const expRequired = extractExperience(descText);
      if (expRequired > 0 && expRequired > (config.currentExperience || 3) + 2) {
        log(`Skipped: "${title}" (needs ${expRequired}yr exp)`, 'warning');
        return 'skipped';
      }
    }

    // Find and click Easy Apply button (with retry/wait for button to render)
    let easyApplyBtn = null;
    
    // First attempt - immediate check
    for (const sel of SELECTORS.easyApplyButton) {
      easyApplyBtn = document.querySelector(sel);
      if (easyApplyBtn) break;
    }

    // If not found, wait for it (LinkedIn lazy-loads the button after description)
    if (!easyApplyBtn) {
      easyApplyBtn = await retryFindElement(SELECTORS.easyApplyButton, 3, 1000);
    }

    if (!easyApplyBtn) {
      log(`Skipped: "${title}" (no apply button)`, 'warning');
      return 'skipped';
    }

    if (!easyApplyBtn.textContent.includes('Easy') &&
        !easyApplyBtn.getAttribute('aria-label')?.includes('Easy')) {
      log(`Skipped: "${title}" (external apply)`, 'warning');
      return 'skipped';
    }

    // Scroll button into view before clicking (prevents click miss)
    easyApplyBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(400);
    easyApplyBtn.click();
    await sleep(1500);

    // Wait for Easy Apply modal (with retry click if first click didn't register)
    await sleep(1000);
    let modal = document.querySelector(SELECTORS.easyApplyModal.join(', '));
    if (!modal) {
      modal = await waitForAnyElement(SELECTORS.easyApplyModal, 5000);
    }
    if (!modal) {
      // Retry: click button again (sometimes first click doesn't register)
      log(`Modal not found on first click for "${title}". Retrying...`, 'info');
      easyApplyBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await sleep(300);
      easyApplyBtn.click();
      await sleep(2000);
      modal = document.querySelector(SELECTORS.easyApplyModal.join(', '));
      if (!modal) {
        modal = await waitForAnyElement(SELECTORS.easyApplyModal, 5000);
      }
    }
    if (!modal) {
      log(`Failed: "${title}" (modal not found after retry)`, 'error');
      return 'failed';
    }

    // Process the multi-step form
    // Attach current job context to config for AI form answering
    config._currentJobTitle = title;
    config._currentCompany = company;
    const success = await processEasyApplyModal(modal, title, company, config);

    if (success) {
      log(`Applied: "${title}" at ${company}`, 'success');
      const jobLink = `https://www.linkedin.com/jobs/view/${jobId}`;
      applicationHistory.push({
        jobId,
        title,
        company,
        jobLink,
        date: new Date().toISOString(),
        status: 'applied'
      });

      // Try to message the recruiter/hiring manager (non-blocking)
      if (config.messageRecruiter !== false) {
        try {
          await messageRecruiter(title, company, config);
        } catch (e) {
          log(`Recruiter msg skipped: ${e.message}`, 'info');
        }
      }

      return 'applied';
    } else {
      await discardApplication();
      log(`Failed: "${title}" (form issue)`, 'error');
      return 'failed';
    }

  } catch (e) {
    try { await discardApplication(); } catch (_) {}
    log(`Error on job: ${e.message}`, 'error');
    return 'failed';
  }
}

/**
 * Process the Easy Apply multi-step modal form.
 * @returns {boolean} - Whether application was submitted successfully
 */
async function processEasyApplyModal(modal, title, company, config) {
  let attempts = 0;
  const maxAttempts = 15;

  while (attempts < maxAttempts) {
    attempts++;

    // Re-find modal in case DOM changed
    modal = document.querySelector(SELECTORS.easyApplyModal.join(', '));
    if (!modal) {
      log('Modal disappeared, aborting...', 'warning');
      return false;
    }

    // Answer questions on current page
    await answerFormQuestions(modal, config);
    await sleep(800);

    // Look for footer buttons
    const footerBtns = modal.querySelectorAll('footer button, div[class*="footer"] button, button[data-easy-apply-next-button]');

    // Check for "Submit application" button (final step)
    const submitBtn = findButtonByText(modal, 'Submit application') ||
                      findButtonByText(modal, 'Submit') ||
                      modal.querySelector('button[aria-label*="Submit application"]');
    if (submitBtn) {
      if (config.pauseBeforeSubmit) {
        const userConfirmed = await showConfirmDialog(
          `Submit application for "${title}" at ${company}?`
        );
        if (!userConfirmed) return false;
      }
      handleFollowCompany(modal, config);
      submitBtn.click();
      await sleep(2000);

      // Dismiss any post-submit popups (e.g., "Add resume to profile", promotions)
      await dismissPostSubmitPopups();

      const doneBtn = findButtonByText(document, 'Done');
      if (doneBtn) doneBtn.click();
      else pressEscape();
      return true;
    }

    // Check for "Review" button (second-to-last step)
    const reviewBtn = findButtonByText(modal, 'Review') ||
                      modal.querySelector('button[aria-label*="Review"]');
    if (reviewBtn) {
      reviewBtn.click();
      await sleep(1500);

      const submitAfterReview = findButtonByText(modal, 'Submit application') ||
                                findButtonByText(document, 'Submit application') ||
                                document.querySelector('button[aria-label*="Submit application"]');
      if (submitAfterReview) {
        if (config.pauseBeforeSubmit) {
          const userConfirmed = await showConfirmDialog(
            `Submit application for "${title}" at ${company}?`
          );
          if (!userConfirmed) return false;
        }
        handleFollowCompany(modal, config);
        submitAfterReview.click();
        await sleep(2000);

        // Dismiss any post-submit popups (e.g., "Add resume to profile", promotions)
        await dismissPostSubmitPopups();

        const doneBtn = findButtonByText(document, 'Done');
        if (doneBtn) doneBtn.click();
        else pressEscape();
        return true;
      }
      continue;
    }

    // Check for "Next" button
    const nextBtn = findButtonByText(modal, 'Next') ||
                    modal.querySelector('button[aria-label*="next" i], button[data-easy-apply-next-button]');
    if (nextBtn) {
      nextBtn.click();
      await sleep(1200);
      continue;
    }

    // Check for "Continue" button
    const continueBtn = findButtonByText(modal, 'Continue');
    if (continueBtn) {
      continueBtn.click();
      await sleep(1200);
      continue;
    }

    // Try any primary button in footer
    if (footerBtns.length > 0) {
      const primaryBtn = Array.from(footerBtns).find(b =>
        b.classList.contains('artdeco-button--primary') && !b.disabled
      );
      if (primaryBtn) {
        primaryBtn.click();
        await sleep(1200);
        continue;
      }
    }

    // Wait and retry if early in the process
    if (attempts < 3) {
      await sleep(1500);
      continue;
    }

    if (attempts >= maxAttempts) {
      log('Stuck in form loop, discarding...', 'warning');
      return false;
    }

    await sleep(500);
  }

  return false;
}

/**
 * Dismiss LinkedIn post-submit popups like "Add resume to profile",
 * "Share that you got a new job", or other promotional modals.
 * Clicks "Not now", "Later", "Dismiss", "Skip", or the X button.
 */
async function dismissPostSubmitPopups() {
  // Wait a moment for popup to appear
  await sleep(1500);

  // Try up to 3 times (multiple popups can stack)
  for (let i = 0; i < 3; i++) {
    let dismissed = false;

    // Look for dismiss/skip/later buttons
    const dismissTexts = ['not now', 'later', 'dismiss', 'skip', 'no thanks', 'maybe later'];
    const allButtons = document.querySelectorAll('button, a[role="button"]');

    for (const btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (dismissTexts.some(d => text === d || text.includes(d))) {
        btn.click();
        dismissed = true;
        await sleep(1000);
        break;
      }
    }

    // Also look for close/X buttons on modals
    if (!dismissed) {
      const closeSelectors = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="dismiss"]',
        'button[aria-label*="close" i]',
        '.artdeco-modal__dismiss',
        'button[data-test-modal-close-btn]',
      ];
      for (const sel of closeSelectors) {
        const closeBtn = document.querySelector(sel);
        if (closeBtn && closeBtn.offsetParent !== null) {
          closeBtn.click();
          dismissed = true;
          await sleep(1000);
          break;
        }
      }
    }

    if (!dismissed) break; // No more popups to dismiss
  }
}

/**
 * Handle the "Follow company" checkbox in the modal.
 * If user has NOT enabled "Follow companies after applying" in settings,
 * we UNCHECK the follow checkbox (LinkedIn checks it by default).
 */
function handleFollowCompany(modal, config) {
  try {
    const shouldFollow = config.followCompanies === true;

    let followCheckbox = null;

    // Strategy 1: Find by ID patterns
    const checkboxSelectors = [
      '#follow-company-checkbox',
      'input[id*="follow"]',
      'input[name*="follow"]',
      'input[type="checkbox"][id*="company"]',
      'input[type="checkbox"][id*="follow"]',
    ];
    for (const sel of checkboxSelectors) {
      followCheckbox = modal.querySelector(sel) || document.querySelector(sel);
      if (followCheckbox) break;
    }

    // Strategy 2: Find checkbox near "Follow" text in the modal
    if (!followCheckbox) {
      const allCheckboxes = modal.querySelectorAll('input[type="checkbox"]');
      for (const cb of allCheckboxes) {
        // Walk up to find the closest container and check its text
        const container = cb.closest('div') || cb.closest('label') || cb.parentElement;
        if (container && container.textContent.toLowerCase().includes('follow')) {
          followCheckbox = cb;
          break;
        }
      }
    }

    // Strategy 3: Search the entire page for a checkbox near "stay up to date" text
    if (!followCheckbox) {
      const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
      for (const cb of allCheckboxes) {
        const container = cb.closest('div[class*="follow"]') || cb.closest('label') || cb.parentElement;
        if (container) {
          const text = container.textContent.toLowerCase();
          if (text.includes('follow') || text.includes('stay up to date')) {
            followCheckbox = cb;
            break;
          }
        }
      }
    }

    if (!followCheckbox) {
      log('Follow checkbox not found — LinkedIn may have changed their UI.', 'info');
      return;
    }

    // Now toggle it
    if (followCheckbox.checked !== shouldFollow) {
      log(`Toggling follow checkbox: was=${followCheckbox.checked}, want=${shouldFollow}`, 'info');

      // Method 1: Click the input directly
      followCheckbox.click();

      // Check if it worked
      if (followCheckbox.checked !== shouldFollow) {
        // Method 2: Click the parent label
        const label = followCheckbox.closest('label') ||
                      document.querySelector(`label[for="${followCheckbox.id}"]`);
        if (label) label.click();
      }

      // Check again
      if (followCheckbox.checked !== shouldFollow) {
        // Method 3: Force the value
        followCheckbox.checked = shouldFollow;
        followCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        followCheckbox.dispatchEvent(new Event('input', { bubbles: true }));
      }

      log(`Follow checkbox final state: ${followCheckbox.checked}`, 'info');
    }
  } catch (e) {
    console.warn('[JobPilot] handleFollowCompany error:', e.message);
  }
}

/**
 * Discard the current application (close modal and confirm discard).
 * Returns a promise that resolves after discard completes.
 */
async function discardApplication() {
  try {
    pressEscape();
    await new Promise(resolve => setTimeout(resolve, 800));
    const discardBtn = findButtonByText(document, 'Discard');
    if (discardBtn) {
      discardBtn.click();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (e) { /* ignore */ }
}

/**
 * Extract years of experience requirement from job description text.
 * Uses stricter patterns to avoid matching years like "2020" or unrelated numbers.
 */
function extractExperience(text) {
  // Match patterns like "3+ years", "3-5 years", "3 to 5 years", "(3) years"
  // Exclude 4-digit numbers (years like 2020) and numbers > 20
  const patterns = [
    /\b(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?(?:experience|exp)/gi,
    /\b(\d{1,2})\s*[-–to]+\s*\d{1,2}\s*\+?\s*years?\s+(?:of\s+)?(?:experience|exp)/gi,
    /(?:at least|minimum|min)\s*(\d{1,2})\s*\+?\s*years?/gi,
    /(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?(?:relevant|professional|hands-on|industry)/gi,
  ];

  const numbers = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const num = parseInt(match[1]);
      // Filter out unreasonable values (> 15 years is likely a false positive)
      if (num > 0 && num <= 15) {
        numbers.push(num);
      }
    }
  }

  return numbers.length > 0 ? Math.max(...numbers) : 0;
}
