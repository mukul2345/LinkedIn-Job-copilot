# AI Job Search Reference Analysis

Date: 2026-08-30

## Scope and method

This is a source-level, clean-room comparison of this browser extension with `/Users/mukulgupta/Downloads/ai-job-search-master`. The reference repository is an agent-orchestrated, human-reviewed job-search workspace; it is not an MV3 extension and does not provide automatic form submission. Concepts were evaluated independently and no captured portal content, candidate data, secrets, or unverified assets were copied.

The reference is MIT licensed (copyright Mads Lorentzen). Its license must remain with any substantially copied source. This integration adapts behavior and contracts rather than copying implementations.

## Reference architecture

`AGENTS.md` points to `CLAUDE.md`, `.claude/commands`, `.claude/skills`, and portable portal skills in `.agents/skills`. The workflow is:

1. Discover enabled portal CLIs and run independent, recent searches.
2. Continue after portal failures and preserve portal/mechanism provenance.
3. Fetch details only for promising jobs, then track seen/expired/ghost listings.
4. Apply eligibility vetoes before weighted ranking.
5. Draft application materials for user review; never submit automatically.
6. Record `drafted`, then require a separate outcome action to record `applied`.

## Evidence matrix

| Area | Reference evidence | Current evidence | Finding | Decision |
|---|---|---|---|---|
| Search orchestration | `.claude/skills/job-scraper/SKILL.md`, steps 1b/1c | `functions/search.js`, `scraper/app.py` | Reference executes portal/query calls independently and continues on failure. Current scraper already fans boards out, but matching formerly sent one literal OR query. | Adapt bounded independent queries with provenance. |
| Pagination | FreeHire `buildQuery`; Jobnet `createSearchOutput`; LinkedIn page/start mapping | `functions/search.js::searchJobs`; `extension/ui/jobs-tracker-handlers.js` | Reference portal adapters preserve page/total contracts. Current backend paged, but UI formerly repaged only one returned slice. | Make backend metadata authoritative in UI. |
| Ranking | `.claude/commands/rank.md`, steps 3–4 | `functions/job-matching.js` | Reference vetoes location/language before score and uses deadline urgency for ties. Current hard filters existed, but exclusion evidence and stable ties were absent. | Preserve hard vetoes, expose reason codes, use deterministic tie order. |
| Application state | `.claude/commands/apply.md`, tracker update and `/outcome` handoff | `application-orchestrator.js`, `application-state.js` | Reference records drafts and requires a separate outcome. Current external URL opening was safe but had no completion action. | Add explicit user-confirmed external completion state; opening remains non-submission. |
| Candidate truth | `01-candidate-profile.md`, `04-job-evaluation.md`, `08-application-forms.md` | `field-matcher.js`, `form-filler.js`, AI providers | Reference forbids fabricated facts and surfaces contradictions. Current deterministic precedence is strong, but consent labels and low-confidence AI needed stronger boundaries. | Never infer consent; mark AI fallback review-only. |
| AI execution | Reference cache tests and bounded portal workflow | `functions/ai-job-matcher.js`, `functions/scoring.js` | Current output validation is strong; matching lacked cache/version keys and concurrent batch bounds. | Add bounded batch workers and versioned cache keys. |
| Quota | No equivalent extension quota | `functions/quota-service.js`, `plan-config.js` | Backend correctly enforces 10/50 monthly and idempotency. Client displayed 3/day and unlimited Pro; Firestore role could bypass backend. | Server custom claim only; client displays 10/50 monthly. |
| Privacy/security | `tools/security_guards.py`, `tools/robots_check.py`, `SECURITY.md` | `firestore.rules`, `storage.rules`, message protocol, `config/questions.py` | Reference treats postings as untrusted and candidate artifacts as sensitive. Current `/system` and resume upload rules were too broad, and tracked legacy answers created privacy risk. | Deny client system writes; owner-scope/constrain resumes; move legacy answers to environment variables. |
| Gmail | `.claude/commands/gmail-sync.md` | `functions/tracker.js`, extension tracker | Reference uses stable Gmail IDs and proposal-before-write. Current backend/client token contracts differ and backend uses unstable subject/date identity. | Do not activate; redesign before claiming support. |
| ATS support | No generic ATS detector in reference | `extension/modules/autofill/adapters.js`, manifest | Generic adapters exist but are not shipped by the manifest. | Do not claim production ATS automation; harden dormant code only. |

## Task 4 completion state

The clean-room behavioral adaptation now extends beyond the initial high-confidence slice:

- Ordinary and AI-ranked discovery use server-owned versioned sessions with immutable result documents, canonical query/source/session provenance, source status, partial failures, and stable pages.
- Session create/resume/get/cancel contracts survive popup closure and MV3 service-worker restart. Cancellation is cooperative and terminal-state guards prevent late completion.
- AI profile extraction or scoring failure no longer destroys discovered eligible jobs; those jobs are returned unscored with `AI_UNAVAILABLE`.
- Candidate facts are frozen in a versioned snapshot. Explicit user answers override persisted and reviewed-resume facts; deterministic transformations are identified; legal consent and unknown facts remain manual.
- Active LinkedIn form preparation uses the resolver when loaded. AI output is review-only, and every final click requires explicit confirmation regardless of legacy settings.
- CAPTCHA, MFA, checkpoint, authwall, and uncertain-submission outcomes stop automation without bypass or automatic retry.
- Confirmed direct and explicit external outcomes are stored in an idempotent server-owned ledger with job/session/match provenance and no candidate secrets.

No substantial reference implementation source was copied. The reference MIT license and author remain documented here; a bundled third-party source notice is therefore not required for the current clean-room adaptation.
