/** Server-owned confirmed application ledger. */

const crypto = require('crypto');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

/**
 * Resolve the Firestore instance. Overridable in tests so the ledger logic can
 * be verified without a live Firestore connection.
 * @type {() => FirebaseFirestore.Firestore}
 */
let firestoreProvider = () => admin.firestore();

/** Override the Firestore provider (test seam). */
function setFirestoreProvider(provider) {
  firestoreProvider = provider;
}

const CONFIRMED_OUTCOMES = Object.freeze([
  'SUBMITTED_CONFIRMED',
  'EXTERNAL_CONFIRMED',
]);
const SUPPORTED_PLATFORMS = Object.freeze(['linkedin', 'indeed', 'glassdoor']);

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id');
}

async function authenticate(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) throw new Error('UNAUTHORIZED');
  return admin.auth().verifyIdToken(authorization.slice(7));
}

function sendError(res, status, code, message, requestId) {
  return res.status(status).json({ ok: false, error: { code, message }, meta: { requestId } });
}

function sanitizeText(value, maximum = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : null;
}

function createLedgerEntry(userId, body, now = new Date()) {
  const jobId = sanitizeText(body.jobId, 500);
  const platform = sanitizeText(body.platform, 40);
  const outcome = sanitizeText(body.outcome, 40);
  if (!jobId || !SUPPORTED_PLATFORMS.includes(platform) || !CONFIRMED_OUTCOMES.includes(outcome)) {
    throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' });
  }
  if (body.confirmed !== true) throw Object.assign(new Error('CONFIRMATION_REQUIRED'), { code: 'CONFIRMATION_REQUIRED' });
  const idempotencyKey = sanitizeText(body.attemptId, 500) || `${outcome}:${jobId}`;
  return {
    id: crypto.createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex'),
    schemaVersion: 1,
    jobId,
    platform,
    outcome,
    confirmed: true,
    confirmationSource: outcome === 'EXTERNAL_CONFIRMED' ? 'USER' : 'PROVIDER',
    attemptId: sanitizeText(body.attemptId, 500),
    receiptId: sanitizeText(body.receiptId, 1000),
    searchSessionId: sanitizeText(body.searchSessionId, 200),
    title: sanitizeText(body.title, 200),
    company: sanitizeText(body.company, 200),
    sourceUrl: sanitizeText(body.sourceUrl, 2000),
    matchProvenance: body.matchProvenance && typeof body.matchProvenance === 'object'
      ? { status: sanitizeText(body.matchProvenance.status, 40), score: Number.isFinite(body.matchProvenance.score) ? body.matchProvenance.score : null }
      : null,
    createdAt: now.toISOString(),
  };
}

async function withAuthentication(req, res, action) {
  setCorsHeaders(res);
  const requestId = req.headers['x-request-id'] || `req_${Date.now().toString(36)}`;
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return sendError(res, 405, 'INVALID_REQUEST', 'Use POST.', requestId);
  let token;
  try {
    token = await authenticate(req);
  } catch (_) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
  }
  try {
    const data = await action(token.uid, req.body || {});
    return res.status(200).json({ ok: true, data, meta: { requestId } });
  } catch (error) {
    const code = error.code || error.message || 'APPLICATION_HISTORY_FAILED';
    const status = ['INVALID_REQUEST', 'CONFIRMATION_REQUIRED'].includes(code) ? 400 : 502;
    return sendError(res, status, code, status === 400
      ? code.replaceAll('_', ' ').toLowerCase()
      : 'Application history is temporarily unavailable.', requestId);
  }
}

async function recordOutcome(userId, body) {
  const entry = createLedgerEntry(userId, body);
  const reference = firestoreProvider().collection(`users/${userId}/applications`).doc(entry.id);
  try {
    await reference.create(entry);
    return { entry, alreadyRecorded: false };
  } catch (error) {
    if (![6, '6', 'already-exists'].includes(error.code)) throw error;
    const existing = await reference.get();
    return { entry: existing.data(), alreadyRecorded: true };
  }
}

async function readHistory(userId, body) {
  const requestedLimit = Number.parseInt(body.limit, 10) || 50;
  const limit = Math.min(Math.max(requestedLimit, 1), 100);
  const snapshot = await firestoreProvider()
    .collection(`users/${userId}/applications`)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return { entries: snapshot.docs.map(document => document.data()) };
}

/**
 * Report whether the user already has a server-confirmed application for one or
 * more stable attempt identities, enabling cross-device already-applied
 * protection before the bot begins a submission.
 */
async function checkAlreadyApplied(userId, body) {
  const attemptIds = Array.isArray(body.attemptIds) ? body.attemptIds : [];
  const cleanedIds = [...new Set(attemptIds.map(id => sanitizeText(id, 500)).filter(Boolean))]
    .slice(0, 100);
  if (!cleanedIds.length) throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' });
  const collection = firestoreProvider().collection(`users/${userId}/applications`);
  const results = await Promise.all(cleanedIds.map(async attemptId => {
    const documentId = crypto.createHash('sha256').update(`${userId}:${attemptId}`).digest('hex');
    const snapshot = await collection.doc(documentId).get();
    return [attemptId, snapshot.exists];
  }));
  const applied = results.filter(([, exists]) => exists).map(([attemptId]) => attemptId);
  return { appliedAttemptIds: applied };
}

const recordApplicationOutcome = functions.runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest((req, res) => withAuthentication(req, res, recordOutcome));

const getApplicationHistory = functions.runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest((req, res) => withAuthentication(req, res, readHistory));

const checkApplicationApplied = functions.runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest((req, res) => withAuthentication(req, res, checkAlreadyApplied));

module.exports = {
  recordApplicationOutcome,
  getApplicationHistory,
  checkApplicationApplied,
  createLedgerEntry,
  recordOutcome,
  readHistory,
  checkAlreadyApplied,
  setFirestoreProvider,
};
