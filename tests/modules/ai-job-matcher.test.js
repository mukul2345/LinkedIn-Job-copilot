jest.mock('../../functions/ai-provider', () => ({
  callAI: jest.fn(),
  parseJsonLoose: jest.fn(),
}));

const { callAI, parseJsonLoose } = require('../../functions/ai-provider');
const {
  MAX_BATCH_SIZE,
  MAX_CONCURRENT_BATCHES,
  MAX_JOB_DESCRIPTION_CHARS,
  computeFitScoresBatch,
  computeFitScores,
  clearMatchCache,
  normalizeMatch,
} = require('../../functions/ai-job-matcher');

describe('AI job matcher normalization', () => {
  afterEach(() => jest.clearAllMocks());

  it.each([
    [0, 'NO_MATCH'],
    [39.6, 'WEAK_MATCH'],
    [69.6, 'MATCH'],
    [84.6, 'STRONG_MATCH'],
    [100, 'STRONG_MATCH'],
  ])('should normalize score %p to %s', (score, recommendation) => {
    expect(normalizeMatch({ score })).toMatchObject({
      score: Math.round(score),
      recommendation,
      matchedSkills: [],
      missingSkills: [],
      reasons: [],
    });
  });

  it.each([-1, 101, NaN, Infinity, 'invalid'])('should reject out-of-bounds score %p', score => {
    expect(() => normalizeMatch({ score })).toThrow('INVALID_AI_MATCH');
  });

  it('should bound and sanitize model-provided arrays', () => {
    const normalized = normalizeMatch({
      score: 70,
      matchedSkills: [...Array.from({ length: 35 }, (_, index) => ` skill-${index} `), 42],
      missingSkills: 'invalid',
      reasons: Array.from({ length: 15 }, (_, index) => `reason-${index}`),
    });

    expect(normalized.matchedSkills).toHaveLength(30);
    expect(normalized.matchedSkills[0]).toBe('skill-0');
    expect(normalized.missingSkills).toEqual([]);
    expect(normalized.reasons).toHaveLength(10);
  });
});


describe('AI job matcher request bounds', () => {
  afterEach(() => {
    clearMatchCache();
    jest.clearAllMocks();
    delete process.env.AI_JOB_MATCHING_MODEL;
  });

  it('should reject oversized and empty batches before calling the provider', async () => {
    const oversizedBatch = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, index) => ({
      id: `job-${index}`,
      description: 'Role',
    }));

    await expect(computeFitScoresBatch('resume', oversizedBatch)).rejects.toThrow('INVALID_JOB_BATCH');
    await expect(computeFitScoresBatch('resume', [])).rejects.toThrow('INVALID_JOB_BATCH');
    expect(callAI).not.toHaveBeenCalled();
  });

  it('should bound descriptions sent to the provider and normalize its match', async () => {
    const longDescription = 'x'.repeat(MAX_JOB_DESCRIPTION_CHARS + 20);
    callAI.mockResolvedValue('provider-response');
    parseJsonLoose.mockReturnValue({
      matches: [{ id: 'job-1', score: 72.4, matchedSkills: ['Node.js'] }],
    });

    const response = await computeFitScoresBatch('professional resume', [{
      id: 'job-1',
      title: 'Engineer',
      description: longDescription,
    }]);

    const prompt = callAI.mock.calls[0][0];
    expect(prompt).toContain('x'.repeat(MAX_JOB_DESCRIPTION_CHARS));
    expect(prompt).not.toContain('x'.repeat(MAX_JOB_DESCRIPTION_CHARS + 1));
    expect(response).toEqual([{
      id: 'job-1',
      match: {
        score: 72,
        recommendation: 'MATCH',
        matchedSkills: ['Node.js'],
        missingSkills: [],
        reasons: [],
      },
    }]);
  });

  it('should reject missing provider matches rather than fabricating a score', async () => {
    callAI.mockResolvedValue('provider-response');
    parseJsonLoose.mockReturnValue({ matches: [] });

    await expect(computeFitScoresBatch('resume', [{ id: 'missing', description: 'Role' }]))
      .rejects.toThrow('MISSING_AI_MATCH:missing');
  });

  it('should cache by resume, job content, provider model, and prompt version', async () => {
    callAI.mockResolvedValue('provider-response');
    parseJsonLoose.mockReturnValue({ matches: [{ id: 'job-1', score: 75 }] });
    const jobs = [{ id: 'job-1', title: 'Engineer', description: 'Build APIs' }];

    await computeFitScores('resume-v1', jobs);
    await computeFitScores('resume-v1', jobs);
    expect(callAI).toHaveBeenCalledTimes(1);

    process.env.AI_JOB_MATCHING_MODEL = 'new-model';
    await computeFitScores('resume-v1', jobs);
    await computeFitScores('resume-v2', jobs);
    await computeFitScores('resume-v2', [{ ...jobs[0], description: 'Build distributed APIs' }]);
    expect(callAI).toHaveBeenCalledTimes(4);
  });

  it('should score cache misses with bounded batch concurrency', async () => {
    let active = 0;
    let maximumActive = 0;
    callAI.mockImplementation(async prompt => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return prompt;
    });
    parseJsonLoose.mockImplementation(prompt => {
      const jobs = JSON.parse(prompt.split('JOBS:\n')[1]);
      return { matches: jobs.map(job => ({ id: job.id, score: 70 })) };
    });
    const jobs = Array.from({ length: MAX_BATCH_SIZE * 4 }, (_, index) => ({
      id: `job-${index}`,
      description: `Role ${index}`,
    }));

    const scores = await computeFitScores('resume', jobs);

    expect(scores).toHaveLength(jobs.length);
    expect(maximumActive).toBeLessThanOrEqual(MAX_CONCURRENT_BATCHES);
    expect(maximumActive).toBeGreaterThan(1);
  });

  it('should acknowledge cancellation between AI batch boundaries', async () => {
    callAI.mockResolvedValue('provider-response');
    parseJsonLoose.mockReturnValue({ matches: [{ id: 'job-1', score: 70 }] });
    const shouldCancel = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onProgress = jest.fn();

    await expect(computeFitScores('resume', [{
      id: 'job-1', title: 'Engineer', description: 'Build APIs',
    }], { shouldCancel, onProgress })).rejects.toMatchObject({ code: 'SEARCH_CANCELLED' });

    expect(callAI).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ completedBatches: 1, totalBatches: 1 });
  });
});
