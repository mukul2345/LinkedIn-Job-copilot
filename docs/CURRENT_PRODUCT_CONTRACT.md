# Current Product Contract

Date: 2026-08-30

This document describes executable behavior, not intended roadmap. Status labels are: `SUPPORTED`, `PARTIALLY_SUPPORTED`, `REVIEW_ONLY`, `EXTERNAL`, `DISABLED`, and `NOT_IMPLEMENTED`.

## Product invariants

- Search, filtering, scoring, form preparation, skips, and opening external pages do not consume application quota.
- Free accounts receive 10 confirmed direct-application attempts per month; Pro accounts receive 50. Only verified server-side admin claims bypass quota.
- LinkedIn is the only direct-application platform. Every final submission requires explicit review confirmation.
- Indeed and Glassdoor applications open externally. Opening a page is not submission; only explicit user confirmation records an external submission.
- Unknown candidate facts, legal consent, CAPTCHA, MFA, login challenges, and anti-bot checks require manual action. They are never inferred or bypassed.
- AI provider credentials remain in Cloud Functions. AI cannot override hard exclusions or fabricate candidate facts.
- An unconfirmed LinkedIn submission stops without automatic retry.

## Capability matrix

| Platform | Search | Job details | Filtering | AI matching | Application | External application | Automation | Tracking |
|---|---|---|---|---|---|---|---|---|
| LinkedIn | `SUPPORTED` | `SUPPORTED` | `SUPPORTED` | `PARTIALLY_SUPPORTED` | `PARTIALLY_SUPPORTED` | `DISABLED` | `PARTIALLY_SUPPORTED` | `PARTIALLY_SUPPORTED` |
| Indeed | `SUPPORTED` | `SUPPORTED` | `SUPPORTED` | `PARTIALLY_SUPPORTED` | `EXTERNAL` | `SUPPORTED` | `DISABLED` | `PARTIALLY_SUPPORTED` |
| Glassdoor | `SUPPORTED` | `SUPPORTED` | `SUPPORTED` | `PARTIALLY_SUPPORTED` | `EXTERNAL` | `SUPPORTED` | `DISABLED` | `PARTIALLY_SUPPORTED` |
| ZipRecruiter | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `DISABLED` | `NOT_IMPLEMENTED` |
| Generic ATS | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `REVIEW_ONLY` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `DISABLED` | `NOT_IMPLEMENTED` |

## Status details

- **Search:** Supported boards are queried through the configured backend scraper. Search sessions persist immutable result snapshots; source/query failures can produce partial results.
- **Job details:** Only fields actually supplied by supported sources are represented. Missing fields are not invented.
- **Filtering:** Deterministic hard exclusions run before AI and remain authoritative.
- **AI matching:** Requires a configured backend AI provider and sufficient candidate evidence. If AI is unavailable, discovered eligible jobs remain visible with `AI_UNAVAILABLE`; they are not represented as scored matches.
- **LinkedIn application:** Easy Apply form preparation is available on LinkedIn pages. Required unresolved fields stop the flow. Explicit final review is mandatory, quota is consumed immediately before the final click, and provider confirmation is required before recording submission.
- **External application:** Indeed and Glassdoor pages can be opened for user completion. A separate user attestation records completion and consumes no LinkedIn quota.
- **Generic ATS:** Dormant adapters are not loaded by the manifest and are not a shipped automation capability.
- **Tracking:** Confirmed direct submissions and explicit external confirmations are tracked. Gmail ingestion is inactive unless separately configured and remains unvalidated as a production capability.

## Known limits

Live browser validation, Firebase Rules emulator tests, and credentialed end-to-end checks are separate deployment gates. Search cancellation is cooperative: an already-running network or AI request may finish, but cancelled session output cannot become a completed session. Platform markup changes can still require adapter updates.
