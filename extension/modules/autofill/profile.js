// modules/autofill/profile.js — Canonical profile loader for the ATS autofill engine.
// Reads the flat config stored in chrome.storage.local (mirrored from Firestore by
// the popup) and normalizes it into a stable, field-matcher-friendly shape.

(function () {
  'use strict';
  const ATS = (window.ATS = window.ATS || {});

  const Profile = {};

  /**
   * Load and normalize the user's profile from chrome.storage.local.
   * Returns both the canonical `profile` and the `raw` config (the raw config is
   * what ai-service.js's getAIFormAnswer expects for its prompt building).
   * @returns {Promise<{profile: object, raw: object}>}
   */
  Profile.load = function () {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (cfg) => {
        cfg = cfg || {};
        const fullName = [cfg.firstName, cfg.middleName, cfg.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();

        const profile = {
          firstName: cfg.firstName || '',
          middleName: cfg.middleName || '',
          lastName: cfg.lastName || '',
          fullName: fullName,
          // No dedicated email profile field exists yet — fall back to the
          // Firebase auth email cached by the popup on sign-in.
          email: cfg.email || cfg.cachedUserEmail || '',
          phone: cfg.phoneNumber || '',
          address: cfg.street || '',
          city: cfg.currentCity || '',
          state: cfg.state || '',
          zip: cfg.zipcode || '',
          country: cfg.country || '',
          linkedin: cfg.linkedInUrl || '',
          website: cfg.website || '',
          headline: cfg.linkedinHeadline || '',
          summary: cfg.linkedinSummary || '',
          coverLetter: cfg.coverLetter || (cfg.templates && cfg.templates.coverLetter) || '',
          yearsExperience: cfg.yearsOfExperience != null ? String(cfg.yearsOfExperience) : '',
          desiredSalary: cfg.desiredSalary ? String(cfg.desiredSalary) : '',
          currentCtc: cfg.currentCtc ? String(cfg.currentCtc) : '',
          noticePeriod: cfg.noticePeriod != null ? String(cfg.noticePeriod) : '',
          currentEmployer: cfg.recentEmployer || '',
          gender: cfg.gender || '',
          ethnicity: cfg.ethnicity || '',
          disability: cfg.disabilityStatus || '',
          veteran: cfg.veteranStatus || '',
          requireVisa: cfg.requireVisa || '',
          workAuth: cfg.usCitizenship || '',
          skillMap: cfg.skillMap || {},
        };

        resolve({ profile: profile, raw: cfg });
      });
    });
  };

  /**
   * A profile is usable for autofill once we at least know the person's name.
   * @param {object} profile
   * @returns {boolean}
   */
  Profile.isUsable = function (profile) {
    return !!(profile && profile.firstName && profile.lastName);
  };

  /**
   * Which important canonical fields are missing — surfaced to the user so they
   * know why some inputs were left blank.
   * @param {object} profile
   * @returns {string[]}
   */
  Profile.missingFields = function (profile) {
    const important = {
      email: 'email',
      phone: 'phone number',
      city: 'city',
      country: 'country',
    };
    const missing = [];
    for (const key of Object.keys(important)) {
      if (!profile[key]) missing.push(important[key]);
    }
    return missing;
  };

  ATS.Profile = Profile;
})();
