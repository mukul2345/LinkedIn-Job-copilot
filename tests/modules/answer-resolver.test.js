const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/applications/candidate-profile-snapshot.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/applications/answer-resolver.js'));
});

describe('candidate profile snapshot and answer resolver', () => {
  it('should prefer explicit facts and preserve immutable provenance', () => {
    const snapshot = CandidateProfileSnapshot.create({
      reviewedResumeFacts: { currentCity: 'Resume City' },
      persistedFacts: { currentCity: 'Persisted City' },
      explicitFacts: { currentCity: 'Explicit City' },
      version: 'candidate-v1',
    });

    expect(snapshot.facts.currentCity).toBe('Explicit City');
    expect(snapshot.provenance.currentCity).toBe(CandidateFactSource.EXPLICIT_USER);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('should never resolve legal consent or apply an AI draft', () => {
    const snapshot = CandidateProfileSnapshot.create({ persistedFacts: { firstName: 'A' } });
    expect(AnswerResolver.resolve({
      question: 'I agree to the privacy terms', controlType: 'checkbox', candidateSnapshot: snapshot,
    }).status).toBe(AnswerResolutionStatus.UNSAFE_TO_ANSWER);
    expect(AnswerResolver.resolve({
      question: 'Describe an unknown fact', controlType: 'text', candidateSnapshot: snapshot,
      aiDraft: 'invented answer',
    })).toMatchObject({ status: AnswerResolutionStatus.NEEDS_USER_INPUT, suggestedValue: 'invented answer' });
  });
});
