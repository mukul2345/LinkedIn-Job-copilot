// tests/modules/resume-tailor.test.js - Unit tests for tailorResume Cloud Function

/**
 * Tests the resume tailoring logic:
 * - Auth validation
 * - Input validation
 * - Job description and base resume fetching
 * - AI prompt building
 * - Factual preservation validation
 * - PDF generation
 * - Response contract
 */

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
const mockGetSignedUrl = jest.fn().mockResolvedValue(['https://storage.example.com/signed-pdf-url']);
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn();
const mockCollection = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();
const mockQueryGet = jest.fn();

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
          return {
            save: mockFileSave,
            getSignedUrl: mockGetSignedUrl,
          };
        },
      }),
    }),
    firestore: () => ({
      collection: (collPath) => {
        mockCollection(collPath);
        return {
          doc: (docId) => ({
            set: mockDocSet,
            get: mockDocGet,
          }),
          where: (...args) => {
            mockWhere(...args);
            return {
              orderBy: (...oArgs) => {
                mockOrderBy(...oArgs);
                return {
                  limit: (n) => {
                    mockLimit(n);
                    return { get: mockQueryGet };
                  },
                };
              },
            };
          },
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
  v4: () => 'tailored-resume-id-5678',
}), { virtual: true });

jest.mock('pdf-parse', () => jest.fn().mockResolvedValue({ text: 'Parsed PDF content' }), { virtual: true });
jest.mock('mammoth', () => ({ extractRawText: jest.fn() }), { virtual: true });
jest.mock('busboy', () => jest.fn(), { virtual: true });

// pdfkit mock - returns a simple buffer
jest.mock('pdfkit', () => {
  const EventEmitter = require('events');
  return jest.fn().mockImplementation(() => {
    const doc = new EventEmitter();
    doc.fontSize = jest.fn().mockReturnThis();
    doc.font = jest.fn().mockReturnThis();
    doc.text = jest.fn().mockReturnThis();
    doc.moveDown = jest.fn().mockReturnThis();
    doc.end = jest.fn().mockImplementation(() => {
      // Emit a chunk then end
      process.nextTick(() => {
        doc.emit('data', Buffer.from('fake-pdf-bytes'));
        doc.emit('end');
      });
    });
    return doc;
  });
}, { virtual: true });

const {
  tailorResume,
  buildTailoringPrompt,
  validateFactualPreservation,
} = require('../../functions/resume');

// Helper to create mock request/response
function createMockReq({ method = 'POST', headers = {}, body = {} } = {}) {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer valid-token',
      ...headers,
    },
    body,
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

describe('tailorResume Cloud Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-123' });

    // Default: job exists with a description
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'job-abc',
        title: 'Senior Backend Developer',
        company: 'TechCorp',
        description: 'We need an experienced Python developer with Django and AWS expertise. Must have 5+ years of experience building scalable microservices.',
      }),
    });

    // Default: base resume exists
    mockQueryGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({
          id: 'base-resume-001',
          type: 'base',
          parsedContent: 'John Doe\nSoftware Engineer at Google (2019-2023)\n• Built microservices using Python and Java\n• Led team of 5 engineers\nEducation: B.S. Computer Science, MIT 2018',
          filename: 'resume.pdf',
        }),
      }],
    });
  });

  describe('CORS and method handling', () => {
    it('handles OPTIONS preflight with 204', async () => {
      const req = createMockReq({ method: 'OPTIONS' });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(204);
      expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('rejects non-POST methods', async () => {
      const req = createMockReq({ method: 'GET' });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(405);
      expect(res._json.ok).toBe(false);
      expect(res._json.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('authentication', () => {
    it('rejects requests without Authorization header', async () => {
      const req = createMockReq({ headers: { authorization: undefined } });
      delete req.headers.authorization;
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(401);
      expect(res._json.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid Bearer token', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));
      const req = createMockReq({ headers: { authorization: 'Bearer bad-token' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(401);
      expect(res._json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('input validation', () => {
    it('rejects missing jobId', async () => {
      const req = createMockReq({ body: {} });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error.code).toBe('INVALID_REQUEST');
      expect(res._json.error.message).toContain('jobId');
    });

    it('rejects empty string jobId', async () => {
      const req = createMockReq({ body: { jobId: '   ' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects non-string jobId', async () => {
      const req = createMockReq({ body: { jobId: 12345 } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(400);
      expect(res._json.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('job lookup', () => {
    it('returns 404 when job does not exist', async () => {
      mockDocGet.mockResolvedValue({ exists: false });
      const req = createMockReq({ body: { jobId: 'nonexistent-job' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(404);
      expect(res._json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when job has no description', async () => {
      mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ id: 'job-abc', description: '' }),
      });
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(404);
      expect(res._json.error.code).toBe('NOT_FOUND');
    });
  });

  describe('base resume lookup', () => {
    it('returns 404 when no base resume exists', async () => {
      mockQueryGet.mockResolvedValue({ empty: true, docs: [] });
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(404);
      expect(res._json.error.code).toBe('NOT_FOUND');
      expect(res._json.error.message).toContain('base resume');
    });

    it('returns 404 when base resume has no parsed content', async () => {
      mockQueryGet.mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ type: 'base', parsedContent: '' }) }],
      });
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(404);
      expect(res._json.error.code).toBe('NOT_FOUND');
    });

    it('queries for latest base resume ordered by createdAt desc', async () => {
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(mockWhere).toHaveBeenCalledWith('type', '==', 'base');
      expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
      expect(mockLimit).toHaveBeenCalledWith(1);
    });
  });

  describe('successful tailoring', () => {
    it('returns pdfUrl, previewUrl, and resumeId on success', async () => {
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._status).toBe(200);
      expect(res._json.ok).toBe(true);
      expect(res._json.data.pdfUrl).toBe('https://storage.example.com/signed-pdf-url');
      expect(res._json.data.previewUrl).toBeDefined();
      expect(res._json.data.resumeId).toBe('tailored-resume-id-5678');
    });

    it('stores tailored resume in Firestore with type "tailored"', async () => {
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);

      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tailored-resume-id-5678',
          type: 'tailored',
          mimeType: 'application/pdf',
          jobId: 'job-abc',
          createdAt: 'SERVER_TIMESTAMP',
        })
      );
    });

    it('uploads PDF to Cloud Storage at correct path', async () => {
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);

      expect(mockBucketFile).toHaveBeenCalledWith(
        expect.stringContaining('resumes/user-123/tailored-resume-id-5678/')
      );
      expect(mockFileSave).toHaveBeenCalledWith(
        expect.any(Buffer),
        { metadata: { contentType: 'application/pdf' } }
      );
    });
  });

  describe('response contract', () => {
    it('follows { ok, data, meta } structure on success', async () => {
      const req = createMockReq({ body: { jobId: 'job-abc' } });
      const res = createMockRes();
      await tailorResume(req, res);

      expect(res._json).toHaveProperty('ok', true);
      expect(res._json).toHaveProperty('data');
      expect(res._json).toHaveProperty('meta');
      expect(res._json.data).toHaveProperty('pdfUrl');
      expect(res._json.data).toHaveProperty('previewUrl');
      expect(res._json.data).toHaveProperty('resumeId');
      expect(res._json.meta).toHaveProperty('requestId');
    });

    it('follows { ok, error, meta } structure on error', async () => {
      const req = createMockReq({ body: {} });
      const res = createMockRes();
      await tailorResume(req, res);

      expect(res._json).toHaveProperty('ok', false);
      expect(res._json).toHaveProperty('error');
      expect(res._json.error).toHaveProperty('code');
      expect(res._json.error).toHaveProperty('message');
      expect(res._json).toHaveProperty('meta');
      expect(res._json.meta).toHaveProperty('requestId');
    });

    it('sets x-request-id header from inbound request', async () => {
      const req = createMockReq({
        body: { jobId: 'job-abc' },
        headers: { 'x-request-id': 'custom-req-id' },
      });
      const res = createMockRes();
      await tailorResume(req, res);
      expect(res._headers['x-request-id']).toBe('custom-req-id');
    });
  });
});

describe('buildTailoringPrompt', () => {
  it('includes job description and resume content in the prompt', () => {
    const prompt = buildTailoringPrompt('My resume text', 'Job description text');
    expect(prompt).toContain('Job description text');
    expect(prompt).toContain('My resume text');
  });

  it('includes instructions to preserve factual claims', () => {
    const prompt = buildTailoringPrompt('Resume', 'Job desc');
    expect(prompt).toContain('factual');
    expect(prompt).toContain('dates');
    expect(prompt).toContain('company names');
    expect(prompt).toContain('degree titles');
  });

  it('includes instructions to emphasize keywords', () => {
    const prompt = buildTailoringPrompt('Resume', 'Job desc');
    expect(prompt).toContain('keywords');
  });
});

describe('validateFactualPreservation', () => {
  it('returns valid when all facts are preserved', () => {
    const original = 'Worked at Google 2019-2023. B.S. in CS.';
    const tailored = 'Senior role at Google 2019-2023. Holds B.S. in CS.';
    const result = validateFactualPreservation(original, tailored);
    expect(result.valid).toBe(true);
    expect(result.missingFacts).toHaveLength(0);
  });

  it('detects missing dates', () => {
    const original = 'Worked at Google 2019-2023.';
    const tailored = 'Worked at Google for several years.';
    const result = validateFactualPreservation(original, tailored);
    expect(result.valid).toBe(false);
    expect(result.missingFacts.some((f) => f.includes('2019'))).toBe(true);
  });

  it('detects missing degree titles', () => {
    const original = 'Education: MBA from Stanford';
    const tailored = 'Education: degree from Stanford';
    const result = validateFactualPreservation(original, tailored);
    expect(result.valid).toBe(false);
    expect(result.missingFacts.some((f) => f.includes('MBA'))).toBe(true);
  });

  it('handles content with no extractable facts', () => {
    const original = 'Built scalable systems and led teams.';
    const tailored = 'Developed scalable architectures and managed teams.';
    const result = validateFactualPreservation(original, tailored);
    expect(result.valid).toBe(true);
  });
});
