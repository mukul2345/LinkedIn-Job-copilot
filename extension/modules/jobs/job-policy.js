// job-policy.js - Preference resolution, deterministic filters, and deduplication.

/** Resolve criteria using explicit > persisted > defaults > safe fallback. */
function resolveJobSearchCriteria(explicit = {}, persisted = {}, defaults = {}) {
  const pick = (key, fallback) => explicit[key] ?? persisted[key] ?? defaults[key] ?? fallback;
  return Object.freeze({
    titles: pick('titles', []),
    keywords: pick('keywords', []),
    locations: pick('locations', []),
    remoteTypes: pick('remoteTypes', []),
    employmentTypes: pick('employmentTypes', []),
    minimumSalary: pick('minimumSalary', null),
    maximumSalary: pick('maximumSalary', null),
    experienceYears: pick('experienceYears', null),
    companies: pick('companies', []),
    excludedCompanies: pick('excludedCompanies', []),
    excludedKeywords: pick('excludedKeywords', []),
    postedWithinDays: pick('postedWithinDays', null),
    platforms: pick('platforms', [JobPlatform.LINKEDIN, JobPlatform.INDEED, JobPlatform.GLASSDOOR]),
    matchThreshold: pick('matchThreshold', DEFAULT_MATCH_THRESHOLD),
  });
}

function normalizedIncludes(value, candidates) {
  const normalized = String(value || '').toLowerCase();
  return candidates.some(candidate => normalized.includes(String(candidate).toLowerCase()));
}

/** Hard rules always run before AI and cannot be overridden by a score. */
function evaluateHardFilters(job, criteria) {
  const reasons = [];
  if (criteria.platforms?.length && !criteria.platforms.includes(job.platform)) reasons.push('PLATFORM_EXCLUDED');
  if (criteria.excludedCompanies?.length && normalizedIncludes(job.company, criteria.excludedCompanies)) reasons.push('COMPANY_EXCLUDED');
  const searchableText = `${job.title || ''} ${job.description || ''}`;
  if (criteria.excludedKeywords?.length && normalizedIncludes(searchableText, criteria.excludedKeywords)) reasons.push('KEYWORD_EXCLUDED');
  if (criteria.locations?.length && job.location && !normalizedIncludes(job.location, criteria.locations)) reasons.push('LOCATION_MISMATCH');
  if (criteria.remoteTypes?.length && job.remoteType && !criteria.remoteTypes.includes(job.remoteType)) reasons.push('REMOTE_TYPE_MISMATCH');
  if (criteria.employmentTypes?.length && job.employmentType && !criteria.employmentTypes.includes(job.employmentType)) reasons.push('EMPLOYMENT_TYPE_MISMATCH');
  if (criteria.minimumSalary != null && job.salary?.maximum != null && job.salary.maximum < criteria.minimumSalary) reasons.push('SALARY_BELOW_MINIMUM');
  if (criteria.maximumSalary != null && job.salary?.minimum != null && job.salary.minimum > criteria.maximumSalary) reasons.push('SALARY_ABOVE_MAXIMUM');
  if (criteria.experienceYears != null && job.metadata?.requiredExperienceYears != null && job.metadata.requiredExperienceYears > criteria.experienceYears) reasons.push('EXPERIENCE_INSUFFICIENT');
  if (criteria.postedWithinDays != null && job.postedAt) {
    const cutoff = Date.now() - criteria.postedWithinDays * 86400000;
    if (new Date(job.postedAt).getTime() < cutoff) reasons.push('POSTED_TOO_LONG_AGO');
  }
  return { eligible: reasons.length === 0, reasons };
}

function normalizeIdentityText(value) {
  return String(value || '').toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function descriptionSimilarity(left, right) {
  if (!left || !right) return 0;
  const leftTokens = new Set(normalizeIdentityText(left).split(' ').filter(token => token.length > 3));
  const rightTokens = new Set(normalizeIdentityText(right).split(' ').filter(token => token.length > 3));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection++;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

/** Return HIGH only when deterministic signals make merging safe. */
function getDuplicateConfidence(left, right) {
  if (left.platform === right.platform && left.platformJobId && left.platformJobId === right.platformJobId) return 'HIGH';
  const leftUrl = canonicalizeJobUrl(left.url);
  const rightUrl = canonicalizeJobUrl(right.url);
  if (leftUrl && leftUrl === rightUrl) return 'HIGH';

  const sameTitle = normalizeIdentityText(left.title) === normalizeIdentityText(right.title);
  const sameCompany = normalizeIdentityText(left.company) === normalizeIdentityText(right.company);
  const sameLocation = normalizeIdentityText(left.location) === normalizeIdentityText(right.location);
  if (sameTitle && sameCompany && sameLocation && descriptionSimilarity(left.description, right.description) >= 0.8) {
    return 'HIGH';
  }
  if (sameTitle && sameCompany) return 'MEDIUM';
  return 'LOW';
}

function mergeDuplicateJobs(primary, duplicate) {
  const sources = [
    ...(primary.metadata?.sourceListings || [{ platform: primary.platform, url: primary.url }]),
    ...(duplicate.metadata?.sourceListings || [{ platform: duplicate.platform, url: duplicate.url }]),
  ];
  const mergedJob = createJob({
    ...primary,
    description: primary.description || duplicate.description,
    salary: primary.salary || duplicate.salary,
    postedAt: primary.postedAt || duplicate.postedAt,
    requiredSkills: [...new Set([...primary.requiredSkills, ...duplicate.requiredSkills])],
    preferredSkills: [...new Set([...primary.preferredSkills, ...duplicate.preferredSkills])],
    metadata: { ...primary.metadata, sourceListings: sources },
  });
  return Object.freeze({ ...mergedJob, match: primary.match || duplicate.match || null });
}

/** Merge only HIGH-confidence duplicates; preserve all ambiguous listings. */
function deduplicateCrossPlatformJobs(jobs) {
  const deduplicated = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const duplicateIndex = deduplicated.findIndex(existing => getDuplicateConfidence(existing, job) === 'HIGH');
    if (duplicateIndex === -1) deduplicated.push(job);
    else deduplicated[duplicateIndex] = mergeDuplicateJobs(deduplicated[duplicateIndex], job);
  }
  return deduplicated;
}
