// application-orchestrator.js - Capability-aware application coordination.

// eslint-disable-next-line no-var
var ApplicationOrchestrator = Object.freeze({
  /**
   * Record a human-confirmed external submission without treating tab opening
   * as proof. External confirmations do not consume LinkedIn automation quota.
   */
  async confirmExternalSubmission({
    job,
    confirmed,
    stateRepository = ApplicationStateRepository,
  }) {
    const validation = validateJob(job);
    if (!validation.valid) return { status: 'FAILED', jobId: job?.id, reasonCodes: validation.errors };
    const platform = PlatformRegistry.get(job.platform);
    if (platform?.application !== ApplicationCapability.EXTERNAL_APPLY) {
      return { status: 'FAILED', jobId: job.id, reasonCodes: ['NOT_EXTERNAL_APPLICATION'] };
    }
    if (confirmed !== true) {
      return { status: 'EXTERNAL_APPLICATION', jobId: job.id, confirmed: false };
    }
    const record = await stateRepository.transition(
      job,
      ApplicationState.EXTERNAL_SUBMISSION_CONFIRMED,
      { confirmed: true, confirmationSource: 'USER' }
    );
    return {
      status: 'EXTERNAL_SUBMISSION_CONFIRMED',
      jobId: job.id,
      confirmed: true,
      confirmationSource: 'USER',
      record,
    };
  },

  /**
   * Route a normalized job without claiming unsupported submission.
   * The injected direct provider owns form preparation and the final-submit
   * quota check; this orchestrator never consumes quota during analysis.
   */
  async apply({ job, criteria, directProvider, stateRepository = ApplicationStateRepository }) {
    const validation = validateJob(job);
    if (!validation.valid) {
      return { status: 'FAILED', jobId: job?.id, reasonCodes: validation.errors };
    }

    if (await stateRepository.hasSubmitted(job.id)) {
      return { status: 'ALREADY_APPLIED', jobId: job.id };
    }

    await stateRepository.transition(job, ApplicationState.ANALYZING);
    const filterResult = evaluateHardFilters(job, criteria || resolveJobSearchCriteria());
    if (!filterResult.eligible) {
      await stateRepository.transition(job, ApplicationState.SKIPPED, {
        reasonCodes: filterResult.reasons,
      });
      return { status: 'SKIPPED', jobId: job.id, reasonCodes: filterResult.reasons };
    }

    const platform = PlatformRegistry.get(job.platform);
    if (!platform || platform.application === ApplicationCapability.UNSUPPORTED) {
      await stateRepository.transition(job, ApplicationState.NEEDS_USER_INPUT, {
        reasonCodes: ['UNSUPPORTED_PLATFORM'],
      });
      return { status: 'UNSUPPORTED', jobId: job.id, capability: ApplicationCapability.UNSUPPORTED };
    }

    if (platform.application === ApplicationCapability.EXTERNAL_APPLY) {
      await stateRepository.transition(job, ApplicationState.EXTERNAL_APPLICATION);
      return {
        status: 'EXTERNAL_APPLICATION',
        jobId: job.id,
        capability: ApplicationCapability.EXTERNAL_APPLY,
        externalUrl: job.url,
      };
    }

    if (!directProvider || typeof directProvider.apply !== 'function') {
      await stateRepository.transition(job, ApplicationState.NEEDS_USER_INPUT, {
        reasonCodes: ['LINKEDIN_TAB_REQUIRED'],
      });
      return {
        status: 'NEEDS_USER_INPUT',
        jobId: job.id,
        capability: ApplicationCapability.REQUIRES_USER,
      };
    }

    const attemptId = `application:${job.id}`;
    await stateRepository.transition(job, ApplicationState.REVIEW_REQUIRED, {
      attemptId,
      reasonCodes: ['FINAL_REVIEW_REQUIRED'],
    });
    const applicationResult = await directProvider.apply({ job, attemptId });
    const hasSubmissionProof = applicationResult.status === 'SUBMITTED' &&
      applicationResult.confirmed === true && Boolean(applicationResult.receiptId);
    if (hasSubmissionProof) {
      await stateRepository.transition(job, ApplicationState.SUBMITTED, { ...applicationResult, attemptId });
    } else if (applicationResult.status === 'NEEDS_USER_INPUT') {
      await stateRepository.transition(job, ApplicationState.NEEDS_USER_INPUT, { ...applicationResult, attemptId });
    } else if (applicationResult.status === 'REVIEW_REQUIRED') {
      await stateRepository.transition(job, ApplicationState.REVIEW_REQUIRED, { ...applicationResult, attemptId });
    } else if (applicationResult.status === 'MANUAL_INTERVENTION') {
      await stateRepository.transition(job, ApplicationState.MANUAL_INTERVENTION, { ...applicationResult, attemptId });
    } else {
      const failedResult = applicationResult.status === 'SUBMITTED'
        ? { status: 'FAILED', reasonCodes: ['SUBMISSION_UNCONFIRMED'] }
        : applicationResult;
      await stateRepository.transition(job, ApplicationState.FAILED, { ...failedResult, attemptId });
      return { ...failedResult, jobId: job.id, attemptId };
    }
    return { ...applicationResult, jobId: job.id, attemptId };
  },
});
