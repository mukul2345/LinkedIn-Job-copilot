/** Authenticated HTTP endpoints for durable search sessions. */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { SearchSessionRepository } = require('./search-session-repository');
const { JobSearchOrchestrator } = require('./search-session-orchestrator');

if (!admin.apps.length) admin.initializeApp();

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id');
}

function sendError(res, status, code, message, requestId) {
  return res.status(status).json({ ok: false, error: { code, message }, meta: { requestId } });
}

async function authenticate(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) throw new Error('UNAUTHORIZED');
  return admin.auth().verifyIdToken(authorization.slice(7));
}

function createContext(req, res) {
  setCorsHeaders(res);
  return { requestId: req.headers['x-request-id'] || `req_${Date.now().toString(36)}` };
}

function createServices() {
  const repository = new SearchSessionRepository({ db: admin.firestore() });
  return { repository, orchestrator: new JobSearchOrchestrator({ repository, db: admin.firestore() }) };
}

function validatePost(req, res, requestId) {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }
  if (req.method !== 'POST') {
    sendError(res, 405, 'INVALID_REQUEST', 'Use POST.', requestId);
    return false;
  }
  return true;
}

async function withAuthentication(req, res, action) {
  const { requestId } = createContext(req, res);
  if (!validatePost(req, res, requestId)) return undefined;
  let token;
  try {
    token = await authenticate(req);
  } catch (_) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
  }
  try {
    const data = await action({ ...createServices(), userId: token.uid, body: req.body || {} });
    return res.status(200).json({ ok: true, data, meta: { requestId } });
  } catch (error) {
    const code = error.code || error.message || 'SEARCH_SESSION_FAILED';
    const status = code === 'SEARCH_SESSION_NOT_FOUND' ? 404
      : ['INVALID_REQUEST', 'USER_NOT_FOUND'].includes(code) ? 400
        : 502;
    if (status >= 500) console.error('[searchSessions] Request failed.', { requestId, error: error.stack || error });
    return sendError(res, status, code, status === 502
      ? 'Search session processing is temporarily unavailable.'
      : code.replaceAll('_', ' ').toLowerCase(), requestId);
  }
}

const createSearchSession = functions.runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest((req, res) => withAuthentication(req, res, ({ orchestrator, userId, body }) =>
    orchestrator.create(userId, body.criteria || {})));

const resumeSearchSession = functions.runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onRequest((req, res) => withAuthentication(req, res, ({ orchestrator, userId, body }) => {
    if (typeof body.sessionId !== 'string' || !body.sessionId) throw new Error('INVALID_REQUEST');
    return orchestrator.run(userId, body.sessionId);
  }));

const getSearchSession = functions.runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest((req, res) => withAuthentication(req, res, async ({ repository, userId, body }) => {
    if (typeof body.sessionId !== 'string' || !body.sessionId) throw new Error('INVALID_REQUEST');
    const session = await repository.get(userId, body.sessionId);
    if (!session) throw new Error('SEARCH_SESSION_NOT_FOUND');
    const page = await repository.readResultPage(userId, body.sessionId, body.page);
    return { session, ...page };
  }));

const cancelSearchSession = functions.runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest((req, res) => withAuthentication(req, res, ({ repository, userId, body }) => {
    if (typeof body.sessionId !== 'string' || !body.sessionId) throw new Error('INVALID_REQUEST');
    return repository.requestCancellation(userId, body.sessionId);
  }));

module.exports = {
  createSearchSession,
  resumeSearchSession,
  getSearchSession,
  cancelSearchSession,
  authenticate,
  withAuthentication,
};
