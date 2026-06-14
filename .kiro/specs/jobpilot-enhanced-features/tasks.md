# Implementation Plan: JobPilot Enhanced Features

## Overview

This plan implements five new capabilities for the JobPilot AI Chrome extension: multi-board job search, AI-powered resume tailoring, job fit scoring, Gmail-based application tracking, and visa sponsorship detection. The implementation is ordered with shared infrastructure first, then feature-specific modules, then integration wiring.

**Languages**: JavaScript (vanilla, Chrome Extension + Cloud Functions Node.js 20), Python 3.11 (scraping service)
**Testing**: Jest + fast-check (property-based testing)

## Tasks

- [x] 1. Set up shared infrastructure and core utilities
  - [x] 1.1 Create shared utility modules and type definitions
    - Create `extension/modules/shared/types.js` with JSDoc typedefs for JobRecord, FailedBoard, TrackerEntry, SponsorshipResult
    - Create `extension/modules/shared/api-client.js` with `callBackend()` wrapper, `ApiError` class, and retry logic
    - Create `extension/modules/shared/validators.js` with `validateSearchInput()`, `validateResumeFile()`, `validateFitScoreThreshold()`
    - Create `extension/modules/shared/hash.js` with `hashString()` and `generateJobId()` functions
    - _Requirements: 1.3, 1.9, 2.7, 3.2_

  - [x] 1.2 Set up testing infrastructure with fast-check
    - Add `fast-check` to devDependencies in root `package.json`
    - Create `tests/properties/` directory structure
    - Create `tests/helpers/generators.js` with fast-check arbitraries for JobRecord, email objects, user profiles
    - _Requirements: All (testing infrastructure)_

  - [x] 1.3 Update Chrome extension manifest for new permissions
    - Add `alarms` permission to manifest.json
    - Add `https://www.googleapis.com/gmail/v1/*` to host_permissions
    - Add `oauth2` section with gmail.readonly scope
    - Register new module files in content_scripts (search, resume, fit-score, tracker, visa)
    - _Requirements: 4.1, 4.2_

  - [x] 1.4 Create Firestore security rules and data model setup
    - Create `firestore.rules` entries for new collections: `users/{userId}/jobs`, `users/{userId}/resumes`, `users/{userId}/tracker`, `users/{userId}/tokens`
    - Extend `users/{userId}/settings/profile` schema with new scoring fields (skills, educationLevel, preferredLocations, salaryMin, salaryMax, salaryCurrency)
    - _Requirements: 1.3, 2.7, 3.1, 4.4_

- [x] 2. Implement multi-board job search
  - [x] 2.1 Create Python scraping service
    - Create `scraper/` directory with `main.py`, `requirements.txt`, `Dockerfile`
    - Implement Flask app with `/scrape` POST endpoint
    - Implement `scrape_single_board()` with per-board 30s timeout using ThreadPoolExecutor
    - Support boards: linkedin, indeed, glassdoor, naukri, uplers, adzuna
    - Return aggregated results with failed_boards array
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 2.2 Implement job normalization and deduplication logic
    - Create `functions/lib/normalization.js` with `normalizeJobRecord()`, `getNestedValue()`, board field maps
    - Create `functions/lib/deduplication.js` with `deduplicateJobs()`, `buildDeduplicationKey()`, `countNonNullFields()`
    - Implement deterministic ID generation via SHA-256 hash of normalized (title, company, location)
    - _Requirements: 1.3, 1.7_

  - [ ]* 2.3 Write property tests for normalization (Property 1)
    - **Property 1: Normalization Completeness**
    - Test that for any raw listing from any board, normalizeJobRecord produces a JobRecord with non-null id, title, company, location, url, sourceBoard
    - **Validates: Requirements 1.3**

  - [ ]* 2.4 Write property tests for deduplication (Property 4)
    - **Property 4: Deduplication Correctness**
    - Test that output contains no two records with the same normalized key, and retained record has highest non-null field count
    - **Validates: Requirements 1.7**

  - [x] 2.5 Implement searchJobs Cloud Function
    - Create `functions/search.js` with auth validation, input validation, scraper call, normalization, deduplication, Firestore batch write, and paginated response
    - Set timeout to 60s, implement CORS headers, request ID propagation
    - _Requirements: 1.1, 1.3, 1.4, 1.7_

  - [x] 2.6 Implement extension search module
    - Create `extension/modules/search/search-service.js` with `searchJobs()`, `validateSearchInput()`, `cacheSearchResults()`
    - Implement chrome.storage.local persistence for board selection and last query
    - Implement client-side pagination (20 results per page)
    - _Requirements: 1.5, 1.6, 1.8, 1.9_

  - [ ]* 2.7 Write property tests for search validation (Property 6) and preferences round-trip (Property 5)
    - **Property 6: Search Input Validation**
    - **Property 5: Search Preferences Round-Trip**
    - **Validates: Requirements 1.8, 1.9**

- [x] 3. Checkpoint - Ensure search module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement job filtering and sorting
  - [x] 4.1 Create combined filter and sort functions
    - Create `extension/modules/shared/filters.js` with `filterJobs()` supporting boards, location, jobType, datePosted, minFitScore, sponsorshipStatuses
    - Implement `sortByFitScore()` with null-score-at-end logic
    - Implement `getDateCutoff()` for 24h/week/month periods
    - _Requirements: 1.6, 3.5, 3.6, 5.8_

  - [ ]* 4.2 Write property tests for filtering (Property 3) and sorting (Property 9)
    - **Property 3: Job Filter Correctness**
    - **Property 9: Sort by Fit Score Correctness**
    - **Validates: Requirements 1.6, 3.5, 3.6, 5.8**

- [x] 5. Implement AI-powered resume tailoring
  - [x] 5.1 Implement resume upload Cloud Function
    - Create `functions/resume.js` with `uploadResume` endpoint handling multipart/form-data
    - Validate file type (PDF/DOCX) and size (≤5 MB)
    - Parse text content from uploaded file and store in Firestore `users/{userId}/resumes/{resumeId}`
    - Store file in Cloud Storage, save reference URL
    - _Requirements: 2.7_

  - [x] 5.2 Implement resume tailoring Cloud Function
    - Add `tailorResume` endpoint to `functions/resume.js`
    - Fetch job description and user profile, build AI prompt for keyword-emphasized rewriting
    - Call AI engine, validate factual preservation (dates, companies, degrees)
    - Generate PDF from tailored content using pdfkit
    - Return pdfUrl and previewUrl; enforce 30s timeout
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.8_

  - [x] 5.3 Implement extension resume module
    - Create `extension/modules/resume/resume-service.js` with `uploadBaseResume()`, `tailorResumeForJob()`, `hasBaseResume()`
    - Implement progress indicator state management during tailoring
    - Handle error states: no base resume, file too large, AI failure, PDF generation failure
    - Provide retry mechanism on failure
    - _Requirements: 2.4, 2.5, 2.9, 2.10_

  - [ ]* 5.4 Write property tests for resume file validation (Property 7)
    - **Property 7: Resume File Validation**
    - Test that files >5MB or invalid MIME types are rejected; valid files are accepted
    - **Validates: Requirements 2.7**

- [x] 6. Implement job fit scoring
  - [x] 6.1 Implement fit score Cloud Function
    - Create `functions/scoring.js` with `computeFitScore` and `recomputeScores` endpoints
    - Build AI prompt using `buildFitScorePrompt()` with all 5 dimensions
    - Parse AI response, normalize score with `normalizeScore()` (clamp to 0-100 integer)
    - Handle missing profile dimensions: compute with available data, list excluded dimensions
    - Enforce 10s timeout per job
    - _Requirements: 3.1, 3.2, 3.3, 3.8, 3.10_

  - [x] 6.2 Implement batch recompute on profile update
    - In `functions/scoring.js`, `recomputeScores` fetches all cached jobs for user, recomputes each score, updates Firestore
    - Complete within 60s timeout
    - _Requirements: 3.7_

  - [x] 6.3 Implement extension fit-score module
    - Create `extension/modules/fit-score/fit-score-service.js` with `getFitScore()`, `recomputeAllScores()`, `fitScoreThreshold()`
    - Cache scores in chrome.storage.local per jobId
    - Display numeric score and explanation alongside each job
    - Handle unavailable scores gracefully (hide cached, show "unavailable" indicator)
    - _Requirements: 3.4, 3.5, 3.6, 3.9_

  - [ ]* 6.4 Write property tests for fit score (Properties 8, 10)
    - **Property 8: Fit Score Range Constraint**
    - **Property 10: Partial Scoring with Excluded Dimensions**
    - **Validates: Requirements 3.2, 3.10**

- [x] 7. Checkpoint - Ensure scoring and resume tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement visa sponsorship detection
  - [x] 8.1 Implement sponsorship classification Cloud Function
    - Create `functions/visa.js` with `classifySponsorship` endpoint
    - Implement keyword lists: POSITIVE_INDICATORS, NEGATIVE_INDICATORS
    - Implement priority logic: positive → "available", negative → "unlikely", none → "unknown"
    - Handle ambiguous visa language: use AI if available, fallback to keyword-only with reduced confidence
    - Support batch classification via jobIds array
    - Enforce 5s timeout per job
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 5.10, 5.11_

  - [x] 8.2 Implement extension visa module
    - Create `extension/modules/visa/visa-service.js` with `getSponsorshipStatus()`, `filterBySponsorshipStatus()`
    - Display visual badge (color-coded) on each JobRecord: green/available, red/unlikely, gray/unknown
    - Allow filtering by one or more sponsorship statuses
    - _Requirements: 5.7, 5.8_

  - [ ]* 8.3 Write property tests for sponsorship classification (Properties 14, 15)
    - **Property 14: Sponsorship Classification Priority**
    - **Property 15: AI Fallback Confidence Indicator**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.10, 5.11**

- [x] 9. Implement application tracking via Gmail
  - [x] 9.1 Implement Gmail OAuth and token management
    - Create `extension/modules/tracker/tracker-service.js` with `connectGmail()`, `disconnectGmail()`
    - Use chrome.identity API for OAuth flow with gmail.readonly scope
    - Store refresh token in chrome.storage.local via Chrome identity API
    - Handle token expiry: badge notification on icon; revoked: prompt re-authentication in popup
    - _Requirements: 4.1, 4.2, 4.9_

  - [x] 9.2 Implement scanGmail Cloud Function
    - Create `functions/tracker.js` with `scanGmail` endpoint
    - Fetch user's Gmail OAuth token from Firestore, refresh if needed
    - Query Gmail API for emails from last 30 days matching application patterns
    - Classify each email using `classifyEmail()` pattern matching
    - Extract company name using multi-strategy `extractCompanyName()`
    - Store TrackerEntry records in Firestore; return new entries
    - _Requirements: 4.3, 4.4, 4.5, 4.8_

  - [x] 9.3 Implement extension tracker dashboard and scheduling
    - Add alarm-based Gmail scan every 15 minutes in service-worker.js using chrome.alarms API
    - Create tracker dashboard UI showing statuses grouped by company with timestamps
    - Implement manual "Scan Now" trigger
    - Implement manual correction and dismissal of tracker entries
    - _Requirements: 4.3, 4.6, 4.7_

  - [ ]* 9.4 Write property tests for email classification (Property 11), correction (Property 12), and date filter (Property 13)
    - **Property 11: Email Classification and Extraction**
    - **Property 12: Tracker Correction Persistence**
    - **Property 13: 30-Day Email Date Filter**
    - **Validates: Requirements 4.3, 4.4, 4.7, 4.8**

- [x] 10. Checkpoint - Ensure tracker and visa tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Integration wiring and UI assembly
  - [x] 11.1 Build popup UI panels for Jobs and Tracker tabs
    - Add "Jobs" and "Tracker" navigation tabs to `extension/ui/popup.html`
    - Create Jobs tab: search bar, board checkboxes, filter row (jobType, datePosted, sponsorship, minScore, sort), results list, pagination
    - Create Tracker tab: Gmail connect button, tracker dashboard with scan-now button and entry list
    - Style new panels consistent with existing extension CSS
    - _Requirements: 1.5, 1.6, 4.6, 5.7_

  - [x] 11.2 Wire extension modules to UI event handlers
    - Connect search UI to search-service.js (search button, filter changes, pagination)
    - Connect resume tailoring button per job card to resume-service.js
    - Connect fit score display to fit-score-service.js (auto-fetch on results load)
    - Connect visa badge display to visa-service.js (auto-fetch on results load)
    - Connect tracker UI to tracker-service.js (connect, scan, correct, dismiss)
    - _Requirements: 1.5, 2.4, 3.4, 4.6, 5.7_

  - [x] 11.3 Wire Cloud Functions index and deploy configuration
    - Update `functions/index.js` to export all new functions: searchJobs, uploadResume, tailorResume, computeFitScore, recomputeScores, scanGmail, classifySponsorship
    - Update `functions/package.json` with new dependencies (pdfkit, node-fetch, etc.)
    - Create `functions/lib/ai-client.js` shared AI engine wrapper for OpenAI/Gemini/DeepSeek
    - _Requirements: All backend requirements_

  - [ ]* 11.4 Write property test for partial failure resilience (Property 2)
    - **Property 2: Partial Failure Resilience**
    - Test that when a subset of boards fails, response contains results from successful boards AND failedBoards array
    - **Validates: Requirements 1.4**

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The Python scraping service (task 2.1) can be developed and tested independently from the extension
- Cloud Functions (tasks 2.5, 5.1, 5.2, 6.1, 6.2, 8.1, 9.2) require Firebase emulator for local testing
- Extension modules use vanilla JS with JSDoc types — no TypeScript compilation step needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.2", "4.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "4.2"] },
    { "id": 3, "tasks": ["2.6", "2.7", "5.1", "8.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "6.1", "8.2", "8.3"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 7, "tasks": ["11.1", "11.3"] },
    { "id": 8, "tasks": ["11.2", "11.4"] }
  ]
}
```
