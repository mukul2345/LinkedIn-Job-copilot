const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/errors.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/ai/ai-provider.js'));
});

function providerRejecting(error) {
  return new OpenAIProvider(jest.fn().mockRejectedValue(error));
}

describe('OpenAIProvider backend proxy', () => {
  it('returns a valid structured draft without accepting a provider key', async () => {
    const backend = jest.fn().mockResolvedValue({ status: 'DRAFT', text: ' Draft ' });
    const provider = new OpenAIProvider(backend);
    await expect(provider.generate({ kind: 'form_answer', candidateFacts: {} }))
      .resolves.toEqual({ status: 'DRAFT', text: 'Draft' });
    expect(backend).toHaveBeenCalledWith('generateAiAssistance', expect.not.objectContaining({ apiKey: expect.anything() }));
  });

  it.each([
    [{ code: 'MISSING_API_KEY' }, 'AI_NOT_CONFIGURED'],
    [{ code: 'UNAUTHORIZED', status: 401 }, 'UNAUTHORIZED'],
    [{ code: 'RATE_LIMITED', status: 429 }, 'RATE_LIMITED'],
    [{ code: 'TIMEOUT' }, 'TIMEOUT'],
    [{ code: 'NETWORK_ERROR' }, 'NETWORK_ERROR'],
    [{ code: 'MALFORMED_RESPONSE' }, 'MALFORMED_RESPONSE'],
  ])('maps backend error %#', async (sourceError, expectedCode) => {
    await expect(providerRejecting(sourceError).generate({ kind: 'cover_letter' }))
      .rejects.toMatchObject({ code: expectedCode });
  });

  it('rejects malformed successful responses', async () => {
    const provider = new OpenAIProvider(jest.fn().mockResolvedValue({ status: 'DRAFT' }));
    await expect(provider.generate({ kind: 'form_answer' }))
      .rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });
});
