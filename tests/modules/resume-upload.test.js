// tests/modules/resume-upload.test.js - Unit tests for uploadResume Cloud Function

/**
 * Tests the resume upload validation and parsing logic.
 * Uses virtual mocks for Firebase and other dependencies.
 *
 * Strategy: The busboy mock's `end()` method triggers file events,
 * simulating how busboy processes rawBody data.
 */

// Test configuration for what the next busboy instance should emit
let nextBusboyFileConfig = null;

jest.mock('firebase-functions', () => ({
  runWith: () => ({
    https: {
      onRequest: (handler) => handler,
    },
  }),
}), { virtual: true });

const mockVerifyIdToken = jest.fn();
const mockBucketFile = jest.fn();
const mockFileSave = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockCollection = jest.fn();

jest.mock('firebase-admin', () => {
  const admin = {
    apps: [{}],
    initializeApp: jest.fn(),
    auth: () => ({ verifyIdToken: mockVerifyIdToken }),
    storage: () => ({
      bucket: () => ({
        name: 'test-bucket',
        file: (filePath) => {
          mockBucketFile(filePath);
          return { save: mockFileSave };
        },
      }),
    }),
    firestore: () => ({
      collection: (collPath) => {
        mockCollection(collPath);
        return {
          doc: () => ({
            set: mockDocSet,
          }),
        };
      },
    }),
  };
  admin.firestore.FieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  };
  return admin;
}, { virtual: true });

jest.mock('uuid', () => ({
  v4: () => 'test-resume-id-1234',
}), { virtual: true });

jest.mock('pdf-parse', () => jest.fn().mockResolvedValue({ text: 'Parsed PDF content here' }), { virtual: true });

jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'Parsed DOCX content here' }),
}), { virtual: true });

jest.mock('busboy', () => {
  const EventEmitter = require('events');
  return jest.fn().mockImplementation(() => {
    const busboy = new EventEmitter();
    // When end() is called, emit events based on the test config
    busboy.end = jest.fn().mockImplementation(() => {
      // Access config via the module-level reference trick
      const config = require('busboy').__nextFileConfig;
      if (config && config.filename) {
        const stream = new EventEmitter();
        busboy.emit('file', 'file', stream, {
          filename: config.filename,
          mimeType: config.mimeType,
        });
        stream.emit('data', config.buffer);
        stream.emit('end');
      }
      busboy.emit('finish');
    });
    return busboy;
  });
}, { virtual: true });

const { uploadResume } = require('../../functions/resume');
const Busboy = require('busboy');

// Helper to configure what the next busboy instance will emit
function configureBusboyFile(filename, mimeType, buffer) {
  Busboy.__nextFileConfig = { filename, mimeType, buffer };
}

function configureBusboyNoFile() {
  Busboy.__nextFileConfig = null;
}

// Helper to create mock request/response
function createMockReq({ method = 'POST', headers = {}, rawBody = null } = {}) {
  return {
    method,
    headers: {
      'content-type': 'multipart/form-data; boundary=---boundary',
      authorization: 'Bearer valid-token',
      ...headers,
    },
    rawBody,
    pipe: jest.fn(),
  };
}

function createMockRes() {
  const res = {
    _status: null,
    _json: null,
    _sent: null,
    _headers: {},
    status(code) {
      res._status = code;
      return res;
    },
    json(data) {
      res._json = data;
      return res;
    },
    send(data) {
      res._sent = data;
      return res;
    },
    set(key, value) {
      res._headers[key] = value;
      return res;
    },
  };
  return res;
}

describe('uploadResume Cloud Function', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockBucketFile.mockReset();
    mockFileSave.mockReset().mockResolvedValue();
    mockDocSet.mockReset().mockResolvedValue();
    mockCollection.mockReset();
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-123' });
    Busboy.__nextFileConfig = null;
  });

  describe('CORS and method handling', () => {
    it('handles OPTIONS preflight with 204', async () => {
      const req = createMockReq({ method: 'OPTIONS' });
      const res = createMockRes();
      await uploadResume(req, res);
      expect(res._status).toBe(204);
      expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('rejects non-POST methods', async () => {
      const req = createMockReq({ method: 'GET' });
      const res = createMockRes();
      await uploadResume(req, res);
      expect(res._status).toBe(405);
      expect(res._json.ok).toBe(false);
      expect(res._json.error.code).toBe('INVALID_REQUEST');
    });

    it('sets x-request-id from header on POST requests', async () => {
      const req = createMockReq({
        headers: { 'x-request-id': 'custom-req-id' },
      });
      delete req.headers.authorization;
      const res = createMockRes();
      await uploadResume(req, res);
      expect(res._headers['x-request-id']).toBe('custom-req-id');
    });
  });

  describe('authentication', () => {
    it('rejects requests without Authorization header', async () => {
      const req = createMockReq();
      delete req.headers.authorization;
      const res = createMockRes();
      await uploadResume(req, res);
      expect(res._status).toBe(401);
      expect(res._json.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid Bearer token', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));
      const req = createMockReq({ headers: { authorization: 'Bearer bad-token' } });
      const res = createMockRes();
      await uploadResume(req, res);
      expect(res._status).toBe(401);
      expect(res._json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('file validation', () => {
    it('rejects invalid file types', async () => {
      configureBusboyFile('resume.txt', 'text/plain', Buffer.from('hello'));
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._status).toBe(400);
      expect(res._json.error.code).toBe('INVALID_REQUEST');
      expect(res._json.error.message).toContain('Only PDF and DOCX');
    });

    it('rejects files exceeding 5 MB', async () => {
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024); // 6 MB
      configureBusboyFile('resume.pdf', 'application/pdf', largeBuffer);
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._status).toBe(422);
      expect(res._json.error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(res._json.error.message).toContain('Resume must be under 5 MB');
    });

    it('provides exact file size in error message for oversized files', async () => {
      const largeBuffer = Buffer.alloc(7.5 * 1024 * 1024);
      configureBusboyFile('resume.pdf', 'application/pdf', largeBuffer);
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._status).toBe(422);
      expect(res._json.error.message).toBe('Resume must be under 5 MB. Your file is 7.50 MB.');
    });

    it('accepts PDF files within size limit', async () => {
      const pdfBuffer = Buffer.alloc(1024);
      configureBusboyFile('resume.pdf', 'application/pdf', pdfBuffer);
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._status).toBe(200);
      expect(res._json.ok).toBe(true);
    });

    it('accepts DOCX files within size limit', async () => {
      const docxBuffer = Buffer.alloc(2048);
      configureBusboyFile(
        'resume.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docxBuffer
      );
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._status).toBe(200);
      expect(res._json.ok).toBe(true);
    });
  });

  describe('successful upload - PDF', () => {
    it('processes a valid PDF file and returns success', async () => {
      const pdfBuffer = Buffer.from('fake pdf content');
      configureBusboyFile('my-resume.pdf', 'application/pdf', pdfBuffer);
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._status).toBe(200);
      expect(res._json.ok).toBe(true);
      expect(res._json.data.resumeId).toBe('test-resume-id-1234');
      expect(res._json.data.filename).toBe('my-resume.pdf');
      expect(res._json.data.parsedLength).toBe('Parsed PDF content here'.length);
      expect(res._json.meta.requestId).toBeDefined();
    });

    it('stores file in Cloud Storage at correct path', async () => {
      const pdfBuffer = Buffer.from('fake pdf');
      configureBusboyFile('resume.pdf', 'application/pdf', pdfBuffer);
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(mockBucketFile).toHaveBeenCalledWith('resumes/user-123/test-resume-id-1234/resume.pdf');
      expect(mockFileSave).toHaveBeenCalledWith(pdfBuffer, {
        metadata: { contentType: 'application/pdf' },
      });
    });

    it('stores resume document in Firestore with correct schema', async () => {
      const pdfBuffer = Buffer.from('fake pdf');
      configureBusboyFile('resume.pdf', 'application/pdf', pdfBuffer);
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(mockCollection).toHaveBeenCalledWith('users/user-123/resumes');
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-resume-id-1234',
          type: 'base',
          filename: 'resume.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          parsedContent: 'Parsed PDF content here',
          storageUrl: 'gs://test-bucket/resumes/user-123/test-resume-id-1234/resume.pdf',
          jobId: null,
          createdAt: 'SERVER_TIMESTAMP',
        })
      );
    });
  });

  describe('successful upload - DOCX', () => {
    it('processes a valid DOCX file and returns success', async () => {
      const docxBuffer = Buffer.from('fake docx content');
      configureBusboyFile(
        'resume.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docxBuffer
      );
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._status).toBe(200);
      expect(res._json.ok).toBe(true);
      expect(res._json.data.filename).toBe('resume.docx');
      expect(res._json.data.parsedLength).toBe('Parsed DOCX content here'.length);
    });
  });

  describe('error handling', () => {
    it('returns error when no file is provided', async () => {
      configureBusboyNoFile(); // No file configured = finish without file event
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      // Suppress expected console.error for this test
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await uploadResume(req, res);
      spy.mockRestore();

      expect(res._status).toBe(400);
      expect(res._json.error.code).toBe('INVALID_REQUEST');
      expect(res._json.error.message).toContain('No file provided');
    });
  });

  describe('response contract', () => {
    it('follows { ok, data, meta } structure on success', async () => {
      configureBusboyFile('resume.pdf', 'application/pdf', Buffer.from('pdf'));
      const req = createMockReq({ rawBody: Buffer.from('fake') });
      const res = createMockRes();

      await uploadResume(req, res);

      expect(res._json).toHaveProperty('ok', true);
      expect(res._json).toHaveProperty('data');
      expect(res._json).toHaveProperty('meta');
      expect(res._json.data).toHaveProperty('resumeId');
      expect(res._json.data).toHaveProperty('filename');
      expect(res._json.data).toHaveProperty('parsedLength');
      expect(res._json.meta).toHaveProperty('requestId');
    });

    it('follows { ok, error, meta } structure on error', async () => {
      const req = createMockReq({ method: 'GET' });
      const res = createMockRes();
      await uploadResume(req, res);

      expect(res._json).toHaveProperty('ok', false);
      expect(res._json).toHaveProperty('error');
      expect(res._json.error).toHaveProperty('code');
      expect(res._json.error).toHaveProperty('message');
      expect(res._json).toHaveProperty('meta');
      expect(res._json.meta).toHaveProperty('requestId');
    });
  });
});
