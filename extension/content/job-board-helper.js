// job-board-helper.js - Human-triggered, server-scored job review for non-LinkedIn boards.
(function () {
  'use strict';
  if (document.getElementById('jp-job-helper-fab')) return;

  const create = (tag, id, text) => {
    const element = document.createElement(tag);
    if (id) element.id = id;
    if (text) element.textContent = text;
    return element;
  };
  const fab = create('button', 'jp-job-helper-fab', '⚡');
  fab.title = 'JobPilot AI — score this job';
  const panel = create('section', 'jp-job-helper-panel');
  panel.style.display = 'none';
  const close = create('button', 'jp-panel-close', '✕');
  const analyze = create('button', 'jp-extract-btn', 'Analyze This Job');
  analyze.className = 'jp-btn jp-btn-primary';
  const output = create('div', 'jp-result');
  const error = create('div', 'jp-error');
  panel.append(create('h3', null, 'JobPilot AI'), close, analyze, output, error);
  document.body.append(fab, panel);

  fab.addEventListener('click', () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
  close.addEventListener('click', () => { panel.style.display = 'none'; });
  analyze.addEventListener('click', async () => {
    analyze.disabled = true;
    error.textContent = '';
    output.textContent = 'Analyzing…';
    const candidates = document.querySelectorAll('[class*="job-description"], [class*="jobDescription"], [id*="jobDescription"], article, main');
    const description = [...candidates].map(element => element.textContent.trim()).find(text => text.length > 200);
    if (!description) {
      output.textContent = '';
      error.textContent = 'Could not find a job description on this page.';
      analyze.disabled = false;
      return;
    }
    try {
      const response = await callBackend('matchCurrentJobForUser', {
        url: window.location.href, title: document.title, description: description.slice(0, 5000),
      });
      const match = validateAiMatchResponse(response.match);
      if (!match.available) throw new Error('The match score was unavailable.');
      output.replaceChildren(
        create('strong', null, `${match.score}% — ${match.recommendation}`),
        create('p', null, match.reasons[0] || 'No additional reason was supplied.'),
      );
    } catch (requestError) {
      output.textContent = '';
      error.textContent = requestError.message || 'Job matching is temporarily unavailable.';
    } finally { analyze.disabled = false; }
  });
})();
