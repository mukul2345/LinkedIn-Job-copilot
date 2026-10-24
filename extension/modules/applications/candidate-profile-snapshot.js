// candidate-profile-snapshot.js - Immutable candidate facts with explicit provenance.

// eslint-disable-next-line no-var
var CandidateFactSource = Object.freeze({
  EXPLICIT_USER: 'EXPLICIT_USER',
  VERIFIED_PERSISTED: 'VERIFIED_PERSISTED',
  REVIEWED_RESUME: 'REVIEWED_RESUME',
  DETERMINISTIC_TRANSFORMATION: 'DETERMINISTIC_TRANSFORMATION',
});

// eslint-disable-next-line no-var
var CandidateProfileSnapshot = (function () {
  const SCHEMA_VERSION = 1;

  function usableFacts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, fact]) =>
      fact !== undefined && fact !== null && fact !== ''));
  }

  function freezeSnapshot(snapshot) {
    Object.freeze(snapshot.facts);
    Object.freeze(snapshot.provenance);
    return Object.freeze(snapshot);
  }

  function create({
    explicitFacts = {},
    persistedFacts = {},
    reviewedResumeFacts = {},
    version = null,
    createdAt = new Date().toISOString(),
  } = {}) {
    const facts = {};
    const provenance = {};
    const layers = [
      [reviewedResumeFacts, CandidateFactSource.REVIEWED_RESUME],
      [persistedFacts, CandidateFactSource.VERIFIED_PERSISTED],
      [explicitFacts, CandidateFactSource.EXPLICIT_USER],
    ];
    for (const [layer, source] of layers) {
      for (const [key, value] of Object.entries(usableFacts(layer))) {
        const normalizedValue = value && typeof value === 'object'
          ? Object.freeze(Array.isArray(value) ? [...value] : { ...value })
          : value;
        facts[key] = normalizedValue;
        provenance[key] = source;
      }
    }
    return freezeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      version: version || `candidate-${Date.parse(createdAt) || Date.now()}`,
      createdAt,
      facts,
      provenance,
    });
  }

  function fromConfig(config = {}) {
    const persistedFacts = {
      firstName: config.firstName,
      middleName: config.middleName,
      lastName: config.lastName,
      email: config.email || config.cachedUserEmail,
      phoneNumber: config.phoneNumber,
      street: config.street,
      currentCity: config.currentCity,
      state: config.state,
      zipcode: config.zipcode,
      country: config.country,
      yearsOfExperience: config.yearsOfExperience,
      linkedInUrl: config.linkedInUrl,
      website: config.website,
      noticePeriod: config.noticePeriod,
      desiredSalary: config.desiredSalary,
      currentCtc: config.currentCtc,
      recentEmployer: config.recentEmployer,
      linkedinHeadline: config.linkedinHeadline,
      linkedinSummary: config.linkedinSummary,
      coverLetter: config.coverLetter || config.templates?.coverLetter,
      requireVisa: config.requireVisa,
      usCitizenship: config.usCitizenship || config.workAuthorization,
      willingToRelocate: config.willingToRelocate,
      gender: config.gender,
      ethnicity: config.ethnicity,
      disabilityStatus: config.disabilityStatus,
      veteranStatus: config.veteranStatus,
      skillMap: config.skillMap,
      educationLevel: config.educationLevel,
      proficiencyLevel: config.proficiencyLevel,
      confidenceLevel: config.confidenceLevel,
      gpa: config.gpa,
      referralSource: config.referralSource,
    };
    return create({
      explicitFacts: config.explicitAnswers || {},
      persistedFacts,
      reviewedResumeFacts: config.reviewedResumeFacts || {},
      version: config.profileVersion || config.updatedAt || null,
    });
  }

  function getFact(snapshot, key) {
    if (!snapshot || typeof key !== 'string') return null;
    if (!Object.prototype.hasOwnProperty.call(snapshot.facts || {}, key)) return null;
    return Object.freeze({
      value: snapshot.facts[key],
      source: snapshot.provenance[key],
      snapshotVersion: snapshot.version,
    });
  }

  return Object.freeze({ create, fromConfig, getFact, SCHEMA_VERSION });
})();
