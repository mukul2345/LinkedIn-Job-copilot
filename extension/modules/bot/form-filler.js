// form-filler.js - Easy Apply form question answering logic

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
        handleTextQuestion(question, textInput, config);
        continue;
      }

      // Handle NUMBER inputs
      const numInput = question.querySelector('input[type="number"]');
      if (numInput) {
        handleTextQuestion(question, numInput, config);
        continue;
      }

      // Handle TEXTAREA
      const textarea = question.querySelector('textarea');
      if (textarea) {
        handleTextareaQuestion(question, textarea, config);
        continue;
      }

      // Handle CHECKBOX
      const checkbox = question.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        checkbox.click();
        continue;
      }
    } catch (e) {
      // Skip problematic questions silently
    }
  }

  // Try to select today's date if date picker is present
  const todayBtn = document.querySelector('button[aria-label*="today" i], button[aria-label*="This is today"]');
  if (todayBtn) todayBtn.click();
}

/**
 * Handle a SELECT dropdown question.
 */
function handleSelectQuestion(question, select, config) {
  const selectedOption = select.options[select.selectedIndex];
  if (selectedOption && selectedOption.value && selectedOption.text !== 'Select an option') {
    return; // Already answered
  }

  const label = getQuestionLabel(question).toLowerCase();
  let answer = 'Yes';

  if (label.includes('gender') || label.includes('sex')) {
    answer = config.gender || 'Decline';
  } else if (label.includes('disability')) {
    answer = config.disabilityStatus || 'Decline';
  } else if (label.includes('veteran')) {
    answer = config.veteranStatus || 'Decline';
  } else if (label.includes('ethnicity') || label.includes('race')) {
    answer = config.ethnicity || 'Decline';
  } else if (label.includes('country')) {
    answer = config.country || 'India';
  } else if (label.includes('state') || label.includes('province')) {
    answer = config.state || 'Karnataka';
  } else if (label.includes('city')) {
    answer = config.currentCity || 'Bangalore';
  } else if (label.includes('sponsorship') || label.includes('visa')) {
    answer = config.requireVisa || 'No';
  } else if (label.includes('proficiency') || label.includes('fluency')) {
    answer = 'Professional';
  } else if (label.includes('education') || label.includes('degree')) {
    answer = 'Bachelor';
  } else if (label.includes('comfortable') || label.includes('willing') || label.includes('able to')) {
    answer = 'Yes';
  } else if (label.includes('experience') || label.includes('years')) {
    answer = '3';
  } else if (label.includes('work auth') || label.includes('legally')) {
    answer = 'Yes';
  }

  selectBestOption(select, answer);
}

/**
 * Handle a RADIO button question.
 */
function handleRadioQuestion(question, fieldset, config) {
  const inputs = fieldset.querySelectorAll('input[type="radio"]');
  const alreadySelected = Array.from(inputs).some(i => i.checked);
  if (alreadySelected) return;

  const label = getQuestionLabel(question).toLowerCase();
  let answer = 'Yes';

  if (label.includes('citizenship') || label.includes('eligibility')) {
    answer = config.usCitizenship || 'Yes';
  } else if (label.includes('veteran') || label.includes('protected')) {
    answer = config.veteranStatus || 'Decline';
  } else if (label.includes('disability') || label.includes('handicap')) {
    answer = config.disabilityStatus || 'Decline';
  } else if (label.includes('sponsorship') || label.includes('visa')) {
    answer = config.requireVisa || 'No';
  } else if (label.includes('gender') || label.includes('sex')) {
    answer = config.gender || 'Decline';
  } else if (label.includes('comfortable') || label.includes('willing') ||
             label.includes('able to') || label.includes('open to') ||
             label.includes('do you have') || label.includes('have you') ||
             label.includes('can you') || label.includes('are you')) {
    answer = 'Yes';
  } else if (label.includes('relocat')) {
    answer = 'Yes';
  }

  // Find matching radio option by text
  for (const input of inputs) {
    const radioLabel = fieldset.querySelector(`label[for="${input.id}"]`);
    if (radioLabel) {
      const radioText = radioLabel.textContent.toLowerCase();
      if (radioText.includes(answer.toLowerCase()) || answer.toLowerCase().includes(radioText)) {
        input.click();
        return;
      }
    }
  }

  // Fallback: try "Yes" option explicitly
  for (const input of inputs) {
    const radioLabel = fieldset.querySelector(`label[for="${input.id}"]`);
    const text = radioLabel ? radioLabel.textContent.toLowerCase().trim() : '';
    if (text === 'yes' || text === 'true') {
      input.click();
      return;
    }
  }

  // Fallback: try "Decline" or "Prefer not" options
  for (const input of inputs) {
    const radioLabel = fieldset.querySelector(`label[for="${input.id}"]`);
    const text = radioLabel ? radioLabel.textContent.toLowerCase() : '';
    if (text.includes('decline') || text.includes('prefer not') || text.includes("don't wish")) {
      input.click();
      return;
    }
  }

  // Last resort: select first option
  if (inputs.length > 0) {
    inputs[0].click();
  }
}

/**
 * Handle a TEXT or NUMBER input question.
 */
function handleTextQuestion(question, input, config) {
  const currentValue = input.value.trim();
  if (currentValue) return;

  const label = getQuestionLabel(question).toLowerCase();
  let answer = '';

  const fullName = [config.firstName, config.middleName, config.lastName].filter(Boolean).join(' ');

  if (label.includes('experience') || label.includes('years')) {
    answer = getSkillExperience(label) || config.yearsOfExperience || '3';
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
    if (label.includes('month')) answer = String(Math.floor((config.noticePeriod || 30) / 30));
    else if (label.includes('week')) answer = String(Math.floor((config.noticePeriod || 30) / 7));
    else answer = String(config.noticePeriod || 30);
  } else if (label.includes('salary') || label.includes('compensation') || label.includes('ctc') || label.includes('pay')) {
    if (label.includes('current') || label.includes('present')) {
      answer = String(config.currentCtc || 0);
    } else {
      answer = String(config.desiredSalary || 0);
    }
  } else if (label.includes('linkedin')) {
    answer = config.linkedInUrl || '';
  } else if (label.includes('website') || label.includes('portfolio') || label.includes('blog') || label.includes('github')) {
    answer = config.website || '';
  } else if (label.includes('scale') || label.includes('1-10') || label.includes('confidence')) {
    answer = config.confidenceLevel || '8';
  } else if (label.includes('headline')) {
    answer = config.linkedinHeadline || '';
  } else if (label.includes('gpa') || label.includes('cgpa')) {
    answer = '7.5';
  } else if (label.includes('how did you hear') || label.includes('come across') || label.includes('referral source')) {
    answer = 'LinkedIn';
  } else {
    answer = getSmartFallback(label, input.type);
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
  let answer = '';

  if (label.includes('summary') || label.includes('about')) {
    answer = config.linkedinSummary || '';
  } else if (label.includes('cover')) {
    answer = config.coverLetter || '';
  } else {
    answer = config.linkedinSummary || config.coverLetter || '';
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
  // Fallback: select first non-placeholder option
  if (options.length > 1) {
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * Determine years of experience for specific skills.
 */
function getSkillExperience(label) {
  const skillMap = {
    'node': '3', 'nodejs': '3', 'node.js': '3',
    'javascript': '3', 'typescript': '3',
    'python': '2', 'aws': '2', 'backend': '3',
    'mongodb': '2', 'express': '3', 'rest': '3', 'api': '3',
    'microservice': '2', 'git': '3', 'sql': '2', 'mysql': '2',
    'dynamodb': '2', 'docker': '1', 'solidity': '1',
    'blockchain': '1', 'web3': '1', 'ethereum': '1',
    'c++': '3', 'java': '2', 'react': '1',
    'kubernetes': '1', 'k8s': '1', 'ci/cd': '2', 'ci cd': '2',
    'lambda': '2', 'sqs': '2', 'sns': '1',
    'redis': '1', 'kafka': '1', 'graphql': '1',
    'terraform': '1', 'linux': '2', 'agile': '3', 'scrum': '2',
    'angular': '0', '.net': '0', 'ruby': '0', 'php': '0',
    'swift': '0', 'kotlin': '0', 'flutter': '0',
  };

  for (const [skill, years] of Object.entries(skillMap)) {
    if (label.includes(skill)) return years;
  }
  return null;
}

/**
 * Smart fallback for completely unknown questions.
 */
function getSmartFallback(label, inputType) {
  if (label.includes('have you') || label.includes('do you') || label.includes('are you') ||
      label.includes('can you') || label.includes('will you') || label.includes('willing')) {
    return 'Yes';
  }
  if (label.includes('how many')) {
    return '3';
  }
  if (label.includes('rate') || label.includes('proficien') || label.includes('level')) {
    return '8';
  }
  if (inputType === 'number') {
    return '3';
  }
  return '3';
}
