const path = require('path');
const { loadFile } = require('../helpers/load-modules');

describe('generic autofill safety boundaries', () => {
  beforeAll(() => {
    window.ATS = {
      dom: {
        setCheckbox: jest.fn(() => true),
        fillText: jest.fn(() => true),
        selectOption: jest.fn(() => true),
        chooseRadio: jest.fn(() => true),
        sleep: jest.fn(async () => {}),
        highlight: jest.fn(),
      },
    };
    loadFile(path.resolve(__dirname, '../../extension/modules/autofill/field-matcher.js'));
    loadFile(path.resolve(__dirname, '../../extension/modules/autofill/base-adapter.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should classify deterministic profile matches as high confidence', async () => {
    await expect(window.ATS.FieldMatcher.resolve(
      { label: 'Email address', kind: 'email', type: 'email' },
      { email: 'candidate@example.com' },
      {}
    )).resolves.toMatchObject({
      value: 'candidate@example.com',
      source: 'profile',
      confidence: 'high',
      reason: 'PROFILE_FIELD_MATCH',
    });
  });

  it('should require explicit action for legal consent fields', async () => {
    await expect(window.ATS.FieldMatcher.resolve(
      { label: 'I agree to the privacy terms and certify this application', kind: 'checkbox' },
      {},
      {}
    )).resolves.toBeNull();
  });

  it('should keep AI suggestions review-only', async () => {
    global.getAIFormAnswer = jest.fn().mockResolvedValue('Suggested answer');
    const answer = await window.ATS.FieldMatcher.resolve(
      { label: 'Describe an unfamiliar topic', kind: 'textarea' },
      {},
      { useAI: true }
    );
    expect(answer).toMatchObject({ confidence: 'low', reason: 'AI_REVIEW_REQUIRED' });

    const adapter = new window.ATS.BaseAdapter();
    const field = { kind: 'textarea', el: document.createElement('textarea'), meta: {} };
    await expect(adapter.applyAnswer(field, answer, {})).resolves.toBe(false);
    expect(window.ATS.dom.fillText).not.toHaveBeenCalled();
    delete global.getAIFormAnswer;
  });

  it('should never infer checkbox consent from its label', async () => {
    const adapter = new window.ATS.BaseAdapter();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const field = {
      kind: 'checkbox',
      el: checkbox,
      meta: { label: 'I agree to all terms' },
    };

    await expect(adapter.applyAnswer(field, null, {})).resolves.toBe(false);
    expect(window.ATS.dom.setCheckbox).not.toHaveBeenCalled();
  });
});