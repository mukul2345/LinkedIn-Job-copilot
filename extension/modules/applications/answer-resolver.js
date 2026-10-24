// answer-resolver.js - Candidate-fact precedence and safe form-answer outcomes.

// eslint-disable-next-line no-var
var AnswerResolutionStatus = Object.freeze({
  ANSWERED: 'ANSWERED',
  NEEDS_USER_INPUT: 'NEEDS_USER_INPUT',
  UNSAFE_TO_ANSWER: 'UNSAFE_TO_ANSWER',
  UNKNOWN: 'UNKNOWN',
});

// eslint-disable-next-line no-var
var AnswerResolver = (function () {
  const LEGAL_PATTERN = /agree|acknowledge|certify|confirm|consent|terms|privacy|authorize|attest|signature|understand/i;

  function normalizedBoolean(value) {
    if (value === true || ['yes', 'true', 'y', '1'].includes(String(value).toLowerCase())) return 'Yes';
    if (value === false || ['no', 'false', 'n', '0'].includes(String(value).toLowerCase())) return 'No';
    return value;
  }

  function outcome(status, values = {}) {
    return Object.freeze({
      status,
      value: null,
      source: null,
      confidence: null,
      reasonCodes: [],
      ...values,
    });
  }

  function findFact(question, snapshot) {
    const facts = snapshot?.facts || {};
    const text = String(question || '').toLowerCase();
    const fullName = [facts.firstName, facts.middleName, facts.lastName].filter(Boolean).join(' ');
    const mappings = [
      [/first name|given name|forename/, 'firstName'],
      [/last name|surname|family name/, 'lastName'],
      [/middle name|middle initial/, 'middleName'],
      [/signature|full name|legal name|candidate name/, '__fullName'],
      [/e-?mail/, 'email'],
      [/phone|mobile|telephone|contact number/, 'phoneNumber'],
      [/postal|zip|postcode/, 'zipcode'],
      [/city|town|location/, 'currentCity'],
      [/state|province|region/, 'state'],
      [/country/, 'country'],
      [/street|address line/, 'street'],
      [/linkedin/, 'linkedInUrl'],
      [/github|portfolio|website|blog/, 'website'],
      [/notice/, 'noticePeriod'],
      [/current.*(?:salary|ctc|compensation)|present salary/, 'currentCtc'],
      [/(?:desired|expected|salary expectation|expected ctc|compensation)/, 'desiredSalary'],
      [/current employer|current company|recent employer/, 'recentEmployer'],
      [/education|degree/, 'educationLevel'],
      [/proficiency|fluency/, 'proficiencyLevel'],
      [/confidence|scale|1-10/, 'confidenceLevel'],
      [/gpa|cgpa/, 'gpa'],
      [/how did you hear|referral source|come across/, 'referralSource'],
    ];
    const mapping = mappings.find(([pattern]) => pattern.test(text));
    if (!mapping && /\bname\b/.test(text) && !/company|employer|school|university/.test(text)) {
      return { key: '__fullName', value: fullName };
    }
    if (!mapping) return null;
    const key = mapping[1];
    return { key, value: key === '__fullName' ? fullName : facts[key] };
  }

  function findDomainFact(question, snapshot) {
    const facts = snapshot?.facts || {};
    const text = String(question || '').toLowerCase();
    if (/years?.*experience|experience.*years?|how many years/.test(text)) {
      for (const [skill, years] of Object.entries(facts.skillMap || {})) {
        if (text.includes(skill.toLowerCase())) return { key: `skillMap.${skill}`, value: years };
      }
      return { key: 'yearsOfExperience', value: facts.yearsOfExperience };
    }
    if (/sponsor|visa|work permit/.test(text)) {
      return { key: 'requireVisa', value: normalizedBoolean(facts.requireVisa) };
    }
    if (/citizen|authorized to work|work authorization|legally|eligible to work|right to work/.test(text)) {
      return { key: 'usCitizenship', value: normalizedBoolean(facts.usCitizenship) };
    }
    if (/relocat/.test(text)) return { key: 'willingToRelocate', value: normalizedBoolean(facts.willingToRelocate) };
    if (/gender|\bsex\b/.test(text)) return { key: 'gender', value: facts.gender };
    if (/race|ethnicity/.test(text)) return { key: 'ethnicity', value: facts.ethnicity };
    if (/disability/.test(text)) return { key: 'disabilityStatus', value: facts.disabilityStatus };
    if (/veteran/.test(text)) return { key: 'veteranStatus', value: facts.veteranStatus };
    if (/summary|about you|tell us about yourself|introduce yourself|bio/.test(text)) {
      return { key: 'linkedinSummary', value: facts.linkedinSummary };
    }
    if (/cover|motivation/.test(text)) return { key: 'coverLetter', value: facts.coverLetter };
    if (/headline|professional title/.test(text)) return { key: 'linkedinHeadline', value: facts.linkedinHeadline };
    return null;
  }

  function transformFact(fact, question, snapshot) {
    if (!fact || fact.value === undefined || fact.value === null || fact.value === '') return null;
    let value = fact.value;
    let source = snapshot.provenance?.[fact.key] || CandidateFactSource.VERIFIED_PERSISTED;
    const text = String(question || '').toLowerCase();
    if (fact.key === 'noticePeriod') {
      const noticeDays = Number(value);
      if (Number.isFinite(noticeDays) && noticeDays >= 0 && text.includes('week')) {
        value = Math.floor(noticeDays / 7);
        source = CandidateFactSource.DETERMINISTIC_TRANSFORMATION;
      } else if (Number.isFinite(noticeDays) && noticeDays >= 0 && text.includes('month')) {
        value = Math.floor(noticeDays / 30);
        source = CandidateFactSource.DETERMINISTIC_TRANSFORMATION;
      }
    }
    return { value: String(value), source };
  }

  function resolve({
    question,
    controlType,
    candidateSnapshot,
    aiDraft = null,
  } = {}) {
    const text = String(question || '').trim();
    if (!text) return outcome(AnswerResolutionStatus.UNKNOWN, { reasonCodes: ['QUESTION_UNIDENTIFIED'] });
    if (LEGAL_PATTERN.test(text)) {
      return outcome(AnswerResolutionStatus.UNSAFE_TO_ANSWER, {
        reasonCodes: ['EXPLICIT_CONSENT_REQUIRED'],
      });
    }
    const fact = findFact(text, candidateSnapshot) || findDomainFact(text, candidateSnapshot);
    const transformed = transformFact(fact, text, candidateSnapshot || {});
    if (transformed) {
      return outcome(AnswerResolutionStatus.ANSWERED, {
        value: transformed.value,
        source: transformed.source,
        confidence: 'HIGH',
        candidateSnapshotVersion: candidateSnapshot?.version || null,
        reasonCodes: ['CANDIDATE_FACT_MATCH'],
      });
    }
    if (aiDraft) {
      return outcome(AnswerResolutionStatus.NEEDS_USER_INPUT, {
        suggestedValue: String(aiDraft),
        source: 'AI_DRAFT',
        confidence: 'LOW',
        candidateSnapshotVersion: candidateSnapshot?.version || null,
        reasonCodes: ['AI_REVIEW_REQUIRED'],
      });
    }
    const factualControl = ['radio', 'checkbox', 'number', 'select'].includes(controlType) ||
      /\b(?:do|have|are|can|will|would) you\b|how many|rate your|proficien/i.test(text);
    return outcome(
      factualControl ? AnswerResolutionStatus.NEEDS_USER_INPUT : AnswerResolutionStatus.UNKNOWN,
      {
        candidateSnapshotVersion: candidateSnapshot?.version || null,
        reasonCodes: [factualControl ? 'CANDIDATE_FACT_REQUIRED' : 'NO_CONFIDENT_ANSWER'],
      },
    );
  }

  return Object.freeze({ resolve, normalizedBoolean });
})();
