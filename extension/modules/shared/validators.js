// validators.js - Input validation functions for JobPilot Enhanced Features
// Validates search input, resume files, and fit score thresholds.

/**
 * Valid job board identifiers supported by the scraping service.
 */
// Boards supported by the deployed python-jobspy scraper.
// eslint-disable-next-line no-var
var VALID_BOARDS = ['linkedin', 'indeed', 'glassdoor'];

/**
 * Maximum resume file size in bytes (5 MB).
 */
// eslint-disable-next-line no-var
var MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Accepted MIME types for resume uploads.
 */
// eslint-disable-next-line no-var
var VALID_RESUME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * Validate search input before sending to backend.
 * Checks query length (2-200 chars) and board selection (at least one valid board).
 *
 * @param {string} query - Search query string
 * @param {string[]} boards - Selected board identifiers
 * @returns {{valid: boolean, error?: string}}
 */
function validateSearchInput(query, boards) {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Search query is required.' };
  }

  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return { valid: false, error: 'Search query must be at least 2 characters.' };
  }

  if (trimmed.length > 200) {
    return { valid: false, error: 'Search query must be 200 characters or less.' };
  }

  if (!Array.isArray(boards) || boards.length === 0) {
    return { valid: false, error: 'Please select at least one job board.' };
  }

  const invalidBoard = boards.find(b => !VALID_BOARDS.includes(b));
  if (invalidBoard) {
    return { valid: false, error: `Unknown board: ${invalidBoard}` };
  }

  return { valid: true };
}

/**
 * Validate a resume file before upload.
 * Checks MIME type (PDF or DOCX) and file size (max 5 MB).
 *
 * @param {File} file - The file to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateResumeFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }

  if (!VALID_RESUME_TYPES.includes(file.type)) {
    return { valid: false, error: 'Resume must be a PDF or DOCX file.' };
  }

  if (file.size > MAX_RESUME_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return { valid: false, error: `Resume must be under 5 MB. Your file is ${sizeMB} MB.` };
  }

  return { valid: true };
}

/**
 * Validate and normalize a fit score threshold value.
 * Clamps to integer in range [0, 100]. Non-numeric values default to 0.
 *
 * @param {*} value - Raw threshold value (could be string, float, or invalid)
 * @returns {number} - Valid integer between 0 and 100 inclusive
 */
function validateFitScoreThreshold(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}
