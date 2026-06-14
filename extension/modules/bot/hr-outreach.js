// hr-outreach.js - HR/Recruiter DM outreach module (FIXED)
// Handles searching for HR connections and sending personalized messages

/**
 * Main HR outreach function.
 * Searches for HR/Recruiter 1st connections and sends them a personalized message.
 *
 * @param {object} state - Shared bot state object
 */
async function startHROutreach(state) {
  state.hrStopRequested = false;
  const config = await getStorage(null);

  // Read template from user-configured data (pushed by popup from Firestore)
  const templates = config.templates || {};
  const messageTemplate = templates.hrMessage || '';
  
  if (!messageTemplate) {
    log('No HR message template configured. Please set one in Settings → HR Outreach.', 'error');
    chrome.storage.local.set({ hrBotRunning: false });
    return;
  }

  const dailyLimit = templates.hrDailyLimit || config.hrDailyLimit || 25;
  const delayBetween = Math.max((templates.hrDelayBetween || config.hrDelayBetween || 30), 15) * 1000;

  // Get already messaged HRs to avoid duplicates
  const messagedHRs = config.messagedHRs || [];
  const today = new Date().toISOString().split('T')[0];
  const todayCount = messagedHRs.filter(h => h.date && h.date.startsWith(today)).length;

  if (todayCount >= dailyLimit) {
    log(`Daily HR message limit reached (${dailyLimit}). Stopping to protect your account.`, 'warning');
    showSafetyAlert(`⚠️ Daily limit reached (${todayCount}/${dailyLimit} messages). Bot stopped to protect your LinkedIn account from spam flags.`, 'danger');
    chrome.storage.local.set({ hrBotRunning: false });
    return;
  }

  // Warn at 20 messages — LinkedIn's known spam threshold
  if (todayCount >= 20) {
    log(`⚠️ LinkedIn safety: ${todayCount} messages sent today. Approaching spam threshold.`, 'warning');
    showSafetyAlert(`⚠️ You've sent ${todayCount} messages today. LinkedIn may flag accounts sending 20+ messages/day. Bot will stop at your limit (${dailyLimit}).`, 'warning');
  }

  log(`HR outreach started. Already sent ${todayCount}/${dailyLimit} today.`, 'info');
  showStatusBadge();

  // Navigate to connections page with search for HR/Recruiter/Manager/Team Lead
  const searchUrl = 'https://www.linkedin.com/search/results/people/?keywords=recruiter%20OR%20HR%20OR%20talent%20acquisition%20OR%20hiring%20manager%20OR%20team%20lead%20OR%20engineering%20manager&network=%5B%22F%22%5D&origin=FACETED_SEARCH';

  if (!window.location.href.includes('search/results/people')) {
    window.location.href = searchUrl;
    chrome.storage.local.set({ hrBotRunning: true, hrBotState: 'searching', hrBotStateTimestamp: Date.now() });
    return;
  }

  await sleep(3000);

  let sentCount = todayCount;
  let pageNum = 1;

  while (sentCount < dailyLimit && !state.hrStopRequested) {
    await sleep(3000);

    const peopleCards = await findPeopleCards();

    if (peopleCards.length === 0) {
      log(`No HR profiles found on this page.`, 'warning');
      break;
    }

    log(`Found ${peopleCards.length} profiles on page ${pageNum}.`, 'info');

    for (const card of peopleCards) {
      if (state.hrStopRequested || sentCount >= dailyLimit) break;

      try {
        // Check usage limit before processing
        const limitCheck = await canPerformAction('hrMessages');
        if (!limitCheck.allowed) {
          log(limitCheck.reason, 'warning');
          showUpgradeModal(limitCheck.reason, limitCheck.current, limitCheck.limit);
          break; // Stop the loop — limit reached
        }

        const result = await processHRCard(card, {
          messagedHRs,
          messageTemplate,
          sentCount,
          dailyLimit,
        });

        if (result === 'sent') {
          sentCount++;
          await incrementHRMessageCount(); // Track usage for plan limits
          log(`[${sentCount}/${dailyLimit}] Message sent successfully.`, 'success');

          // Check if daily limit reached — stop immediately
          if (sentCount >= dailyLimit) {
            log(`Daily limit reached (${dailyLimit}). Stopping HR outreach to protect your account.`, 'warning');
            showSafetyAlert(`✅ Done! Sent ${sentCount} messages today (limit: ${dailyLimit}). Stopped to keep your account safe.`, 'info');
            state.hrStopRequested = true;
            break;
          }

          // Warn at 20 messages mid-run
          if (sentCount === 20) {
            showSafetyAlert(`⚠️ 20 messages sent today. LinkedIn may flag further messages as spam. Bot will stop at ${dailyLimit}.`, 'warning');
          }

          // Ensure message window is closed before moving to next
          await closeMessageWindow();
          await sleep(500);

          // Wait between messages (rate limiting)
          log(`Waiting ${Math.round(delayBetween / 1000)}s before next message...`, 'info');
          await sleep(delayBetween);
        } else if (result === 'failed') {
          // Ensure window is closed on failure too
          await closeMessageWindow();
          await sleep(300);
        }
      } catch (e) {
        log(`Error processing HR card: ${e.message}`, 'warning');
        pressEscape();
        await sleep(1000);
      }
    }

    // Go to next page
    if (sentCount < dailyLimit && !state.hrStopRequested) {
      const hasNextPage = await goToHRNextPage(++pageNum);
      if (!hasNextPage) {
        log('No more pages of HR connections.', 'info');
        break;
      }
      await sleep(4000);
    }
  }

  log(`HR outreach stopped. Sent ${sentCount - todayCount} messages today (${sentCount} total today).`, 'success');
  chrome.storage.local.set({ hrBotRunning: false });
  removeStatusBadge();
}

/**
 * Find people cards on the search results page using multiple selector strategies.
 * @returns {Element[]}
 */
async function findPeopleCards() {
  // Strategy 1: Standard selectors
  let cards = document.querySelectorAll(SELECTORS.peopleCards.join(', '));

  // Strategy 2: Broader selectors
  if (cards.length === 0) {
    await sleep(3000);
    cards = document.querySelectorAll(SELECTORS.peopleCardsBroad.join(', '));
  }

  // Strategy 3: Find cards by looking for "Message" buttons and walking up
  if (cards.length === 0) {
    const allElements = document.querySelectorAll('button, a, span[role="button"]');
    const cardsWithMessage = new Set();
    for (const el of allElements) {
      const text = el.textContent.trim();
      if (text === 'Message') {
        let parent = el.closest('li') || el.closest('div[class*="entity"]');
        if (!parent) {
          let node = el.parentElement;
          for (let i = 0; i < 8 && node; i++) {
            if (node.tagName === 'LI' || (node.offsetHeight > 80 && node.offsetWidth > 400)) {
              parent = node;
              break;
            }
            node = node.parentElement;
          }
        }
        if (parent) cardsWithMessage.add(parent);
      }
    }
    cards = Array.from(cardsWithMessage);
  }

  return Array.from(cards);
}

/**
 * Process a single HR profile card - extract info, open message, type, send.
 * @returns {'sent'|'skipped'|'failed'}
 */
async function processHRCard(card, context) {
  const { messagedHRs, messageTemplate } = context;

  // Get person's name and profile link
  let nameEl = null;
  for (const sel of SELECTORS.profileNameLink) {
    nameEl = card.querySelector(sel);
    if (nameEl) break;
  }
  const profileLink = card.querySelector(SELECTORS.profileLink);
  if (!nameEl || !profileLink) return 'skipped';

  const name = nameEl.textContent.trim().split('\n')[0].trim();
  const profileUrl = profileLink.href;

  // Skip if already messaged
  if (messagedHRs.some(h => h.profileUrl === profileUrl)) return 'skipped';

  // Find the "Message" button on this card
  const actualMsgBtn = findMessageButtonOnCard(card);
  if (!actualMsgBtn) return 'skipped';

  // Personalize the message — replace ALL supported placeholders
  const firstName = name.split(' ')[0];
  const config = await getStorage(null);
  const myName = [config.firstName, config.lastName].filter(Boolean).join(' ') || 'Me';
  const experience = config.yearsOfExperience || config.profile?.yearsOfExperience || '3';
  const headline = config.linkedinHeadline || config.profile?.linkedinHeadline || '';

  // Try to extract company from the person's card (subtitle/headline on the card)
  let personCompany = '';
  const subtitleEl = card.querySelector('.entity-result__primary-subtitle, [class*="subtitle"], [class*="headline"]');
  if (subtitleEl) {
    const subtitleText = subtitleEl.textContent.trim();
    // LinkedIn shows "Title at Company" or "Company" in subtitle
    const atMatch = subtitleText.match(/(?:at|@)\s+(.+)/i);
    if (atMatch) {
      personCompany = atMatch[1].trim();
    } else {
      // Might be just the company name or "Title | Company"
      const pipeMatch = subtitleText.split('|').pop()?.trim() || '';
      if (pipeMatch && pipeMatch.length < 50) {
        personCompany = pipeMatch;
      }
    }
  }

  const personalizedMsg = messageTemplate
    .replace(/\{name\}/gi, firstName)
    .replace(/\{myName\}/gi, myName)
    .replace(/\{experience\}/gi, experience)
    .replace(/\{headline\}/gi, headline)
    .replace(/\{company\}/gi, personCompany)
    .replace(/\{jobTitle\}/gi, '');  // Job title not available in HR search context

  // Click Message button
  actualMsgBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await sleep(400);
  actualMsgBtn.click();

  // Wait for message window to open (adaptive — checks quickly, waits up to 8s)
  log(`Opening message window for ${name}...`, 'info');
  await sleep(1500); // Initial wait for window animation

  // Try to find the message input
  const msgInput = await waitForMessageInput();

  if (!msgInput) {
    // Enhanced debug: check what's actually on the page
    const ce = document.querySelectorAll('[contenteditable]');
    const ceTrue = document.querySelectorAll('[contenteditable="true"]');
    const msgForm = document.querySelectorAll('.msg-form__contenteditable');
    const iframes = document.querySelectorAll('iframe');
    log(`DEBUG: contenteditable=${ce.length}, ce=true=${ceTrue.length}, msg-form__contenteditable=${msgForm.length}, iframes=${iframes.length}`, 'warning');
    
    // If msg-form__contenteditable exists but wasn't found by selectors, grab it directly
    if (msgForm.length > 0) {
      const directInput = msgForm[msgForm.length - 1]; // Last one = most recent window
      log(`DEBUG: Found msg-form__contenteditable directly! Using it.`, 'info');
      return await typeAndSendMessage(directInput, personalizedMsg, name, profileUrl, messagedHRs);
    }

    log(`Could not find message box for ${name}. Retrying...`, 'warning');

    // FIXED: Retry - close and reopen
    await closeMessageWindow();
    await sleep(2000);
    actualMsgBtn.click();
    await sleep(3000);

    const msgInputRetry = await waitForMessageInput();
    if (!msgInputRetry) {
      log(`Could not find message box for ${name} after retry. Skipping.`, 'warning');
      await closeMessageWindow();
      return 'failed';
    }
    // Use the retry result
    return await typeAndSendMessage(msgInputRetry, personalizedMsg, name, profileUrl, messagedHRs);
  }

  // Check for recent conversation (within last 2 months)
  if (await hasRecentConversation()) {
    log(`Skipped ${name} (messaged within last 3 months).`, 'info');
    await closeMessageWindow();
    return 'skipped';
  }

  return await typeAndSendMessage(msgInput, personalizedMsg, name, profileUrl, messagedHRs);
}

/**
 * Wait for the LinkedIn message input to appear with proper retry logic.
 * LinkedIn renders the messaging UI inside a Shadow DOM (div.theme--light),
 * so we must query inside shadowRoot to find the input.
 * Optimized: polls every 300ms for up to 8 seconds (faster detection).
 * @returns {Element|null}
 */
async function waitForMessageInput() {
  // Poll for up to 8 seconds (27 attempts × 300ms)
  for (let attempt = 0; attempt < 27; attempt++) {
    // Try Shadow DOM first (LinkedIn 2025-2026 uses Shadow DOM for messaging)
    const shadowInput = findInputInShadowDOM();
    if (shadowInput) return shadowInput;

    // Fallback: try regular DOM (in case LinkedIn changes back)
    const regularInput = findMessageInputElement();
    if (regularInput) return regularInput;

    await sleep(300);
  }

  // Last resort: brute-force
  const bruteForce = findMessageInputBruteForce();
  if (bruteForce) return bruteForce;

  return null;
}

/**
 * Find the message input inside LinkedIn's Shadow DOM.
 * LinkedIn wraps the messaging UI in a Shadow DOM host (div.theme--light).
 * @returns {Element|null}
 */
function findInputInShadowDOM() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return null;

  // Search inside the shadow root using confirmed selectors
  const selectors = [
    'div.msg-form__contenteditable',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'div[contenteditable="plaintext-only"]',
    'div[role="textbox"][contenteditable]',
    'div[aria-label*="Write a message"]',
  ];

  for (const sel of selectors) {
    const elements = shadowRoot.querySelectorAll(sel);
    if (elements.length > 0) {
      return elements[elements.length - 1];
    }
  }

  // Also try nested shadow roots
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot && el !== document.querySelector('div.theme--light')) {
      const input = el.shadowRoot.querySelector('div.msg-form__contenteditable, div[contenteditable="true"][role="textbox"]');
      if (input) return input;
    }
  }

  return null;
}

/**
 * Find the message input element using centralized selectors.
 * Targets the LAST matching element (most recently opened message window).
 * @returns {Element|null}
 */
function findMessageInputElement() {
  for (const sel of SELECTORS.messageInput) {
    try {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        // Return the LAST match — LinkedIn stacks message windows,
        // and the most recently opened one is last in DOM order
        const el = elements[elements.length - 1];
        // Verify it's visible (not hidden/collapsed)
        if (el.offsetParent !== null || el.offsetHeight > 0) {
          return el;
        }
        // If last isn't visible, try others
        for (let i = elements.length - 1; i >= 0; i--) {
          if (elements[i].offsetParent !== null || elements[i].offsetHeight > 0) {
            return elements[i];
          }
        }
        // Return last even if visibility check fails (offsetParent can be null for fixed elements)
        return el;
      }
    } catch (e) {
      // Invalid selector — skip
    }
  }
  return null;
}

/**
 * Brute-force find a message input by looking for contenteditable elements
 * near "Write a message" placeholder text or within messaging containers.
 * Handles both contenteditable="true" AND contenteditable="plaintext-only".
 * @returns {Element|null}
 */
function findMessageInputBruteForce() {
  // Find ALL contenteditable elements (any value: "true", "plaintext-only", "inherit", etc.)
  const allEditable = document.querySelectorAll('[contenteditable]');

  for (const el of allEditable) {
    const ceValue = el.getAttribute('contenteditable');
    // Skip contenteditable="false"
    if (ceValue === 'false') continue;

    const text = el.textContent.trim().toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const placeholder = (el.getAttribute('data-placeholder') || '').toLowerCase();
    const role = el.getAttribute('role');

    // Match by placeholder text or aria-label
    if (text.includes('write a message') || text === '' ||
        ariaLabel.includes('write a message') || ariaLabel.includes('message') ||
        placeholder.includes('write a message') || placeholder.includes('message')) {

      // Verify it's inside a messaging context
      const parent = el.closest(
        '.msg-overlay-conversation-bubble, ' +
        '.msg-form, ' +
        '[class*="msg-overlay"], ' +
        '[class*="msg-convo"], ' +
        'aside[class*="msg"], ' +
        'form[class*="msg"], ' +
        '[class*="messaging"]'
      );

      if (parent) return el;

      // Also accept if it has role="textbox" and is near a Send button
      if (role === 'textbox') {
        const form = el.closest('form') || el.parentElement?.closest('div');
        if (form) {
          const sendBtn = form.querySelector('button');
          if (sendBtn && sendBtn.textContent.trim().toLowerCase().includes('send')) {
            return el;
          }
        }
        if (ariaLabel.includes('message') || ariaLabel.includes('write')) {
          return el;
        }
      }
    }
  }

  // Last resort: find by proximity to "Send" button
  const sendButtons = document.querySelectorAll('button');
  for (const btn of sendButtons) {
    if (btn.textContent.trim() === 'Send' && !btn.disabled) {
      let container = btn.parentElement;
      for (let i = 0; i < 6 && container; i++) {
        const editable = container.querySelector('[contenteditable]:not([contenteditable="false"])');
        if (editable) return editable;
        container = container.parentElement;
      }
    }
  }

  return null;
}

/**
 * Type a message into the input and click Send.
 * @returns {'sent'|'failed'}
 */
async function typeAndSendMessage(msgInput, message, name, profileUrl, messagedHRs) {
  // Focus and click the input
  msgInput.click();
  msgInput.focus();
  await sleep(300);

  // Clear any existing content
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  await sleep(150);

  // Type the message using execCommand (works with contenteditable)
  document.execCommand('insertText', false, message);
  await sleep(600);

  // Verify text was typed
  const parentEditable = msgInput.closest('[contenteditable="true"]') || msgInput;
  let typed = parentEditable.textContent.trim();

  if (!typed || typed === 'Write a message…' || typed === 'Write a message...') {
    log(`Message not typed for ${name}. Trying alternate method...`, 'warning');

    // Alternate method 1: Set innerHTML with paragraph
    parentEditable.innerHTML = `<p>${message}</p>`;
    parentEditable.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);

    typed = parentEditable.textContent.trim();
    if (!typed || typed === 'Write a message…' || typed === 'Write a message...') {
      // Alternate method 2: Set innerText and dispatch events
      parentEditable.innerText = message;
      parentEditable.dispatchEvent(new Event('input', { bubbles: true }));
      parentEditable.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);
    }
  }

  // Final verification
  const finalText = parentEditable.textContent.trim();
  if (!finalText || finalText === 'Write a message…' || finalText === 'Write a message...') {
    log(`Failed to type message for ${name}. Closing.`, 'warning');
    await closeMessageWindow();
    return 'failed';
  }

  // Fire input event to enable Send button
  parentEditable.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(600);

  // Check again for recent conversation (duplicate check after message loads)
  if (await hasRecentConversation()) {
    log(`Skipped ${name} (recent conversation detected after opening).`, 'info');
    // Clear the typed message
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await closeMessageWindow();
    return 'skipped';
  }

  // Find and click Send button
  const sent = await clickSendButton(parentEditable, message);

  if (sent) {
    messagedHRs.push({ name, profileUrl, date: new Date().toISOString() });
    log(`[Messaged] ${name}`, 'success');
    chrome.storage.local.set({ messagedHRs });
    await sleep(1000);
    await closeMessageWindow();
    return 'sent';
  } else {
    log(`Could not send to ${name} (send button not found/disabled).`, 'warning');
    await closeMessageWindow();
    return 'failed';
  }
}

/**
 * Find and click the Send button.
 * Checks both regular DOM and Shadow DOM.
 * @returns {boolean} - Whether send was successful
 */
async function clickSendButton(parentEditable, message) {
  const shadowRoot = getShadowRoot();

  // Method 1: Find Send button by text inside Shadow DOM
  let sendBtn = null;
  if (shadowRoot) {
    const btns = shadowRoot.querySelectorAll('button');
    for (const btn of btns) {
      if (btn.textContent.trim() === 'Send' && !btn.disabled) {
        sendBtn = btn;
        break;
      }
    }
    // Also try by class (confirmed: msg-form__send-button)
    if (!sendBtn) {
      sendBtn = shadowRoot.querySelector('button.msg-form__send-button:not([disabled])');
    }
  }

  // Method 2: Try regular DOM
  if (!sendBtn) {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      if (btn.textContent.trim() === 'Send' && !btn.disabled) {
        sendBtn = btn;
        break;
      }
    }
  }

  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    await sleep(500);
    return true;
  }

  // Method 3: Try pressing Enter to send
  parentEditable.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    keyCode: 13,
    bubbles: true
  }));
  await sleep(800);

  // Check if message was sent (text should be cleared)
  const afterEnter = parentEditable.textContent.trim();
  if (!afterEnter || afterEnter.length < message.length / 2) {
    return true;
  }

  return false;
}

/**
 * Check if there's ANY existing conversation with this person.
 * If any messages exist (including deleted ones), skip — we've already messaged them.
 * This prevents re-messaging people even if messages were deleted.
 * @returns {boolean}
 */
async function hasRecentConversation() {
  // Helper to query in both regular and shadow DOM
  function queryAll(selector) {
    const regular = document.querySelectorAll(selector);
    const results = Array.from(regular);
    
    const shadowHosts = document.querySelectorAll('div.theme--light, div[class*="theme--"]');
    for (const host of shadowHosts) {
      if (host.shadowRoot) {
        const shadow = host.shadowRoot.querySelectorAll(selector);
        results.push(...Array.from(shadow));
      }
    }
    return results;
  }

  // Check if ANY messages exist in the conversation — if yes, we've already talked
  const chatMsgs = queryAll(SELECTORS.chatMessages.join(', '));
  if (chatMsgs.length > 0) {
    return true; // Any message = already contacted, skip this person
  }

  return false;
}

/**
 * Find the "Message" button on a people search card.
 * @param {Element} card
 * @returns {Element|null}
 */
function findMessageButtonOnCard(card) {
  // Method 1: aria-label based
  const ariaBtn = card.querySelector(
    'button[aria-label*="Message"], a[aria-label*="Message"]'
  );

  // Method 2: Find by text content
  let textBtn = null;
  const allBtns = card.querySelectorAll('button, a[role="button"], a[href*="messaging"], a');
  for (const btn of allBtns) {
    if (btn.textContent.trim() === 'Message') {
      textBtn = btn;
      break;
    }
  }

  return textBtn || ariaBtn || null;
}

/**
 * Close the message overlay/conversation window.
 * Must check inside Shadow DOM since LinkedIn's messaging is shadow-encapsulated.
 */
async function closeMessageWindow() {
  // LinkedIn's messaging UI is inside Shadow DOM (div.theme--light > shadowRoot)
  const shadowRoot = getShadowRoot();

  if (shadowRoot) {
    // Find close button by text content (most reliable)
    const buttons = shadowRoot.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes('close your') || text.includes('close conversation') || text.includes('close your draft')) {
        btn.click();
        await sleep(500);
        return;
      }
    }

    // Try by class
    const closeByClass = shadowRoot.querySelector(
      'button.msg-overlay-bubble-header__control[class*="close"]'
    );
    if (closeByClass) {
      closeByClass.click();
      await sleep(500);
      return;
    }
  }

  // Try regular DOM selectors
  for (const sel of SELECTORS.messageClose) {
    const closeBtn = document.querySelector(sel);
    if (closeBtn) {
      closeBtn.click();
      await sleep(500);
      return;
    }
  }

  // Last resort: press Escape
  pressEscape();
  await sleep(500);
  pressEscape();
  await sleep(300);
}

/**
 * Get the Shadow DOM root where LinkedIn's messaging UI lives.
 * @returns {ShadowRoot|null}
 */
function getShadowRoot() {
  const host = document.querySelector('div.theme--light, div[class*="theme--"]');
  return host?.shadowRoot || null;
}

/**
 * Navigate to the next page of HR search results.
 * @param {number} pageNum - Target page number
 * @returns {boolean} - Whether navigation was successful
 */
async function goToHRNextPage(pageNum) {
  // Method 1: Direct page number button
  let nextBtn = document.querySelector(`button[aria-label="Page ${pageNum}"]`);

  // Method 2: "Next" button
  if (!nextBtn) {
    const allBtns = document.querySelectorAll('button, a');
    for (const btn of allBtns) {
      const label = btn.getAttribute('aria-label') || btn.textContent.trim();
      if (label === 'Next' || label === `Page ${pageNum}` || label === 'Forward') {
        nextBtn = btn;
        break;
      }
    }
  }

  // Method 3: Pagination container
  if (!nextBtn) {
    const paginationBtns = document.querySelectorAll(SELECTORS.paginationButtons);
    for (const btn of paginationBtns) {
      if (btn.textContent.trim() === String(pageNum)) {
        nextBtn = btn;
        break;
      }
    }
  }

  if (nextBtn) {
    nextBtn.scrollIntoView({ block: 'center' });
    await sleep(500);
    nextBtn.click();
    log(`Moving to page ${pageNum}...`, 'info');
    return true;
  }

  return false;
}
