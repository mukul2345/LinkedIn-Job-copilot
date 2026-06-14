// job-board-helper.js - Floating "Score & Tailor" button for non-LinkedIn job boards
// Injects on: Naukri, Indeed, Glassdoor, Workday, Lever, Greenhouse, SmartRecruiters, Wellfound
// Extracts job description from the current page and sends to AI for scoring/tailoring.

(function () {
  'use strict';

  // Don't run if already injected
  if (document.getElementById('jp-job-helper-fab')) return;

  // Create floating action button
  const fab = document.createElement('div');
  fab.id = 'jp-job-helper-fab';
  fab.innerHTML = '⚡';
  fab.title = 'JobPilot AI — Score this job';
  document.body.appendChild(fab);

  // Create the panel (hidden initially)
  const panel = document.createElement('div');
  panel.id = 'jp-job-helper-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="jp-panel-header">
      <span>⚡ JobPilot AI</span>
      <button id="jp-panel-close">✕</button>
    </div>
    <div class="jp-panel-body">
      <p class="jp-hint">Extract job description from this page and get your fit score + tailored resume.</p>
      <button id="jp-extract-btn" class="jp-btn jp-btn-primary">🔍 Analyze This Job</button>
      <div id="jp-result" style="display:none;">
        <div id="jp-score-display"></div>
        <div id="jp-explanation"></div>
        <button id="jp-tailor-btn" class="jp-btn jp-btn-secondary" style="display:none;">✨ Tailor My Resume</button>
      </div>
      <div id="jp-loading" style="display:none;">
        <div class="jp-spinner"></div>
        <p>Analyzing job description...</p>
      </div>
      <div id="jp-error" style="display:none;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // Toggle panel on FAB click
  fab.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // Close panel
  document.getElementById('jp-panel-close').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // Extract and analyze
  document.getElementById('jp-extract-btn').addEventListener('click', analyzeJob);

  /**
   * Extract job description from the current page based on the site.
   */
  function extractJobDescription() {
    const hostname = window.location.hostname;

    // Site-specific selectors for job description
    const selectors = {
      'naukri.com': ['.styles_JDC__dang-inner-html__h0K4t', '.job-desc', '#job-desc-container', '.dang-inner-html'],
      'indeed.com': ['#jobDescriptionText', '.jobsearch-JobComponent-description', '[class*="jobDescription"]'],
      'glassdoor.com': ['.desc', '.jobDescriptionContent', '[class*="JobDescription"]', '#JobDescriptionContainer'],
      'workday.com': ['[data-automation-id="jobPostingDescription"]', '.css-cygeeu', '[class*="jobDescription"]'],
      'lever.co': ['.posting-page .content', '.section-wrapper .content', '[class*="posting-description"]'],
      'greenhouse.io': ['#content .body', '.job-post-content', '#app_body'],
      'smartrecruiters.com': ['.job-sections', '.jobad-description', '[class*="jobDescription"]'],
      'angel.co': ['.description', '[class*="description"]'],
      'wellfound.com': ['.description', '[class*="description"]'],
    };

    // Find matching selectors for current site
    let siteSelectors = [];
    for (const [domain, sels] of Object.entries(selectors)) {
      if (hostname.includes(domain)) {
        siteSelectors = sels;
        break;
      }
    }

    // Try site-specific selectors first
    for (const sel of siteSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) {
        return el.textContent.trim();
      }
    }

    // Fallback: generic job description selectors
    const genericSelectors = [
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="job_description"]',
      '[id*="job-description"]',
      '[id*="jobDescription"]',
      'article',
      '.description',
      'main',
    ];

    for (const sel of genericSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) {
        return el.textContent.trim().substring(0, 5000); // Cap at 5000 chars
      }
    }

    return null;
  }

  /**
   * Analyze the job description — get fit score from AI.
   */
  async function analyzeJob() {
    const resultDiv = document.getElementById('jp-result');
    const loadingDiv = document.getElementById('jp-loading');
    const errorDiv = document.getElementById('jp-error');
    const extractBtn = document.getElementById('jp-extract-btn');

    resultDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    loadingDiv.style.display = 'block';
    extractBtn.disabled = true;

    const jobDescription = extractJobDescription();

    if (!jobDescription) {
      loadingDiv.style.display = 'none';
      errorDiv.style.display = 'block';
      errorDiv.textContent = '❌ Could not find a job description on this page. Try opening a specific job posting.';
      extractBtn.disabled = false;
      return;
    }

    // Get user config from storage
    const config = await new Promise(resolve => chrome.storage.local.get(null, resolve));

    if (!config.useAI || !config.aiApiKey) {
      loadingDiv.style.display = 'none';
      errorDiv.style.display = 'block';
      errorDiv.textContent = '⚠️ AI is not configured. Go to extension Settings → AI Settings and add your API key.';
      extractBtn.disabled = false;
      return;
    }

    // Build scoring prompt
    const skills = config.skillMap ? Object.keys(config.skillMap).join(', ') : '';
    const experience = config.yearsOfExperience || '3';
    const headline = config.linkedinHeadline || '';

    const prompt = `Score how well this candidate matches this job on a scale of 0-100.

CANDIDATE PROFILE:
- Experience: ${experience} years
- Headline: ${headline}
- Skills: ${skills}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

Respond in this EXACT format (JSON):
{"score": 75, "explanation": "Brief 1-2 sentence explanation of the match", "missingSkills": ["skill1", "skill2"], "matchingSkills": ["skill1", "skill2"]}`;

    try {
      let response;
      if (config.aiProvider === 'gemini') {
        response = await callGeminiForScore(prompt, config.aiApiKey, config.aiModel);
      } else {
        response = await callOpenAIForScore(prompt, config.aiApiUrl, config.aiApiKey, config.aiModel);
      }

      loadingDiv.style.display = 'none';

      if (response) {
        // Try to parse JSON from response
        let parsed;
        try {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { score: 50, explanation: response };
        } catch (e) {
          parsed = { score: 50, explanation: response, missingSkills: [], matchingSkills: [] };
        }

        displayScore(parsed);
        resultDiv.style.display = 'block';
      } else {
        errorDiv.style.display = 'block';
        errorDiv.textContent = '❌ AI returned no response. Check your API key.';
      }
    } catch (err) {
      loadingDiv.style.display = 'none';
      errorDiv.style.display = 'block';
      errorDiv.textContent = `❌ Error: ${err.message}`;
    }

    extractBtn.disabled = false;
  }

  /**
   * Display the fit score result.
   */
  function displayScore(data) {
    const scoreDiv = document.getElementById('jp-score-display');
    const explanationDiv = document.getElementById('jp-explanation');
    const score = data.score || 0;

    let color, label;
    if (score >= 80) { color = '#10b981'; label = 'Excellent Match'; }
    else if (score >= 60) { color = '#3b82f6'; label = 'Good Match'; }
    else if (score >= 40) { color = '#eab308'; label = 'Fair Match'; }
    else { color = '#ef4444'; label = 'Low Match'; }

    scoreDiv.innerHTML = `
      <div class="jp-score-circle" style="border-color: ${color}; color: ${color};">
        <span class="jp-score-number">${score}</span>
        <span class="jp-score-label">${label}</span>
      </div>
    `;

    let explanationHTML = `<p class="jp-explanation-text">${data.explanation || ''}</p>`;
    if (data.matchingSkills && data.matchingSkills.length > 0) {
      explanationHTML += `<p class="jp-skills-match">✅ Matching: ${data.matchingSkills.join(', ')}</p>`;
    }
    if (data.missingSkills && data.missingSkills.length > 0) {
      explanationHTML += `<p class="jp-skills-missing">⚠️ Missing: ${data.missingSkills.join(', ')}</p>`;
    }
    explanationDiv.innerHTML = explanationHTML;
  }

  /**
   * Call Gemini API for scoring.
   */
  async function callGeminiForScore(prompt, apiKey, model) {
    const geminiModel = model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1/models/${geminiModel}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
      }),
    });

    if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);
    const result = await response.json();
    return result.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  /**
   * Call OpenAI-compatible API for scoring.
   */
  async function callOpenAIForScore(prompt, apiUrl, apiKey, model) {
    const url = (apiUrl || 'https://api.openai.com/v1/').replace(/\/$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey !== 'not-needed') headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) throw new Error(`AI API returned ${response.status}`);
    const result = await response.json();
    return result.choices?.[0]?.message?.content || null;
  }

  console.log('[JobPilot AI] Job board helper loaded on', window.location.hostname);
})();
