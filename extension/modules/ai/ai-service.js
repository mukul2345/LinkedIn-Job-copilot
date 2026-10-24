// ai-service.js - Authenticated server-side AI draft assistance.
// Provider credentials are deployment secrets and never enter extension contexts.

// eslint-disable-next-line no-var
var _aiServiceReady = false;

/** Return whether the user enabled server-managed AI assistance. */
async function isAIServiceAvailable() {
  const settings = await new Promise(resolve => chrome.storage.local.get(['useAI'], resolve));
  _aiServiceReady = settings.useAI === true;
  return _aiServiceReady;
}

async function requestAiAssistance(kind, payload) {
  if (!_aiServiceReady && !(await isAIServiceAvailable())) return null;
  try {
    const provider = new OpenAIProvider(callBackend);
    const response = await provider.generate({ kind, ...payload });
    return response.text || null;
  } catch (error) {
    ExtensionLogger.warn('AI assistance unavailable.', { code: error?.code });
    return null;
  }
}

/** Draft an answer only from explicitly configured candidate facts. */
async function getAIFormAnswer(question, jobTitle, company, config = {}) {
  return requestAiAssistance('form_answer', {
    question, jobTitle, company,
    candidateFacts: {
      yearsOfExperience: config.yearsOfExperience ?? null,
      requireVisa: config.requireVisa ?? null,
      workAuthorization: config.usCitizenship ?? null,
      desiredSalary: config.desiredSalary ?? null,
      currentCtc: config.currentCtc ?? null,
      noticePeriod: config.noticePeriod ?? null,
      currentCity: config.currentCity ?? null,
      country: config.country ?? null,
      professionalSummary: config.linkedinSummary ?? null,
    },
  });
}

/** Draft a cover letter without exposing provider credentials. */
async function getAICoverLetter(jobTitle, company, jobDescription, config = {}) {
  return requestAiAssistance('cover_letter', {
    jobTitle, company, jobDescription,
    candidateFacts: { professionalSummary: config.linkedinSummary ?? null },
  });
}

/** Recruiter outreach is template-only; AI never creates a fallback message. */
async function getAIRecruiterMessage() { return null; }
