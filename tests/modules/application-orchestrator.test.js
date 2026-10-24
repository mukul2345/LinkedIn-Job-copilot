const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-domain.js'));
  global.DEFAULT_MATCH_THRESHOLD = 70;
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-policy.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/platforms/platform-adapter.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/platforms/linkedin-adapter.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/platforms/platform-registry.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/applications/application-orchestrator.js'));
});

function createApplicationJob(overrides = {}) {
  return createJob({
    platform: JobPlatform.LINKEDIN,
    platformJobId: 'job-1',
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote',
    url: 'https://linkedin.com/jobs/1',
    description: 'Build platform APIs',
    ...overrides,
  });
}

function createStateRepository({ hasSubmitted = false } = {}) {
  return {
    hasSubmitted: jest.fn().mockResolvedValue(hasSubmitted),
    transition: jest.fn().mockResolvedValue(undefined),
  };
}

describe('application orchestrator routing', () => {
  afterEach(() => jest.clearAllMocks());

  it('should fail invalid jobs before state or provider work', async () => {
    const stateRepository = createStateRepository();
    const directProvider = { apply: jest.fn() };

    const response = await ApplicationOrchestrator.apply({
      job: { id: 'bad', platform: JobPlatform.LINKEDIN, title: '', url: 'http://bad' },
      directProvider,
      stateRepository,
    });

    expect(response).toMatchObject({ status: 'FAILED', reasonCodes: ['TITLE_REQUIRED', 'HTTPS_URL_REQUIRED'] });
    expect(stateRepository.hasSubmitted).not.toHaveBeenCalled();
    expect(directProvider.apply).not.toHaveBeenCalled();
  });

  it('should stop after hard filters before invoking the direct provider', async () => {
    const job = createApplicationJob({ company: 'Blocked Company' });
    const stateRepository = createStateRepository();
    const directProvider = { apply: jest.fn() };

    const response = await ApplicationOrchestrator.apply({
      job,
      criteria: resolveJobSearchCriteria({ excludedCompanies: ['blocked'] }),
      directProvider,
      stateRepository,
    });

    expect(response).toMatchObject({ status: 'SKIPPED', reasonCodes: ['COMPANY_EXCLUDED'] });
    expect(directProvider.apply).not.toHaveBeenCalled();
    expect(stateRepository.transition.mock.calls.map(call => call[1])).toEqual([
      ApplicationState.ANALYZING,
      ApplicationState.SKIPPED,
    ]);
  });

  it('should route external platforms to review without claiming submission', async () => {
    const job = createApplicationJob({
      platform: JobPlatform.INDEED,
      platformJobId: 'indeed-1',
      url: 'https://indeed.com/viewjob/1',
    });
    const stateRepository = createStateRepository();
    const directProvider = { apply: jest.fn() };

    const response = await ApplicationOrchestrator.apply({ job, directProvider, stateRepository });

    expect(response).toEqual({
      status: 'EXTERNAL_APPLICATION',
      jobId: job.id,
      capability: ApplicationCapability.EXTERNAL_APPLY,
      externalUrl: job.url,
    });
    expect(directProvider.apply).not.toHaveBeenCalled();
    expect(stateRepository.transition).toHaveBeenLastCalledWith(
      job,
      ApplicationState.EXTERNAL_APPLICATION,
    );
  });

  it('should route ZipRecruiter to unsupported user review', async () => {
    const job = createApplicationJob({
      platform: JobPlatform.ZIP_RECRUITER,
      platformJobId: 'zip-1',
      url: 'https://ziprecruiter.com/jobs/1',
    });
    const stateRepository = createStateRepository();

    const response = await ApplicationOrchestrator.apply({
      job,
      criteria: { platforms: [JobPlatform.ZIP_RECRUITER] },
      stateRepository,
    });

    expect(response).toMatchObject({
      status: 'UNSUPPORTED',
      capability: ApplicationCapability.UNSUPPORTED,
    });
    expect(stateRepository.transition).toHaveBeenLastCalledWith(
      job,
      ApplicationState.NEEDS_USER_INPUT,
      { reasonCodes: ['UNSUPPORTED_PLATFORM'] },
    );
  });

  it('should record an external submission only after explicit user confirmation', async () => {
    const job = createApplicationJob({
      platform: JobPlatform.INDEED,
      platformJobId: 'indeed-confirmed',
      url: 'https://indeed.com/viewjob/confirmed',
    });
    const stateRepository = createStateRepository();

    await expect(ApplicationOrchestrator.confirmExternalSubmission({
      job,
      confirmed: false,
      stateRepository,
    })).resolves.toMatchObject({ status: 'EXTERNAL_APPLICATION', confirmed: false });
    expect(stateRepository.transition).not.toHaveBeenCalled();

    const response = await ApplicationOrchestrator.confirmExternalSubmission({
      job,
      confirmed: true,
      stateRepository,
    });
    expect(response).toMatchObject({
      status: 'EXTERNAL_SUBMISSION_CONFIRMED',
      confirmed: true,
      confirmationSource: 'USER',
    });
    expect(stateRepository.transition).toHaveBeenCalledWith(
      job,
      ApplicationState.EXTERNAL_SUBMISSION_CONFIRMED,
      { confirmed: true, confirmationSource: 'USER' },
    );
  });

  it('should reject external confirmation for a direct-apply platform', async () => {
    const job = createApplicationJob();
    const stateRepository = createStateRepository();

    await expect(ApplicationOrchestrator.confirmExternalSubmission({
      job,
      confirmed: true,
      stateRepository,
    })).resolves.toMatchObject({
      status: 'FAILED',
      reasonCodes: ['NOT_EXTERNAL_APPLICATION'],
    });
    expect(stateRepository.transition).not.toHaveBeenCalled();
  });

  it('should preserve an existing submission without invoking the provider', async () => {
    const job = createApplicationJob();
    const stateRepository = createStateRepository({ hasSubmitted: true });
    const directProvider = { apply: jest.fn() };

    await expect(ApplicationOrchestrator.apply({ job, directProvider, stateRepository }))
      .resolves.toEqual({ status: 'ALREADY_APPLIED', jobId: job.id });
    expect(stateRepository.transition).not.toHaveBeenCalled();
    expect(directProvider.apply).not.toHaveBeenCalled();
  });

  it('should require confirmed receipt proof before recording SUBMITTED', async () => {
    const job = createApplicationJob();
    const stateRepository = createStateRepository();
    const directProvider = {
      apply: jest.fn().mockResolvedValue({ status: 'SUBMITTED', confirmed: true }),
    };

    const response = await ApplicationOrchestrator.apply({ job, directProvider, stateRepository });

    expect(response).toMatchObject({
      status: 'FAILED',
      reasonCodes: ['SUBMISSION_UNCONFIRMED'],
      attemptId: `application:${job.id}`,
    });
    expect(stateRepository.transition.mock.calls.map(call => call[1])).toEqual([
      ApplicationState.ANALYZING,
      ApplicationState.REVIEW_REQUIRED,
      ApplicationState.FAILED,
    ]);
    expect(stateRepository.transition.mock.calls.map(call => call[1]))
      .not.toContain(ApplicationState.SUBMITTED);
  });

  it('should record SUBMITTED only with confirmation and a receipt', async () => {
    const job = createApplicationJob();
    const stateRepository = createStateRepository();
    const directProvider = {
      apply: jest.fn().mockResolvedValue({
        status: 'SUBMITTED', confirmed: true, receiptId: 'receipt-1',
      }),
    };

    const response = await ApplicationOrchestrator.apply({ job, directProvider, stateRepository });

    expect(response).toMatchObject({
      status: 'SUBMITTED',
      confirmed: true,
      receiptId: 'receipt-1',
      attemptId: `application:${job.id}`,
    });
    expect(stateRepository.transition).toHaveBeenLastCalledWith(
      job,
      ApplicationState.SUBMITTED,
      expect.objectContaining({
        attemptId: `application:${job.id}`,
        confirmed: true,
        receiptId: 'receipt-1',
      }),
    );
  });
});
