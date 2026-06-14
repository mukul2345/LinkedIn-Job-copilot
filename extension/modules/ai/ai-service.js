// ai-service.js - Client-side AI service for form answering and message generation
// Connects to user-configured AI provider (OpenAI, local LLM, etc.)
// Used when useAI is enabled in settings to provide smarter form answers.

/**
 * Internal state for AI service availability.
 */
// eslint-disable-next-line no-var
var _aiServiceReady = false;

/**
 * Check if AI service is configured and available.
 * @returns {Promise<boolean>}
 */
async function isAIServiceAvailable() {
  const config = await new Promise(resolve => {
    chrome.storage.local.get(['useAI', 'aiApiUrl', 'aiApiKey', 'aiModel', 'aiProvider'], resolve);
  });

  if (!config.useAI) return false;
  if (!config.aiApiUrl && config.aiProvider !== 'gemini') return false;
  if (!config.aiModel) return false;

  _aiServiceReady = true;
  return true;
}

/**
 * Generate an AI-powered answer for a form question.
 * Falls back to null if AI is unavailable or fails — caller should use default answer.
 *
 * @param {string} question - The form question text
 * @param {string} jobTitle - Title of the job being applied to
 * @param {string} company - Company name
 * @param {object} config - User configuration with profile data
 * @returns {Promise<string|null>} AI-generated answer or null on failure
 */
async function getAIFormAnswer(question, jobTitle, company, config) {
  if (!_aiServiceReady) {
    const available = await isAIServiceAvailable();
    if (!available) return null;
  }

  try {
    const prompt = buildFormAnswerPrompt(question, jobTitle, company, config);
    const response = await callAIProvider(prompt, config);
    return response ? response.trim() : null;
  } catch (err) {
    console.warn('[JobPilot AI] Form answer generation failed:', err.message);
    return null;
  }
}

/**
 * Generate an AI-powered cover letter for a specific job.
 *
 * @param {string} jobTitle - Title of the job
 * @param {string} company - Company name
 * @param {string} jobDescription - Job description text
 * @param {object} config - User configuration with profile data
 * @returns {Promise<string|null>} Generated cover letter or null on failure
 */
async function getAICoverLetter(jobTitle, company, jobDescription, config) {
  if (!_aiServiceReady) {
    const available = await isAIServiceAvailable();
    if (!available) return null;
  }

  try {
    const prompt = buildCoverLetterPrompt(jobTitle, company, jobDescription, config);
    const response = await callAIProvider(prompt, config);
    return response ? response.trim() : null;
  } catch (err) {
    console.warn('[JobPilot AI] Cover letter generation failed:', err.message);
    return null;
  }
}

/**
 * Generate an AI-powered recruiter message.
 *
 * @param {string} recruiterName - Name of the recruiter
 * @param {string} jobTitle - Title of the job
 * @param {string} company - Company name
 * @param {object} config - User configuration
 * @returns {Promise<string|null>} Generated message or null on failure
 */
async function getAIRecruiterMessage(recruiterName, jobTitle, company, config) {
  if (!_aiServiceReady) {
    const available = await isAIServiceAvailable();
    if (!available) return null;
  }

  try {
    const myName = [config.firstName, config.lastName].filter(Boolean).join(' ');
    const headline = config.linkedinHeadline || 'software development';
    const experience = config.yearsOfExperience || '3';

    const prompt = `Generate a short, professional LinkedIn message (under 300 characters) from ${myName} to ${recruiterName} about the ${jobTitle} role at ${company}. I have ${experience}+ years in ${headline}. Keep it warm, brief, and professional. No subject line needed. Just the message body.`;

    const response = await callAIProvider(prompt, config);
    return response ? response.trim() : null;
  } catch (err) {
    console.warn('[JobPilot AI] Recruiter message generation failed:', err.message);
    return null;
  }
}

/**
 * Call the configured AI provider with a prompt.
 *
 * @param {string} prompt - The prompt to send
 * @param {object} config - User config with AI settings
 * @returns {Promise<string|null>} AI response text or null
 */
async function callAIProvider(prompt, config) {
  const provider = config.aiProvider || 'openai';
  const apiUrl = config.aiApiUrl || '';
  const apiKey = config.aiApiKey || '';
  const model = config.aiModel || 'gpt-3.5-turbo';

  if (provider === 'gemini') {
    return await callGeminiAPI(prompt, apiKey, model);
  }

  // OpenAI-compatible API (OpenAI, local LLMs, DeepSeek, etc.)
  return await callOpenAICompatibleAPI(prompt, apiUrl, apiKey, model);
}

/**
 * Call an OpenAI-compatible chat completions API.
 */
async function callOpenAICompatibleAPI(prompt, apiUrl, apiKey, model) {
  const url = apiUrl.endsWith('/') ? `${apiUrl}chat/completions` : `${apiUrl}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey !== 'not-needed' && apiKey !== '') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that answers job application form questions concisely and professionally. Answer in the shortest possible way that is truthful and appropriate.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API returned ${response.status}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || null;
}

/**
 * Call the Google Gemini API.
 */
async function callGeminiAPI(prompt, apiKey, model) {
  const geminiModel = model || 'gemini-pro';
  const url = `https://generativelanguage.googleapis.com/v1/models/${geminiModel}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}`);
  }

  const result = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

/**
 * Build a prompt for answering a form question.
 */
function buildFormAnswerPrompt(question, jobTitle, company, config) {
  const myName = [config.firstName, config.lastName].filter(Boolean).join(' ');
  const experience = config.yearsOfExperience || '3';
  const headline = config.linkedinHeadline || '';

  return `I'm applying for the "${jobTitle}" role at ${company}. My name is ${myName}, I have ${experience} years of experience${headline ? ' in ' + headline : ''}.

The application form asks: "${question}"

Provide a brief, professional answer (1-2 sentences max). If it's a yes/no question, just answer yes or no. If it asks for a number, just give the number.`;
}

/**
 * Build a prompt for generating a cover letter.
 */
function buildCoverLetterPrompt(jobTitle, company, jobDescription, config) {
  const myName = [config.firstName, config.lastName].filter(Boolean).join(' ');
  const experience = config.yearsOfExperience || '3';
  const headline = config.linkedinHeadline || 'software development';
  const summary = config.linkedinSummary || '';

  const descSnippet = jobDescription ? jobDescription.substring(0, 500) : '';

  return `Write a concise, professional cover letter (150-200 words) for:
- Position: ${jobTitle} at ${company}
- Candidate: ${myName}, ${experience} years in ${headline}
${summary ? '- About me: ' + summary.substring(0, 200) : ''}
${descSnippet ? '- Job description excerpt: ' + descSnippet : ''}

Requirements: Be specific, mention the company name, highlight relevant experience. No placeholder text. Professional tone.`;
}
