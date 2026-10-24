// application-state.js - Versioned, lifecycle-safe application state storage.

const APPLICATION_STATE_STORAGE_VERSION = 2;
const APPLICATION_STATE_KEY = 'applicationStatesV1';

function readApplicationStates() {
  return new Promise(resolve => {
    chrome.storage.local.get([APPLICATION_STATE_KEY], stored => {
      resolve(stored[APPLICATION_STATE_KEY] || {});
    });
  });
}

function writeApplicationStates(states) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [APPLICATION_STATE_KEY]: states }, resolve);
  });
}

// eslint-disable-next-line no-var
var ApplicationStateRepository = Object.freeze({
  async get(jobId) {
    const states = await readApplicationStates();
    return states[jobId] || null;
  },

  async transition(job, state, details = {}) {
    if (!Object.values(ApplicationState).includes(state)) {
      throw new Error('INVALID_APPLICATION_STATE');
    }
    const states = await readApplicationStates();
    const previous = states[job.id] || null;
    const terminalStates = [ApplicationState.SUBMITTED, ApplicationState.EXTERNAL_SUBMISSION_CONFIRMED];
    // Confirmed direct and user-confirmed external submissions are terminal.
    if (terminalStates.includes(previous?.state)) return previous;
    const next = {
      version: APPLICATION_STATE_STORAGE_VERSION,
      jobId: job.id,
      platform: job.platform,
      state,
      attemptId: details.attemptId || previous?.attemptId || null,
      receiptId: details.receiptId || previous?.receiptId || null,
      confirmed: details.confirmed === true,
      confirmationSource: details.confirmationSource || previous?.confirmationSource || null,
      reasonCodes: details.reasonCodes || [],
      updatedAt: new Date().toISOString(),
    };
    states[job.id] = next;
    await writeApplicationStates(states);
    return next;
  },

  async hasSubmitted(jobId) {
    const record = await this.get(jobId);
    return [ApplicationState.SUBMITTED, ApplicationState.EXTERNAL_SUBMISSION_CONFIRMED]
      .includes(record?.state);
  },

  async hasUncertainAttempt(jobId) {
    const record = await this.get(jobId);
    return record?.state === ApplicationState.FAILED &&
      record.reasonCodes?.includes('SUBMISSION_UNCONFIRMED');
  },
});
