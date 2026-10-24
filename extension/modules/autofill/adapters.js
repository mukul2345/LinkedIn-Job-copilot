// modules/autofill/adapters.js — Concrete ATS adapters + hostname registry.
//
// Each adapter extends ATS.BaseAdapter and overrides only the hooks where the
// platform deviates from the generic behavior. The generic BaseAdapter already
// handles standard <input>/<select>/<textarea> forms, so most adapters are thin.
//
// ATS.resolveAdapter(hostname) returns the best adapter instance for the page,
// falling back to a plain BaseAdapter ("generic") when nothing specific matches.

(function () {
  'use strict';
  const ATS = (window.ATS = window.ATS || {});
  const Base = ATS.BaseAdapter;
  const dom = ATS.dom;

  if (!Base) {
    console.error('[ATS] adapters.js loaded before base-adapter.js');
    return;
  }

  // ---------------------------------------------------------------- Greenhouse
  // boards.greenhouse.io / job-boards.greenhouse.io — single-page form.
  class GreenhouseAdapter extends Base {
    constructor() {
      super();
      this.name = 'greenhouse';
      this.hostPatterns = ['greenhouse.io', 'grnh.se'];
    }
    getFormRoot() {
      return document.querySelector('#application_form, #app_body, form#application-form') || super.getFormRoot();
    }
    getJobTitle() {
      const el = document.querySelector('.app-title, .job__title h1, h1.section-header');
      return (el && el.textContent.trim()) || super.getJobTitle();
    }
    getCompany() {
      const el = document.querySelector('.company-name, #company-name');
      return (el && el.textContent.trim().replace(/^at\s+/i, '')) || super.getCompany();
    }
  }

  // --------------------------------------------------------------------- Lever
  // jobs.lever.co — single-page form, fields use name="..." heavily.
  class LeverAdapter extends Base {
    constructor() {
      super();
      this.name = 'lever';
      this.hostPatterns = ['lever.co', 'jobs.eu.lever.co'];
    }
    getFormRoot() {
      return document.querySelector('form.application-form, .application-page form, form[action*="apply"]') || super.getFormRoot();
    }
    getJobTitle() {
      const el = document.querySelector('.posting-headline h2, .posting-header h2');
      return (el && el.textContent.trim()) || super.getJobTitle();
    }
    getCompany() {
      const el = document.querySelector('.main-header-logo img, .main-header-content .company');
      if (el && el.alt) return el.alt.trim();
      return super.getCompany();
    }
  }

  // --------------------------------------------------------------------- Ashby
  // jobs.ashbyhq.com — React app, custom dropdowns (not native <select>).
  class AshbyAdapter extends Base {
    constructor() {
      super();
      this.name = 'ashby';
      this.hostPatterns = ['ashbyhq.com'];
    }
    getJobTitle() {
      const el = document.querySelector('h1, [class*="jobTitle"], [class*="JobTitle"]');
      return (el && el.textContent.trim()) || super.getJobTitle();
    }
    // Ashby renders comboboxes as button + listbox. Best-effort open+pick.
    async applyAnswer(field, answer, ctx) {
      if (field.kind === 'select' || field.el.getAttribute('role') === 'combobox') {
        const opened = await this._pickFromListbox(field.el, answer);
        if (opened) return true;
      }
      return super.applyAnswer(field, answer, ctx);
    }
    async _pickFromListbox(trigger, answer) {
      if (!answer || !answer.value) return false;
      try {
        const btn = trigger.closest('[role="combobox"]') || trigger;
        btn.click();
        await dom.sleep(350);
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        const target = answer.value.toLowerCase();
        const match =
          options.find((o) => o.textContent.trim().toLowerCase() === target) ||
          options.find((o) => o.textContent.trim().toLowerCase().includes(target));
        if (match) { match.click(); return true; }
        // Close again if nothing matched.
        document.body.click();
      } catch (e) { /* noop */ }
      return false;
    }
  }

  // ------------------------------------------------------------------ Workable
  // apply.workable.com / *.workable.com — React app, the one in the screenshots.
  class WorkableAdapter extends Base {
    constructor() {
      super();
      this.name = 'workable';
      this.hostPatterns = ['workable.com'];
    }
    getJobTitle() {
      const el = document.querySelector('[data-ui="job-title"], h1, h2[data-ui="overview-title"]');
      return (el && el.textContent.trim()) || super.getJobTitle();
    }
    getCompany() {
      const el = document.querySelector('[data-ui="company-name"], .company-title');
      return (el && el.textContent.trim()) || super.getCompany();
    }
    getSubmitButton(root) {
      return (
        dom.findButton(root, ['submit application', 'submit'], false) ||
        super.getSubmitButton(root)
      );
    }
  }

  // ------------------------------------------------------------------- Workday
  // *.myworkdayjobs.com — multi-step wizard, data-automation-id attributes.
  class WorkdayAdapter extends Base {
    constructor() {
      super();
      this.name = 'workday';
      this.hostPatterns = ['myworkdayjobs.com', 'workday.com'];
    }
    getFormRoot() {
      return document.querySelector('[data-automation-id="applyFlow"], form, [role="main"]') || super.getFormRoot();
    }
    getNextButton(root) {
      // Workday uses "Next", "Save and Continue", "Continue" buttons.
      return (
        dom.findButton(root, ['save and continue', 'continue', 'next'], false) ||
        super.getNextButton(root)
      );
    }
    getSubmitButton(root) {
      return dom.findButton(root, ['submit'], true) || dom.findButton(root, ['submit'], false);
    }
  }

  // -------------------------------------------------------------------- Breezy
  class BreezyAdapter extends Base {
    constructor() {
      super();
      this.name = 'breezy';
      this.hostPatterns = ['breezy.hr'];
    }
  }

  // ----------------------------------------------------------- SmartRecruiters
  class SmartRecruitersAdapter extends Base {
    constructor() {
      super();
      this.name = 'smartrecruiters';
      this.hostPatterns = ['smartrecruiters.com'];
    }
    getJobTitle() {
      const el = document.querySelector('h1.job-title, [class*="jobTitle"]');
      return (el && el.textContent.trim()) || super.getJobTitle();
    }
  }

  // Registry — order doesn't matter since matching is by hostname substring.
  const REGISTRY = [
    new GreenhouseAdapter(),
    new LeverAdapter(),
    new AshbyAdapter(),
    new WorkableAdapter(),
    new WorkdayAdapter(),
    new BreezyAdapter(),
    new SmartRecruitersAdapter(),
  ];

  /**
   * Pick the adapter for a hostname (defaults to window.location.hostname).
   * @returns {BaseAdapter}
   */
  ATS.resolveAdapter = function (hostname) {
    const host = (hostname || window.location.hostname || '').toLowerCase();
    const found = REGISTRY.find((a) => a.matches(host));
    return found || new Base();
  };

  ATS.ADAPTERS = REGISTRY;
})();
