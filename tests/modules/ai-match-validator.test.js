const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-domain.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/ai-match-validator.js'));
});

describe('AI match validator', () => {
  it.each([null, undefined, '90'])('should reject non-object AI responses', response => {
    expect(validateAiMatchResponse(response)).toEqual({
      available: false,
      errorCode: 'INVALID_AI_RESPONSE',
    });
  });

  it.each([-1, 101, 'not-a-score', Infinity])('should strictly reject invalid score %p', score => {
    expect(validateAiMatchResponse({ score })).toEqual({
      available: false,
      errorCode: 'INVALID_AI_SCORE',
    });
  });

  it('should normalize a valid response without trusting malformed arrays', () => {
    const response = validateAiMatchResponse({
      score: 84.6,
      recommendation: 'MODEL_INVENTED_VALUE',
      matchedSkills: [' Node.js ', 42, '', 'x'.repeat(150)],
      missingSkills: 'not-an-array',
      reasons: Array.from({ length: 12 }, (_, index) => `reason-${index}`),
    });

    expect(response).toMatchObject({
      available: true,
      score: 85,
      recommendation: MatchRecommendation.STRONG_MATCH,
      missingSkills: [],
    });
    expect(response.matchedSkills).toEqual(['Node.js', 'x'.repeat(120)]);
    expect(response.reasons).toHaveLength(10);
  });
});
