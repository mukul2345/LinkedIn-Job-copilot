// recruiter-msg.js - Post-apply recruiter/hiring manager messaging

/**
 * Message the recruiter/hiring manager after applying to a job.
 * Looks for "Meet the hiring team" section on the job page.
 *
 * @param {string} jobTitle - Title of the job applied to
 * @param {string} company - Company name
 * @param {object} config - User configuration
 */
async function messageRecruiter(jobTitle, company, config) {
  try {
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
    log(`Found recruiter: ${recruiterName}. Sending message...`, 'info');

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

    // Type the message
    const message = buildRecruiterMessage(recruiterName, jobTitle, company, config);
    if (!message) {
      log('No recruiter message template configured. Skipping.', 'info');
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
      sendBtn.click();
      log(`Message sent to ${recruiterName}!`, 'success');
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
 * Build a personalized recruiter message from user's template.
 * If no template is configured, returns null (caller should skip messaging).
 */
function buildRecruiterMessage(recruiterName, jobTitle, company, config) {
  const templates = config.templates || {};
  // Try recruiter-specific template first, fall back to HR template
  const template = templates.recruiterMessage || templates.hrMessage || '';

  if (!template) {
    // No template configured — return null so caller knows to skip
    log('No recruiter/HR message template configured. Skipping post-apply message.', 'info');
    return null;
  }

  const myName = [config.firstName, config.lastName].filter(Boolean).join(' ');
  const experience = config.yearsOfExperience || config.profile?.yearsOfExperience || '3';
  const headline = config.linkedinHeadline || config.profile?.linkedinHeadline || '';

  // Replace all supported placeholders
  return template
    .replace(/\{recruiterName\}/gi, recruiterName)
    .replace(/\{name\}/gi, recruiterName)
    .replace(/\{jobTitle\}/gi, jobTitle || '')
    .replace(/\{company\}/gi, company || '')
    .replace(/\{experience\}/gi, experience)
    .replace(/\{headline\}/gi, headline)
    .replace(/\{myName\}/gi, myName);
}
