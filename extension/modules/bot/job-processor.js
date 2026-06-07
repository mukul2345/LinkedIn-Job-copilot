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
      await sleep(1500);
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

    // Find and click Easy Apply button
    let easyApplyBtn = null;
    for (const sel of SELECTORS.easyApplyButton) {
      easyApplyBtn = document.querySelector(sel);
      if (easyApplyBtn) break;
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

    easyApplyBtn.click();
    await sleep(1500);

    // Wait for Easy Apply modal
    await sleep(1000);
    let modal = document.querySelector(SELECTORS.easyApplyModal.join(', '));
    if (!modal) {
      await waitForAnyElement(SELECTORS.easyApplyModal, 5000);
      modal = document.querySelector(SELECTORS.easyApplyModal.join(', '));
    }
    if (!modal) {
      log(`Failed: "${title}" (modal not found)`, 'error');
      return 'failed';
    }

    // Process the multi-step form
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
      discardApplication();
      log(`Failed: "${title}" (form issue)`, 'error');
      return 'failed';
    }

  } catch (e) {
    try { discardApplication(); } catch (_) {}
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

    // LinkedIn uses different selectors for the follow checkbox across versions
    const checkboxSelectors = [
      '#follow-company-checkbox',
      'input[id*="follow"]',
      'input[name*="follow"]',
      'input[type="checkbox"][id*="company"]',
      'input[type="checkbox"][id*="follow"]',
    ];

    let followCheckbox = null;

    // Search in the modal
    for (const sel of checkboxSelectors) {
      followCheckbox = modal.querySelector(sel);
      if (followCheckbox) break;
    }

    // Also search in the entire document (modal might not contain it directly)
    if (!followCheckbox) {
      for (const sel of checkboxSelectors) {
        followCheckbox = document.querySelector(sel);
        if (followCheckbox) break;
      }
    }

    // Also try inside Shadow DOM
    if (!followCheckbox) {
      const shadowRoot = typeof getShadowRoot === 'function' ? getShadowRoot() : null;
      if (shadowRoot) {
        for (const sel of checkboxSelectors) {
          followCheckbox = shadowRoot.querySelector(sel);
          if (followCheckbox) break;
        }
      }
    }

    // Also try finding by label text "Follow"
    if (!followCheckbox) {
      const searchContainers = [modal, document];
      for (const container of searchContainers) {
        const labels = container.querySelectorAll('label');
        for (const label of labels) {
          if (label.textContent.toLowerCase().includes('follow')) {
            const forAttr = label.getAttribute('for');
            const checkbox = label.querySelector('input[type="checkbox"]') ||
                            (forAttr ? container.querySelector(`#${forAttr}`) : null);
            if (checkbox) {
              followCheckbox = checkbox;
              break;
            }
          }
        }
        if (followCheckbox) break;
      }
    }

    if (followCheckbox) {
      // If checkbox state doesn't match user preference, toggle it
      if (followCheckbox.checked !== shouldFollow) {
        // Try clicking the label first (more reliable for custom checkboxes)
        const labelFor = followCheckbox.id ?
          (modal.querySelector(`label[for="${followCheckbox.id}"]`) ||
           document.querySelector(`label[for="${followCheckbox.id}"]`)) : null;
        if (labelFor) {
          labelFor.click();
        } else {
          followCheckbox.click();
        }
        // Verify the change took effect
        if (followCheckbox.checked !== shouldFollow) {
          // Direct property set as fallback
          followCheckbox.checked = shouldFollow;
          followCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  } catch (e) { /* ignore */ }
}

/**
 * Discard the current application (close modal and confirm discard).
 */
function discardApplication() {
  try {
    pressEscape();
    setTimeout(() => {
      const discardBtn = findButtonByText(document, 'Discard');
      if (discardBtn) discardBtn.click();
    }, 500);
  } catch (e) { /* ignore */ }
}

/**
 * Extract years of experience requirement from job description text.
 */
function extractExperience(text) {
  const matches = text.match(/[(]?\s*(\d+)\s*[)]?\s*[-to]*\s*\d*[+]*\s*year[s]?/gi);
  if (!matches) return 0;
  const numbers = matches.map(m => {
    const num = m.match(/(\d+)/);
    return num ? parseInt(num[1]) : 0;
  }).filter(n => n <= 12);
  return numbers.length > 0 ? Math.max(...numbers) : 0;
}
