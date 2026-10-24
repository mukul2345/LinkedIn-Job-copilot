// ai-provider.js - Backend-only AI provider contract for extension contexts.

/** Abstract AI provider contract. */
// eslint-disable-next-line no-var
var AIProvider = (function () {
  function AIProvider() {
    if (new.target === AIProvider) throw new TypeError('AIProvider is abstract.');
  }
  /** Generate a structured draft from explicitly supplied facts. */
  AIProvider.prototype.generate = function () {
    throw new Error('AIProvider.generate must be implemented.');
  };
  return AIProvider;
})();

/**
 * OpenAI-backed provider facade. The provider key remains in Cloud Functions;
 * this class only invokes the authenticated extension backend.
 */
// eslint-disable-next-line no-var
var OpenAIProvider = (function () {
  function OpenAIProvider(backendCall) {
    this.backendCall = backendCall || callBackend;
  }
  OpenAIProvider.prototype = Object.create(AIProvider.prototype);
  OpenAIProvider.prototype.constructor = OpenAIProvider;

  OpenAIProvider.prototype.generate = async function (request) {
    if (!request || !['form_answer', 'cover_letter'].includes(request.kind)) {
      throw new ValidationExtensionError({ message: 'A supported AI assistance kind is required.' });
    }
    try {
      const response = await this.backendCall('generateAiAssistance', request);
      if (!response || response.status !== 'DRAFT' || typeof response.text !== 'string') {
        throw new MalformedResponseExtensionError({ message: 'AI backend returned an invalid structured response.' });
      }
      return Object.freeze({ status: response.status, text: response.text.trim() });
    } catch (error) {
      if (error instanceof ExtensionError) throw error;
      if (error?.code === 'MISSING_API_KEY' || error?.code === 'AI_NOT_CONFIGURED') {
        throw new ValidationExtensionError({ code: 'AI_NOT_CONFIGURED', message: 'AI assistance is not configured on the backend.', cause: error });
      }
      if (error?.status === 401 || error?.code === 'UNAUTHORIZED') {
        throw new AuthenticationExtensionError({ message: 'Sign in to use AI assistance.', cause: error });
      }
      if (error?.status === 429 || error?.code === 'RATE_LIMITED') {
        throw new RateLimitExtensionError({ message: 'AI assistance is temporarily rate limited.', cause: error, status: 429 });
      }
      if (error?.code === 'TIMEOUT') {
        throw new TimeoutExtensionError({ message: 'AI backend request timed out.', cause: error });
      }
      if (error?.code === 'MALFORMED_RESPONSE') {
        throw new MalformedResponseExtensionError({ message: 'AI backend returned malformed data.', cause: error });
      }
      throw new NetworkExtensionError({ message: 'AI backend is unavailable.', cause: error });
    }
  };
  return OpenAIProvider;
})();
