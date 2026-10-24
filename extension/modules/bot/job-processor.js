// job-processor.js - Process individual job cards and handle Easy Apply modal

/**
 * Ask the server-owned confirmed ledger whether this stable attempt identity was
 * already applied to, enabling cross-device already-applied protection. A cloud
 * failure fails open (returns false) so transient errors never block the user.
 * @param {string} attemptId
 * @returns {Promise<boolean>}
 */
async function hasServerConfirmedApplication(attemptId) {
  if (typeof fetchAppliedAttemptIds !== 'function') return false;
  try {
    const applied = await fetchAppliedAttemptIds([attemptId]);
    return applied.has(attemptId);
  } catch (_) {
    return false;
  }
}

/**
 * Detect a full-page verification redirect that must remain manual. This checks
 * only the navigation path, so it never false-positives on unrelated page markup
 * while the normal jobs search or job detail pages are loaded.
 * @returns {'AUTH_WALL'|'HUMAN_VERIFICATION'|null}
 */
function detectLinkedInPageManualIntervention() {
  const path = String(window.location?.pathname || '').toLowerCase();
  if (path.startsWith('/authwall') || path.startsWith('/login') ||
      path.startsWith('/uas/login') || path.startsWith('/checkpoint/lg/login')) {
    return 'AUTH_WALL';
  }
  if (path.startsWith('/checkpoint') || path.startsWith('/challenge')) {
    return 'HUMAN_VERIFICATION';
  }
  return null;
}

/**
 * Detect a genuine in-flow verification challenge. Scoped to the active Easy
 * Apply modal (falling back to document) and combined with the page-path check,
 * so ambient page markup containing "captcha" substrings is not misread.
 * @param {Element|Document} root
 * @returns {'AUTH_WALL'|'HUMAN_VERIFICATION'|'MFA'|'CAPTCHA'|null}
 */
function detectLinkedInManualIntervention(root = document) {
  const pageReason = detectLinkedInPageManualIntervention();
  if (pageReason) return pageReason;
  const scope = root && typeof root.querySelector === 'function' ? root : document;
  if (scope.querySelector('input[autocomplete="one-time-code"], input[name*="otp" i]')) return 'MFA';
  if (scope.querySelector('iframe[src*="captcha" i], iframe[title*="captcha" i]')) return 'CAPTCHA';
  return null;
}

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
    const applicationIdentity = buildJobIdentity({
      platform: JobPlatform.LINKEDIN,
      platformJobId: jobId,
    });
    if (await ApplicationStateRepository.hasSubmitted(applicationIdentity)) return 'skipped';
    if (await ApplicationStateRepository.hasUncertainAttempt(applicationIdentity)) {
      log('Skipped a job with an uncertain previous submission attempt. Review it manually.', 'warning');
      return 'skipped';
    }
    if (await hasServerConfirmedApplication(`linkedin:${jobId}`)) {
      log('Skipped a job already confirmed applied on another device.', 'info');
      return 'skipped';
    }
    const manualInterventionReason = detectLinkedInPageManualIntervention();
    if (manualInterventionReason) {
      return { status: 'manual_intervention', reason: manualInterventionReason };
    }

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
    const title = titleLink?.textContent.trim().split('\n')[0] || '';
    const subtitle = subtitleEl?.textContent.trim() || '';
    const company = subtitle.split(' · ')[0] || '';
    if (!title) {
      log('Skipped a job with no reliable title.', 'warning');
      return 'skipped';
    }

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
      await sleep(250); // Brief extra wait for button rendering
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

    // Check experience only when the user configured an explicit finite value.
    const hasConfiguredExperience = config.currentExperience != null &&
      config.currentExperience !== '';
    const currentExperience = Number(config.currentExperience);
    if (descEl && hasConfiguredExperience &&
        Number.isFinite(currentExperience) && currentExperience >= 0) {
      const descText = descEl.textContent;
      const expRequired = extractExperience(descText);
      if (expRequired > 0 && expRequired > currentExperience + 2) {
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

    if (!easyApplyBtn.textContent.includes('Apply') &&
        !easyApplyBtn.getAttribute('aria-label')?.includes('Apply')) {
      log(`Skipped: "${title}" (external apply)`, 'warning');
      return 'skipped';
    }

    // Scroll button into view before clicking (prevents click miss)
    easyApplyBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(200);
    easyApplyBtn.click();

    // Wait for the Easy Apply modal; polling replaces long fixed sleeps.
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

    // Keep job context separate from the immutable candidate profile snapshot.
    const applicationConfig = {
      ...config,
      _currentJobTitle: title,
      _currentCompany: company,
      _currentJobId: jobId,
    };
    const submissionResult = await processEasyApplyModal(
      modal,
      title,
      company,
      applicationConfig,
      `linkedin:${jobId}`
    );

    if (submissionResult && typeof submissionResult === 'object') {
      const attemptedJob = createJob({
        id: applicationIdentity,
        platform: JobPlatform.LINKEDIN,
        platformJobId: jobId,
        title,
        company,
        url: `https://www.linkedin.com/jobs/view/${jobId}`,
        applicationCapability: ApplicationCapability.DIRECT_APPLY,
      });
      const transition = submissionResult.status === 'submission_unconfirmed'
        ? { state: ApplicationState.FAILED, reasonCodes: ['SUBMISSION_UNCONFIRMED'] }
        : submissionResult.status === 'review_required'
          ? { state: ApplicationState.REVIEW_REQUIRED, reasonCodes: ['FINAL_REVIEW_REQUIRED'] }
          : submissionResult.status === 'manual_intervention'
            ? { state: ApplicationState.MANUAL_INTERVENTION, reasonCodes: [submissionResult.reason] }
            : { state: ApplicationState.NEEDS_USER_INPUT, reasonCodes: ['NEEDS_USER_INPUT'] };
      await ApplicationStateRepository.transition(attemptedJob, transition.state, {
        attemptId: `linkedin:${jobId}`,
        reasonCodes: transition.reasonCodes,
      });
      await discardApplication();
      return submissionResult;
    }

    if (submissionResult) {
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
      await incrementApplicationCount();
      const submittedJob = createJob({
        id: applicationIdentity,
        platform: JobPlatform.LINKEDIN,
        platformJobId: jobId,
        title,
        company,
        url: jobLink,
        applicationCapability: ApplicationCapability.DIRECT_APPLY,
      });
      await ApplicationStateRepository.transition(submittedJob, ApplicationState.SUBMITTED, {
        confirmed: true,
        receiptId: jobLink,
      });
      try {
        await recordConfirmedApplication({
          job: submittedJob,
          outcome: 'SUBMITTED_CONFIRMED',
          attemptId: `linkedin:${jobId}`,
          receiptId: jobLink,
        });
      } catch (error) {
        log('Submission was confirmed, but cloud history sync is pending.', 'warning');
      }

      // Try to message the recruiter/hiring manager (non-blocking)
      if (config.messageRecruiter !== false) {
        try {
          await messageRecruiter(title, company, config, jobId);
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
 * Build a stable signature of the current Easy Apply step so the loop can tell
 * whether clicking Next/Continue actually advanced the form. Combines the
 * progress percentage (when present) with the visible question labels.
 * @param {Element} modal
 * @returns {string}
 */
function getModalStepSignature(modal) {
  if (!modal) return '';
  const progress = modal.querySelector('progress, [role="progressbar"]');
  const progressValue = progress
    ? (progress.getAttribute('value') || progress.getAttribute('aria-valuenow') || '')
    : '';
  const labels = [...modal.querySelectorAll('label, legend, h3')]
    .map(element => (element.textContent || '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('|');
  return `${progressValue}::${labels}`;
}

/**
 * Decide whether to show the final review confirmation before an irreversible
 * LinkedIn submission. Defaults to false (auto-submit): the dialog only shows
 * when the user has explicitly turned on "pause before submit" in settings.
 * @param {object} config
 * @returns {Promise<boolean>}
 */
async function shouldPauseBeforeSubmit(config) {
  return config?.pauseBeforeSubmit === true;
}

/**
 * Consume one application quota unit immediately before submitting.
 * Returns null when submission is allowed. Only genuine monthly exhaustion
 * (no errorCode) blocks submission. Transient service/network failures are
 * treated as "allow" so an unreachable backend never prevents applying.
 *
 * @param {string} attemptId - Stable job/application attempt identifier
 * @returns {Promise<null|{status: 'limit_reached', quota: object}>}
 */
async function consumeApplicationQuotaForSubmit(attemptId) {
  let quota;
  try {
    quota = await consumeQuota('application', attemptId);
  } catch (_) {
    // Service completely unreachable — allow the submission.
    return null;
  }

  if (quota.allowed) return null;

  // Transient service failure (errorCode set) — allow submission, log the issue.
  if (quota.errorCode) {
    log('Quota service unavailable, proceeding with submission.', 'info');
    return null;
  }

  // Genuine monthly exhaustion — block.
  return { status: 'limit_reached', quota };
}

/**
 * Process the Easy Apply multi-step modal form.
 * @param {string} attemptId - Stable key reused if final submission is retried
 * @returns {Promise<boolean|{status: 'quota_unavailable'|'limit_reached'|'submission_unconfirmed', quota?: object, attemptId?: string}>}
 * Whether submission was confirmed, or a structured denial/uncertain outcome.
 */
async function processEasyApplyModal(modal, title, company, config, attemptId) {
  let attempts = 0;
  const maxAttempts = 15;
  let lastStepSignature = null;
  let stuckWithRequiredFields = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const manualInterventionReason = detectLinkedInManualIntervention(modal || document);
    if (manualInterventionReason) {
      return { status: 'manual_intervention', reason: manualInterventionReason, attemptId };
    }

    // Re-find modal in case DOM changed
    modal = document.querySelector(SELECTORS.easyApplyModal.join(', '));
    if (!modal) {
      log('Modal disappeared, aborting...', 'warning');
      return false;
    }

    // Answer questions on current page
    const formResult = await answerFormQuestions(modal, config);
    await sleep(400);

    // Detect a form that will not advance because required fields we cannot
    // safely answer remain. If the step content stops changing across attempts
    // while required fields are still unanswered, discard and skip this job so
    // the bot continues with the next one instead of stalling.
    const stepSignature = getModalStepSignature(modal);
    if (formResult?.needsUserInput?.length && stepSignature === lastStepSignature) {
      stuckWithRequiredFields++;
      if (stuckWithRequiredFields >= 2) {
        log(`Skipping "${title}": required questions could not be auto-answered.`, 'info');
        return { status: 'needs_user_input', fields: formResult.needsUserInput, attemptId };
      }
    } else {
      stuckWithRequiredFields = 0;
    }
    lastStepSignature = stepSignature;

    // Look for footer buttons
    const footerBtns = modal.querySelectorAll('footer button, div[class*="footer"] button, button[data-easy-apply-next-button]');

    // Check for "Submit application" button (final step)
    const submitBtn = findButtonByText(modal, 'Submit application') ||
                      findButtonByText(modal, 'Submit') ||
                      modal.querySelector('button[aria-label*="Submit application"]');
    if (submitBtn) {
      if (await shouldPauseBeforeSubmit(config)) {
        const userConfirmed = await showConfirmDialog(
          `Review and submit application for "${title}" at ${company}?`
        );
        if (!userConfirmed) return { status: 'review_required', attemptId };
      }

      handleFollowCompany(modal, config);
      const quotaDenial = await consumeApplicationQuotaForSubmit(attemptId);
      if (quotaDenial) return quotaDenial;

      submitBtn.click();
      if (!(await waitForLinkedInSubmissionConfirmation())) {
        return { status: 'submission_unconfirmed', attemptId };
      }

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
      await sleep(800);

      const submitAfterReview = findButtonByText(modal, 'Submit application') ||
                                findButtonByText(document, 'Submit application') ||
                                document.querySelector('button[aria-label*="Submit application"]');
      if (submitAfterReview) {
        if (await shouldPauseBeforeSubmit(config)) {
          const userConfirmed = await showConfirmDialog(
            `Review and submit application for "${title}" at ${company}?`
          );
          if (!userConfirmed) return { status: 'review_required', attemptId };
        }

        handleFollowCompany(modal, config);
        const quotaDenial = await consumeApplicationQuotaForSubmit(attemptId);
        if (quotaDenial) return quotaDenial;

        submitAfterReview.click();
        if (!(await waitForLinkedInSubmissionConfirmation())) {
          return { status: 'submission_unconfirmed', attemptId };
        }

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
      await sleep(700);
      continue;
    }

    // Check for "Continue" button
    const continueBtn = findButtonByText(modal, 'Continue');
    if (continueBtn) {
      continueBtn.click();
      await sleep(700);
      continue;
    }

    // Try any primary button in footer
    if (footerBtns.length > 0) {
      const primaryBtn = Array.from(footerBtns).find(b =>
        b.classList.contains('artdeco-button--primary') && !b.disabled
      );
      if (primaryBtn) {
        primaryBtn.click();
        await sleep(700);
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
 * Wait for LinkedIn to explicitly confirm the irreversible submission. Matches
 * the success popup text such as "Your application was sent to ..." or
 * "Application submitted", including the "was sent/was submitted" variants.
 */
async function waitForLinkedInSubmissionConfirmation(timeoutMs = 5000) {
  const confirmationPattern =
    /application\s+(?:was\s+)?(?:sent|submitted)|your application was sent/i;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const modalText = [...document.querySelectorAll('[role="dialog"], .artdeco-modal')]
      .map(element => element.textContent || '')
      .join(' ');
    if (confirmationPattern.test(modalText)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Dismiss LinkedIn post-submit popups like "Update profile", "Add resume to
 * profile", "Share that you got a new job", or other promotional modals.
 * Tries dismiss/skip/close buttons, then falls back to pressing Escape.
 */
async function dismissPostSubmitPopups() {
  await sleep(500);

  for (let round = 0; round < 5; round++) {
    let dismissed = false;

    // 1. Look for explicit dismiss/skip/later buttons.
    const dismissTexts = [
      'not now', 'later', 'dismiss', 'skip', 'no thanks', 'maybe later',
      'done', 'got it', 'continue browsing',
    ];
    for (const btn of document.querySelectorAll('button, a[role="button"]')) {
      const text = btn.textContent.trim().toLowerCase();
      if (dismissTexts.some(d => text === d || text.includes(d))) {
        btn.click();
        dismissed = true;
        await sleep(500);
        break;
      }
    }

    // 2. Close any remaining modal with the X / dismiss button.
    if (!dismissed) {
      const closeSelectors = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="dismiss"]',
        'button[aria-label*="close" i]',
        '.artdeco-modal__dismiss',
        'button[data-test-modal-close-btn]',
        '.artdeco-modal button[type="button"] li-icon[type="cancel"]',
      ];
      for (const sel of closeSelectors) {
        const closeBtn = document.querySelector(sel);
        if (closeBtn && closeBtn.offsetParent !== null) {
          closeBtn.click();
          dismissed = true;
          await sleep(500);
          break;
        }
      }
    }

    // 3. If nothing was found, press Escape as a last resort.
    if (!dismissed) {
      pressEscape();
      await sleep(300);
      break;
    }
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
  // Capture common forms such as "3 years", "5+ years", "3-5 years",
  // "3 to 5 years", and "(3) years". A non-digit boundary prevents a
  // four-digit calendar year from being partially matched.
  const yearsPattern =
    /(?:^|[^\d])\(?(\d{1,2})\)?\s*(?:\+|[-–]\s*\d{1,2}|to\s+\d{1,2})?\s*years?\b/gi;
  const numbers = [];
  let match;

  while ((match = yearsPattern.exec(text)) !== null) {
    const years = Number.parseInt(match[1], 10);
    // Values above 15 are more likely company age or unrelated chronology.
    if (years > 0 && years <= 15) {
      numbers.push(years);
    }
  }

  return numbers.length > 0 ? Math.max(...numbers) : 0;
}
