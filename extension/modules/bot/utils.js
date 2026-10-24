// utils.js - Core utility functions (sleep, logging, storage, DOM helpers)

/**
 * Sleep with randomized jitter to avoid detection.
 * @param {number} ms - Base milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  const jitter = ms * 0.3;
  const randomized = ms + (Math.random() * jitter * 2 - jitter);
  return new Promise(resolve => setTimeout(resolve, Math.max(randomized, 200)));
}

/**
 * Wait for a DOM element to appear using MutationObserver.
 * @param {string} selector - CSS selector to wait for
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    // Guard against document.body not being ready
    if (!document.body) {
      setTimeout(() => resolve(null), timeout);
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el && !resolved) {
        resolved = true;
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(null);
      }
    }, timeout);
  });
}

/**
 * Wait for any of multiple selectors to appear.
 * @param {string[]} selectors - Array of CSS selectors
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<Element|null>}
 */
function waitForAnyElement(selectors, timeout = 10000) {
  return new Promise((resolve) => {
    // Check immediately
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return resolve(el);
    }

    // Guard against document.body not being ready
    if (!document.body) {
      setTimeout(() => resolve(null), timeout);
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && !resolved) {
          resolved = true;
          observer.disconnect();
          resolve(el);
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(null);
      }
    }, timeout);
  });
}

/**
 * Retry finding an element with increasing delays.
 * @param {string[]} selectors - CSS selectors to try
 * @param {number} maxRetries - Number of retries
 * @param {number} baseDelay - Base delay between retries in ms
 * @returns {Promise<Element|null>}
 */
async function retryFindElement(selectors, maxRetries = 3, baseDelay = 1500) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    if (attempt < maxRetries) {
      await sleep(baseDelay * (attempt + 1));
    }
  }
  return null;
}

/**
 * Set a native input value (bypasses React/Angular controlled inputs).
 */
function setNativeValue(element, value) {
  let setter = null;

  if (element instanceof HTMLInputElement) {
    setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
  } else if (element instanceof HTMLTextAreaElement) {
    setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
  }

  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Dispatch Escape key event to close modals/overlays.
 */
function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    keyCode: 27,
    bubbles: true
  }));
}

/**
 * Find a button by its visible text content.
 * @param {Element} container - DOM container to search within
 * @param {string} text - Button text to find
 * @returns {Element|null}
 */
function findButtonByText(container, text) {
  const buttons = container.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.disabled) continue;
    const btnText = btn.textContent.trim().toLowerCase();
    if (btnText === text.toLowerCase() || btnText.includes(text.toLowerCase())) {
      return btn;
    }
  }
  const ariaBtn = container.querySelector(`button[aria-label*="${text}" i]`);
  if (ariaBtn && !ariaBtn.disabled) return ariaBtn;
  return null;
}

/**
 * Log a message to console and send to popup via chrome.runtime.
 */
function log(message, level = 'info') {
  ExtensionLogger.info('Bot event.', { level });
  chrome.runtime.sendMessage(MessageProtocol.create(MessageType.LOG, { message, level })).catch(() => {});
}

/**
 * Send bot status counts to popup.
 */
function sendStatus(applied, skipped, failed) {
  chrome.runtime.sendMessage(MessageProtocol.create(MessageType.STATUS, {
    applied,
    skipped,
    failed,
  })).catch(() => {});
}

/**
 * Get data from chrome.storage.local.
 * @param {string|string[]|null} keys - Keys to retrieve (null = all)
 * @returns {Promise<object>}
 */
function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data));
  });
}

/**
 * Show a confirmation dialog overlay on the page.
 * Uses textContent to prevent XSS from malicious job titles/company names.
 */
function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'lja-confirm-overlay';

    const box = document.createElement('div');
    box.className = 'lja-confirm-box';

    const p = document.createElement('p');
    p.textContent = message; // Safe: textContent prevents XSS

    const actions = document.createElement('div');
    actions.className = 'lja-confirm-actions';

    const yesBtn = document.createElement('button');
    yesBtn.id = 'lja-confirm-yes';
    yesBtn.textContent = 'Submit';

    const noBtn = document.createElement('button');
    noBtn.id = 'lja-confirm-no';
    noBtn.textContent = 'Skip';

    actions.appendChild(yesBtn);
    actions.appendChild(noBtn);
    box.appendChild(p);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    yesBtn.onclick = () => {
      overlay.remove();
      resolve(true);
    };
    noBtn.onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

/**
 * Show the "Auto Applying..." status badge on the page.
 */
function showStatusBadge() {
  removeStatusBadge();
  const badge = document.createElement('div');
  badge.className = 'lja-status-badge';
  badge.id = 'lja-status-badge';
  badge.innerHTML = '<span class="lja-dot"></span> ⚡ JobPilot AI — Running';
  document.body.appendChild(badge);
}

/**
 * Remove the status badge from the page.
 */
function removeStatusBadge() {
  const existing = document.getElementById('lja-status-badge');
  if (existing) existing.remove();
}

/**
 * Render a message template by substituting {placeholder} tokens with values.
 * Placeholder matching is case-insensitive and only replaces keys that are
 * present in `values`. Any token whose key is missing (or whose value is empty)
 * is intentionally left in place so the caller can detect it as unresolved.
 *
 * @param {string} template - Raw template text containing {field} tokens
 * @param {Object<string,string>} values - Map of placeholder name → value
 * @returns {string} Rendered message (may still contain unresolved tokens)
 */
function renderTemplate(template, values) {
  if (!template) return '';
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    const token = new RegExp(`\\{${key}\\}`, 'gi');
    rendered = rendered.replace(token, String(value));
  }
  return rendered;
}

/**
 * Find any unresolved {placeholder} tokens remaining in a rendered message.
 * @param {string} message - Rendered message text
 * @returns {string[]} List of unresolved placeholder names (without braces)
 */
function findUnresolvedPlaceholders(message) {
  if (!message) return [];
  const matches = message.match(/\{[a-zA-Z0-9_]+\}/g) || [];
  return matches.map(token => token.slice(1, -1));
}

/**
 * Build a stable dedupe key for a recruiter/HR contact on a specific job posting.
 * Ensures the same person is never messaged twice for the same job.
 * @param {string} contactId - Recruiter profile URL or name
 * @param {string} jobId - Job posting identifier (empty for network-wide outreach)
 * @returns {string}
 */
function buildOutreachDedupeKey(contactId, jobId) {
  return `${(contactId || '').trim().toLowerCase()}::${(jobId || '').trim().toLowerCase()}`;
}

/**
 * Check whether a recruiter has already been messaged for a given job posting.
 * Reads the persisted `outreachLog` from chrome.storage.local.
 * @param {string} contactId - Recruiter profile URL or name
 * @param {string} jobId - Job posting identifier
 * @returns {Promise<boolean>}
 */
async function hasAlreadyMessaged(contactId, jobId) {
  const key = buildOutreachDedupeKey(contactId, jobId);
  const data = await getStorage(['outreachLog']);
  const log = data.outreachLog || {};
  return Boolean(log[key]);
}

/**
 * Record that a recruiter was messaged for a given job posting, so future runs
 * skip them. Persists to chrome.storage.local under `outreachLog`.
 * @param {string} contactId - Recruiter profile URL or name
 * @param {string} jobId - Job posting identifier
 * @returns {Promise<void>}
 */
async function recordOutreach(contactId, jobId) {
  const key = buildOutreachDedupeKey(contactId, jobId);
  const data = await getStorage(['outreachLog']);
  const log = data.outreachLog || {};
  log[key] = new Date().toISOString();
  await new Promise(resolve => chrome.storage.local.set({ outreachLog: log }, resolve));
}
