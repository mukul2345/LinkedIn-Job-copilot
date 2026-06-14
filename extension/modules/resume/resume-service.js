// resume-service.js - Resume upload and AI tailoring module for JobPilot Enhanced Features
// Handles base resume upload (multipart/form-data via fetch), AI-powered tailoring requests,
// progress state management, and retry logic.

/**
 * Internal state for resume operations.
 * Tracks upload/tailoring progress and any error encountered.
 */
// eslint-disable-next-line no-var
var _resumeState = {
  uploading: false,
  tailoring: false,
  error: null,
};

/**
 * Get the current resume operation state.
 * Returns an object indicating whether an upload or tailoring is in progress,
 * and any error message from the last failed operation.
 *
 * @returns {{uploading: boolean, tailoring: boolean, error: string|null}}
 */
function getResumeState() {
  return {
    uploading: _resumeState.uploading,
    tailoring: _resumeState.tailoring,
    error: _resumeState.error,
  };
}

/**
 * Upload a base resume file (PDF/DOCX, max 5 MB).
 * Validates the file locally using validateResumeFile(), then uploads via
 * fetch with multipart/form-data directly (not callBackend, which uses JSON).
 *
 * @param {File} file - The resume file to upload
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function uploadBaseResume(file) {
  // Validate file locally first
  var validation = validateResumeFile(file);
  if (!validation.valid) {
    _resumeState.error = validation.error;
    return { success: false, error: validation.error };
  }

  _resumeState.uploading = true;
  _resumeState.error = null;

  try {
    var token = await getAuthToken();
    if (!token) {
      var authErr = 'Not signed in. Please log in to continue.';
      _resumeState.uploading = false;
      _resumeState.error = authErr;
      return { success: false, error: authErr };
    }

    var formData = new FormData();
    formData.append('file', file);

    var response = await fetch(API_BASE_URL + '/uploadResume', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'x-request-id': generateRequestId(),
      },
      body: formData,
    });

    var result = await response.json();

    if (!result.ok) {
      var errorMessage = (result.error && result.error.message) || 'Upload failed. Please try again.';
      _resumeState.uploading = false;
      _resumeState.error = errorMessage;
      return { success: false, error: errorMessage };
    }

    // Mark base resume as uploaded in chrome.storage.local
    await setBaseResumeUploaded(file.name);

    _resumeState.uploading = false;
    _resumeState.error = null;
    return { success: true };
  } catch (err) {
    var networkErr = 'Unable to upload resume. Check your connection.';
    _resumeState.uploading = false;
    _resumeState.error = networkErr;
    return { success: false, error: networkErr };
  }
}

/**
 * Request an AI-tailored resume for a specific job.
 * Calls the backend 'tailorResume' endpoint and manages progress state.
 * Requires a base resume to already be uploaded.
 *
 * @param {string} jobId - The Job_Record ID to tailor for
 * @returns {Promise<{pdfUrl: string, previewUrl: string}>}
 * @throws {ApiError} On backend failure
 */
async function tailorResumeForJob(jobId) {
  // Check if base resume exists before attempting tailoring
  var hasResume = await hasBaseResume();
  if (!hasResume) {
    var noResumeErr = 'No base resume found. Please upload your resume before tailoring.';
    _resumeState.error = noResumeErr;
    throw new ApiError('NO_BASE_RESUME', noResumeErr);
  }

  _resumeState.tailoring = true;
  _resumeState.error = null;

  try {
    var result = await callBackend('tailorResume', { jobId: jobId });

    _resumeState.tailoring = false;
    _resumeState.error = null;
    return result;
  } catch (err) {
    _resumeState.tailoring = false;

    // Map error codes to user-friendly messages
    var errorMsg;
    if (err && err.code === 'UPSTREAM_ERROR') {
      errorMsg = 'AI service temporarily unavailable. Please retry.';
    } else if (err && err.code === 'PDF_GENERATION_FAILED') {
      errorMsg = 'PDF generation failed. Please retry.';
    } else if (err && err.message) {
      errorMsg = err.message;
    } else {
      errorMsg = 'Resume tailoring failed. Please try again.';
    }

    _resumeState.error = errorMsg;
    throw err;
  }
}

/**
 * Retry a failed tailoring request for a specific job.
 * Clears the previous error state and re-invokes tailorResumeForJob.
 *
 * @param {string} jobId - The Job_Record ID to retry tailoring for
 * @returns {Promise<{pdfUrl: string, previewUrl: string}>}
 * @throws {ApiError} On backend failure
 */
async function retryTailorResume(jobId) {
  _resumeState.error = null;
  return tailorResumeForJob(jobId);
}

/**
 * Check if a base resume has been uploaded.
 * Reads the 'hasBaseResume' flag from chrome.storage.local.
 *
 * @returns {Promise<boolean>}
 */
async function hasBaseResume() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['hasBaseResume'], function (data) {
      resolve(data.hasBaseResume === true);
    });
  });
}

/**
 * Mark that a base resume has been uploaded successfully.
 * Stores the hasBaseResume flag and the filename in chrome.storage.local.
 *
 * @param {string} filename - The name of the uploaded resume file
 * @returns {Promise<void>}
 */
async function setBaseResumeUploaded(filename) {
  return new Promise(function (resolve) {
    chrome.storage.local.set(
      {
        hasBaseResume: true,
        baseResumeFilename: filename,
      },
      function () {
        resolve();
      }
    );
  });
}
