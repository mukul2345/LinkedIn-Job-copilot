/**
 * scanGmail Cloud Function
 *
 * POST /scanGmail
 * Body: {} (uses stored OAuth token)
 * Auth: Bearer token required
 * Timeout: 30s
 *
 * Scans user's Gmail inbox for application-related emails:
 * 1. Validates auth
 * 2. Fetches Gmail OAuth token from Firestore, refreshes if needed
 * 3. Queries Gmail API for emails from last 30 days matching application patterns
 * 4. Classifies each email (interview/rejection/offer)
 * 5. Extracts company name using multi-strategy approach
 * 6. Stores new TrackerEntry records in Firestore
 * 7. Returns new entries
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

// Ensure admin is initialized (may already be from index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

// Gmail OAuth2 client credentials (from environment / Firebase config)
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || '';

// --- Classification patterns ---

const INTERVIEW_PATTERNS = /interview|phone screen|schedule|next step|moving forward/i;
const REJECTION_PATTERNS = /unfortunately|regret|not moving forward|decided not to|position filled/i;
const OFFER_PATTERNS = /offer letter|job offer|pleased to offer|extend an offer|welcome aboard/i;

// Generic email domains to exclude from company name extraction
const GENERIC_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'aol.com',
  'icloud.com',
  'mail.com',
  'protonmail.com',
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkday.com',
  'icims.com',
  'smartrecruiters.com',
  'ashbyhq.com',
  'jobvite.com',
  'applytojob.com',
  'breezy.hr',
]);

/**
 * Set CORS headers on the response.
 * @param {Object} res - Express-like response object
 */
function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id');
}

/**
 * Generate a request ID.
 * @returns {string}
 */
function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Build a standardized error response.
 * @param {Object} res - Response object
 * @param {number} status - HTTP status code
 * @param {string} code - Error code
 * @param {string} message - Human-readable error message
 * @param {string} requestId - Request correlation ID
 */
function sendError(res, status, code, message, requestId) {
  return res.status(status).json({
    ok: false,
    error: { code, message },
    meta: { requestId },
  });
}

/**
 * Classify an email as interview, rejection, offer, or unknown.
 * Uses regex pattern matching against subject and body snippet.
 *
 * @param {{ subject: string, snippet: string, body: string }} email
 * @returns {'interview'|'rejection'|'offer'|'unknown'}
 */
function classifyEmail(email) {
  const text = `${email.subject || ''} ${email.snippet || ''} ${email.body || ''}`;

  // Check offer first (most specific/important)
  if (OFFER_PATTERNS.test(text)) {
    return 'offer';
  }

  // Check interview
  if (INTERVIEW_PATTERNS.test(text)) {
    return 'interview';
  }

  // Check rejection
  if (REJECTION_PATTERNS.test(text)) {
    return 'rejection';
  }

  return 'unknown';
}

/**
 * Extract company name from email using multiple strategies:
 * 1. From sender domain (exclude generic providers)
 * 2. From body patterns ("at {Company}", "{Company} team")
 * 3. From subject line
 * 4. Fallback: "Unknown Company"
 *
 * @param {{ from: string, subject: string, snippet: string, body: string }} email
 * @returns {string}
 */
function extractCompanyName(email) {
  // Strategy 1: Extract from sender domain
  const fromAddress = email.from || '';
  const domainMatch = fromAddress.match(/@([a-zA-Z0-9.-]+)/);
  if (domainMatch) {
    const domain = domainMatch[1].toLowerCase();
    if (!GENERIC_DOMAINS.has(domain)) {
      // Convert domain to company name: "acme-corp.com" -> "Acme Corp"
      const domainParts = domain.split('.')[0]; // Take first part before TLD
      const companyFromDomain = domainParts
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      if (companyFromDomain.length > 1) {
        return companyFromDomain;
      }
    }
  }

  const text = `${email.subject || ''} ${email.snippet || ''} ${email.body || ''}`;

  // Strategy 2: From body patterns
  // Pattern: "at {Company}" or "from {Company}"
  const atCompanyMatch = text.match(/(?:at|from|with)\s+([A-Z][A-Za-z0-9\s&.'-]{1,40})(?:\s+team|\s+is|\s*[,.])/);
  if (atCompanyMatch) {
    return atCompanyMatch[1].trim();
  }

  // Pattern: "{Company} team" or "{Company} is pleased"
  const companyTeamMatch = text.match(/(?:^|[.\s])([A-Z][A-Za-z0-9&.'-]{1,40})\s+(?:team|is pleased|would like|has reviewed)/);
  if (companyTeamMatch) {
    return companyTeamMatch[1].trim();
  }

  // Strategy 3: From subject line - look for capitalized words that might be company names
  const subjectCompanyMatch = (email.subject || '').match(/(?:from|at|with)\s+([A-Z][A-Za-z0-9\s&.'-]{1,30})/i);
  if (subjectCompanyMatch) {
    return subjectCompanyMatch[1].trim();
  }

  // Strategy 4: Fallback
  return 'Unknown Company';
}

/**
 * Create an OAuth2 client with the user's stored tokens.
 * Refreshes the access token if expired.
 *
 * @param {Object} tokenDoc - Firestore token document data
 * @param {string} userId - User ID for updating refreshed tokens
 * @returns {Promise<OAuth2Client>}
 */
async function getAuthenticatedClient(tokenDoc, userId) {
  const oauth2Client = new OAuth2Client(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: tokenDoc.accessToken,
    refresh_token: tokenDoc.refreshToken,
    expiry_date: tokenDoc.expiresAt ? tokenDoc.expiresAt.toMillis() : 0,
  });

  // Check if token needs refresh
  const now = Date.now();
  const expiresAt = tokenDoc.expiresAt ? tokenDoc.expiresAt.toMillis() : 0;

  if (now >= expiresAt - 60000) {
    // Token expired or expires within 60s, refresh it
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    // Update stored token in Firestore
    const db = admin.firestore();
    await db.doc(`users/${userId}/tokens/gmail`).update({
      accessToken: credentials.access_token,
      expiresAt: admin.firestore.Timestamp.fromMillis(credentials.expiry_date || (now + 3600000)),
    });
  }

  return oauth2Client;
}

/**
 * Build Gmail search query for application-related emails from the last 30 days.
 * @returns {string}
 */
function buildGmailQuery() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split('T')[0].replace(/-/g, '/');

  return `(interview OR rejection OR offer OR application) after:${dateStr}`;
}

/**
 * Extract email details from a Gmail message resource.
 * @param {Object} message - Gmail API message resource (full format)
 * @returns {{ from: string, subject: string, snippet: string, body: string, date: string, messageId: string }}
 */
function extractEmailDetails(message) {
  const headers = message.payload?.headers || [];

  const getHeader = (name) => {
    const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : '';
  };

  const from = getHeader('From');
  const subject = getHeader('Subject');
  const date = getHeader('Date');
  const snippet = message.snippet || '';

  // Extract body text from payload
  let body = '';
  if (message.payload) {
    body = extractBodyText(message.payload);
  }

  return {
    from,
    subject,
    snippet,
    body: body.substring(0, 2000), // Limit body to 2000 chars for processing
    date,
    messageId: message.id,
  };
}

/**
 * Recursively extract plain text body from Gmail message payload.
 * @param {Object} payload - Gmail message payload
 * @returns {string}
 */
function extractBodyText(payload) {
  // Direct body data
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart: check parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      if (part.parts) {
        const nested = extractBodyText(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

/**
 * Generate a deterministic entry ID from email subject + date.
 * Used for deduplication.
 * @param {string} subject
 * @param {string} date
 * @returns {string}
 */
function generateEntryId(subject, date) {
  const crypto = require('crypto');
  const normalized = `${(subject || '').toLowerCase().trim()}|${(date || '').trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 20);
}

/**
 * scanGmail Cloud Function handler.
 */
const scanGmail = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    setCorsHeaders(res);

    // Handle preflight OPTIONS
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }

    // Get or generate request ID
    const requestId = req.headers['x-request-id'] || generateRequestId();
    res.set('x-request-id', requestId);

    // Only accept POST
    if (req.method !== 'POST') {
      return sendError(res, 405, 'INVALID_REQUEST', 'Method not allowed. Use POST.', requestId);
    }

    // --- Auth validation ---
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
    }

    let userId;
    try {
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      userId = decodedToken.uid;
    } catch (err) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please sign in again.', requestId);
    }

    // --- Fetch Gmail token from Firestore ---
    const db = admin.firestore();
    let tokenDoc;
    try {
      const tokenSnap = await db.doc(`users/${userId}/tokens/gmail`).get();
      if (!tokenSnap.exists) {
        return sendError(
          res,
          400,
          'INVALID_REQUEST',
          'Gmail not connected. Please connect your Gmail account first.',
          requestId
        );
      }
      tokenDoc = tokenSnap.data();
    } catch (err) {
      console.error(`[scanGmail] Firestore token fetch error (requestId=${requestId}):`, err.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to retrieve Gmail credentials.', requestId);
    }

    if (!tokenDoc.accessToken || !tokenDoc.refreshToken) {
      return sendError(
        res,
        400,
        'INVALID_REQUEST',
        'Gmail not connected. Please connect your Gmail account first.',
        requestId
      );
    }

    // --- Authenticate with Gmail API ---
    let oauth2Client;
    try {
      oauth2Client = await getAuthenticatedClient(tokenDoc, userId);
    } catch (err) {
      console.error(`[scanGmail] OAuth refresh error (requestId=${requestId}):`, err.message);
      return sendError(
        res,
        401,
        'UNAUTHORIZED',
        'Gmail token expired. Please reconnect your Gmail account.',
        requestId
      );
    }

    // --- Query Gmail API ---
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const query = buildGmailQuery();

    let messageIds = [];
    try {
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 50,
        labelIds: ['INBOX'],
      });
      messageIds = (listResponse.data.messages || []).map((m) => m.id);
    } catch (err) {
      console.error(`[scanGmail] Gmail list error (requestId=${requestId}):`, err.message);
      if (err.code === 401 || err.response?.status === 401) {
        return sendError(
          res,
          401,
          'UNAUTHORIZED',
          'Gmail access revoked. Please reconnect your Gmail account.',
          requestId
        );
      }
      return sendError(res, 502, 'UPSTREAM_ERROR', 'Failed to fetch emails from Gmail.', requestId);
    }

    if (messageIds.length === 0) {
      // Update lastScanAt and return empty
      await db.doc(`users/${userId}/tokens/gmail`).update({
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({
        ok: true,
        data: { entries: [], newCount: 0 },
        meta: { requestId },
      });
    }

    // --- Fetch full message details ---
    const emails = [];
    for (const msgId of messageIds) {
      try {
        const msgResponse = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'full',
        });
        const emailDetails = extractEmailDetails(msgResponse.data);
        emails.push(emailDetails);
      } catch (err) {
        // Skip individual message fetch failures
        console.error(`[scanGmail] Message fetch error (requestId=${requestId}, msgId=${msgId}):`, err.message);
      }
    }

    // --- Filter to last 30 days and classify ---
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newEntries = [];
    const trackerCollectionPath = `users/${userId}/tracker`;

    // Get existing entry IDs to avoid duplicates
    let existingIds = new Set();
    try {
      const existingSnap = await db.collection(trackerCollectionPath).get();
      existingIds = new Set(existingSnap.docs.map((d) => d.id));
    } catch (err) {
      console.error(`[scanGmail] Existing entries fetch error (requestId=${requestId}):`, err.message);
    }

    for (const email of emails) {
      // Parse email date and enforce 30-day filter
      const emailDate = new Date(email.date);
      if (isNaN(emailDate.getTime()) || emailDate < thirtyDaysAgo) {
        continue;
      }

      // Classify
      const status = classifyEmail(email);
      if (status === 'unknown') {
        // Skip emails that don't clearly match application patterns
        continue;
      }

      // Extract company name
      const company = extractCompanyName(email);

      // Generate deterministic ID for deduplication
      const entryId = generateEntryId(email.subject, email.date);

      // Skip if already processed
      if (existingIds.has(entryId)) {
        continue;
      }

      const entry = {
        id: entryId,
        company,
        status,
        emailSubject: email.subject || '',
        emailDate: admin.firestore.Timestamp.fromDate(emailDate),
        emailSnippet: (email.snippet || '').substring(0, 200),
        dismissed: false,
        manualCorrection: null,
        detectedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      newEntries.push(entry);
    }

    // --- Store new entries in Firestore ---
    if (newEntries.length > 0) {
      try {
        const batch = db.batch();
        for (const entry of newEntries) {
          const docRef = db.collection(trackerCollectionPath).doc(entry.id);
          batch.set(docRef, entry, { merge: true });
        }
        await batch.commit();
      } catch (err) {
        console.error(`[scanGmail] Firestore write error (requestId=${requestId}):`, err.message);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to store tracker entries.', requestId);
      }
    }

    // Update lastScanAt
    try {
      await db.doc(`users/${userId}/tokens/gmail`).update({
        lastScanAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      // Non-critical, just log
      console.error(`[scanGmail] lastScanAt update error (requestId=${requestId}):`, err.message);
    }

    // --- Return response ---
    // Convert entries for the response (replace server timestamps with ISO strings)
    const responseEntries = newEntries.map((entry) => ({
      id: entry.id,
      company: entry.company,
      status: entry.status,
      emailSubject: entry.emailSubject,
      emailDate: entry.emailDate.toDate().toISOString(),
      emailSnippet: entry.emailSnippet,
      dismissed: entry.dismissed,
      manualCorrection: entry.manualCorrection,
    }));

    return res.status(200).json({
      ok: true,
      data: {
        entries: responseEntries,
        newCount: responseEntries.length,
      },
      meta: { requestId },
    });
  });

module.exports = {
  scanGmail,
  // Exported for testing
  classifyEmail,
  extractCompanyName,
  buildGmailQuery,
  extractEmailDetails,
  extractBodyText,
  generateEntryId,
  INTERVIEW_PATTERNS,
  REJECTION_PATTERNS,
  OFFER_PATTERNS,
  GENERIC_DOMAINS,
};
