jest.mock('firebase-functions', () => ({ https: { onRequest: handler => handler } }));
jest.mock('firebase-admin', () => ({ apps: [{}], auth: jest.fn() }));
jest.mock('../../functions/ai-provider', () => ({ callAI: jest.fn() }));

const { missingRequiredFact, sanitizeCandidateFacts } = require('../../functions/ai-assistance');

describe('server AI assistance safety', () => {
  it('should require explicit facts for experience and authorization questions', () => {
    expect(missingRequiredFact('How many years of Java experience?', {})).toBe(true);
    expect(missingRequiredFact('How many years of Java experience?', { yearsOfExperience: 4 })).toBe(false);
    expect(missingRequiredFact('Are you legally authorized to work?', {})).toBe(true);
  });

  it('should never ask AI to guess unknown yes/no or numeric facts', () => {
    expect(missingRequiredFact('Can you start immediately?', { professionalSummary: 'Engineer' })).toBe(true);
    expect(missingRequiredFact('Rate your proficiency', { professionalSummary: 'Engineer' })).toBe(true);
  });

  it('should allowlist and bound candidate facts before prompting', () => {
    const facts = sanitizeCandidateFacts({
      yearsOfExperience: 5,
      professionalSummary: 'x'.repeat(1200),
      apiKey: 'must-not-pass',
    });
    expect(facts).toEqual({ yearsOfExperience: '5', professionalSummary: 'x'.repeat(1000) });
    expect(facts.apiKey).toBeUndefined();
  });
});
