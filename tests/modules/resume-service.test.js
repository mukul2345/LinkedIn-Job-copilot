// tests/modules/resume-service.test.js - Unit tests for resume-service.js

const { loadFile } = require('../helpers/load-modules');
const path = require('path');

beforeAll(() => {
  // Load dependencies first (validators provides validateResumeFile, api-client provides ApiError, callBackend, getAuthToken, generateRequestId, API_BASE_URL)
  loadFile(path.resolve(__dirname, '../../extension/core/runtime-config.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/message-protocol.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/validators.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/api-client.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/resume/resume-service.js'));
});

beforeEach(() => {
  global.resetChromeMocks();
  // Reset internal resume state between tests
  global._resumeState = { uploading: false, tailoring: false, error: null };
});

// ===== getResumeState() =====
describe('getResumeState()', () => {
  it('returns initial state with no operations in progress', () => {
    const state = getResumeState();
    expect(state).toEqual({ uploading: false, tailoring: false, error: null });
  });

  it('returns a copy, not a reference to internal state', () => {
    const state1 = getResumeState();
    state1.uploading = true;
    const state2 = getResumeState();
    expect(state2.uploading).toBe(false);
  });
});

// ===== uploadBaseResume() =====
describe('uploadBaseResume()', () => {
  let mockFetch;

  beforeEach(() => {
    // Mock fetch for upload (resume uses fetch directly, not callBackend)
    mockFetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: {} }),
    });
    global.fetch = mockFetch;

    // Mock getAuthToken to return a valid token
    global.getAuthToken = jest.fn().mockResolvedValue('valid-token-123');
  });

  afterEach(() => {
    delete global.fetch;
    delete global.getAuthToken;
  });

  it('rejects when no file is provided', async () => {
    const result = await uploadBaseResume(null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No file selected');
  });

  it('rejects files with invalid MIME type', async () => {
    const file = { name: 'resume.txt', type: 'text/plain', size: 1024 };
    const result = await uploadBaseResume(file);
    expect(result.success).toBe(false);
    expect(result.error).toContain('PDF or DOCX');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects files exceeding 5 MB', async () => {
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 };
    const result = await uploadBaseResume(file);
    expect(result.success).toBe(false);
    expect(result.error).toContain('under 5 MB');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sets error state on validation failure', async () => {
    const file = { name: 'resume.txt', type: 'text/plain', size: 1024 };
    await uploadBaseResume(file);
    const state = getResumeState();
    expect(state.error).toContain('PDF or DOCX');
    expect(state.uploading).toBe(false);
  });

  it('returns error when not signed in', async () => {
    global.getAuthToken = jest.fn().mockResolvedValue(null);
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 1024 };
    const result = await uploadBaseResume(file);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not signed in');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uploads valid PDF via fetch with multipart/form-data', async () => {
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 2048 };
    const result = await uploadBaseResume(file);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/uploadResume');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer valid-token-123');
    expect(options.headers['x-request-id']).toBeDefined();
    // Should NOT set Content-Type (browser sets it with boundary for FormData)
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);
  });

  it('uploads valid DOCX file successfully', async () => {
    const file = {
      name: 'resume.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 3000,
    };
    const result = await uploadBaseResume(file);
    expect(result.success).toBe(true);
  });

  it('marks base resume as uploaded in chrome.storage.local on success', async () => {
    const file = { name: 'my-resume.pdf', type: 'application/pdf', size: 1024 };
    await uploadBaseResume(file);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { hasBaseResume: true, baseResumeFilename: 'my-resume.pdf' },
      expect.any(Function)
    );
  });

  it('returns error on backend failure response', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({
        ok: false,
        error: { code: 'UNPROCESSABLE_ENTITY', message: 'File corrupt' },
      }),
    });
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 1024 };
    const result = await uploadBaseResume(file);
    expect(result.success).toBe(false);
    expect(result.error).toBe('File corrupt');
  });

  it('returns network error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 1024 };
    const result = await uploadBaseResume(file);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unable to upload');
  });

  it('sets uploading state during upload', async () => {
    // Use a delayed fetch to capture state mid-flight
    let capturedState;
    mockFetch.mockImplementation(() => {
      capturedState = getResumeState();
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: {} }) });
    });

    const file = { name: 'resume.pdf', type: 'application/pdf', size: 1024 };
    await uploadBaseResume(file);

    expect(capturedState.uploading).toBe(true);
    // After completion, uploading should be false
    expect(getResumeState().uploading).toBe(false);
  });

  it('clears error state on successful upload', async () => {
    // First, trigger an error
    global._resumeState.error = 'Previous error';
    const file = { name: 'resume.pdf', type: 'application/pdf', size: 1024 };
    await uploadBaseResume(file);
    expect(getResumeState().error).toBeNull();
  });
});

// ===== tailorResumeForJob() =====
describe('tailorResumeForJob()', () => {
  let mockCallBackend;

  beforeEach(() => {
    mockCallBackend = jest.fn().mockResolvedValue({
      pdfUrl: 'https://storage.example.com/resume.pdf',
      previewUrl: 'https://storage.example.com/preview.png',
    });
    global.callBackend = mockCallBackend;

    // Set up base resume as existing
    global.setMockStorageData({ hasBaseResume: true });
  });

  afterEach(() => {
    delete global.callBackend;
  });

  it('throws ApiError when no base resume exists', async () => {
    global.resetChromeMocks(); // Clear hasBaseResume
    await expect(tailorResumeForJob('job-123')).rejects.toMatchObject({
      code: 'NO_BASE_RESUME',
    });
  });

  it('sets error state when no base resume exists', async () => {
    global.resetChromeMocks();
    try { await tailorResumeForJob('job-123'); } catch (e) { /* expected */ }
    const state = getResumeState();
    expect(state.error).toContain('No base resume');
  });

  it('calls backend with correct endpoint and jobId', async () => {
    await tailorResumeForJob('job-456');
    expect(mockCallBackend).toHaveBeenCalledWith('tailorResume', { jobId: 'job-456' });
  });

  it('returns pdfUrl and previewUrl on success', async () => {
    const result = await tailorResumeForJob('job-789');
    expect(result.pdfUrl).toBe('https://storage.example.com/resume.pdf');
    expect(result.previewUrl).toBe('https://storage.example.com/preview.png');
  });

  it('sets tailoring state during request', async () => {
    let capturedState;
    mockCallBackend.mockImplementation(() => {
      capturedState = getResumeState();
      return Promise.resolve({ pdfUrl: 'url', previewUrl: 'url' });
    });

    await tailorResumeForJob('job-123');

    expect(capturedState.tailoring).toBe(true);
    expect(getResumeState().tailoring).toBe(false);
  });

  it('clears tailoring state and sets error on UPSTREAM_ERROR', async () => {
    const err = new ApiError('UPSTREAM_ERROR', 'AI engine down');
    mockCallBackend.mockRejectedValue(err);

    await expect(tailorResumeForJob('job-123')).rejects.toThrow();

    const state = getResumeState();
    expect(state.tailoring).toBe(false);
    expect(state.error).toBe('AI service temporarily unavailable. Please retry.');
  });

  it('maps PDF_GENERATION_FAILED to user-friendly message', async () => {
    const err = new ApiError('PDF_GENERATION_FAILED', 'pdfkit crashed');
    mockCallBackend.mockRejectedValue(err);

    await expect(tailorResumeForJob('job-123')).rejects.toThrow();

    const state = getResumeState();
    expect(state.error).toBe('PDF generation failed. Please retry.');
  });

  it('uses error message for unknown error codes', async () => {
    const err = new ApiError('UNKNOWN_ERROR', 'Something went wrong');
    mockCallBackend.mockRejectedValue(err);

    await expect(tailorResumeForJob('job-123')).rejects.toThrow();

    const state = getResumeState();
    expect(state.error).toBe('Something went wrong');
  });

  it('clears error on successful tailoring', async () => {
    global._resumeState.error = 'Previous failure';
    await tailorResumeForJob('job-123');
    expect(getResumeState().error).toBeNull();
  });
});

// ===== retryTailorResume() =====
describe('retryTailorResume()', () => {
  let mockCallBackend;

  beforeEach(() => {
    mockCallBackend = jest.fn().mockResolvedValue({
      pdfUrl: 'https://storage.example.com/retry.pdf',
      previewUrl: 'https://storage.example.com/retry-preview.png',
    });
    global.callBackend = mockCallBackend;
    global.setMockStorageData({ hasBaseResume: true });
  });

  afterEach(() => {
    delete global.callBackend;
  });

  it('clears error state before retrying', async () => {
    global._resumeState.error = 'AI service temporarily unavailable. Please retry.';
    await retryTailorResume('job-123');
    expect(getResumeState().error).toBeNull();
  });

  it('calls tailorResumeForJob with the same jobId', async () => {
    await retryTailorResume('job-abc');
    expect(mockCallBackend).toHaveBeenCalledWith('tailorResume', { jobId: 'job-abc' });
  });

  it('returns result on successful retry', async () => {
    const result = await retryTailorResume('job-123');
    expect(result.pdfUrl).toBe('https://storage.example.com/retry.pdf');
    expect(result.previewUrl).toBe('https://storage.example.com/retry-preview.png');
  });
});

// ===== hasBaseResume() =====
describe('hasBaseResume()', () => {
  it('returns true when hasBaseResume flag is set', async () => {
    global.setMockStorageData({ hasBaseResume: true });
    const result = await hasBaseResume();
    expect(result).toBe(true);
  });

  it('returns false when hasBaseResume flag is not set', async () => {
    const result = await hasBaseResume();
    expect(result).toBe(false);
  });

  it('returns false when hasBaseResume is explicitly false', async () => {
    global.setMockStorageData({ hasBaseResume: false });
    const result = await hasBaseResume();
    expect(result).toBe(false);
  });

  it('returns false when hasBaseResume is a truthy non-boolean', async () => {
    global.setMockStorageData({ hasBaseResume: 'yes' });
    const result = await hasBaseResume();
    expect(result).toBe(false);
  });
});

// ===== setBaseResumeUploaded() =====
describe('setBaseResumeUploaded()', () => {
  it('stores hasBaseResume flag and filename', async () => {
    await setBaseResumeUploaded('my-resume.pdf');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { hasBaseResume: true, baseResumeFilename: 'my-resume.pdf' },
      expect.any(Function)
    );
  });
});
