// job-matches-screen.js - Human-review workflow for AI-ranked jobs.

// eslint-disable-next-line no-var
var JobMatchesScreen = (function () {
  let currentJobs = [];
  let currentCriteria = resolveJobSearchCriteria();
  let currentSessionId = null;
  let currentPage = 1;
  let totalPages = 1;
  let pollTimer = null;
  const ACTIVE_SESSION_KEY = 'activeSearchSessionId';

  function setStatus(message, kind) {
    const status = document.getElementById('jobMatchesStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `job-matches-status ${kind || ''}`;
  }

  function render(jobs) {
    const container = document.getElementById('jobMatchesResults');
    if (!container) return;
    container.replaceChildren();
    currentJobs = jobs;
    if (!jobs.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No jobs met your configured filters and match threshold.';
      container.appendChild(empty);
      return;
    }

    for (const job of jobs) {
      const row = document.createElement('label');
      row.className = 'job-match-review-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.jobId = job.id;
      const details = document.createElement('span');
      const reason = job.match?.reasons?.[0] || (job.matchStatus === 'AI_UNAVAILABLE'
        ? 'AI matching unavailable; review this deterministically eligible job manually.'
        : 'No AI score is available; review the source details.');
      const score = job.match ? `${job.match.score}%` : 'Unscored';
      details.textContent = `${job.title} — ${job.company || 'Company not provided'} · ${score} · ${reason}`;
      const capability = PlatformRegistry.get(job.platform)?.application || ApplicationCapability.UNSUPPORTED;
      const badge = document.createElement('small');
      badge.textContent = ` ${job.platform}: ${capability}`;
      row.append(checkbox, details, badge);
      if (capability === ApplicationCapability.EXTERNAL_APPLY) {
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'confirm-external-submission';
        confirmButton.dataset.jobId = job.id;
        confirmButton.textContent = 'Mark submitted';
        confirmButton.addEventListener('click', () => confirmExternalSubmission(job.id));
        row.appendChild(confirmButton);
      }
      container.appendChild(row);
    }
  }

  function readReviewCriteria() {
    const query = document.getElementById('jobSearchQuery')?.value.trim() || '';
    const platforms = [...document.querySelectorAll('.board-checkbox input:checked:not(:disabled)')]
      .map(input => input.value)
      .filter(platform => PlatformRegistry.get(platform)?.jobDiscovery);
    const thresholdValue = Number(document.getElementById('filterMinScore')?.value);
    const datePosted = document.getElementById('filterDatePosted')?.value || '';
    const postedWithinDays = { '24h': 1, week: 7, month: 30 }[datePosted];
    return {
      ...(query ? { titles: [query] } : {}),
      platforms,
      ...(document.getElementById('filterMinScore')?.value !== '' &&
          Number.isFinite(thresholdValue) && thresholdValue >= 0 && thresholdValue <= 100
        ? { matchThreshold: thresholdValue }
        : {}),
      ...(document.getElementById('filterJobType')?.value
        ? { employmentTypes: [document.getElementById('filterJobType').value] }
        : {}),
      ...(postedWithinDays ? { postedWithinDays } : {}),
    };
  }

  function setSessionControls(isRunning) {
    const cancelButton = document.getElementById('cancelMatchesBtn');
    const discoverButton = document.getElementById('discoverMatchesBtn');
    if (cancelButton) cancelButton.disabled = !isRunning;
    if (discoverButton) discoverButton.disabled = isRunning;
  }

  function renderProgress(session) {
    const progress = document.getElementById('jobMatchesProgress');
    const warnings = document.getElementById('jobMatchesWarnings');
    if (progress) {
      const total = session.queryTasks?.length || 0;
      progress.textContent = `${session.stage}: ${session.completedQueries || 0}/${total} queries · ${session.resultCount || 0} snapshot results`;
    }
    if (warnings) warnings.textContent = (session.warningCodes || []).join(' · ');
  }

  function renderPagination(response) {
    currentPage = response.page || 1;
    totalPages = response.totalPages || 1;
    const pagination = document.getElementById('jobMatchesPagination');
    if (pagination) pagination.hidden = totalPages <= 1;
    const pageInfo = document.getElementById('jobMatchesPageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    const previous = document.getElementById('jobMatchesPrevBtn');
    const next = document.getElementById('jobMatchesNextBtn');
    if (previous) previous.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= totalPages;
  }

  async function persistActiveSession(sessionId) {
    await chrome.storage.local.set({ [ACTIVE_SESSION_KEY]: sessionId });
  }

  async function clearActiveSession() {
    await chrome.storage.local.remove(ACTIVE_SESSION_KEY);
  }

  async function pollSession(sessionId, page = currentPage) {
    if (sessionId !== currentSessionId) return;
    try {
      const response = await getJobSearchSession(sessionId, page);
      currentCriteria = resolveJobSearchCriteria(response.session.criteria || {});
      renderProgress(response.session);
      if (response.jobs.length || response.session.status === 'COMPLETED' || response.session.status === 'PARTIAL') {
        render(response.jobs);
        renderPagination(response);
      }
      const terminal = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(response.session.status);
      if (terminal) {
        setSessionControls(false);
        await clearActiveSession();
        const degraded = response.session.ai?.status === 'UNAVAILABLE';
        const message = response.session.status === 'CANCELLED'
          ? 'Search cancellation acknowledged. Partial work was not promoted to a completed snapshot.'
          : response.session.status === 'FAILED'
            ? `Search failed: ${response.session.errorCode || 'unknown error'}.`
            : `Snapshot ready with ${response.total} job${response.total === 1 ? '' : 's'}${degraded ? '; AI was unavailable, so unscored jobs require manual review' : ''}.`;
        setStatus(message, response.session.status === 'FAILED' ? 'error' : 'success');
        return;
      }
      pollTimer = setTimeout(() => pollSession(sessionId, page), 750);
    } catch (error) {
      setSessionControls(false);
      setStatus(error.message || 'Unable to read search progress.', 'error');
    }
  }

  async function discover() {
    if (pollTimer) clearTimeout(pollTimer);
    setStatus('Creating a durable search session…', 'info');
    setSessionControls(true);
    try {
      const session = await createJobSearchSession(readReviewCriteria());
      currentSessionId = session.id;
      currentPage = 1;
      await persistActiveSession(currentSessionId);
      resumeJobSearchSession(currentSessionId).catch(() => {});
      await pollSession(currentSessionId, 1);
    } catch (error) {
      setSessionControls(false);
      render([]);
      setStatus(error.message || 'Job matching is temporarily unavailable.', 'error');
    }
  }

  async function cancelCurrentSession() {
    if (!currentSessionId) return;
    setStatus('Requesting cancellation…', 'info');
    await cancelJobSearchSession(currentSessionId);
    await pollSession(currentSessionId, currentPage);
  }

  async function loadPage(page) {
    if (!currentSessionId || page < 1 || page > totalPages) return;
    const response = await getJobSearchSession(currentSessionId, page);
    render(response.jobs);
    renderPagination(response);
  }

  async function confirmExternalSubmission(jobId) {
    const job = currentJobs.find(item => item.id === jobId);
    if (!job) {
      setStatus('The selected external application is no longer available.', 'error');
      return;
    }
    const confirmed = window.confirm(
      `Confirm that you personally submitted the application for ${job.title}. Opening the page alone is not a submission.`
    );
    if (!confirmed) return;
    const outcome = await ApplicationOrchestrator.confirmExternalSubmission({ job, confirmed: true });
    if (outcome.status === 'EXTERNAL_SUBMISSION_CONFIRMED') {
      try {
        await recordConfirmedApplication({
          job,
          outcome: 'EXTERNAL_CONFIRMED',
          attemptId: `external:${job.id}`,
        });
        await renderConfirmedHistory();
        setStatus('External application recorded from your explicit confirmation. No automation quota was consumed.', 'success');
      } catch (_) {
        setStatus('External confirmation is saved locally; cloud history sync is temporarily unavailable.', 'error');
      }
    } else {
      setStatus('The external submission could not be recorded.', 'error');
    }
  }

  async function applySelected() {
    const selectedIds = [...document.querySelectorAll('#jobMatchesResults input:checked')]
      .map(input => input.dataset.jobId);
    if (!selectedIds.length) {
      setStatus('Select at least one job before continuing.', 'error');
      return;
    }

    let opened = 0;
    for (const job of currentJobs.filter(item => selectedIds.includes(item.id))) {
      const outcome = await ApplicationOrchestrator.apply({
        job,
        criteria: currentCriteria,
      });
      if (outcome.status === 'EXTERNAL_APPLICATION' || outcome.status === 'NEEDS_USER_INPUT') {
        await chrome.tabs.create({ url: outcome.externalUrl || job.url });
        opened++;
      }
    }
    setStatus(
      `Opened ${opened} selected application${opened === 1 ? '' : 's'} for required human review. No application was marked submitted and no quota was consumed.`,
      'info'
    );
  }

  async function renderConfirmedHistory() {
    const container = document.getElementById('jobMatchesHistory');
    if (!container) return;
    const response = await getConfirmedApplicationHistory(20);
    container.replaceChildren();
    for (const entry of response.entries || []) {
      const row = document.createElement('p');
      row.textContent = `${entry.title || 'Job'} — ${entry.company || entry.platform} · ${entry.outcome}`;
      container.appendChild(row);
    }
    if (!container.childElementCount) {
      const empty = document.createElement('p');
      empty.textContent = 'No confirmed applications recorded yet.';
      container.appendChild(empty);
    }
  }

  async function restoreActiveSession() {
    const stored = await chrome.storage.local.get([ACTIVE_SESSION_KEY]);
    const sessionId = stored?.[ACTIVE_SESSION_KEY];
    if (!sessionId) return;
    currentSessionId = sessionId;
    setSessionControls(true);
    resumeJobSearchSession(sessionId).catch(() => {});
    await pollSession(sessionId, 1);
  }

  function init() {
    document.getElementById('discoverMatchesBtn')?.addEventListener('click', discover);
    document.getElementById('cancelMatchesBtn')?.addEventListener('click', cancelCurrentSession);
    document.getElementById('applySelectedMatchesBtn')?.addEventListener('click', applySelected);
    document.getElementById('jobMatchesPrevBtn')?.addEventListener('click', () => loadPage(currentPage - 1));
    document.getElementById('jobMatchesNextBtn')?.addEventListener('click', () => loadPage(currentPage + 1));
    restoreActiveSession().catch(() => clearActiveSession());
    renderConfirmedHistory().catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
  return Object.freeze({
    discover,
    cancelCurrentSession,
    loadPage,
    applySelected,
    render,
    renderProgress,
  });
})();
