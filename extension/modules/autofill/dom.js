// modules/autofill/dom.js — Low-level DOM primitives for the generic ATS autofill engine.
// Framework-agnostic helpers that work across React/Vue/Angular controlled inputs.
// Attaches to the shared window.ATS namespace (classic content script, no ES modules).

(function () {
  'use strict';
  const ATS = (window.ATS = window.ATS || {});

  const dom = {};

  /**
   * Sleep with a little randomized jitter (keeps timing human-ish).
   * @param {number} ms
   * @returns {Promise<void>}
   */
  dom.sleep = function (ms) {
    const jitter = ms * 0.25;
    const t = ms + (Math.random() * jitter * 2 - jitter);
    return new Promise((r) => setTimeout(r, Math.max(t, 120)));
  };

  /**
   * Is the element actually visible/interactable on the page?
   * @param {Element} el
   * @returns {boolean}
   */
  dom.isVisible = function (el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };

  /**
   * Set an input/textarea value in a way that survives React's controlled-input
   * value tracking (uses the native prototype setter, then fires events).
   * @param {HTMLInputElement|HTMLTextAreaElement} el
   * @param {string} value
   */
  dom.setNativeValue = function (el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /**
   * Fill a text/number/email input or textarea. Skips if empty value.
   * Focuses first, sets the value, then blurs to trigger validation.
   * @returns {boolean} whether a value was written
   */
  dom.fillText = function (el, value) {
    if (!el || value == null || String(value) === '') return false;
    try {
      el.focus();
      dom.setNativeValue(el, String(value));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  };

  /**
   * Pick the best matching <option> in a native <select>.
   * Tries: exact text/value, then partial, then a sensible non-placeholder fallback.
   * @returns {boolean} whether a selection was made
   */
  dom.selectOption = function (selectEl, value) {
    if (!selectEl || value == null || String(value) === '') return false;
    const target = String(value).toLowerCase().trim();
    const opts = Array.from(selectEl.options || []).filter((o) => o.text && o.text.trim());

    const apply = (opt) => {
      selectEl.value = opt.value;
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    // Exact match on visible text or underlying value.
    let match = opts.find(
      (o) => o.text.toLowerCase().trim() === target || o.value.toLowerCase().trim() === target
    );
    // Partial / contains match (guard against trivial placeholder options).
    if (!match) {
      match = opts.find((o) => {
        const t = o.text.toLowerCase().trim();
        return t.length > 1 && (t.includes(target) || target.includes(t));
      });
    }
    if (match) return apply(match);
    return false;
  };

  /**
   * Resolve the human-readable label text associated with a radio/checkbox input.
   */
  function inputLabelText(input) {
    if (input.id) {
      let escaped = input.id;
      try { escaped = (window.CSS && CSS.escape) ? CSS.escape(input.id) : input.id; } catch (e) { /* noop */ }
      const l = document.querySelector(`label[for="${escaped}"]`);
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    const wrap = input.closest('label');
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    const aria = input.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (input.nextElementSibling && input.nextElementSibling.textContent.trim()) {
      return input.nextElementSibling.textContent.trim();
    }
    return input.value || '';
  }
  dom.inputLabelText = inputLabelText;

  /**
   * Choose a radio option from a group by matching the desired value against
   * each option's label text. Falls back to yes/decline/first as appropriate.
   * @param {HTMLInputElement[]} inputs
   * @param {string} value
   * @returns {boolean}
   */
  dom.chooseRadio = function (inputs, value) {
    const list = Array.from(inputs || []).filter(Boolean);
    if (!list.length || value == null || String(value) === '') return false;
    const target = String(value).toLowerCase().trim();
    const withText = list.map((i) => ({ i, t: inputLabelText(i).toLowerCase().trim() }));

    let m = withText.find((x) => x.t === target);
    if (!m) m = withText.find((x) => x.t && (x.t.includes(target) || target.includes(x.t)));
    if (!m && (target === 'yes' || target === 'no')) {
      m = withText.find((x) => x.t.startsWith(target));
    }
    if (!m) return false;
    m.i.click();
    return true;
  };

  /**
   * Check/uncheck a single checkbox.
   */
  dom.setCheckbox = function (el, checked) {
    if (!el) return false;
    if (!!el.checked === !!checked) return true;
    el.click();
    return true;
  };

  /**
   * Attach a File object to a file input via DataTransfer (the only way to
   * programmatically set input.files in Chrome). Requires a real File/Blob.
   * @param {HTMLInputElement} inputEl
   * @param {File} file
   * @returns {boolean}
   */
  dom.attachFile = function (inputEl, file) {
    if (!inputEl || !file) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  };

  /**
   * Draw attention to an element the user needs to handle manually.
   */
  dom.highlight = function (el, color) {
    if (!el) return;
    try {
      el.style.outline = `2px solid ${color || '#f59e0b'}`;
      el.style.outlineOffset = '2px';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { /* noop */ }
  };

  /**
   * Find a clickable, enabled button inside a container by matching any of the
   * provided text fragments against textContent / aria-label / value.
   * @param {Element} container
   * @param {string[]} texts - lowercase fragments to match
   * @param {boolean} exact - require exact (trimmed) match
   * @returns {HTMLElement|null}
   */
  dom.findButton = function (container, texts, exact) {
    const root = container || document;
    const candidates = root.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"], a.button'
    );
    for (const btn of candidates) {
      if (btn.disabled || !dom.isVisible(btn)) continue;
      const label = (
        btn.textContent || btn.value || btn.getAttribute('aria-label') || ''
      ).toLowerCase().trim();
      if (!label) continue;
      for (const t of texts) {
        const frag = t.toLowerCase();
        if (exact ? label === frag : label.includes(frag)) return btn;
      }
    }
    return null;
  };

  /**
   * Wait for any of the given selectors to appear (MutationObserver based).
   * @param {string[]} selectors
   * @param {number} timeout
   * @returns {Promise<Element|null>}
   */
  dom.waitForAny = function (selectors, timeout) {
    return new Promise((resolve) => {
      const find = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      };
      const found = find();
      if (found) return resolve(found);
      if (!document.body) return setTimeout(() => resolve(null), timeout || 8000);

      let done = false;
      const obs = new MutationObserver(() => {
        const el = find();
        if (el && !done) {
          done = true;
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        if (!done) {
          done = true;
          obs.disconnect();
          resolve(null);
        }
      }, timeout || 8000);
    });
  };

  ATS.dom = dom;
})();
