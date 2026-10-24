/** Authenticated, server-only AI draft assistance. */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { callAI } = require('./ai-provider');
if (!admin.apps.length) admin.initializeApp();

const FACT_REQUIREMENTS = [
  [/experience|years?/i, 'yearsOfExperience'],
  [/sponsor|visa/i, 'requireVisa'],
  [/authori[sz]ed|legally|citizen/i, 'workAuthorization'],
  [/desired salary|expected salary/i, 'desiredSalary'],
  [/current salary|current ctc/i, 'currentCtc'],
  [/notice period/i, 'noticePeriod'],
  [/city|location/i, 'currentCity'],
  [/country/i, 'country'],
];
const clean = value => typeof value === 'string' ? value.trim().slice(0, 5000) : value;
const ALLOWED_FACTS = ['yearsOfExperience', 'requireVisa', 'workAuthorization', 'desiredSalary', 'currentCtc', 'noticePeriod', 'currentCity', 'country', 'professionalSummary'];
function sanitizeCandidateFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(ALLOWED_FACTS
    .filter(key => value[key] != null && value[key] !== '')
    .map(key => [key, clean(String(value[key])).slice(0, 1000)]));
}
function sendError(res, status, code, message, requestId) {
  return res.status(status).json({ ok: false, error: { code, message }, meta: { requestId } });
}
async function authenticate(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new Error('UNAUTHORIZED');
  return admin.auth().verifyIdToken(header.slice(7));
}
function missingRequiredFact(question, facts) {
  const requirement = FACT_REQUIREMENTS.find(([pattern]) => pattern.test(question));
  if (requirement) return facts[requirement[1]] == null || facts[requirement[1]] === '';
  // Unknown yes/no and numeric questions are factual and must never be guessed.
  return /\b(?:do|have|are|can|will|would) you\b|\bhow many\b|\brate your\b|\bproficien/i.test(question);
}
const generateAiAssistance = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  const requestId = req.headers['x-request-id'] || `req_${Date.now().toString(36)}`;
  if (req.method !== 'POST') return sendError(res, 405, 'INVALID_REQUEST', 'Use POST.', requestId);
  try { await authenticate(req); } catch (_) { return sendError(res, 401, 'UNAUTHORIZED', 'Sign in again.', requestId); }
  const { kind } = req.body || {};
  const candidateFacts = sanitizeCandidateFacts(req.body?.candidateFacts);
  if (!['form_answer', 'cover_letter'].includes(kind)) return sendError(res, 400, 'INVALID_REQUEST', 'Unsupported assistance kind.', requestId);
  const question = clean(req.body.question || '');
  if (kind === 'form_answer' && (!question || missingRequiredFact(question, candidateFacts))) {
    return res.status(200).json({ ok: true, data: { status: 'NEEDS_USER_INPUT' }, meta: { requestId } });
  }
  const prompt = ['Use only the supplied candidate facts. Never infer or invent facts.', 'If facts are insufficient, return exactly NEEDS_USER_INPUT.', `Task: ${kind}`, `Job: ${clean(req.body.jobTitle || '')} at ${clean(req.body.company || '')}`, `Question: ${question}`, `Candidate facts: ${JSON.stringify(candidateFacts)}`, `Job description: ${clean(req.body.jobDescription || '')}`].join('\n');
  try {
    const text = (await callAI(prompt, { maxTokens: kind === 'cover_letter' ? 800 : 200 })).trim();
    const data = text === 'NEEDS_USER_INPUT' ? { status: 'NEEDS_USER_INPUT' } : { status: 'DRAFT', text };
    return res.status(200).json({ ok: true, data, meta: { requestId } });
  } catch (error) { return sendError(res, 502, 'AI_UNAVAILABLE', 'AI assistance is temporarily unavailable.', requestId); }
});
module.exports = { generateAiAssistance, missingRequiredFact, sanitizeCandidateFacts };
