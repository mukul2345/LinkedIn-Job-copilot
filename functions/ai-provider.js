/** Server-only AI provider facade. API keys never enter extension contexts. */

const { callAI: callSharedAI, AIClientError } = require('./lib/ai-client');

/** Parse JSON returned with optional markdown fences. */
function parseJsonLoose(raw) {
  if (typeof raw !== 'string') throw new AIClientError('INVALID_RESPONSE', 'AI response was not text.');
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(stripped);
}

/** Return raw model text through the configured server-side provider. */
async function callAI(prompt, options = {}) {
  const response = await callSharedAI(prompt, options);
  if (!response.text?.trim()) {
    throw new AIClientError('EMPTY_RESPONSE', 'AI provider returned an empty response.');
  }
  return response.text;
}

module.exports = { callAI, parseJsonLoose };
