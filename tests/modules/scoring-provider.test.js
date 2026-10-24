jest.mock('firebase-functions', () => ({
  runWith: jest.fn(() => ({ https: { onRequest: handler => handler } })),
}));
jest.mock('firebase-admin', () => ({ apps: [{}], auth: jest.fn(), firestore: jest.fn() }));
jest.mock('../../functions/ai-provider', () => ({
  callAI: jest.fn(), parseJsonLoose: jest.fn(),
}));

const { callAI, parseJsonLoose } = require('../../functions/ai-provider');
const {
  normalizeScore,
  callAIForScoring,
  detectProfileDimensions,
  buildFitScorePrompt,
  runWithConcurrency,
  MAX_CONCURRENT_SCORING_JOBS,
} = require('../../functions/scoring');

describe('legacy fit scoring provider safety', () => {
  afterEach(() => jest.clearAllMocks());

  it.each([NaN, Infinity, -1, 101, 'invalid'])('should reject invalid score %p', score => {
    expect(() => normalizeScore(score)).toThrow('INVALID_AI_SCORE');
  });

  it('should return only validated server AI output', async () => {
    callAI.mockResolvedValue('raw');
    parseJsonLoose.mockReturnValue({
      score: 74.6,
      explanation: 'Skills align.',
      dimensions_evaluated: ['skills'],
      dimensions_missing: [],
    });

    await expect(callAIForScoring('prompt')).resolves.toEqual({
      score: 75,
      explanation: 'Skills align.',
      dimensions_evaluated: ['skills'],
      dimensions_missing: [],
    });
    expect(callAI).toHaveBeenCalledWith('prompt', expect.objectContaining({ jsonMode: true }));
  });

  it('should reject malformed provider explanations instead of fabricating one', async () => {
    callAI.mockResolvedValue('raw');
    parseJsonLoose.mockReturnValue({ score: 70 });
    await expect(callAIForScoring('prompt')).rejects.toThrow('INVALID_AI_EXPLANATION');
  });

  it('should reject scoring when no professional profile dimension exists', () => {
    const dimensions = detectProfileDimensions({});
    expect(dimensions.available).toEqual([]);
    expect(() => buildFitScorePrompt(
      { title: 'Engineer', description: 'Build APIs' },
      {},
      dimensions.available
    )).toThrow('PROFILE_INCOMPLETE');
  });

  it('should bound legacy per-job scoring concurrency', async () => {
    let active = 0;
    let maximumActive = 0;
    const worker = jest.fn(async value => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return value * 2;
    });

    const response = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], worker);

    expect(response).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(maximumActive).toBeLessThanOrEqual(MAX_CONCURRENT_SCORING_JOBS);
    expect(maximumActive).toBeGreaterThan(1);
  });
});
