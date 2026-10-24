// recruiter-msg.js - Post-apply recruiter/hiring manager messaging

/**
 * Message the recruiter/hiring manager after applying to a job.
 * Looks for "Meet the hiring team" section on the job page.
 *
 * @param {string} jobTitle - Title of the job applied to
 * @param {string} company - Company name
 * @param {object} config - User configuration
 * @param {string} [jobId] - Job posting identifier (used for dedupe)
 */
async function messageRecruiter(jobTitle, company, config, jobId = '') {
  try {
    // Guard: a real user-configured template must exist before we do anything.
    // No fallback text is ever sent.
    const templateExists = Boolean(
      (config.templates && (config.templates.recruiterMessage || config.templates.hrMessage))
    );
    if (!templateExists) {
      log('No recruiter/HR message template configured. Skipping post-apply message.', 'info');
      return;
    }

    const allButtons = document.querySelectorAll('button, a[role="button"]');
    let messageBtnInHiringSection = null;
    let recruiterName = '';

    // Scroll down to reveal the hiring team section
    const jobDetailScroll = document.querySelector(SELECTORS.jobDetailScroll);
    if (jobDetailScroll) {
      jobDetailScroll.scrollTop = jobDetailScroll.scrollHeight * 0.4;
      await sleep(800);
    }

    // Strategy 1: Find "Message" button near "hiring team" or "Job poster" text
    for (const btn of allButtons) {
      if (btn.textContent.trim() === 'Message') {
        const parent = btn.closest('div, section, li');
        if (parent) {
          const parentText = parent.textContent || '';
          if (parentText.includes('hiring team') || parentText.includes('Job poster') ||
              parentText.includes('reach out to') || parentText.includes('Recruiter') ||
              parentText.includes('HR') || parentText.includes('CTO') ||
              parentText.includes('Founder') || parentText.includes('Manager') ||
              parentText.includes('· 1st')) {
            messageBtnInHiringSection = btn;
            const nameEl = parent.querySelector('a[href*="/in/"] span, a[href*="/in/"], strong');
            if (nameEl) recruiterName = nameEl.textContent.trim().split('\n')[0].trim();
            break;
          }
        }
      }
    }

    // Strategy 2: Look for the section by heading text
    if (!messageBtnInHiringSection) {
      const headings = document.querySelectorAll('h2, h3, span');
      for (const h of headings) {
        const text = h.textContent.trim();
        if (text.includes('Meet the hiring team') || text.includes('hiring team') ||
            text.includes('People you can reach out to') || text.includes('reach out to')) {
          const section = h.closest('div, section') || h.parentElement;
          if (section) {
            const container = section.parentElement || section;
            const btns = container.querySelectorAll('button, a[role="button"]');
            for (const btn of btns) {
              if (btn.textContent.trim() === 'Message') {
                messageBtnInHiringSection = btn;
                const nameEl = container.querySelector('a[href*="/in/"] span, a[href*="/in/"], strong');
                if (nameEl) recruiterName = nameEl.textContent.trim().split('\n')[0].trim();
                break;
              }
            }
            if (messageBtnInHiringSection) break;
          }
        }
      }
    }

    if (!messageBtnInHiringSection) {
      log('No recruiter Message button found for this job.', 'info');
      return;
    }

    if (!recruiterName) recruiterName = 'Hiring Manager';

    // Try to resolve a stable contact identity for dedupe (profile URL preferred).
    let contactId = recruiterName;
    const recruiterProfileLink = messageBtnInHiringSection
      .closest('div, section, li')
      ?.querySelector('a[href*="/in/"]');
    if (recruiterProfileLink) contactId = recruiterProfileLink.href;

    // Dedupe: never message the same recruiter twice for the same job posting.
    if (await hasAlreadyMessaged(contactId, jobId)) {
      log(`Already messaged ${recruiterName} for this job. Skipping.`, 'info');
      return;
    }

    // Render the template and verify no unresolved {field} placeholders remain
    // BEFORE consuming quota or opening the chat window.
    const message = buildRecruiterMessage(recruiterName, jobTitle, company, config);
    if (!message) {
      log('No recruiter message template configured. Skipping.', 'info');
      return;
    }

    const unresolved = findUnresolvedPlaceholders(message);
    if (unresolved.length > 0) {
      log(`Recruiter message has unresolved placeholders (${unresolved.join(', ')}). Skipping to avoid sending a broken message.`, 'warning');
      return;
    }

    log(`Found recruiter: ${recruiterName}. Opening message...`, 'info');

    // Click the Message button
    messageBtnInHiringSection.click();

    // Wait for message input to appear using the improved wait logic
    // Reduced from 4s hardcoded wait — uses dynamic polling instead
    const msgBox = await waitForMessageInput();

    if (!msgBox) {
      log(`Chat window didn't open for ${recruiterName}.`, 'warning');
      pressEscape();
      return;
    }

    msgBox.focus();
    await sleep(200);
    document.execCommand('insertText', false, message);
    await sleep(500);

    // Click Send
    let sendBtn = null;
    for (const sel of SELECTORS.messageSend) {
      sendBtn = document.querySelector(sel);
      if (sendBtn) break;
    }

    if (sendBtn && !sendBtn.disabled) {
      // Consume outreach quota at the last safe point: the template is valid,
      // dedupe passed, the chat opened, and the Send button is available.
      const quota = await consumeQuota('outreach');
      if (!quota.allowed) {
        msgBox.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);

        if (quota.errorCode) {
          showNotificationSafe('Unable to verify outreach quota. Message was not sent.');
        } else {
          log(`Monthly outreach limit reached (${quota.used}/${quota.limit} on ${quota.plan} plan). Skipping recruiter message.`, 'warning');
          showNotificationSafe('Monthly outreach limit reached. Upgrade to Pro for more.');
        }
        await closeMessageWindow();
        return;
      }

      sendBtn.click();
      log(`Message sent to ${recruiterName}!`, 'success');
      // Record for dedupe so this recruiter isn't messaged again for this job.
      await recordOutreach(contactId, jobId);
      await incrementHRMessageCount();
    } else {
      log(`Send button not found/disabled for ${recruiterName}.`, 'warning');
    }

    // Close the chat overlay
    await sleep(1000);
    await closeMessageWindow();

  } catch (e) {
    log(`Recruiter message error: ${e.message}`, 'warning');
    pressEscape();
  }
}

/**
 * Build a personalized recruiter message from the user's configured template.
 * Uses the recruiter-specific template, or the HR template if the user
 * configured that one instead. Both are user-authored — there is NO hardcoded
 * generic fallback. Returns null when the user has configured neither, so the
 * caller skips messaging entirely.
 *
 * @returns {string|null} Rendered message, or null if no template is configured
 */
function buildRecruiterMessage(recruiterName, jobTitle, company, config) {
  const templates = config.templates || {};
  const template = templates.recruiterMessage || templates.hrMessage || '';

  if (!template) {
    return null;
  }

  const myName = [config.firstName, config.lastName].filter(Boolean).join(' ');
  const experience = config.yearsOfExperience || config.profile?.yearsOfExperience || '';
  const headline = config.linkedinHeadline || config.profile?.linkedinHeadline || '';

  return renderTemplate(template, {
    recruiterName,
    name: recruiterName,
    jobTitle: jobTitle || '',
    company: company || '',
    experience,
    headline,
    myName,
  });
}

/**
 * Show a lightweight user-facing notification from a content-script context.
 * Falls back to logging if no notification bridge is available.
 * @param {string} message
 */
function showNotificationSafe(message) {
  try {
    chrome.runtime.sendMessage({ type: 'notification', message }).catch(() => {});
  } catch (_) {
    // Ignore — extension context may be invalidated.
  }
  log(message, 'warning');
}
