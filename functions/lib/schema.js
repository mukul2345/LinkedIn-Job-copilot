/**
 * Firestore Data Model Schema Documentation
 *
 * This file documents the expected Firestore document shapes for the
 * JobPilot Enhanced Features. These are JSDoc type definitions used as
 * developer reference — they are not enforced at runtime but serve as
 * the canonical source of truth for collection structures.
 */

// ============================================================
// Collection: users/{userId}/jobs/{jobId}
// Purpose: Normalized job records from multi-board search
// ============================================================

/**
 * @typedef {Object} JobDocument
 * @property {string} id - Deterministic identity derived from platform job ID or canonical URL
 * @property {1} schemaVersion - Canonical job schema version
 * @property {'linkedin'|'indeed'|'glassdoor'} platform - Supported source platform
 * @property {string|null} platformJobId - Platform-owned posting ID when available
 * @property {string} title - Job title
 * @property {string|null} company - Company name when supplied by the board
 * @property {string|null} location - Job location when supplied by the board
 * @property {string|null} description - Full job description text
 * @property {{minimum:number,maximum:number,currency:string|null,text:string}|null} salary - Parsed salary range
 * @property {string} url - Valid canonical HTTPS listing URL
 * @property {string} canonicalUrl - URL used for deterministic identity and deduplication
 * @property {string|null} employmentType - Board-provided employment type
 * @property {string|null} remoteType - Board-provided remote/on-site type
 * @property {string[]} requiredSkills - Explicitly extracted required skills
 * @property {string[]} preferredSkills - Explicitly extracted preferred skills
 * @property {Object} metadata - Non-canonical source details, including original salary text
 * @property {string} sourceBoard - Backward-compatible alias of platform
 * @property {string|null} postedAt - ISO posting timestamp
 * @property {string|null} postedDate - Backward-compatible alias of postedAt
 * @property {{platform:string,url:string}[]} sourceListings - High-confidence duplicate sources only
 * @property {{score:number,recommendation:string,matchedSkills:string[],missingSkills:string[],reasons:string[]}|null} match - Validated AI match result
 * @property {'DIRECT_APPLY'|'EXTERNAL_APPLY'|'UNSUPPORTED'|'REQUIRES_USER'} applicationCapability - Truthful application routing capability
 */

// ============================================================
// Extension-local application lifecycle (chrome.storage.local)
// Key: applicationStatesV1[jobId]
// ============================================================

/**
 * @typedef {Object} ApplicationStateRecord
 * @property {1} version
 * @property {string} jobId
 * @property {'linkedin'|'indeed'|'glassdoor'} platform
 * @property {'DISCOVERED'|'ANALYZING'|'MATCHED'|'SKIPPED'|'READY'|'APPLYING'|'NEEDS_USER_INPUT'|'EXTERNAL_APPLICATION'|'SUBMITTED'|'FAILED'} state
 * @property {string|null} attemptId - Stable application attempt/idempotency key
 * @property {string|null} receiptId - Provider receipt required for confirmed submission
 * @property {boolean} confirmed - Whether the provider explicitly confirmed submission
 * @property {string[]} reasonCodes
 * @property {string} updatedAt - ISO timestamp
 */

// ============================================================
// Collection: users/{userId}/resumes/{resumeId}
// Purpose: Base and tailored resume documents
// ============================================================

/**
 * @typedef {Object} ResumeDocument
 * @property {string} id - Unique resume document ID
 * @property {'base'|'tailored'} type - Whether this is the original upload or a tailored version
 * @property {string} filename - Original filename (e.g. "resume.pdf")
 * @property {'application/pdf'|'application/vnd.openxmlformats-officedocument.wordprocessingml.document'} mimeType - File MIME type
 * @property {number} sizeBytes - File size in bytes
 * @property {string} parsedContent - Extracted text content from the resume
 * @property {string} storageUrl - Cloud Storage path/URL for the file
 * @property {string|null} jobId - null for base resumes, jobId for tailored versions
 * @property {FirebaseFirestore.Timestamp} createdAt - When this resume was uploaded/generated
 */

// ============================================================
// Collection: users/{userId}/tracker/{entryId}
// Purpose: Application status entries detected from Gmail scanning
// ============================================================

/**
 * @typedef {Object} TrackerDocument
 * @property {string} id - Unique tracker entry ID
 * @property {string} company - Extracted company name, or "Unknown Company" if not extractable
 * @property {'interview'|'rejection'|'offer'|'unknown'} status - Detected application status
 * @property {string} emailSubject - Subject line of the detected email
 * @property {FirebaseFirestore.Timestamp} emailDate - When the email was received
 * @property {string} emailSnippet - First 200 characters of the email body
 * @property {boolean} dismissed - Whether the user dismissed this entry
 * @property {string|null} manualCorrection - User-corrected status, null if not corrected
 * @property {FirebaseFirestore.Timestamp} detectedAt - When the tracker identified this email
 */

// ============================================================
// Collection: users/{userId}/tokens/gmail
// Purpose: Gmail OAuth tokens (server-side access only)
// ============================================================

/**
 * @typedef {Object} GmailTokenDocument
 * @property {string} accessToken - OAuth 2.0 access token (encrypted at rest)
 * @property {string} refreshToken - OAuth 2.0 refresh token (encrypted at rest)
 * @property {FirebaseFirestore.Timestamp} expiresAt - When the access token expires
 * @property {string[]} scopes - Granted OAuth scopes (e.g. ["gmail.readonly"])
 * @property {FirebaseFirestore.Timestamp} connectedAt - When the user first connected Gmail
 * @property {FirebaseFirestore.Timestamp|null} lastScanAt - Last successful inbox scan time, null if never scanned
 */

// ============================================================
// Collection: users/{userId}/settings/profile (extended)
// Purpose: User profile with scoring-related fields
// ============================================================

/**
 * @typedef {Object} UserProfileDocument
 * @property {string} firstName - User's first name
 * @property {string} lastName - User's last name
 * @property {string[]} skills - List of user skills (used for fit scoring)
 * @property {string} educationLevel - Highest education level (e.g. "bachelor", "master", "phd")
 * @property {string[]} preferredLocations - Preferred work locations for scoring
 * @property {number} salaryMin - Minimum acceptable salary
 * @property {number} salaryMax - Maximum acceptable salary
 * @property {string} salaryCurrency - Currency code for salary (e.g. "USD", "INR", "EUR")
 */

// ============================================================
// Exports (for programmatic reference in Cloud Functions)
// ============================================================

/**
 * Default/empty document shapes for reference and initialization.
 */
const SCHEMA_DEFAULTS = {
  job: {
    id: '',
    schemaVersion: 1,
    platform: '',
    platformJobId: null,
    title: '',
    company: null,
    location: null,
    description: null,
    salary: null,
    url: '',
    canonicalUrl: '',
    employmentType: null,
    remoteType: null,
    requiredSkills: [],
    preferredSkills: [],
    metadata: {},
    sourceBoard: '',
    postedAt: null,
    postedDate: null,
    sourceListings: [],
    match: null,
    applicationCapability: 'UNSUPPORTED',
  },

  resume: {
    id: '',
    type: 'base',
    filename: '',
    mimeType: 'application/pdf',
    sizeBytes: 0,
    parsedContent: '',
    storageUrl: '',
    jobId: null,
    createdAt: null,
  },

  tracker: {
    id: '',
    company: '',
    status: 'unknown',
    emailSubject: '',
    emailDate: null,
    emailSnippet: '',
    dismissed: false,
    manualCorrection: null,
    detectedAt: null,
  },

  gmailToken: {
    accessToken: '',
    refreshToken: '',
    expiresAt: null,
    scopes: [],
    connectedAt: null,
    lastScanAt: null,
  },

  profileScoringFields: {
    skills: [],
    educationLevel: '',
    preferredLocations: [],
    salaryMin: 0,
    salaryMax: 0,
    salaryCurrency: 'USD',
  },
};

/**
 * Collection path helpers for consistent path construction.
 */
const COLLECTION_PATHS = {
  userJobs: (userId) => `users/${userId}/jobs`,
  userResumes: (userId) => `users/${userId}/resumes`,
  userTracker: (userId) => `users/${userId}/tracker`,
  userTokens: (userId) => `users/${userId}/tokens`,
  userProfile: (userId) => `users/${userId}/settings/profile`,
  userSearchSessions: (userId) => `users/${userId}/searchSessions`,
  userApplications: (userId) => `users/${userId}/applications`,
};

module.exports = {
  SCHEMA_DEFAULTS,
  COLLECTION_PATHS,
};
