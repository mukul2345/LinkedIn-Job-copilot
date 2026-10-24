// Regression tests for centralized HTTP retry behavior.

const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/core/runtime-config.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/message-protocol.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/api-client.js'));
});

beforeEach(() => {
  resetChromeMocks();
  global.auth = {
    currentUser: {
      getIdToken: jest.fn().mockResolvedValue('firebase-id-token'),
    },
  };
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.auth;
  delete global.fetch;
  jest.restoreAllMocks();
});

describe('callBackend retry policy', () => {
  it('does not retry an unauthorized response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Sign in again.' },
        meta: { requestId: 'request-1' },
      }),
    });

    await expect(callBackend('searchJobs', {})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a configured service-unavailable response once', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: jest.fn().mockResolvedValue({
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Try later.' },
          meta: { requestId: 'request-2' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true, data: { jobs: [] } }),
      });

    const response = await callBackend('searchJobs', {}, { backoffMs: [0] });

    expect(response).toEqual({ jobs: [] });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a validation response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid search.' },
      }),
    });

    await expect(callBackend('searchJobs', {})).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
