// types.js - Shared JSDoc type definitions for JobPilot Enhanced Features
// These types are used across all new extension modules.

/**
 * @typedef {Object} JobRecord
 * @property {string} id - Deterministic hash of normalized (title, company, location)
 * @property {string} title - Job title
 * @property {string} company - Company name
 * @property {string} location - Job location
 * @property {string} description - Full job description text
 * @property {string|null} salary - Salary information if available
 * @property {string} url - Direct link to the job listing
 * @property {'linkedin'|'indeed'|'glassdoor'|'naukri'|'uplers'|'adzuna'} sourceBoard - Origin board
 * @property {string|null} postedDate - ISO date string or null
 * @property {number|null} fitScore - AI-computed score 0-100 or null if not yet scored
 * @property {string|null} fitExplanation - Brief explanation of score factors
 * @property {string[]} fitExcludedDimensions - Dimensions excluded due to missing profile data
 * @property {'available'|'unlikely'|'unknown'|null} sponsorship - Visa sponsorship status
 * @property {'full'|'reduced'} sponsorshipConfidence - Confidence level of sponsorship classification
 * @property {string} searchId - ID of the search that produced this record
 * @property {string[]} deduplicatedFrom - URLs merged into this record during deduplication
 */

/**
 * @typedef {Object} FailedBoard
 * @property {string} board - Board identifier that failed
 * @property {string} error - Human-readable failure reason
 */

/**
 * @typedef {Object} TrackerEntry
 * @property {string} id - Unique entry identifier
 * @property {string} company - Extracted company name or "Unknown Company"
 * @property {'interview'|'rejection'|'offer'|'unknown'} status - Detected application status
 * @property {string} emailSubject - Subject line of the classified email
 * @property {string} emailDate - ISO date string of the email received date
 * @property {string} emailSnippet - First 200 characters of the email body
 * @property {boolean} dismissed - Whether the user dismissed this entry
 * @property {string|null} manualCorrection - User-provided status correction or null
 * @property {string} detectedAt - ISO date string when the entry was detected
 */

/**
 * @typedef {Object} SponsorshipResult
 * @property {'available'|'unlikely'|'unknown'} status - Classification result
 * @property {'full'|'reduced'} confidence - Whether AI was available for classification
 */
