# Reference Integration Plan

Date: 2026-08-30

## Goals

Adopt high-value workflow ideas from `ai-job-search-master` without replacing the vanilla MV3/Firebase architecture, weakening final-submit safeguards, exposing provider credentials, or inventing platform support.

## Configuration precedence

All new search behavior follows this order:

1. Explicit request input.
2. Persisted user configuration.
3. Extracted professional profile fields where explicitly supported.
4. Generic safe defaults only when they are not candidate facts.

No candidate-specific title, location, skill, salary, company, experience, answer, or resume fact may be hardcoded. AI cannot override a deterministic exclusion.

## Implemented high-confidence slice

| Capability | Files | Behavior | Tests |
|---|---|---|---|
| Monthly quota alignment | `plan-config.js`, `plan-service.js`, `quota-service.js`, `api-client.js`, `upgrade-modal.js` | Free 10/month; Pro 50/month. Local roles no longer elevate access. Only verified token claims bypass backend quota. | `plan-config`, `plan-service`, `admin-role`, `quota-service-backend`, `quota-consume` |
| Multi-query discovery | `functions/job-matching.js` | Executes configured title/keyword and location combinations separately, max 20 requests, max 3 concurrent, continues after query failures, records provenance. | `job-matching-backend.test.js` |
| Hard exclusions and deterministic rank | `functions/job-matching.js` | Emits exclusion reason codes; only eligible jobs reach AI; ties resolve by score, posting date, then stable ID. | `job-matching-backend.test.js` |
| AI cache/concurrency | `functions/ai-job-matcher.js`, `functions/scoring.js` | Cache key includes resume digest, job identity/content, prompt version, provider and model; cache misses and legacy per-job scoring use bounded workers; empty profiles fail with `PROFILE_INCOMPLETE`. | `ai-job-matcher`, `scoring-provider` |
| URL identity and dedupe | `normalization.js`, `deduplication.js` | Removes tracking parameters, sorts remaining query parameters, keeps merged IDs stable, preserves source/query provenance. | `backend-normalization-deduplication.test.js` |
| Backend UI pagination | `search.js`, `jobs-tracker-handlers.js` | Backend page metadata is used directly; page controls request another backend page instead of slicing the first page again. | `jobs-tracker-handlers.test.js` |
| Consent-safe autofill | `field-matcher.js`, `base-adapter.js`, `form-filler.js` | Legal/attestation checkboxes require explicit action; low-confidence AI stays review-only; generic adapter stops at final review. | `form-filler`, `autofill-boundaries` |
| External confirmation | `application-state.js`, `application-orchestrator.js`, `job-matches-screen.js` | Opening an external page remains non-submission. A separate user confirmation records a distinct terminal state without consuming LinkedIn quota. | `application-state`, `application-orchestrator` |
| Candidate config privacy | `config/questions.py`, `config/search.py`, `.env.example` | Removes tracked candidate answers/search facts and loads legacy bot values from environment variables; required facts fail validation when absent. | Python syntax/validator smoke check. |
| Rules/privacy | `firestore.rules`, `storage.rules`, `docs/privacy.html` | Denies client system writes, makes nested backend records read-only to owners, constrains resume uploads, and documents actual processing/integrations. | Static security contract plus repository validation. |

## Task 4 production completion

1. **Durable search snapshots:** both ordinary and AI-ranked discovery persist bounded server-owned sessions and immutable result documents with 24-hour expiry metadata. Later pages read the first snapshot instead of scraping again.
2. **Resumable orchestration:** session state, query/source progress, cancellation request/acknowledgement, partial failures, AI status, and result counts survive popup and MV3 worker restarts.
3. **Safe AI degradation:** deterministic eligible jobs remain available with `AI_UNAVAILABLE`; hard exclusions still run before AI. Query work and AI batches check cooperative cancellation boundaries.
4. **Candidate truth contract:** immutable candidate snapshots preserve explicit-over-persisted precedence. One answer resolver leaves unknown/legal/low-confidence values for user action.
5. **Application boundary:** LinkedIn requires final review, quota remains immediately before the click, uncertain submissions block automatic retries, and CAPTCHA/MFA/authwall states stop for manual action.
6. **Confirmed history:** direct provider confirmation and explicit external confirmation write idempotent server-owned ledger entries. Opening an external URL is never a confirmed outcome.
7. **Truthful UI/contracts:** the popup exposes phase/progress, partial warnings, cancellation, stable pages, AI degradation, and confirmed history; unsupported platforms remain disabled.

## Remaining deployment phases

1. **Persistent AI cache:** move the bounded process cache to a server-owned TTL store with model/prompt/profile invalidation and no raw resume text in keys or logs.
2. **Quota reconciliation:** add a server-side attempt lifecycle for a quota unit consumed before an ultimately unconfirmed click, without automatic resubmission.
3. **Rules emulator suite:** add credentialed Firebase emulator coverage for cross-user session/result/application reads and all denied client writes.
4. **Retention jobs:** enforce deletion of expired search snapshots and expose explicit cloud-data deletion controls.
5. **Live validation:** load `dist/extension` unpacked and validate LinkedIn, Indeed, and Glassdoor with non-production accounts. Gmail, ZipRecruiter, and generic ATS remain outside production support.

## Validation gates

Each phase must pass targeted Jest tests, `npm run lint`, `npm run validate:extension`, `npm run build`, full Jest, and `git diff --check`. Browser-only claims require loading `dist/extension` unpacked and testing on live supported pages with non-production accounts.