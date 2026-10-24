// job-normalizers.js - Board-specific raw record adapters.

const JOB_NORMALIZER_FIELDS = Object.freeze({
  linkedin: {
    platformJobId: ['platformJobId', 'job_id', 'id'],
    title: ['title'], company: ['company', 'company_name'], location: ['location'],
    url: ['url', 'job_url'], description: ['description'], postedAt: ['postedAt', 'posted_date'],
  },
  indeed: {
    platformJobId: ['platformJobId', 'job_id', 'id'],
    title: ['title'], company: ['company'], location: ['location'],
    url: ['url', 'job_url'], description: ['description'], postedAt: ['postedAt', 'posted_date'],
  },
  glassdoor: {
    platformJobId: ['platformJobId', 'job_id', 'id'],
    title: ['title', 'job_title'], company: ['company', 'employer_name'], location: ['location'],
    url: ['url', 'apply_url'], description: ['description', 'job_description'], postedAt: ['postedAt', 'listing_date'],
  },
});

function firstPresent(rawJob, names) {
  for (const name of names) {
    if (rawJob?.[name] !== undefined && rawJob[name] !== null && rawJob[name] !== '') {
      return rawJob[name];
    }
  }
  return null;
}

/** Normalize one raw scraper/UI record into the core Job model. */
function normalizeJob(rawJob, explicitPlatform) {
  if (!rawJob || typeof rawJob !== 'object') {
    return { ok: false, error: { code: 'MALFORMED_JOB' } };
  }

  const platform = explicitPlatform || rawJob.platform || rawJob.sourceBoard ||
    rawJob.source_board || inferJobPlatform(rawJob.url || rawJob.job_url || rawJob.apply_url);
  const fields = JOB_NORMALIZER_FIELDS[platform];
  if (!fields) {
    return { ok: false, error: { code: 'UNSUPPORTED_PLATFORM', platform } };
  }

  const value = field => firstPresent(rawJob, fields[field] || [field]);
  const job = createJob({
    id: rawJob.id || undefined,
    platform,
    platformJobId: value('platformJobId'),
    title: value('title'),
    company: value('company'),
    location: value('location'),
    url: value('url'),
    description: value('description'),
    employmentType: rawJob.employmentType || rawJob.jobType || rawJob.job_type || null,
    remoteType: rawJob.remoteType || rawJob.remote_type || null,
    salary: rawJob.salary && typeof rawJob.salary === 'object' ? rawJob.salary : null,
    postedAt: value('postedAt') || rawJob.postedDate || null,
    requiredSkills: rawJob.requiredSkills,
    preferredSkills: rawJob.preferredSkills,
    applicationCapability: rawJob.applicationCapability ||
      (platform === JobPlatform.LINKEDIN
        ? ApplicationCapability.DIRECT_APPLY
        : ApplicationCapability.EXTERNAL_APPLY),
    metadata: {
      ...(rawJob.metadata && typeof rawJob.metadata === 'object' ? rawJob.metadata : {}),
      sourceRecordId: rawJob.id || null,
      sourceListings: rawJob.sourceListings || rawJob.metadata?.sourceListings || [],
      salaryText: typeof rawJob.salary === 'string' ? rawJob.salary : rawJob.metadata?.salaryText || null,
    },
  });

  const validation = validateJob(job);
  return validation.valid
    ? { ok: true, job }
    : { ok: false, error: { code: 'INVALID_JOB', fields: validation.errors } };
}

function normalizeLinkedInJob(rawJob) {
  return normalizeJob(rawJob, JobPlatform.LINKEDIN);
}

function normalizeIndeedJob(rawJob) {
  return normalizeJob(rawJob, JobPlatform.INDEED);
}

function normalizeGlassdoorJob(rawJob) {
  return normalizeJob(rawJob, JobPlatform.GLASSDOOR);
}

function normalizeZipRecruiterJob() {
  return {
    ok: false,
    error: {
      code: 'DISCOVERY_NOT_IMPLEMENTED',
      platform: JobPlatform.ZIP_RECRUITER,
    },
  };
}

/** Normalize a list while preserving rejection diagnostics. */
function normalizeJobs(rawJobs) {
  const jobs = [];
  const errors = [];
  for (const rawJob of Array.isArray(rawJobs) ? rawJobs : []) {
    const normalized = normalizeJob(rawJob);
    if (normalized.ok) jobs.push(normalized.job);
    else errors.push(normalized.error);
  }
  return { jobs, errors };
}
