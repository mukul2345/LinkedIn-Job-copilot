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
    const msgBox = await waitForMessageInput();

    if (!msgBox) {
      log(`Chat window didn't open for ${recruiterName}.`, 'warning');
      pressEscape();
      return;
    }

    // Type the message
    const message = buildRecruiterMessage(recruiterName, jobTitle, company, config);
    msgBox.focus();
    await sleep(300);
    document.execCommand('insertText', false, message);
    await sleep(800);

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
 * Build a personalized recruiter message.
 */
function buildRecruiterMessage(recruiterName, jobTitle, company, config) {
  const myName = [config.firstName, config.lastName].filter(Boolean).join(' ');
  const experience = config.yearsOfExperience || '3';

  return `Hi Team,\n\nI just applied for the ${jobTitle} role at ${company} and wanted to reach out directly. I have ${experience}+ years of backend development experience with Node.js, TypeScript, and AWS, and I believe my skills align well with this position.\n\nI'd love the opportunity to discuss how I can contribute to your team. Would you be open to a brief conversation?\n\nBest regards,\n${myName}`;
}
