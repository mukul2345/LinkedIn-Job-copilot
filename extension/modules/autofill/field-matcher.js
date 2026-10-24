// modules/autofill/field-matcher.js — Maps a detected form field to a profile value.
// This is the generic, DOM-agnostic version of the if/else logic in
// modules/bot/form-filler.js. It works off a normalized "field meta" object
// (label + name + placeholder + autocomplete + kind) so it can serve any ATS.
//
// Returns { value, source, confidence, reason } or null when no confident answer
// is available. Low-confidence AI suggestions are review-only and are never
// applied automatically.

(function () {
  'use strict';
  const ATS = (window.ATS = window.ATS || {});

  const DECLINE = 'Decline to self identify';

  function val(v, source, confidence, reason) {
    if (v == null || String(v).trim() === '') return null;
    return {
      value: String(v),
      source: source || 'profile',
      confidence: confidence || 'high',
      reason: reason || 'PROFILE_FIELD_MATCH',
    };
  }

  function requiresExplicitConsent(meta) {
    if (meta.kind !== 'checkbox' && meta.kind !== 'radio') return false;
    const text = [meta.label, meta.name, meta.ariaLabel].filter(Boolean).join(' ').toLowerCase();
    return /agree|acknowledge|certify|confirm|consent|terms|privacy|authorize|attest|signature|understand/.test(text);
  }

  /**
   * Years of experience for a specific named skill, from the user's skill map.
   * Mirrors getSkillExperience() in form-filler.js.
   */
  function skillExperience(haystack, profile) {
    const map = (profile && profile.skillMap) || {};
    for (const skill of Object.keys(map)) {
      if (skill && haystack.includes(skill.toLowerCase())) return String(map[skill]);
    }
    return null;
  }

  function normalizeYesNo(v) {
    if (v == null) return null;
    const s = String(v).toLowerCase().trim();
    if (['yes', 'true', 'y', '1'].includes(s)) return 'Yes';
    if (['no', 'false', 'n', '0'].includes(s)) return 'No';
    return v;
  }

  const FieldMatcher = {};

  /**
   * Resolve a value for a single field.
   * @param {object} meta - { label, name, placeholder, ariaLabel, autocomplete, type, kind }
   * @param {object} profile - canonical profile (ATS.Profile.load().profile)
   * @param {object} raw - raw chrome.storage config (for AI fallback via getAIFormAnswer)
   * @returns {Promise<{value:string, source:string}|null>}
   */
  FieldMatcher.resolve = async function (meta, profile, raw) {
    const hay = [meta.label, meta.name, meta.placeholder, meta.ariaLabel, meta.autocomplete]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const ac = (meta.autocomplete || '').toLowerCase();
    const has = (...keys) => keys.some((k) => hay.includes(k));

    // Legal attestations and consent require a fresh, explicit user action.
    if (requiresExplicitConsent(meta)) return null;

    // ----- Email -----
    if (ac === 'email' || meta.type === 'email' || has('e-mail', 'email address', 'email')) {
      return val(profile.email);
    }

    // ----- Name -----
    if (ac === 'given-name' || has('first name', 'given name', 'forename', 'firstname')) {
      return val(profile.firstName);
    }
    if (ac === 'family-name' || has('last name', 'surname', 'family name', 'lastname')) {
      return val(profile.lastName);
    }
    if (has('middle name', 'middle initial')) {
      return val(profile.middleName);
    }
    if (
      ac === 'name' ||
      has('full name', 'your name', 'legal name', 'candidate name', 'preferred name') ||
      (has('name') &&
        !has('company', 'employer', 'organization', 'user', 'file', 'referr', 'event', 'school', 'university'))
    ) {
      return val(profile.fullName);
    }

    // ----- Contact -----
    if (ac === 'tel' || has('phone', 'mobile', 'telephone', 'contact number', 'cell')) {
      return val(profile.phone);
    }
    if (has('linkedin')) return val(profile.linkedin);
    if (has('github', 'portfolio', 'personal website', 'website', 'personal site', 'blog', 'url')) {
      return val(profile.website);
    }

    // ----- Address -----
    if (has('zip', 'postal code', 'postcode')) return val(profile.zip);
    if (has('city', 'town')) return val(profile.city);
    if (has('state', 'province', 'region')) return val(profile.state);
    if (has('country')) return val(profile.country);
    if (has('street', 'address line', 'address')) return val(profile.address);

    // ----- Documents / long text -----
    if (has('cover letter', 'motivation', 'why do you want', 'why are you interested')) {
      return val(profile.coverLetter, 'profile-doc');
    }
    if (has('summary', 'about you', 'tell us about yourself', 'introduce yourself', 'bio')) {
      return val(profile.summary);
    }
    if (has('headline', 'current title', 'professional title')) {
      return val(profile.headline);
    }

    // ----- Experience & numbers -----
    if (has('years of experience', 'total experience', 'years experience', 'how many years', 'experience in years')) {
      return val(skillExperience(hay, profile) || profile.yearsExperience, 'profile');
    }
    if (has('notice period')) {
      return val(profile.noticePeriod);
    }
    if (has('current ctc', 'current salary', 'present salary', 'current compensation')) {
      return val(profile.currentCtc);
    }
    if (has('expected', 'desired salary', 'salary expectation', 'expected ctc', 'compensation', 'salary')) {
      return val(profile.desiredSalary);
    }
    if (has('current employer', 'current company', 'most recent employer', 'present employer')) {
      return val(profile.currentEmployer);
    }

    // ----- Work authorization / sponsorship -----
    if (has('sponsor', 'visa', 'work permit')) {
      return val(normalizeYesNo(profile.requireVisa));
    }
    if (has('authorized to work', 'work authorization', 'legally', 'eligible to work', 'right to work')) {
      return val(normalizeYesNo(profile.workAuth));
    }

    // ----- Demographics (EEO) -----
    if (has('gender', 'sex')) return val(profile.gender || DECLINE);
    if (has('race', 'ethnicity')) return val(profile.ethnicity || DECLINE);
    if (has('disability')) return val(profile.disability || DECLINE);
    if (has('veteran', 'protected veteran')) return val(profile.veteran || DECLINE);

    // Unknown radios and checkboxes require explicit user input.
    if (meta.kind === 'radio' || meta.kind === 'checkbox') return null;

    // ----- Free-text / number fallback -----
    if (meta.kind === 'text' || meta.kind === 'textarea' || meta.kind === 'number') {
      // Try AI for genuinely unknown questions (mirrors form-filler's getSmartFallback).
      if (raw && raw.useAI && typeof getAIFormAnswer === 'function' && (meta.label || meta.name)) {
        try {
          const ai = await getAIFormAnswer(
            meta.label || meta.name,
            raw._currentJobTitle || '',
            raw._currentCompany || '',
            raw
          );
          if (ai) {
            return {
              value: ai,
              source: 'ai',
              confidence: 'low',
              reason: 'AI_REVIEW_REQUIRED',
            };
          }
        } catch (e) { /* fall through to heuristics */ }
      }
      // Leave unknown free-text and numeric fields blank rather than guessing.
      return null;
    }

    // Selects with no rule match: don't force a random option.
    return null;
  };

  // Exposed for unit testing / reuse.
  FieldMatcher._internal = {
    normalizeYesNo,
    skillExperience,
    requiresExplicitConsent,
    DECLINE,
  };

  ATS.FieldMatcher = FieldMatcher;
})();
