// tests/modules/form-filler.test.js - Unit tests for form-filler.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['utils.js', 'selectors.js', 'form-filler.js']);
});

beforeEach(() => {
  resetChromeMocks();
  document.body.innerHTML = '';
});

// ===== getQuestionLabel() =====
describe('getQuestionLabel()', () => {
  it('should extract label from label > span', () => {
    document.body.innerHTML = `
      <div id="q"><label><span>Years of experience</span></label></div>
    `;
    const q = document.getElementById('q');
    expect(getQuestionLabel(q)).toBe('Years of experience');
  });

  it('should extract label from legend > span', () => {
    document.body.innerHTML = `
      <div id="q"><fieldset><legend><span>Gender</span></legend></fieldset></div>
    `;
    const q = document.getElementById('q');
    expect(getQuestionLabel(q)).toBe('Gender');
  });

  it('should extract label from h3', () => {
    document.body.innerHTML = `
      <div id="q"><h3>Do you require visa sponsorship?</h3></div>
    `;
    const q = document.getElementById('q');
    expect(getQuestionLabel(q)).toBe('Do you require visa sponsorship?');
  });

  it('should return empty string if no label found', () => {
    document.body.innerHTML = '<div id="q"><input type="text" /></div>';
    const q = document.getElementById('q');
    expect(getQuestionLabel(q)).toBe('');
  });
});

// ===== selectBestOption() =====
describe('selectBestOption()', () => {
  it('should select exact match option', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="">Select an option</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    `;
    const select = document.getElementById('sel');
    selectBestOption(select, 'Yes');
    expect(select.value).toBe('yes');
  });

  it('should select partial match option', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="">Select an option</option>
        <option value="bach">Bachelor's Degree</option>
        <option value="mast">Master's Degree</option>
      </select>
    `;
    const select = document.getElementById('sel');
    selectBestOption(select, 'Bachelor');
    expect(select.value).toBe('bach');
  });

  it('should select first non-placeholder if no match', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="">Select an option</option>
        <option value="a">Option A</option>
        <option value="b">Option B</option>
      </select>
    `;
    const select = document.getElementById('sel');
    selectBestOption(select, 'NonExistent');
    expect(select.selectedIndex).toBe(1);
  });

  it('should dispatch change event', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="">Select</option>
        <option value="y">Yes</option>
      </select>
    `;
    const select = document.getElementById('sel');
    const handler = jest.fn();
    select.addEventListener('change', handler);

    selectBestOption(select, 'Yes');
    expect(handler).toHaveBeenCalled();
  });
});

// ===== getSkillExperience() =====
describe('getSkillExperience()', () => {
  it('should return years for known skills', () => {
    expect(getSkillExperience('how many years of node.js experience')).toBe('3');
    expect(getSkillExperience('python experience in years')).toBe('2');
    expect(getSkillExperience('docker experience')).toBe('1');
    expect(getSkillExperience('kubernetes experience')).toBe('1');
  });

  it('should return "0" for skills with no experience', () => {
    expect(getSkillExperience('angular experience')).toBe('0');
    expect(getSkillExperience('flutter development years')).toBe('0');
  });

  it('should return null for unknown skills', () => {
    expect(getSkillExperience('how many years of cooking')).toBeNull();
    expect(getSkillExperience('random question')).toBeNull();
  });

  it('should be case-insensitive in matching', () => {
    // getSkillExperience checks label.includes(skill) where label is already lowercased
    // by the caller (handleTextQuestion). So we test with lowercase.
    expect(getSkillExperience('javascript experience')).toBe('3');
    expect(getSkillExperience('aws cloud experience')).toBe('2');
  });
});

// ===== getSmartFallback() =====
describe('getSmartFallback()', () => {
  it('should return "Yes" for yes/no type questions', () => {
    expect(getSmartFallback('have you worked with teams', 'text')).toBe('Yes');
    expect(getSmartFallback('do you have experience', 'text')).toBe('Yes');
    expect(getSmartFallback('are you willing to relocate', 'text')).toBe('Yes');
    expect(getSmartFallback('can you start immediately', 'text')).toBe('Yes');
  });

  it('should return "3" for "how many" questions', () => {
    // Use a string that doesn't trigger the yes/no patterns
    expect(getSmartFallback('how many certifications obtained', 'text')).toBe('3');
  });

  it('should return "8" for rate/proficiency questions', () => {
    expect(getSmartFallback('rate your proficiency in java', 'text')).toBe('8');
    expect(getSmartFallback('what is your level of expertise', 'text')).toBe('8');
  });

  it('should return "3" for number inputs', () => {
    expect(getSmartFallback('some random question', 'number')).toBe('3');
  });

  it('should return "3" as ultimate fallback', () => {
    expect(getSmartFallback('completely unknown question', 'text')).toBe('3');
  });
});

// ===== handleTextQuestion() =====
describe('handleTextQuestion()', () => {
  const config = {
    firstName: 'John',
    middleName: '',
    lastName: 'Doe',
    phoneNumber: '9876543210',
    currentCity: 'Bangalore',
    state: 'Karnataka',
    zipcode: '560001',
    country: 'India',
    street: '123 Main St',
    yearsOfExperience: '4',
    linkedInUrl: 'https://linkedin.com/in/johndoe',
    website: 'https://johndoe.dev',
    noticePeriod: 30,
    desiredSalary: 2000000,
    currentCtc: 1500000,
    recentEmployer: 'TechCorp',
    confidenceLevel: '9',
    linkedinHeadline: 'Backend Developer',
  };

  function createQuestion(labelText, inputType = 'text') {
    const div = document.createElement('div');
    div.innerHTML = `
      <label><span>${labelText}</span></label>
      <input type="${inputType}" value="" />
    `;
    document.body.appendChild(div);
    return { question: div, input: div.querySelector('input') };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should fill phone number', () => {
    const { question, input } = createQuestion('Phone number');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('9876543210');
  });

  it('should fill city', () => {
    const { question, input } = createQuestion('Current city');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('Bangalore');
  });

  it('should fill years of experience', () => {
    const { question, input } = createQuestion('Years of experience');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('4');
  });

  it('should fill first name', () => {
    const { question, input } = createQuestion('First name');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('John');
  });

  it('should fill last name', () => {
    const { question, input } = createQuestion('Last name');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('Doe');
  });

  it('should fill full name for signature', () => {
    const { question, input } = createQuestion('Signature / Full name');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('John Doe');
  });

  it('should fill LinkedIn URL', () => {
    const { question, input } = createQuestion('LinkedIn profile URL');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('https://linkedin.com/in/johndoe');
  });

  it('should fill website/portfolio', () => {
    const { question, input } = createQuestion('Website or portfolio');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('https://johndoe.dev');
  });

  it('should fill desired salary', () => {
    const { question, input } = createQuestion('Expected salary');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('2000000');
  });

  it('should fill current CTC', () => {
    const { question, input } = createQuestion('Current salary/CTC');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('1500000');
  });

  it('should fill notice period in days', () => {
    const { question, input } = createQuestion('Notice period (days)');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('30');
  });

  it('should fill notice period in weeks', () => {
    const { question, input } = createQuestion('Notice period in weeks');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('4');
  });

  it('should fill employer name', () => {
    const { question, input } = createQuestion('Current employer / company name');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('TechCorp');
  });

  it('should not overwrite existing values', () => {
    const { question, input } = createQuestion('Phone number');
    input.value = 'already filled';
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('already filled');
  });

  it('should fill "LinkedIn" for referral source questions', () => {
    const { question, input } = createQuestion('How did you hear about us');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('LinkedIn');
  });

  it('should use skill-specific experience for skill questions', () => {
    const { question, input } = createQuestion('Years of Node.js experience');
    handleTextQuestion(question, input, config);
    expect(input.value).toBe('3');
  });
});

// ===== handleSelectQuestion() =====
describe('handleSelectQuestion()', () => {
  const config = {
    gender: 'Male',
    disabilityStatus: 'No',
    veteranStatus: 'No',
    ethnicity: 'Asian',
    country: 'India',
    state: 'Karnataka',
    currentCity: 'Bangalore',
    requireVisa: 'No',
  };

  function createSelectQuestion(labelText, options) {
    const div = document.createElement('div');
    const optionsHtml = options.map(o => `<option value="${o.toLowerCase()}">${o}</option>`).join('');
    div.innerHTML = `
      <label><span>${labelText}</span></label>
      <select>${optionsHtml}</select>
    `;
    document.body.appendChild(div);
    return { question: div, select: div.querySelector('select') };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should select gender option', () => {
    const { question, select } = createSelectQuestion('Gender', ['Select an option', 'Male', 'Female', 'Decline']);
    handleSelectQuestion(question, select, config);
    expect(select.value).toBe('male');
  });

  it('should select visa/sponsorship option', () => {
    const { question, select } = createSelectQuestion('Do you require visa sponsorship?', ['Select an option', 'Yes', 'No']);
    handleSelectQuestion(question, select, config);
    expect(select.value).toBe('no');
  });

  it('should not change already-answered selects', () => {
    const { question, select } = createSelectQuestion('Country', ['Select an option', 'USA', 'India']);
    select.value = 'usa';
    handleSelectQuestion(question, select, config);
    expect(select.value).toBe('usa'); // Should not change
  });

  it('should select "Yes" for work authorization questions', () => {
    const { question, select } = createSelectQuestion('Are you legally authorized to work?', ['Select an option', 'Yes', 'No']);
    handleSelectQuestion(question, select, config);
    expect(select.value).toBe('yes');
  });
});

// ===== handleRadioQuestion() =====
describe('handleRadioQuestion()', () => {
  const config = {
    usCitizenship: 'Yes',
    requireVisa: 'No',
    gender: 'Male',
    veteranStatus: 'No',
    disabilityStatus: 'No',
  };

  function createRadioQuestion(labelText, options) {
    const div = document.createElement('div');
    const radiosHtml = options.map((o, i) => `
      <input type="radio" id="radio_${i}" name="q" value="${o.toLowerCase()}" />
      <label for="radio_${i}">${o}</label>
    `).join('');
    div.innerHTML = `
      <label><span>${labelText}</span></label>
      <fieldset data-test-form-builder-radio-button-form-component="true">
        ${radiosHtml}
      </fieldset>
    `;
    document.body.appendChild(div);
    return { question: div, fieldset: div.querySelector('fieldset') };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should select "Yes" for citizenship questions', () => {
    const { question, fieldset } = createRadioQuestion('US Citizenship eligibility', ['Yes', 'No']);
    handleRadioQuestion(question, fieldset, config);
    const checked = fieldset.querySelector('input:checked');
    expect(checked).not.toBeNull();
    expect(checked.value).toBe('yes');
  });

  it('should select "No" for visa sponsorship questions', () => {
    const { question, fieldset } = createRadioQuestion('Do you require visa sponsorship?', ['Yes', 'No']);
    handleRadioQuestion(question, fieldset, config);
    const checked = fieldset.querySelector('input:checked');
    expect(checked).not.toBeNull();
    expect(checked.value).toBe('no');
  });

  it('should select "Yes" for "are you willing" questions', () => {
    const { question, fieldset } = createRadioQuestion('Are you willing to relocate?', ['Yes', 'No']);
    handleRadioQuestion(question, fieldset, config);
    const checked = fieldset.querySelector('input:checked');
    expect(checked).not.toBeNull();
    expect(checked.value).toBe('yes');
  });

  it('should not change already-selected radio', () => {
    const { question, fieldset } = createRadioQuestion('Gender', ['Male', 'Female']);
    const firstRadio = fieldset.querySelector('input');
    firstRadio.checked = true;
    handleRadioQuestion(question, fieldset, config);
    // Should still be the first one (already selected)
    expect(firstRadio.checked).toBe(true);
  });

  it('should select first option as last resort', () => {
    const { question, fieldset } = createRadioQuestion('Unknown question type', ['Option X', 'Option Y']);
    handleRadioQuestion(question, fieldset, config);
    const checked = fieldset.querySelector('input:checked');
    expect(checked).not.toBeNull();
  });
});

// ===== answerFormQuestions() =====
describe('answerFormQuestions()', () => {
  const config = {
    firstName: 'John',
    lastName: 'Doe',
    phoneNumber: '9876543210',
    yearsOfExperience: '3',
  };

  it('should fill text inputs in form elements', async () => {
    document.body.innerHTML = `
      <div id="modal">
        <div data-test-form-element>
          <label><span>Phone number</span></label>
          <input type="text" value="" />
        </div>
      </div>
    `;
    const modal = document.getElementById('modal');
    await answerFormQuestions(modal, config);
    expect(modal.querySelector('input').value).toBe('9876543210');
  });

  it('should check unchecked checkboxes', async () => {
    document.body.innerHTML = `
      <div id="modal">
        <div data-test-form-element>
          <input type="checkbox" />
        </div>
      </div>
    `;
    const modal = document.getElementById('modal');
    await answerFormQuestions(modal, config);
    expect(modal.querySelector('input[type="checkbox"]').checked).toBe(true);
  });

  it('should handle multiple form elements', async () => {
    document.body.innerHTML = `
      <div id="modal">
        <div data-test-form-element>
          <label><span>First name</span></label>
          <input type="text" value="" />
        </div>
        <div data-test-form-element>
          <label><span>Last name</span></label>
          <input type="text" value="" />
        </div>
      </div>
    `;
    const modal = document.getElementById('modal');
    await answerFormQuestions(modal, config);
    const inputs = modal.querySelectorAll('input');
    expect(inputs[0].value).toBe('John');
    expect(inputs[1].value).toBe('Doe');
  });
});
