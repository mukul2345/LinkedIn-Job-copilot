// form-filler.js - Easy Apply form question answering logic

/** Resolve through the canonical snapshot when the runtime contract is loaded. */
function resolveConfiguredAnswer(question, controlType, config) {
  if (typeof AnswerResolver === 'undefined' || typeof CandidateProfileSnapshot === 'undefined') {
    return null;
  }
  const candidateSnapshot = config.candidateProfileSnapshot || CandidateProfileSnapshot.fromConfig(config);
  return AnswerResolver.resolve({ question, controlType, candidateSnapshot });
}

/** Apply a resolved value to a native text control. */
function applyResolvedText(input, resolution) {
  if (resolution?.status !== AnswerResolutionStatus.ANSWERED) return false;
  setNativeValue(input, resolution.value);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Answer all form questions on the current Easy Apply modal page.
 * @param {Element} modal - The Easy Apply modal element
 * @param {object} config - User configuration from storage
 */
async function answerFormQuestions(modal, config) {
  const formElements = modal.querySelectorAll(SELECTORS.formElements.join(', '));

  for (const question of formElements) {
    try {
      // Handle SELECT dropdowns
      const select = question.querySelector('select');
      if (select) {
        handleSelectQuestion(question, select, config);
        continue;
      }

      // Handle RADIO buttons
      const radio = question.querySelector(
        'fieldset[data-test-form-builder-radio-button-form-component="true"], fieldset[class*="radio"]'
      );
      if (radio) {
        handleRadioQuestion(question, radio, config);
        continue;
      }

      // Handle TEXT inputs
      const textInput = question.querySelector('input[type="text"], input:not([type])');
      if (textInput && textInput.type !== 'hidden' && textInput.type !== 'checkbox' && textInput.type !== 'radio') {
        await handleTextQuestion(question, textInput, config);
        continue;
      }

      // Handle NUMBER inputs
      const numInput = question.querySelector('input[type="number"]');
      if (numInput) {
        await handleTextQuestion(question, numInput, config);
        continue;
      }

      // Handle TEXTAREA
      const textarea = question.querySelector('textarea');
      if (textarea) {
        handleTextareaQuestion(question, textarea, config);
        continue;
      }

      // Checkboxes can represent legal attestations, privacy consent, marketing
      // opt-ins, or material job preferences. Never infer consent from label text.
      const checkbox = question.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        continue;
      }
    } catch (e) {
      // Skip problematic questions silently
    }
  }

  // Date questions require explicit context; leave them for user review.
  const needsUserInput = [...formElements]
    .filter(question => {
      const requiredField = question.querySelector('input[required], textarea[required], select[required], [aria-required="true"]');
      if (!requiredField) return false;
      const select = question.querySelector('select');
      if (select) return !select.value;
      const radios = [...question.querySelectorAll('input[type="radio"]')];
      if (radios.length) return !radios.some(input => input.checked);
      const field = question.querySelector('input:not([type="hidden"]), textarea');
      if (!field) return false;
      if (field.type === 'checkbox') return !field.checked;
      return !String(field.value || '').trim();
    })
    .map(question => getQuestionLabel(question) || 'Required question');
  return { needsUserInput };
}

/**
 * Handle a SELECT dropdown question.
 */
function handleSelectQuestion(question, select, config) {
  const selectedOption = select.options[select.selectedIndex];
  if (selectedOption && selectedOption.value && selectedOption.text !== 'Select an option') return;

  const label = getQuestionLabel(question).toLowerCase();
  const resolution = resolveConfiguredAnswer(label, 'select', config);
  let answer = null;
  if (resolution) {
    if (resolution.status !== AnswerResolutionStatus.ANSWERED) return;
    answer = resolution.value;
  } else if (label.includes('gender') || label.includes('sex')) {
    answer = config.gender || 'Decline';
  } else if (label.includes('disability')) {
    answer = config.disabilityStatus || 'Decline';
  } else if (label.includes('veteran')) {
    answer = config.veteranStatus || 'Decline';
  } else if (label.includes('ethnicity') || label.includes('race')) {
    answer = config.ethnicity || 'Decline';
  } else if (label.includes('country')) {
    answer = config.country || null;
  } else if (label.includes('state') || label.includes('province')) {
    answer = config.state || null;
  } else if (label.includes('city')) {
    answer = config.currentCity || null;
  } else if (label.includes('sponsorship') || label.includes('visa')) {
    answer = config.requireVisa || null;
  } else if (label.includes('proficiency') || label.includes('fluency')) {
    answer = config.proficiencyLevel || null;
  } else if (label.includes('education') || label.includes('degree')) {
    answer = config.educationLevel || null;
  } else if (label.includes('relocat')) {
    answer = config.willingToRelocate || null;
  } else if (label.includes('experience') || label.includes('years')) {
    answer = config.yearsOfExperience ?? null;
  } else if (label.includes('work auth') || label.includes('legally')) {
    answer = config.workAuthorization || config.usCitizenship || null;
  }

  if (answer != null && String(answer).trim()) selectBestOption(select, String(answer));
}

/**
 * Handle a RADIO button question.
 */
function handleRadioQuestion(question, fieldset, config) {
  const inputs = fieldset.querySelectorAll('input[type="radio"]');
  if (Array.from(inputs).some(input => input.checked)) return;

  const label = getQuestionLabel(question).toLowerCase();
  const resolution = resolveConfiguredAnswer(label, 'radio', config);
  let answer = null;
  if (resolution) {
    if (resolution.status === AnswerResolutionStatus.ANSWERED) {
      answer = resolution.value;
    } else if (resolution.status === AnswerResolutionStatus.UNSAFE_TO_ANSWER) {
      // Legal/consent attestations must be handled by the user; never auto-fill.
      return;
    }
    // NEEDS_USER_INPUT / UNKNOWN: fall through to the generic Yes/No fallback
    // below so common capability questions do not stall the run.
  } else if (label.includes('citizenship') || label.includes('eligibility') ||
      label.includes('work auth') || label.includes('legally')) {
    answer = config.workAuthorization || config.usCitizenship || null;
  } else if (label.includes('veteran') || label.includes('protected')) {
    answer = config.veteranStatus || 'Decline';
  } else if (label.includes('disability') || label.includes('handicap')) {
    answer = config.disabilityStatus || 'Decline';
  } else if (label.includes('sponsorship') || label.includes('visa')) {
    answer = config.requireVisa || null;
  } else if (label.includes('gender') || label.includes('sex')) {
    answer = config.gender || 'Decline';
  } else if (label.includes('relocat')) {
    answer = config.willingToRelocate || null;
  }

  // Generic Yes/No fallback so common capability, education, and experience
  // questions do not stall the run. Skipped for legal/consent attestations and
  // when the user has turned off auto-answering.
  if ((answer == null || !String(answer).trim()) &&
      canAutoAnswerYesNo(label, inputs, config)) {
    answer = resolveDefaultYesNoAnswer(label, config);
  }

  if (answer == null || !String(answer).trim()) return;

  for (const input of inputs) {
    const radioLabel = fieldset.querySelector(`label[for="${input.id}"]`);
    if (!radioLabel) continue;
    const radioText = radioLabel.textContent.toLowerCase().trim();
    const normalizedAnswer = String(answer).toLowerCase().trim();
    if (radioText.includes(normalizedAnswer) || normalizedAnswer.includes(radioText)) {
      input.click();
      return;
    }
  }

  if (String(answer).toLowerCase().includes('decline')) {
    for (const input of inputs) {
      const text = fieldset.querySelector(`label[for="${input.id}"]`)?.textContent.toLowerCase() || '';
      if (text.includes('decline') || text.includes('prefer not')) {
        input.click();
        return;
      }
    }
  }
}

/** Legal/consent attestations must never be auto-answered. */
const LEGAL_CONSENT_PATTERN =
  /agree|acknowledge|certify|consent|terms|privacy|authorize|attest|signature|policy/i;

/**
 * Decide whether a two-option Yes/No radio may be auto-answered to keep the
 * run moving. Excludes legal/consent questions and honors an opt-out flag.
 * @param {string} label - Lowercased question label
 * @param {NodeListOf<HTMLInputElement>} inputs
 * @param {object} config
 * @returns {boolean}
 */
function canAutoAnswerYesNo(label, inputs, config) {
  if (config && config.autoAnswerYesNo === false) return false;
  if (LEGAL_CONSENT_PATTERN.test(label)) return false;
  const optionTexts = [...inputs]
    .map(input => (input.closest('label')?.textContent ||
      input.parentElement?.textContent || '').toLowerCase().trim());
  const looksYesNo = optionTexts.some(text => /\byes\b/.test(text)) &&
    optionTexts.some(text => /\bno\b/.test(text));
  return looksYesNo;
}

/**
 * Choose a default answer for an unmapped Yes/No question. Defaults to "Yes"
 * for capability/eligibility-style questions since those are the common
 * blockers; declines demographic disclosures.
 * @param {string} label - Lowercased question label
 * @param {object} config
 * @returns {string}
 */
function resolveDefaultYesNoAnswer(label, config) {
  if (/gender|\bsex\b|race|ethnicity|disability|veteran/.test(label)) return 'Decline';
  return (config && config.defaultYesNoAnswer) || 'Yes';
}

/**
 * Handle a TEXT or NUMBER input question.
 */
async function handleTextQuestion(question, input, config) {
  const currentValue = input.value.trim();
  if (currentValue) return;

  const label = getQuestionLabel(question).toLowerCase();
  const resolution = resolveConfiguredAnswer(label, input.type === 'number' ? 'number' : 'text', config);
  if (resolution) {
    applyResolvedText(input, resolution);
    return;
  }
  let answer = '';

  const fullName = [config.firstName, config.middleName, config.lastName].filter(Boolean).join(' ');

  if (label.includes('experience') || label.includes('years')) {
    answer = getSkillExperience(label, config) || config.yearsOfExperience || '';
  } else if (label.includes('phone') || label.includes('mobile')) {
    answer = config.phoneNumber || '';
  } else if (label.includes('street')) {
    answer = config.street || '';
  } else if (label.includes('city') || label.includes('location')) {
    answer = config.currentCity || '';
  } else if (label.includes('state') || label.includes('province')) {
    answer = config.state || '';
  } else if (label.includes('zip') || label.includes('postal')) {
    answer = config.zipcode || '';
  } else if (label.includes('country')) {
    answer = config.country || '';
  } else if (label.includes('signature') || label.includes('full name') || label.includes('legal name')) {
    answer = fullName;
  } else if (label.includes('first') && label.includes('name')) {
    answer = config.firstName || '';
  } else if (label.includes('last') && label.includes('name')) {
    answer = config.lastName || '';
  } else if (label.includes('middle') && label.includes('name')) {
    answer = config.middleName || '';
  } else if (label.includes('name') && !label.includes('company') && !label.includes('employer')) {
    answer = fullName;
  } else if (label.includes('employer') || label.includes('company name')) {
    answer = config.recentEmployer || '';
  } else if (label.includes('notice')) {
    if (config.noticePeriod != null && config.noticePeriod !== '') {
      const noticePeriod = Number(config.noticePeriod);
      if (Number.isFinite(noticePeriod) && noticePeriod >= 0) {
        if (label.includes('month')) answer = String(Math.floor(noticePeriod / 30));
        else if (label.includes('week')) answer = String(Math.floor(noticePeriod / 7));
        else answer = String(noticePeriod);
      }
    }
  } else if (label.includes('salary') || label.includes('compensation') || label.includes('ctc') || label.includes('pay')) {
    const configuredSalary = label.includes('current') || label.includes('present')
      ? config.currentCtc
      : config.desiredSalary;
    answer = configuredSalary != null && configuredSalary !== '' ? String(configuredSalary) : '';
  } else if (label.includes('linkedin')) {
    answer = config.linkedInUrl || '';
  } else if (label.includes('website') || label.includes('portfolio') || label.includes('blog') || label.includes('github')) {
    answer = config.website || '';
  } else if (label.includes('scale') || label.includes('1-10') || label.includes('confidence')) {
    answer = config.confidenceLevel || '';
  } else if (label.includes('headline')) {
    answer = config.linkedinHeadline || '';
  } else if (label.includes('gpa') || label.includes('cgpa')) {
    answer = config.gpa || '';
  } else if (label.includes('how did you hear') || label.includes('come across') || label.includes('referral source')) {
    answer = config.referralSource || '';
  } else {
    answer = await getSmartFallback(label, input.type, config);
  }

  if (answer) {
    setNativeValue(input, answer);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * Handle a TEXTAREA question.
 */
function handleTextareaQuestion(question, textarea, config) {
  const currentValue = textarea.value.trim();
  if (currentValue) return;

  const label = getQuestionLabel(question).toLowerCase();
  const resolution = resolveConfiguredAnswer(label, 'textarea', config);
  if (resolution) {
    applyResolvedText(textarea, resolution);
    return;
  }
  let answer = '';
  if (label.includes('summary') || label.includes('about')) {
    answer = config.linkedinSummary || '';
  } else if (label.includes('cover')) {
    answer = config.coverLetter || '';
  }

  if (answer) {
    setNativeValue(textarea, answer);
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * Get the label text for a form question element.
 */
function getQuestionLabel(question) {
  const selectors = [
    'label span.visually-hidden',
    'label span',
    'label',
    'legend span',
    'legend',
    'span[data-test-form-builder-radio-button-form-component__title]',
    'h3',
    '.fb-form-element-label'
  ];
  for (const sel of selectors) {
    const el = question.querySelector(sel);
    if (el && el.textContent.trim()) return el.textContent.trim();
  }
  return '';
}

/**
 * Select the best matching option in a dropdown.
 */
function selectBestOption(select, answer) {
  const options = Array.from(select.options);
  // Exact match
  for (const opt of options) {
    if (opt.text.toLowerCase() === answer.toLowerCase()) {
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
  // Partial match
  for (const opt of options) {
    if (opt.text.toLowerCase().includes(answer.toLowerCase()) ||
        answer.toLowerCase().includes(opt.text.toLowerCase())) {
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
  // No confident option match: leave the field for explicit user input.
}

/**
 * Determine years of experience for specific skills from user's skill map.
 * Reads from config.skillMap (populated from Firestore via chrome.storage.local).
 * Falls back to user's general yearsOfExperience if no match found.
 */
function getSkillExperience(label, config) {
  const skillMap = config && config.skillMap ? config.skillMap : {};
  const labelLower = label.toLowerCase();

  // Look for a matching skill in the user's configured map
  for (const [skill, years] of Object.entries(skillMap)) {
    if (labelLower.includes(skill.toLowerCase())) {
      return String(years);
    }
  }

  // No match found — return null so caller uses general fallback
  return null;
}

/**
 * Unknown questions remain blank. Backend AI output is a review-only draft and
 * is never applied directly in the active LinkedIn submission path.
 */
async function getSmartFallback() {
  return null;
}
