const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/jobs/job-domain.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/applications/application-state.js'));
});

beforeEach(() => {
  global.resetChromeMocks();
});

const job = Object.freeze({ id: 'job-state-1', platform: 'linkedin' });

describe('application state repository', () => {
  it('should persist submission proof and report a submitted job', async () => {
    const record = await ApplicationStateRepository.transition(job, ApplicationState.SUBMITTED, {
      attemptId: 'attempt-1', receiptId: 'receipt-1', confirmed: true,
    });

    expect(record).toMatchObject({
      version: 2,
      jobId: job.id,
      state: ApplicationState.SUBMITTED,
      attemptId: 'attempt-1',
      receiptId: 'receipt-1',
      confirmed: true,
    });
    await expect(ApplicationStateRepository.hasSubmitted(job.id)).resolves.toBe(true);
  });

  it('should preserve a terminal submitted record when a later transition is requested', async () => {
    await ApplicationStateRepository.transition(job, ApplicationState.SUBMITTED, {
      attemptId: 'attempt-1', receiptId: 'receipt-1', confirmed: true,
    });

    const record = await ApplicationStateRepository.transition(job, ApplicationState.FAILED, {
      reasonCodes: ['LATE_ERROR'],
    });

    expect(record).toMatchObject({
      state: ApplicationState.SUBMITTED,
      attemptId: 'attempt-1',
      receiptId: 'receipt-1',
      confirmed: true,
    });
    await expect(ApplicationStateRepository.hasSubmitted(job.id)).resolves.toBe(true);
  });

  it('should preserve a user-confirmed external submission as terminal', async () => {
    const externalJob = { id: 'external-1', platform: 'indeed' };
    const record = await ApplicationStateRepository.transition(
      externalJob,
      ApplicationState.EXTERNAL_SUBMISSION_CONFIRMED,
      { confirmed: true, confirmationSource: 'USER' }
    );

    expect(record).toMatchObject({
      version: 2,
      state: ApplicationState.EXTERNAL_SUBMISSION_CONFIRMED,
      confirmed: true,
      confirmationSource: 'USER',
    });
    await expect(ApplicationStateRepository.hasSubmitted(externalJob.id)).resolves.toBe(true);
    await expect(ApplicationStateRepository.transition(externalJob, ApplicationState.FAILED))
      .resolves.toMatchObject({ state: ApplicationState.EXTERNAL_SUBMISSION_CONFIRMED });
  });

  it('should block automatic retry after an uncertain submission attempt', async () => {
    await ApplicationStateRepository.transition(job, ApplicationState.FAILED, {
      attemptId: 'attempt-uncertain', reasonCodes: ['SUBMISSION_UNCONFIRMED'],
    });

    await expect(ApplicationStateRepository.hasUncertainAttempt(job.id)).resolves.toBe(true);
    await expect(ApplicationStateRepository.hasSubmitted(job.id)).resolves.toBe(false);
  });

  it('should reject unknown application states', async () => {
    await expect(ApplicationStateRepository.transition(job, 'UNKNOWN'))
      .rejects.toThrow('INVALID_APPLICATION_STATE');
  });
});
