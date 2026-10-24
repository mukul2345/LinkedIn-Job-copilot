// modules/autofill/base-adapter.js — Generic per-ATS autofill adapter framework.
//
// A BaseAdapter knows how to: find the application form, detect every fillable
// field, resolve a value for each (via ATS.FieldMatcher + ATS.Profile), upload a
// resume, and advance through multi-step forms to the final submit button.
//
// The generic implementation works on the majority of modern ATS platforms
// (Greenhouse, Lever, Ashby, Workable, Breezy, SmartRecruiters, etc.) because
// they all render standard <input>/<select>/<textarea> controls with associated
// <label>s. Site-specific subclasses (see adapters.js) only override the few
// hooks where a platform deviates (custom dropdowns, shadow roots, step buttons).
//
// Classic content script — attaches to the shared window.ATS namespace.

(function () {
  'use strict';
  const ATS = (window.ATS = window.ATS || {});
  const dom = ATS.dom;

  const MAX_STEPS = 8;          // hard cap on multi-step pagination
  const STEP_SETTLE_MS = 1500;  // wait after clicking next/submit for the next page

  // Button text fragments (lowercase). Order matters: submit is checked before next.
  const SUBMIT_TEXTS = [
    'submit application', 'submit your application', 'send application',
    'submit & apply', 'submit and apply', 'finish & submit', 'submit', 'apply now',
  ];
  const NEXT_TEXTS = [
    'save and continue', 'save & continue', 'continue to next', 'review your application',
    'next step', 'continue', 'next', 'review', 'proceed',
  ];
  // Fields we never auto-touch (handled separately or intentionally skipped).
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search']);

  class BaseAdapter {
    constructor() {
      this.name = 'generic';
      // Subclasses set hostPatterns to claim specific domains.
      this.hostPatterns = [];
    }

    /** Does this adapter handle the given hostname? */
    matches(hostname) {
      return this.hostPatterns.some((p) => hostname.includes(p));
    }

    // ===================================================================
    // Overridable hooks — sensible generic defaults below.
    // ===================================================================

    /** Root element that contains the application form. */
    getFormRoot() {
      // Prefer a form that actually contains text inputs (skip search bars).
      const forms = Array.from(document.querySelectorAll('form'));
      const scored = forms
        .map((f) => ({ f, n: f.querySelectorAll('input, select, textarea').length }))
        .filter((x) => x.n >= 2)
        .sort((a, b) => b.n - a.n);
      if (scored.length) return scored[0].f;
      return document.querySelector('main') || document.body;
    }

    /** Best-effort job title for narration. */
    getJobTitle() {
      const sels = [
        '[data-ui="job-title"]', '.app-title', '.posting-headline h2',
        'h1.job__title', 'h1[class*="title"]', 'h1', 'h2[class*="title"]',
      ];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.textContent.trim()) return el.textContent.trim().slice(0, 120);
      }
      // Fall back to <title> minus the company/board suffix.
      return (document.title || '').split(/[|\-–·]/)[0].trim().slice(0, 120) || 'this role';
    }

    /** Best-effort company name for narration. */
    getCompany() {
      const sels = [
        '[data-ui="company-name"]', '.company-name', '.posting-categories .company',
        'meta[property="og:site_name"]',
      ];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (!el) continue;
        const v = el.getAttribute('content') || el.textContent;
        if (v && v.trim()) return v.trim().slice(0, 80);
      }
      return '';
    }

    /** File inputs that should receive the resume / CV. */
    getResumeInputs(root) {
      const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
      return inputs.filter((el) => {
        const hay = [
          el.name, el.id, el.getAttribute('accept') || '',
          this.resolveLabel(el),
        ].join(' ').toLowerCase();
        // Resume/CV by name, or any pdf/doc accepting input that isn't clearly a cover-letter/photo.
        const isResume = /resume|cv|curriculum/.test(hay);
        const acceptsDoc = /pdf|\.doc|word|document/.test(hay);
        const isOther = /photo|image|avatar|logo|portfolio image/.test(hay);
        return (isResume || acceptsDoc) && !isOther;
      });
    }

    /** The terminal submit button, or null if not on the final step. */
    getSubmitButton(root) {
      // Exact match first so "Submit application" wins over a stray "Apply" link.
      return (
        dom.findButton(root, SUBMIT_TEXTS, true) ||
        dom.findButton(root, SUBMIT_TEXTS, false) ||
        dom.findButton(document, SUBMIT_TEXTS, true)
      );
    }

    /** A next/continue button for multi-step forms, or null. */
    getNextButton(root) {
      return dom.findButton(root, NEXT_TEXTS, true) || dom.findButton(root, NEXT_TEXTS, false);
    }

    /** Heuristic: did the application submit successfully? */
    isApplicationComplete() {
      const text = (document.body.innerText || '').toLowerCase();
      const phrases = [
        'application submitted', 'thank you for applying', 'thanks for applying',
        'application received', 'successfully applied', "we've received your application",
        'your application has been', 'application complete',
      ];
      return phrases.some((p) => text.includes(p));
    }

    // ===================================================================
    // Core engine — generally not overridden.
    // ===================================================================

    /**
     * Run the full apply flow.
     * @param {object} ctx - {
     *   profile, raw, mode ('auto'|'copilot'), resumeFile (File|null),
     *   emit(event, payload), shouldStop() => boolean
     * }
     * @returns {Promise<{status:string, filled:number, total:number, missing:string[]}>}
     */
    async run(ctx) {
      const { emit } = ctx;
      const title = this.getJobTitle();
      const company = this.getCompany();
      // Stash for AI prompt context (form-filler/field-matcher read these).
      ctx.raw._currentJobTitle = title;
      ctx.raw._currentCompany = company;

      emit('detect', { title, company, adapter: this.name });

      let totalFilled = 0;
      let totalFields = 0;
      const missing = [];

      for (let step = 0; step < MAX_STEPS; step++) {
        if (ctx.shouldStop()) return { status: 'stopped', filled: totalFilled, total: totalFields, missing };

        const root = this.getFormRoot();
        emit('gather', { step: step + 1 });
        const fields = this.collectFields(root);

        if (fields.length) {
          emit('fill', { count: fields.length, step: step + 1 });
          const res = await this.fillFields(fields, ctx);
          totalFilled += res.filled;
          totalFields += res.total;
          res.missing.forEach((m) => { if (!missing.includes(m)) missing.push(m); });
        }

        // Upload resume on whichever step exposes the file input.
        await this.uploadResume(root, ctx);

        if (ctx.shouldStop()) return { status: 'stopped', filled: totalFilled, total: totalFields, missing };

        const submitBtn = this.getSubmitButton(root);
        const nextBtn = this.getNextButton(root);

        // Multi-step: advance when there's a next but no terminal submit yet.
        if (nextBtn && !submitBtn) {
          await dom.sleep(600);
          nextBtn.click();
          await dom.sleep(STEP_SETTLE_MS);
          continue;
        }

        if (submitBtn) {
          dom.highlight(submitBtn, '#10b981');
          emit('review', {
            filled: totalFilled,
            total: totalFields,
            missing,
            reason: ctx.mode === 'copilot' ? 'copilot-review' : 'explicit-submit-confirmation-required',
          });
          return { status: 'review', filled: totalFilled, total: totalFields, missing };
        }

        // Neither next nor submit found — nothing more we can do automatically.
        break;
      }

      emit('review', { filled: totalFilled, total: totalFields, missing, reason: 'no-submit' });
      return { status: 'incomplete', filled: totalFilled, total: totalFields, missing };
    }

    /**
     * Detect every fillable field within the form root.
     * Radios are grouped by name; checkboxes/file/text handled individually.
     * @returns {Array<{kind:string, el:Element, group?:Element[], meta:object}>}
     */
    collectFields(root) {
      const controls = Array.from(root.querySelectorAll('input, select, textarea'));
      const fields = [];
      const seenRadioGroups = new Set();

      for (const el of controls) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();

        if (tag === 'input' && SKIP_TYPES.has(type)) continue;
        if (type === 'file') continue; // handled by uploadResume
        if (!dom.isVisible(el)) continue;

        if (tag === 'select') {
          fields.push({ kind: 'select', el, meta: this.buildMeta(el, 'select') });
          continue;
        }
        if (tag === 'textarea') {
          if (el.value && el.value.trim()) continue;
          fields.push({ kind: 'textarea', el, meta: this.buildMeta(el, 'textarea') });
          continue;
        }
        // input
        if (type === 'radio') {
          const name = el.name || el.getAttribute('aria-labelledby') || '';
          const key = name || el.id;
          if (key && seenRadioGroups.has(key)) continue;
          if (key) seenRadioGroups.add(key);
          const group = name
            ? Array.from(root.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`))
            : [el];
          if (group.some((r) => r.checked)) continue; // already answered
          fields.push({ kind: 'radio', el, group, meta: this.buildMeta(el, 'radio') });
          continue;
        }
        if (type === 'checkbox') {
          fields.push({ kind: 'checkbox', el, meta: this.buildMeta(el, 'checkbox') });
          continue;
        }
        // text / email / tel / number / url / (no type)
        if (el.value && el.value.trim()) continue; // don't clobber prefilled values
        const kind = type === 'number' ? 'number' : type === 'email' ? 'email' : 'text';
        fields.push({ kind, el, meta: this.buildMeta(el, kind) });
      }

      return fields;
    }

    /** Build the normalized meta object FieldMatcher consumes. */
    buildMeta(el, kind) {
      return {
        label: this.resolveLabel(el),
        name: el.getAttribute('name') || el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        type: (el.getAttribute('type') || '').toLowerCase(),
        kind,
      };
    }

    /**
     * Resolve the human-readable label for a control, trying many strategies.
     * For radios/checkboxes we want the GROUP question, not the single option.
     */
    resolveLabel(el) {
      // 1. aria-labelledby (can reference multiple ids)
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const text = labelledby
          .split(/\s+/)
          .map((id) => {
            const ref = document.getElementById(id);
            return ref ? ref.textContent.trim() : '';
          })
          .filter(Boolean)
          .join(' ');
        if (text) return text;
      }

      // 2. aria-label
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();

      // 3. <label for="id">
      if (el.id) {
        let escaped = el.id;
        try { escaped = CSS.escape(el.id); } catch (e) { /* noop */ }
        const forLabel = document.querySelector(`label[for="${escaped}"]`);
        if (forLabel && forLabel.textContent.trim()) return forLabel.textContent.trim();
      }

      // 4. For grouped controls, prefer the fieldset legend / group label.
      const fieldset = el.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend && legend.textContent.trim()) return legend.textContent.trim();
      }
      const group = el.closest('[role="group"], [role="radiogroup"]');
      if (group) {
        const gl = group.getAttribute('aria-label');
        if (gl) return gl.trim();
      }

      // 5. Wrapping <label>
      const wrap = el.closest('label');
      if (wrap && wrap.textContent.trim()) return this._stripControlText(wrap, el);

      // 6. Climb to a form-field container and grab its label-ish text.
      const container = el.closest(
        '.field, .form-field, .form-group, .input, [class*="field"], [class*="question"], [class*="form-group"]'
      );
      if (container) {
        const lbl = container.querySelector('label, legend, .label, [class*="label"], [class*="title"]');
        if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
      }

      // 7. Placeholder / humanized name as last resort.
      const ph = el.getAttribute('placeholder');
      if (ph && ph.trim()) return ph.trim();
      const name = el.getAttribute('name') || el.id || '';
      return name.replace(/[_\-\[\]]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    }

    /** Remove the control's own option text from a wrapping-label's text. */
    _stripControlText(labelEl, el) {
      let txt = labelEl.textContent.trim();
      if (el.value && txt.toLowerCase() === el.value.toLowerCase()) return txt;
      return txt;
    }

    /**
     * Fill an array of detected fields. Returns counts + missing-field labels.
     */
    async fillFields(fields, ctx) {
      const { profile, raw } = ctx;
      let filled = 0;
      const missing = [];

      for (const field of fields) {
        if (ctx.shouldStop()) break;
        try {
          const answer = await ATS.FieldMatcher.resolve(field.meta, profile, raw);
          const ok = await this.applyAnswer(field, answer, ctx);
          if (ok) {
            filled++;
            await dom.sleep(160);
          } else if (this._isRequired(field.el) && answer == null) {
            missing.push(field.meta.label || field.meta.name);
          }
        } catch (e) {
          // Never let one bad field abort the whole form.
        }
      }
      return { filled, total: fields.length, missing };
    }

    /** Apply a resolved answer to a field according to its kind. */
    async applyAnswer(field, answer, ctx) {
      const { kind, el, group } = field;

      // Checkboxes may be legal attestations, consent, preferences, or marketing
      // choices. Only an explicit, high-confidence profile value may select one.
      if (kind === 'checkbox') {
        if (!answer || answer.confidence !== 'high') return false;
        return /^yes|true$/i.test(answer.value) ? dom.setCheckbox(el, true) : false;
      }

      if (!answer || answer.value == null || answer.value === '' || answer.confidence === 'low') return false;

      switch (kind) {
        case 'select':
          return dom.selectOption(el, answer.value);
        case 'radio':
          return dom.chooseRadio(group || [el], answer.value);
        case 'textarea':
        case 'text':
        case 'email':
        case 'number':
          return dom.fillText(el, answer.value);
        default:
          return false;
      }
    }

    _isRequired(el) {
      return (
        el.required ||
        el.getAttribute('aria-required') === 'true' ||
        /\*/.test(this.resolveLabel(el))
      );
    }

    /**
     * Attach the user's resume to any resume file input on this step.
     * If no resume file is configured, highlight the input for manual upload.
     */
    async uploadResume(root, ctx) {
      const inputs = this.getResumeInputs(root);
      if (!inputs.length) return false;

      const target = inputs[0];
      if (ctx.resumeFile) {
        ctx.emit('upload', { fileName: ctx.resumeFile.name });
        const ok = dom.attachFile(target, ctx.resumeFile);
        await dom.sleep(STEP_SETTLE_MS);
        return ok;
      }
      // No file available — flag it so the user can drop one in (Co-Pilot friendly).
      dom.highlight(target, '#f59e0b');
      ctx.emit('upload-manual', {});
      return false;
    }
  }

  ATS.BaseAdapter = BaseAdapter;
  // Expose tuning constants for adapters/tests.
  ATS.BaseAdapter.CONSTANTS = { MAX_STEPS, STEP_SETTLE_MS, SUBMIT_TEXTS, NEXT_TEXTS };
})();
