# Requirements Document

## Introduction

This document specifies requirements for five new capabilities to be added to the JobPilot AI Chrome extension: multi-board job search, AI-powered resume tailoring, job fit scoring, Gmail-based application tracking, and visa sponsorship detection. These features extend the existing LinkedIn-only auto-applier into a comprehensive job search and application management platform.

The architecture introduces a Python scraping backend (using python-jobspy) callable via Firebase Functions or a lightweight Node.js relay, while the Chrome extension frontend gains new UI panels and background processing capabilities.

## Glossary

- **Extension**: The JobPilot AI Chrome Extension (Manifest V3) that runs in the user's browser
- **Backend**: Firebase Cloud Functions (Node.js) that power server-side operations
- **Scraping_Service**: A Python service using python-jobspy that fetches job listings from multiple job boards
- **AI_Engine**: The LLM integration (OpenAI/Gemini/DeepSeek) used for text generation and analysis
- **Job_Record**: A normalized data object representing a single job listing regardless of source board
- **User_Profile**: The stored collection of user experience, skills, education, and preferences
- **Resume_Store**: The user's uploaded or stored base resume content (text + optional PDF)
- **Fit_Score**: A numeric value 0-100 representing how well a job matches a user's profile
- **Tracker**: The application tracking subsystem that monitors Gmail for status updates
- **Gmail_OAuth**: Google OAuth 2.0 integration granting read-only access to the user's Gmail inbox

## Requirements

### Requirement 1: Multi-Board Job Search

**User Story:** As a job seeker, I want to search for jobs across multiple job boards (Indeed, Glassdoor, LinkedIn, Adzuna) from a single interface, so that I can discover more opportunities without visiting each site manually.

#### Acceptance Criteria

1. WHEN the user initiates a job search with at least one selected board and a search query between 2 and 200 characters, THE Backend SHALL invoke the Scraping_Service to fetch listings from all selected boards concurrently with a per-board timeout of 30 seconds.
2. THE Scraping_Service SHALL support at minimum the following boards: LinkedIn, Naukri.com, Uplers, Indeed, Glassdoor, and Adzuna.
3. WHEN the Scraping_Service returns results, THE Backend SHALL normalize each listing into a Job_Record containing: title, company, location, description, salary (if available), URL, source board, and posting date.
4. IF the Scraping_Service fails to fetch from one board or a board does not respond within 30 seconds, THEN THE Backend SHALL return results from successful boards and include an error indicator identifying each failed board and the failure reason.
5. WHEN results are ready, THE Extension SHALL display up to 100 Job_Records per search in a paginated unified list with a visual indicator of the source board for each listing.
6. THE Extension SHALL allow the user to filter results by source board, location, job type (full-time, part-time, contract, internship), and date posted.
7. THE Backend SHALL deduplicate Job_Records that appear on multiple boards by performing case-insensitive matching on title, company, and location, retaining the listing with the most complete data.
8. WHEN the user configures search preferences, THE Extension SHALL persist the selected boards and search terms in chrome.storage.local.
9. IF the user initiates a search with no boards selected or a search query shorter than 2 characters or longer than 200 characters, THEN THE Extension SHALL display a validation error indicating the input requirements and SHALL NOT invoke the Backend.

### Requirement 2: AI-Powered Resume Tailoring

**User Story:** As a job applicant, I want my resume automatically rewritten to match each job description, so that I can present the most relevant experience for every application.

#### Acceptance Criteria

1. WHEN the user selects a Job_Record for tailoring, THE Extension SHALL send the job description and User_Profile to the AI_Engine via the Backend.
2. THE AI_Engine SHALL rewrite resume bullet points to emphasize skills and keywords present in the job description while preserving factual accuracy of the user's experience.
3. WHEN the AI_Engine returns rewritten content, THE Backend SHALL generate a tailored PDF resume from that content using a predefined template.
4. WHEN the tailored PDF is generated successfully, THE Extension SHALL provide a rendered preview of the first page of the tailored resume. THE Extension MAY display the preview without enabling download. A download link SHALL also be provided alongside the preview. IF PDF generation fails or is still in progress, THE Extension SHALL NOT display a preview.
5. IF any component in the tailoring pipeline fails (AI_Engine, PDF generation, or Backend processing), THEN THE Extension SHALL display an error message indicating the failure reason and the failing component, and offer the user the option to retry. THE Extension SHALL NOT provide download functionality until the user explicitly acknowledges the error.
6. THE AI_Engine SHALL preserve all factual claims (dates, company names, degree titles) from the original resume and modify only phrasing and emphasis.
7. WHEN the user uploads or updates their base resume, THE Resume_Store SHALL accept files in PDF or DOCX format up to 5 MB in size, parse the content, and store it for use in future tailoring operations. IF the uploaded file exceeds 5 MB, THEN THE Extension SHALL display a specific error message stating the file size limit and the actual file size.
8. THE Backend SHALL complete resume tailoring and PDF generation within 30 seconds of the user's request.
9. IF the user selects a Job_Record for tailoring and no base resume exists in the Resume_Store, THEN THE Extension SHALL display an error message indicating that a base resume must be uploaded before tailoring and provide a link to the resume upload interface.
10. WHILE the Backend is processing a tailoring request, THE Extension SHALL display a progress indicator to the user until the tailored PDF is ready or an error occurs.

### Requirement 3: Job Fit Scoring

**User Story:** As a job seeker, I want each job scored against my profile so that I can prioritize applications for roles where I am the strongest match.

#### Acceptance Criteria

1. WHEN a Job_Record is retrieved, THE Backend SHALL compute a Fit_Score by comparing the job description against the User_Profile and return the result within 10 seconds of retrieval.
2. THE Fit_Score SHALL be an integer from 0 to 100 where 0 indicates no match and 100 indicates a perfect match.
3. THE AI_Engine SHALL consider the following dimensions when computing Fit_Score: skills match, experience level alignment, education requirements, location compatibility, and salary range fit.
4. WHEN the Fit_Score is computed, THE Extension SHALL display the numeric score alongside each Job_Record in the search results.
5. THE Extension SHALL allow the user to sort search results by Fit_Score in descending order.
6. THE Extension SHALL allow the user to set a minimum Fit_Score threshold (between 0 and 100, default 0) below which jobs are hidden from results, and SHALL persist the threshold value in chrome.storage.local.
7. WHEN the user updates their User_Profile, THE Backend SHALL recompute Fit_Scores for all cached Job_Records within 60 seconds of the profile update.
8. THE Backend SHALL include a brief explanation (two to three sentences) of the primary factors contributing to each Fit_Score.
9. IF the AI_Engine fails to compute a Fit_Score for a Job_Record, THEN THE Extension SHALL hide any previously cached score for that listing and display only an indicator that scoring is unavailable.
10. IF the User_Profile is missing data for one or more scoring dimensions (skills, experience, education, location, or salary preference), THEN THE AI_Engine SHALL compute the Fit_Score using only the available dimensions and THE Backend SHALL indicate which dimensions were excluded from the calculation.

### Requirement 4: Application Tracking via Gmail

**User Story:** As a job applicant, I want my extension to automatically detect interview invitations, rejections, and offers from my Gmail, so that I can track my application pipeline without manual data entry.

#### Acceptance Criteria

1. WHEN the user connects their Gmail account, THE Extension SHALL initiate Gmail_OAuth requesting read-only access (scope: gmail.readonly) to the user's inbox.
2. THE Extension SHALL store the OAuth refresh token in chrome.storage.local using the Chrome identity API.
3. WHEN the user has an active Gmail_OAuth connection AND a scan is triggered (every 15 minutes or manually by the user), THE Tracker SHALL scan for new emails matching application-related patterns (interview invitations, rejection notices, offer letters).
4. WHEN the Tracker identifies an application status email, THE Tracker SHALL extract the company name, status (interview, rejection, offer), and the email received date from the email content.
5. IF the Tracker cannot extract the company name from an email, THEN THE Tracker SHALL label the entry as "Unknown Company" and include the email subject line for manual identification.
6. THE Extension SHALL display a tracking dashboard showing all detected application statuses grouped by company with timestamps.
7. IF the Tracker misclassifies an email, THEN THE Extension SHALL allow the user to manually correct the status or dismiss the detected entry entirely.
8. THE Tracker SHALL scan only emails received within the last 30 days from the current date and SHALL NOT process emails older than 30 days.
9. IF the Gmail_OAuth token expires but is not revoked, THEN THE Extension SHALL display a notification badge on the extension icon only. IF the Gmail_OAuth token is revoked but not expired, THEN THE Extension SHALL display a notification badge and prompt re-authentication when the user opens the popup. IF the token is both expired and revoked simultaneously, THEN THE Extension SHALL show only the re-authentication prompt without the notification badge.

### Requirement 5: Visa Sponsorship Detection

**User Story:** As an international job seeker, I want jobs that offer visa sponsorship clearly flagged, so that I can focus my effort on positions where I am eligible to work.

#### Acceptance Criteria

1. WHEN a Job_Record is retrieved, THE Backend SHALL analyze the job description for visa sponsorship indicators and assign a sponsorship flag within 5 seconds.
2. IF the job description contains explicit mentions of visa sponsorship, H-1B, work permit assistance, J-1 sponsorship, or employer-sponsored work visa, THEN THE Backend SHALL flag the job as "Sponsorship Available".
3. IF the job description contains phrases such as "must be authorized to work", "no sponsorship", "US citizens only", "requires active security clearance", or "permanent resident required", THEN THE Backend SHALL flag the job as "Sponsorship Unlikely".
4. IF the job description contains no visa-related language, THEN THE Backend SHALL flag the job as "Sponsorship Unknown".
5. THE Backend SHALL classify sponsorship status by first checking for positive indicators, then negative indicators. IF positive indicators are found, THEN THE Backend SHALL immediately flag as "Sponsorship Available" without further conflict checking. IF negative indicators are found (and no positive indicators), THEN THE Backend SHALL immediately flag as "Sponsorship Unlikely". IF no visa-related language is found, THEN THE Backend SHALL flag as "Sponsorship Unknown".
6. IF the job description contains visa-related language that does not match the positive or negative indicator lists, THEN THE Backend SHALL process it through AI_Engine contextual analysis to determine the appropriate classification. IF the AI_Engine is unavailable, THE Backend SHALL process the analysis using keyword-matching-only and indicate reduced confidence.
7. WHEN a visa sponsorship flag is determined, THE Extension SHALL display a visual badge on the Job_Record indicating the sponsorship status using a distinct label and color per status category.
8. THE Extension SHALL allow the user to filter search results by one or more sponsorship statuses ("Sponsorship Available", "Sponsorship Unlikely", "Sponsorship Unknown").
9. THE Backend SHALL use keyword matching combined with AI_Engine contextual analysis to classify sponsorship status, resolving ambiguous phrasing by considering surrounding sentence context rather than isolated keyword presence.
10. IF the AI_Engine is unavailable during sponsorship analysis, THEN THE Backend SHALL fall back to keyword-matching-only classification and indicate reduced confidence on the resulting flag.
11. IF the AI_Engine is available but the job description contains highly ambiguous or conflicting sponsorship language, THEN THE Backend SHALL classify using best-effort AI analysis without indicating reduced confidence.
