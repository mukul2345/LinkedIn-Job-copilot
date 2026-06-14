// tests/helpers/generators.js
// fast-check arbitraries for property-based testing of JobPilot enhanced features.

const fc = require('fast-check');

// --- Primitive generators ---

/** Generates a non-empty trimmed string of reasonable length. */
const nonEmptyString = (maxLen = 100) =>
  fc.string({ minLength: 1, maxLength: maxLen }).map(s => s.trim() || 'fallback');

/** Generates a job title. */
const jobTitle = () =>
  fc.oneof(
    fc.constantFrom(
      'Software Engineer',
      'Backend Developer',
      'Data Scientist',
      'Product Manager',
      'Frontend Developer',
      'DevOps Engineer',
      'Full Stack Developer',
      'Machine Learning Engineer',
      'QA Engineer',
      'Technical Lead'
    ),
    nonEmptyString(80)
  );

/** Generates a company name. */
const companyName = () =>
  fc.oneof(
    fc.constantFrom(
      'Google',
      'Microsoft',
      'Amazon',
      'Meta',
      'Apple',
      'Netflix',
      'Stripe',
      'Shopify',
      'Acme Corp',
      'TechStart Inc'
    ),
    nonEmptyString(60)
  );

/** Generates a location string. */
const location = () =>
  fc.oneof(
    fc.constantFrom(
      'San Francisco, CA',
      'New York, NY',
      'Remote',
      'London, UK',
      'Bangalore, India',
      'Berlin, Germany',
      'Toronto, Canada',
      'Austin, TX',
      'Seattle, WA',
      'Mumbai, India'
    ),
    nonEmptyString(50)
  );

/** Generates a valid URL. */
const jobUrl = () =>
  fc.oneof(
    fc.constantFrom(
      'https://linkedin.com/jobs/123',
      'https://indeed.com/viewjob?jk=abc',
      'https://glassdoor.com/job/456',
      'https://naukri.com/job/789',
      'https://uplers.com/jobs/101',
      'https://adzuna.com/details/202'
    ),
    fc.webUrl()
  );

/** Generates a supported source board. */
const sourceBoard = () =>
  fc.constantFrom('linkedin', 'indeed', 'glassdoor', 'naukri', 'uplers', 'adzuna');

/** Generates an optional salary string. */
const salary = () =>
  fc.oneof(
    fc.constant(null),
    fc.constantFrom(
      '$80,000 - $120,000',
      '₹10,00,000 - ₹15,00,000',
      '£50,000 - £70,000',
      '$150k - $200k',
      'Competitive'
    ),
    nonEmptyString(30)
  );

/** Generates an optional ISO date string (within the last year). */
const postedDate = () =>
  fc.oneof(
    fc.constant(null),
    fc.date({
      min: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      max: new Date(),
    }).map(d => d.toISOString())
  );

/** Generates a job description. */
const jobDescription = () =>
  fc.oneof(
    fc.constantFrom(
      'We are looking for a skilled developer to join our team.',
      'Join our fast-growing startup as we build the next generation platform.',
      'Seeking an experienced engineer with 5+ years in distributed systems.',
      'Remote-first company looking for passionate builders.'
    ),
    fc.string({ minLength: 10, maxLength: 500 })
  );

/** Generates a fit score (0-100 or null). */
const fitScore = () =>
  fc.oneof(
    fc.constant(null),
    fc.integer({ min: 0, max: 100 })
  );

/** Generates a sponsorship status. */
const sponsorshipStatus = () =>
  fc.constantFrom('available', 'unlikely', 'unknown');

/** Generates a sponsorship confidence level. */
const sponsorshipConfidence = () =>
  fc.constantFrom('full', 'reduced');

// --- Composite generators ---

/**
 * Generates a valid JobRecord object.
 * All required fields are non-null; optional fields may be null.
 */
const jobRecord = () =>
  fc.record({
    id: fc.uuid(),
    title: jobTitle(),
    company: companyName(),
    location: location(),
    description: jobDescription(),
    salary: salary(),
    url: jobUrl(),
    sourceBoard: sourceBoard(),
    postedDate: postedDate(),
    fitScore: fitScore(),
    fitExplanation: fc.oneof(fc.constant(null), nonEmptyString(200)),
    sponsorship: sponsorshipStatus(),
    sponsorshipConfidence: sponsorshipConfidence(),
  });

/**
 * Generates a list of JobRecords.
 * @param {Object} [options]
 * @param {number} [options.minLength=0]
 * @param {number} [options.maxLength=50]
 */
const jobRecordList = (options = {}) =>
  fc.array(jobRecord(), {
    minLength: options.minLength ?? 0,
    maxLength: options.maxLength ?? 50,
  });

/**
 * Generates a raw job listing as it might come from a scraper (before normalization).
 * Fields may be in different formats or missing.
 */
const rawJobListing = () =>
  fc.record({
    title: fc.oneof(jobTitle(), fc.constant(undefined)),
    job_title: fc.oneof(jobTitle(), fc.constant(undefined)),
    company: fc.oneof(companyName(), fc.constant(undefined)),
    company_name: fc.oneof(companyName(), fc.constant(undefined)),
    location: fc.oneof(location(), fc.constant(undefined)),
    job_location: fc.oneof(location(), fc.constant(undefined)),
    description: fc.oneof(jobDescription(), fc.constant(undefined)),
    salary: salary(),
    url: fc.oneof(jobUrl(), fc.constant(undefined)),
    link: fc.oneof(jobUrl(), fc.constant(undefined)),
    date_posted: postedDate(),
    posted_date: postedDate(),
  });

// --- Email generators (for application tracking) ---

/** Generates an email status category. */
const emailStatus = () =>
  fc.constantFrom('interview', 'rejection', 'offer', 'unknown');

/** Generates an email subject line relevant to job applications. */
const emailSubject = () =>
  fc.oneof(
    fc.constantFrom(
      'Interview Invitation - Software Engineer at Google',
      'We regret to inform you - Application Update',
      'Congratulations! Job Offer from Amazon',
      'Your application has been received',
      'Next steps: Phone screening scheduled',
      'Thank you for applying to Meta',
      'Application Status Update - Rejected',
      'Offer Letter - Senior Developer Position',
      'Schedule your interview with our team',
      'Unfortunately, we have decided to move forward with other candidates'
    ),
    nonEmptyString(120)
  );

/** Generates an email body with application-related content. */
const emailBody = () =>
  fc.oneof(
    fc.constantFrom(
      'Dear Candidate, We are pleased to invite you for an interview for the position of Software Engineer. Please find the details below.',
      'Thank you for your interest. After careful consideration, we have decided to move forward with other candidates.',
      'Congratulations! We are delighted to offer you the position of Senior Developer at our company. Please review the attached offer letter.',
      'We received your application and it is currently under review. We will get back to you within 2 weeks.',
      'Hi, we would like to schedule a phone screening with you. Please let us know your availability.'
    ),
    fc.string({ minLength: 20, maxLength: 1000 })
  );

/** Generates a sender email address. */
const emailFrom = () =>
  fc.oneof(
    fc.constantFrom(
      'hr@google.com',
      'recruiting@microsoft.com',
      'talent@amazon.com',
      'careers@meta.com',
      'hiring@stripe.com',
      'no-reply@greenhouse.io',
      'notifications@lever.co',
      'jobs@workday.com'
    ),
    fc.emailAddress()
  );

/** Generates an email date within the last 60 days. */
const emailDate = () =>
  fc.date({
    min: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    max: new Date(),
  }).map(d => d.toISOString());

/**
 * Generates an email object suitable for testing email classification.
 */
const emailObject = () =>
  fc.record({
    subject: emailSubject(),
    body: emailBody(),
    from: emailFrom(),
    date: emailDate(),
  });

/**
 * Generates a TrackerEntry object.
 */
const trackerEntry = () =>
  fc.record({
    id: fc.uuid(),
    company: fc.oneof(companyName(), fc.constant('Unknown Company')),
    status: emailStatus(),
    emailSubject: emailSubject(),
    emailDate: emailDate(),
    dismissed: fc.boolean(),
    manualCorrection: fc.oneof(fc.constant(null), emailStatus()),
  });

// --- User profile generators (for fit scoring) ---

/** Generates a list of skills. */
const skills = () =>
  fc.array(
    fc.constantFrom(
      'JavaScript',
      'Python',
      'Java',
      'TypeScript',
      'React',
      'Node.js',
      'AWS',
      'Docker',
      'Kubernetes',
      'SQL',
      'MongoDB',
      'GraphQL',
      'Go',
      'Rust',
      'C++',
      'Machine Learning',
      'Data Analysis',
      'Project Management',
      'Agile',
      'CI/CD'
    ),
    { minLength: 1, maxLength: 10 }
  );

/** Generates years of experience. */
const experienceYears = () =>
  fc.integer({ min: 0, max: 40 });

/** Generates an education level. */
const educationLevel = () =>
  fc.constantFrom(
    'High School',
    'Associate',
    'Bachelor',
    'Master',
    'PhD',
    'Bootcamp',
    'Self-taught'
  );

/** Generates preferred locations. */
const preferredLocations = () =>
  fc.array(location(), { minLength: 0, maxLength: 5 });

/** Generates a salary range. */
const salaryRange = () =>
  fc.record({
    min: fc.integer({ min: 20000, max: 150000 }),
    max: fc.integer({ min: 150001, max: 500000 }),
    currency: fc.constantFrom('USD', 'GBP', 'EUR', 'INR', 'CAD'),
  });

/**
 * Generates a user profile for fit scoring tests.
 * Some fields may be absent to test partial scoring.
 */
const userProfile = () =>
  fc.record({
    firstName: fc.constantFrom('Alice', 'Bob', 'Charlie', 'Diana', 'Eve'),
    lastName: fc.constantFrom('Smith', 'Johnson', 'Williams', 'Brown', 'Davis'),
    skills: skills(),
    experienceYears: experienceYears(),
    educationLevel: educationLevel(),
    preferredLocations: preferredLocations(),
    salaryMin: fc.integer({ min: 20000, max: 150000 }),
    salaryMax: fc.integer({ min: 150001, max: 500000 }),
    salaryCurrency: fc.constantFrom('USD', 'GBP', 'EUR', 'INR', 'CAD'),
  });

/**
 * Generates a partial user profile (some scoring dimensions missing).
 * Useful for testing Property 10 (partial scoring with excluded dimensions).
 */
const partialUserProfile = () =>
  fc.record({
    firstName: fc.constantFrom('Alice', 'Bob', 'Charlie'),
    lastName: fc.constantFrom('Smith', 'Johnson', 'Williams'),
    skills: fc.oneof(skills(), fc.constant(undefined)),
    experienceYears: fc.oneof(experienceYears(), fc.constant(undefined)),
    educationLevel: fc.oneof(educationLevel(), fc.constant(undefined)),
    preferredLocations: fc.oneof(preferredLocations(), fc.constant(undefined)),
    salaryMin: fc.oneof(fc.integer({ min: 20000, max: 150000 }), fc.constant(undefined)),
    salaryMax: fc.oneof(fc.integer({ min: 150001, max: 500000 }), fc.constant(undefined)),
    salaryCurrency: fc.oneof(
      fc.constantFrom('USD', 'GBP', 'EUR', 'INR', 'CAD'),
      fc.constant(undefined)
    ),
  });

// --- Filter criteria generators ---

/**
 * Generates a filter criteria object for testing filter correctness.
 */
const filterCriteria = () =>
  fc.record({
    boards: fc.oneof(
      fc.constant(undefined),
      fc.array(sourceBoard(), { minLength: 1, maxLength: 6 })
    ),
    location: fc.oneof(fc.constant(undefined), location()),
    jobType: fc.oneof(
      fc.constant(undefined),
      fc.constantFrom('full-time', 'part-time', 'contract', 'internship')
    ),
    datePosted: fc.oneof(
      fc.constant(undefined),
      fc.constantFrom('24h', 'week', 'month')
    ),
    minFitScore: fc.oneof(
      fc.constant(undefined),
      fc.integer({ min: 0, max: 100 })
    ),
    sponsorshipStatuses: fc.oneof(
      fc.constant(undefined),
      fc.array(sponsorshipStatus(), { minLength: 1, maxLength: 3 })
    ),
  });

// --- Search input generators ---

/**
 * Generates a valid search query (2-200 characters).
 */
const validSearchQuery = () =>
  fc.string({ minLength: 2, maxLength: 200 }).filter(s => s.trim().length >= 2);

/**
 * Generates an invalid search query (too short or too long).
 */
const invalidSearchQuery = () =>
  fc.oneof(
    fc.constant(''),
    fc.constant(' '),
    fc.string({ minLength: 0, maxLength: 1 }),
    fc.string({ minLength: 201, maxLength: 300 })
  );

/**
 * Generates a valid board selection (at least one board).
 */
const validBoardSelection = () =>
  fc.array(sourceBoard(), { minLength: 1, maxLength: 6 });

module.exports = {
  // Primitives
  nonEmptyString,
  jobTitle,
  companyName,
  location,
  jobUrl,
  sourceBoard,
  salary,
  postedDate,
  jobDescription,
  fitScore,
  sponsorshipStatus,
  sponsorshipConfidence,

  // Job records
  jobRecord,
  jobRecordList,
  rawJobListing,

  // Email / Tracker
  emailStatus,
  emailSubject,
  emailBody,
  emailFrom,
  emailDate,
  emailObject,
  trackerEntry,

  // User profiles
  skills,
  experienceYears,
  educationLevel,
  preferredLocations,
  salaryRange,
  userProfile,
  partialUserProfile,

  // Filters and search
  filterCriteria,
  validSearchQuery,
  invalidSearchQuery,
  validBoardSelection,
};
