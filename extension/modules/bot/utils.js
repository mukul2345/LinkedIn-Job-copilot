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

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
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

    const observer = new MutationObserver(() => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          observer.disconnect();
          resolve(el);
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
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
  console.log(`[LinkedIn Auto Applier] ${message}`);
  chrome.runtime.sendMessage({ type: 'log', message, level }).catch(() => {});
}

/**
 * Send bot status counts to popup.
 */
function sendStatus(applied, skipped, failed) {
  chrome.runtime.sendMessage({
    type: 'status',
    applied,
    skipped,
    failed
  }).catch(() => {});
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
 */
function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'lja-confirm-overlay';
    overlay.innerHTML = `
      <div class="lja-confirm-box">
        <p>${message}</p>
        <div class="lja-confirm-actions">
          <button id="lja-confirm-yes">Submit</button>
          <button id="lja-confirm-no">Skip</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('lja-confirm-yes').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    document.getElementById('lja-confirm-no').onclick = () => {
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
