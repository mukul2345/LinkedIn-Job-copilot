/**
 * Shared AI Engine Client
 *
 * Provides a unified interface for calling AI providers (OpenAI, Gemini, DeepSeek).
 * All three use OpenAI-compatible API format with different base URLs.
 *
 * Configuration via environment variables:
 *   AI_PROVIDER   - "openai" | "gemini" | "deepseek" (default: "openai")
 *   AI_API_KEY      - Shared key used by the selected OpenAI/Gemini provider
 *   OPENAI_API_KEY  - Optional OpenAI-specific override
 *   GEMINI_API_KEY  - Optional Gemini-specific override
 *   DEEPSEEK_API_KEY - API key for DeepSeek
 *
 * Usage:
 *   const { callAI } = require('./lib/ai-client');
 *   const result = await callAI('Summarize this text...', { model: 'gpt-4o-mini' });
 */

const PROVIDER_CONFIG = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    getApiKey: () => process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    getApiKey: () => process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    getApiKey: () => process.env.DEEPSEEK_API_KEY || '',
  },
};

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Get the active provider configuration.
 * @returns {{ baseUrl: string, defaultModel: string, getApiKey: () => string }}
 */
function getProviderConfig() {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    throw new AIClientError(
      'INVALID_PROVIDER',
      `Unknown AI provider: "${provider}". Supported: openai, gemini, deepseek`
    );
  }
  return config;
}

/**
 * Call the configured AI provider with a prompt.
 *
 * @param {string} prompt - The user prompt to send
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.model] - Override the default model
 * @param {string} [options.systemPrompt] - System message (prepended)
 * @param {number} [options.timeoutMs] - Request timeout in ms (default: 10000)
 * @param {number} [options.temperature] - Sampling temperature (default: 0.3)
 * @param {number} [options.maxTokens] - Max output tokens (default: 1024)
 * @param {boolean} [options.jsonMode] - Request JSON output format
 * @returns {Promise<{ text: string, parsed: Object|null, usage: Object|null }>}
 * @throws {AIClientError} On timeout, auth failure, or upstream error
 */
async function callAI(prompt, options = {}) {
  const config = getProviderConfig();
  const apiKey = config.getApiKey();

  if (!apiKey) {
    throw new AIClientError(
      'MISSING_API_KEY',
      `No API key configured for provider "${process.env.AI_PROVIDER || 'openai'}". Set the appropriate environment variable.`
    );
  }

  const model = options.model || config.defaultModel;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens || 1024;

  const messages = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (options.jsonMode) {
    requestBody.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new AIClientError(
        'UPSTREAM_ERROR',
        `AI provider returned ${response.status}: ${errorBody.substring(0, 200)}`
      );
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content || '';

    // Attempt JSON parsing if jsonMode was requested
    let parsed = null;
    if (options.jsonMode) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Response wasn't valid JSON despite jsonMode request
        parsed = null;
      }
    }

    return {
      text,
      parsed,
      usage: result.usage || null,
    };
  } catch (error) {
    if (error instanceof AIClientError) throw error;

    if (error.name === 'AbortError') {
      throw new AIClientError(
        'TIMEOUT',
        `AI request timed out after ${timeoutMs}ms`
      );
    }

    throw new AIClientError(
      'NETWORK_ERROR',
      `Failed to reach AI provider: ${error.message}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Structured error class for AI client failures.
 */
class AIClientError extends Error {
  /**
   * @param {string} code - Error code (TIMEOUT, MISSING_API_KEY, UPSTREAM_ERROR, NETWORK_ERROR, INVALID_PROVIDER)
   * @param {string} message - Human-readable error description
   */
  constructor(code, message) {
    super(message);
    this.name = 'AIClientError';
    this.code = code;
  }
}

module.exports = {
  callAI,
  AIClientError,
  PROVIDER_CONFIG,
  getProviderConfig,
  DEFAULT_TIMEOUT_MS,
};
