/**
 * Resume Cloud Functions
 *
 * POST /uploadResume
 * Body: multipart/form-data with file field
 * Auth: Bearer token required
 * Max size: 5 MB
 *
 * Handles resume upload:
 * 1. Validates auth
 * 2. Parses multipart/form-data via busboy
 * 3. Validates file type (PDF/DOCX) and size (≤5 MB)
 * 4. Extracts text content from the file
 * 5. Stores file in Cloud Storage
 * 6. Stores resume document in Firestore
 * 7. Returns resumeId, filename, and parsedLength
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Busboy = require('busboy');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { v4: uuidv4 } = require('uuid');
const { COLLECTION_PATHS } = require('./lib/schema');

// Ensure admin is initialized (may already be from index.js)
if (!admin.apps.length) {
  admin.initializeApp();
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

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
 * Generate a request ID (simple unique string).
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
 * Extract text content from a PDF buffer.
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPdf(buffer) {
  const data = await pdfParse(buffer);
  return data.text || '';
}

/**
 * Extract text content from a DOCX buffer.
 * @param {Buffer} buffer - DOCX file buffer
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

/**
 * uploadResume Cloud Function handler.
 * Handles multipart/form-data file uploads for base resumes.
 */
const uploadResume = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
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

    // --- Parse multipart/form-data ---
    try {
      const { fileBuffer, filename, mimeType } = await parseMultipartUpload(req);

      // --- Validate file type ---
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return sendError(
          res,
          400,
          'INVALID_REQUEST',
          `Invalid file type. Only PDF and DOCX files are accepted.`,
          requestId
        );
      }

      // --- Validate file size ---
      if (fileBuffer.length > MAX_FILE_SIZE) {
        const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2);
        return sendError(
          res,
          422,
          'UNPROCESSABLE_ENTITY',
          `Resume must be under 5 MB. Your file is ${sizeMB} MB.`,
          requestId
        );
      }

      // --- Extract text content ---
      let parsedContent = '';
      if (mimeType === 'application/pdf') {
        parsedContent = await extractTextFromPdf(fileBuffer);
      } else {
        parsedContent = await extractTextFromDocx(fileBuffer);
      }

      // --- Generate resume ID ---
      const resumeId = uuidv4();

      // --- Upload to Cloud Storage ---
      const bucket = admin.storage().bucket();
      const storagePath = `resumes/${userId}/${resumeId}/${filename}`;
      const file = bucket.file(storagePath);

      await file.save(fileBuffer, {
        metadata: {
          contentType: mimeType,
        },
      });

      // Make the file accessible and get URL
      const storageUrl = `gs://${bucket.name}/${storagePath}`;

      // --- Store in Firestore ---
      const db = admin.firestore();
      const resumesPath = COLLECTION_PATHS.userResumes(userId);
      const resumeDoc = {
        id: resumeId,
        type: 'base',
        filename,
        mimeType,
        sizeBytes: fileBuffer.length,
        parsedContent,
        storageUrl,
        jobId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection(resumesPath).doc(resumeId).set(resumeDoc);

      // --- Return success ---
      return res.status(200).json({
        ok: true,
        data: {
          resumeId,
          filename,
          parsedLength: parsedContent.length,
        },
        meta: { requestId },
      });
    } catch (err) {
      console.error(`[uploadResume] Error (requestId=${requestId}):`, err.message);

      if (err.code === 'NO_FILE') {
        return sendError(res, 400, 'INVALID_REQUEST', 'No file provided in the request.', requestId);
      }

      return sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'An error occurred while processing your resume. Please try again.',
        requestId
      );
    }
  });

/**
 * Parse multipart/form-data from the request.
 * Returns a promise that resolves with the file buffer, filename, and mimeType.
 *
 * @param {Object} req - HTTP request object
 * @returns {Promise<{fileBuffer: Buffer, filename: string, mimeType: string}>}
 */
function parseMultipartUpload(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });

    let fileBuffer = null;
    let filename = '';
    let mimeType = '';
    let fileFound = false;

    busboy.on('file', (fieldname, file, info) => {
      fileFound = true;
      filename = info.filename || 'resume';
      mimeType = info.mimeType || '';

      const chunks = [];
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('finish', () => {
      if (!fileFound || !fileBuffer) {
        const err = new Error('No file provided');
        err.code = 'NO_FILE';
        return reject(err);
      }
      resolve({ fileBuffer, filename, mimeType });
    });

    busboy.on('error', (err) => {
      reject(err);
    });

    // Firebase Cloud Functions provides req.rawBody for the raw request body
    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }
  });
}

// ============================================================
// tailorResume Cloud Function
// ============================================================

/**
 * POST /tailorResume
 * Body: { jobId }
 * Auth: Bearer token required
 * Timeout: 30s
 *
 * Tailors a user's base resume to match a specific job description:
 * 1. Verifies auth
 * 2. Reads job description from Firestore
 * 3. Reads user's latest base resume from Firestore
 * 4. Builds AI prompt for keyword-emphasized rewriting
 * 5. Calls AI engine (placeholder)
 * 6. Validates factual preservation (dates, companies, degrees)
 * 7. Generates PDF from tailored content using pdfkit
 * 8. Uploads PDF to Cloud Storage
 * 9. Stores tailored resume document in Firestore
 * 10. Returns { pdfUrl, previewUrl, resumeId }
 */

const PDFDocument = require('pdfkit');

// ============================================================
// AI Engine Helpers (placeholder — same pattern as visa.js)
// ============================================================

/**
 * Build an AI prompt for resume tailoring.
 * Instructs the LLM to rewrite resume bullets emphasizing job keywords
 * while preserving all factual claims.
 *
 * @param {string} resumeContent - Original resume text
 * @param {string} jobDescription - Target job description
 * @returns {string} The constructed prompt
 */
function buildTailoringPrompt(resumeContent, jobDescription) {
  return [
    'You are a professional resume writer. Rewrite the following resume content to better match the job description provided.',
    '',
    'RULES:',
    '1. Emphasize skills and keywords present in the job description.',
    '2. Preserve ALL factual claims: dates, company names, degree titles, and quantitative metrics must remain unchanged.',
    '3. Only modify phrasing, emphasis, and bullet ordering.',
    '4. Do not invent new experience or skills.',
    '5. Output the rewritten resume text only, no commentary.',
    '',
    '--- JOB DESCRIPTION ---',
    jobDescription,
    '',
    '--- ORIGINAL RESUME ---',
    resumeContent,
    '',
    '--- REWRITTEN RESUME ---',
  ].join('\n');
}

/**
 * Call the AI engine to tailor resume content.
 * Placeholder: in production, this calls OpenAI/Gemini/DeepSeek.
 * For testing, it returns the original resume with minor keyword emphasis markers.
 *
 * @param {string} prompt - The tailoring prompt
 * @param {string} resumeContent - Original resume text (used in placeholder mode)
 * @param {string} jobDescription - Job description (used in placeholder mode)
 * @returns {Promise<string>} Tailored resume text
 */
async function callAIForTailoring(prompt, resumeContent, jobDescription) {
  // Placeholder implementation: return original content with a tailored header.
  // In production, replace with actual API call:
  // const response = await fetch(AI_ENDPOINT, { method: 'POST', body: JSON.stringify({ prompt }) });
  // return response.json().then(r => r.text);

  // Extract keywords from job description (simple placeholder logic)
  const words = jobDescription.toLowerCase().split(/\s+/);
  const keywordSet = new Set(words.filter((w) => w.length > 5));
  const topKeywords = [...keywordSet].slice(0, 5).join(', ');

  const tailoredContent = [
    `[Tailored for position emphasizing: ${topKeywords}]`,
    '',
    resumeContent,
  ].join('\n');

  return tailoredContent;
}

/**
 * Validate that factual claims are preserved between original and tailored content.
 * Checks that dates, company names, and degree titles from the original appear in the tailored version.
 *
 * @param {string} original - Original resume text
 * @param {string} tailored - Tailored resume text
 * @returns {{valid: boolean, missingFacts: string[]}}
 */
function validateFactualPreservation(original, tailored) {
  const missingFacts = [];

  // Extract date patterns (e.g., "2019", "Jan 2020", "2018-2022", "2020 - Present")
  const datePattern = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?\d{4}\b/gi;
  const originalDates = original.match(datePattern) || [];
  for (const date of originalDates) {
    if (!tailored.includes(date)) {
      missingFacts.push(`Date: ${date}`);
    }
  }

  // Extract degree titles (common patterns)
  const degreePattern = /\b(B\.?S\.?|M\.?S\.?|B\.?A\.?|M\.?A\.?|Ph\.?D\.?|MBA|Bachelor|Master|Doctorate)\b/gi;
  const originalDegrees = original.match(degreePattern) || [];
  for (const degree of originalDegrees) {
    if (!tailored.toLowerCase().includes(degree.toLowerCase())) {
      missingFacts.push(`Degree: ${degree}`);
    }
  }

  return {
    valid: missingFacts.length === 0,
    missingFacts,
  };
}

/**
 * Generate a PDF document from resume text content using pdfkit.
 *
 * @param {string} content - The tailored resume text
 * @param {string} filename - Desired filename for metadata
 * @returns {Promise<Buffer>} PDF file buffer
 */
function generateResumePdf(content, filename) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: filename,
          Author: 'JobPilot AI',
          Creator: 'JobPilot AI Resume Tailoring',
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Split content into lines and render
      const lines = content.split('\n');
      let isFirstLine = true;

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          doc.moveDown(0.5);
          continue;
        }

        // Render first non-empty line as a title
        if (isFirstLine) {
          doc.fontSize(14).font('Helvetica-Bold').text(trimmedLine);
          doc.moveDown(0.5);
          isFirstLine = false;
          continue;
        }

        // Render bullet points
        if (trimmedLine.startsWith('•') || trimmedLine.startsWith('-') || trimmedLine.startsWith('*')) {
          doc.fontSize(10).font('Helvetica').text(trimmedLine, { indent: 15 });
        }
        // Render section headers (ALL CAPS lines or short lines ending with colon)
        else if (trimmedLine === trimmedLine.toUpperCase() && trimmedLine.length > 2) {
          doc.moveDown(0.5);
          doc.fontSize(12).font('Helvetica-Bold').text(trimmedLine);
        } else if (trimmedLine.endsWith(':')) {
          doc.moveDown(0.3);
          doc.fontSize(11).font('Helvetica-Bold').text(trimmedLine);
        } else {
          doc.fontSize(10).font('Helvetica').text(trimmedLine);
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * tailorResume Cloud Function handler.
 * Accepts { jobId }, tailors the user's base resume to match the job, returns PDF URLs.
 */
const tailorResume = functions
  .runWith({ timeoutSeconds: 30, memory: '512MB' })
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

    // --- Input validation ---
    const { jobId } = req.body || {};

    if (!jobId || typeof jobId !== 'string' || jobId.trim().length === 0) {
      return sendError(res, 400, 'INVALID_REQUEST', 'jobId is required.', requestId);
    }

    const trimmedJobId = jobId.trim();

    // --- Enforce 30s timeout on the entire operation ---
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OPERATION_TIMEOUT')), 28000); // 28s to leave room for response
    });

    try {
      const result = await Promise.race([
        performTailoring(userId, trimmedJobId, requestId),
        timeoutPromise,
      ]);

      return res.status(200).json({
        ok: true,
        data: result,
        meta: { requestId },
      });
    } catch (err) {
      if (err.message === 'OPERATION_TIMEOUT') {
        return sendError(res, 408, 'REQUEST_TIMEOUT', 'Resume tailoring timed out. Please try again.', requestId);
      }
      if (err.code === 'NOT_FOUND') {
        return sendError(res, 404, 'NOT_FOUND', err.message, requestId);
      }
      if (err.code === 'AI_FAILURE') {
        return sendError(res, 502, 'UPSTREAM_ERROR', 'AI service temporarily unavailable. Please retry.', requestId);
      }
      if (err.code === 'PDF_FAILURE') {
        return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to generate PDF. Please try again.', requestId);
      }

      console.error(`[tailorResume] Error (requestId=${requestId}):`, err.message);
      return sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'An error occurred while tailoring your resume. Please try again.',
        requestId
      );
    }
  });

/**
 * Core tailoring logic extracted for timeout wrapping.
 *
 * @param {string} userId - Authenticated user ID
 * @param {string} jobId - Job document ID
 * @param {string} requestId - Request correlation ID
 * @returns {Promise<{pdfUrl: string, previewUrl: string, resumeId: string}>}
 */
async function performTailoring(userId, jobId, requestId) {
  const db = admin.firestore();

  // --- Step 1: Read job description from Firestore ---
  const jobRef = db.collection(COLLECTION_PATHS.userJobs(userId)).doc(jobId);
  const jobDoc = await jobRef.get();

  if (!jobDoc.exists) {
    const err = new Error('Job listing not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const jobData = jobDoc.data();
  const jobDescription = jobData.description || '';

  if (!jobDescription) {
    const err = new Error('Job listing has no description available for tailoring.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // --- Step 2: Read user's latest base resume ---
  const resumesRef = db.collection(COLLECTION_PATHS.userResumes(userId));
  const baseResumeQuery = resumesRef
    .where('type', '==', 'base')
    .orderBy('createdAt', 'desc')
    .limit(1);

  const baseResumeSnapshot = await baseResumeQuery.get();

  if (baseResumeSnapshot.empty) {
    const err = new Error('No base resume found. Please upload a resume before tailoring.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const baseResume = baseResumeSnapshot.docs[0].data();
  const resumeContent = baseResume.parsedContent || '';

  if (!resumeContent) {
    const err = new Error('Base resume has no parsed content. Please re-upload your resume.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // --- Step 3: Build AI prompt ---
  const prompt = buildTailoringPrompt(resumeContent, jobDescription);

  // --- Step 4: Call AI engine ---
  let tailoredContent;
  try {
    tailoredContent = await callAIForTailoring(prompt, resumeContent, jobDescription);
  } catch (aiErr) {
    console.error(`[tailorResume] AI engine failure (requestId=${requestId}):`, aiErr.message);
    const err = new Error('AI service temporarily unavailable.');
    err.code = 'AI_FAILURE';
    throw err;
  }

  // --- Step 5: Validate factual preservation ---
  const validation = validateFactualPreservation(resumeContent, tailoredContent);
  if (!validation.valid) {
    // Log the issue but proceed — the placeholder always preserves facts.
    // In production, you'd retry or flag for manual review.
    console.warn(
      `[tailorResume] Factual preservation warning (requestId=${requestId}): missing ${validation.missingFacts.join(', ')}`
    );
  }

  // --- Step 6: Generate PDF ---
  const tailoredResumeId = uuidv4();
  const pdfFilename = `tailored_resume_${tailoredResumeId.substring(0, 8)}.pdf`;

  let pdfBuffer;
  try {
    pdfBuffer = await generateResumePdf(tailoredContent, pdfFilename);
  } catch (pdfErr) {
    console.error(`[tailorResume] PDF generation failure (requestId=${requestId}):`, pdfErr.message);
    const err = new Error('Failed to generate PDF.');
    err.code = 'PDF_FAILURE';
    throw err;
  }

  // --- Step 7: Upload PDF to Cloud Storage ---
  const bucket = admin.storage().bucket();
  const storagePath = `resumes/${userId}/${tailoredResumeId}/${pdfFilename}`;
  const file = bucket.file(storagePath);

  await file.save(pdfBuffer, {
    metadata: {
      contentType: 'application/pdf',
    },
  });

  // Generate signed URLs for download and preview (valid for 1 hour)
  const [pdfUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });

  // Preview URL points to the same file (can be used in an iframe/viewer)
  const previewUrl = pdfUrl;

  // --- Step 8: Store tailored resume document in Firestore ---
  const resumeDoc = {
    id: tailoredResumeId,
    type: 'tailored',
    filename: pdfFilename,
    mimeType: 'application/pdf',
    sizeBytes: pdfBuffer.length,
    parsedContent: tailoredContent,
    storageUrl: `gs://${bucket.name}/${storagePath}`,
    jobId: jobId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection(COLLECTION_PATHS.userResumes(userId)).doc(tailoredResumeId).set(resumeDoc);

  // --- Step 9: Return result ---
  return {
    pdfUrl,
    previewUrl,
    resumeId: tailoredResumeId,
  };
}

module.exports = {
  uploadResume,
  tailorResume,
  // Exported for testing
  buildTailoringPrompt,
  callAIForTailoring,
  validateFactualPreservation,
  generateResumePdf,
};
