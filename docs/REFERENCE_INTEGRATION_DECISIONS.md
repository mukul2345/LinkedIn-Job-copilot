# Reference Integration Decisions

Date: 2026-08-30

## Decision register

| ID | Decision | Evidence | Reason | Implementation / status | Risk and verification |
|---|---|---|---|---|---|
| D-01 | KEEP transactional quota consumption | `functions/quota-service.js::consumeQuota` | Transaction and idempotency key prevent concurrent/double consumption. | Preserved at final LinkedIn boundary. | Verify retries consume once and failures fail closed. |
| D-02 | KEEP uncertain-submission stop | `job-processor.js::processEasyApplyModal` | Missing confirmation must not trigger automatic retry. | Preserved. | Quota reconciliation remains future work. |
| D-03 | KEEP conservative deduplication | `functions/lib/deduplication.js` | High-confidence evidence avoids merging unrelated same-title jobs. | Preserved and made order-stable. | Test ambiguous cross-platform roles remain separate. |
| D-04 | ADAPT independent portal/query execution | Reference scraper skill step 1b | Independent calls provide diagnosable partial failure and provenance. | Bounded clean-room implementation in `job-matching.js`. | Max 20 requests and 3 concurrent; report truncation/failures. |
| D-05 | ADAPT hard veto before scoring | Reference `rank.md` steps 3–4 | Eligibility, location, language, salary, and explicit exclusions must not be averaged away. | Existing hard filters now emit reason codes and precede AI. | Missing fields do not become guessed failures. |
| D-06 | ADAPT explicit external outcome | Reference `apply.md` and `/outcome` | Draft/open is not applied. | Added `EXTERNAL_SUBMISSION_CONFIRMED` after separate user confirmation. | This is user attestation, not portal receipt proof. |
| D-07 | ADAPT versioned caching | Reference cache test patterns | Repeated model calls waste cost and can create inconsistent results. | Process cache includes resume/job digest, prompt version, provider, model. | Process-local only; persistent TTL cache is future work. |
| D-08 | REPLACE client daily/unlimited quota text | Backend `MONTHLY_LIMITS` | Client and server contradicted each other. | Client now displays 10/50 monthly; server response includes period metadata. | Backend remains authority. |
| D-09 | REPLACE client/Firestore admin trust | Firestore user data and quota handler | Client-controlled or mutable profile roles cannot authorize a bypass. | Only verified Firebase custom claim reaches `isAdmin`. | Custom-claim assignment must remain server-only. |
| D-10 | REPLACE inferred consent | `form-filler.js`, dormant generic `base-adapter.js` | Terms, privacy, attestations, and preferences require user intent. | Checkboxes are not inferred; low-confidence AI is review-only. | Required fields surface as user input. |
| D-11 | UNSAFE arbitrary URL fetching | Reference Jobindex detail behavior | Unrestricted server fetch creates SSRF and data-exfiltration risk. | Not integrated. | Future clients require host allowlists and HTTPS validation. |
| D-12 | UNSAFE bulk/cookie LinkedIn scraping | Reference LinkedIn skill warning | Brittle, account-risking, and potentially terms-incompatible. | Not integrated. | Current support remains user-controlled extension behavior. |
| D-13 | UNSAFE automatic email sending | Reference Gmail workflow | Email classification is uncertain and outreach is consequential. | Not integrated. | Gmail remains optional/unvalidated. |
| D-14 | FUTURE ZipRecruiter | No executable implementation in either product flow | A label is not support. | Registry remains unsupported. | Requires backend, adapter, tests, and browser validation. |
| D-15 | FUTURE generic ATS automation | Dormant `adapters.js` not in manifest | Existing classes are not a shipped capability. | Hardened but not enabled or claimed. | Vendor-specific validation is mandatory. |
| D-16 | FUTURE Gmail activation | `tracker.js` contract mismatch | Chrome Identity and backend token-document expectations conflict; dedupe IDs are unstable. | Privacy disclosure corrected; feature not claimed as production-ready. | Redesign around stable Gmail message IDs and proposed updates. |
| D-17 | ADD durable search sessions | Task 4 lifecycle audit | Fresh-scrape pagination shifts membership and popup state does not survive MV3 suspension. | Added versioned server-owned sessions, immutable result documents, stable pages, progress, resume, and 24-hour expiry metadata. | Retention cleanup and emulator validation remain deployment work. |
| D-18 | ADD cooperative cancellation | Task 4 cancellation audit | UI-only stop flags cannot govern backend query and model work. | Persist cancellation request/acknowledgement; check before/after query calls and AI batches; terminal state rejects late completion. | In-flight network calls cannot always be physically aborted. |
| D-19 | DEGRADE AI safely | Task 4 AI audit | Provider failure formerly discarded discovered jobs. | Return deterministic eligible jobs as unscored with `AI_UNAVAILABLE`. | Users must manually review unscored jobs. |
| D-20 | REQUIRE final review | Reference `/apply` review boundary | Consequential submission must remain user-controlled. | Legacy opt-out is ignored; quota is consumed only after explicit final confirmation. | Requires live LinkedIn browser validation. |
| D-21 | ADD candidate snapshot and resolver | Reference form-grounding contract | Distributed fallback logic could apply low-confidence text inconsistently. | Explicit facts override persisted/reviewed facts; legal, unknown, and AI-draft answers remain manual. | Candidate profile review UX can be expanded later. |
| D-22 | ADD confirmed outcome ledger | Reference `/outcome` separation | Local mutable history is not authoritative and opening is not applying. | Added idempotent server-owned entries only for provider-confirmed direct or user-confirmed external outcomes. | Legacy local history remains a compatibility fallback. |

## Non-negotiable invariants

- Explicit user input wins over persisted settings, defaults, and fallback.
- Provider credentials stay backend-side and never enter page DOM, content scripts, manifest values, or extension storage.
- Free quota is 10 applications/month; Pro quota is 50 applications/month.
- Discovery, scoring, form filling, skips, and external tab opening consume no application quota.
- Final LinkedIn quota is consumed immediately before the final click with a stable idempotency key.
- AI never fabricates candidate facts or overrides hard exclusions.
- Opening an external application is never recorded as submitted.
- Unconfirmed submission stops without automatic retry.
- Third-party licenses and attribution are preserved.

## Deferred evidence requirements

ZipRecruiter, ATS vendors, Gmail, new portals, persistent cross-instance AI caching, and substantive resume tailoring must not be described as supported until executable code, focused tests, privacy review, and live external/browser validation all exist.