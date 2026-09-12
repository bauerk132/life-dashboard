# Phase 3 Handoff to User — Stored Jobs Review Queue

## Status

**Complete — local/static verification complete; live Apps Script and Google Sheets behavior remains unverified.**

Phase 3 was begun only after reviewing the delivered Phase 2 handoff and reconciling the application files. The Phase 2 handoff is present at `PHASE_2_HANDOFF_TO_CODEX.md`, which points to the top-level Claude handoff. No Phase 4 work was started.

## Scope delivered

Phase 3 adds a fast stored-record Jobs review queue. Opening, refreshing, filtering, sorting, and scrolling the queue uses only stored job rows; it has no source-discovery, scraping, outbound fetch, trigger, runtime AI/model, application-automation, or Calendar-write path.

- Job cards show stored title, company, location/remote status, salary, posted/discovered dates, source, external ID, last-seen time, match score, recommendation, reasons, gaps, and notes.
- The client offers filters for All active jobs, 80%+ match, Remote, New today, Saved, and Ready to apply. The user lowered the strong-match threshold from 90% to 80% to support a career transition where transferable skills may not produce a same-industry score.
- The client offers deterministic sorts: match score, posting date, discovery date, and salary. Invalid or absent sort values are placed after valid values; ties use title then ID.
- Bad individual stored rows are quarantined with a count instead of breaking the whole queue. Unsafe URLs are never returned to the browser.
- Server-validated transitions support `New -> Reviewed -> Saved -> Ready to Apply -> Applied -> Interview -> Offer`, rejection from Reviewed/Saved/Ready to Apply, and recoverable `Rejected -> Reviewed`.
- Server-side notes update the stored job and append an audit entry. Status changes and notes append to a dedicated `JobHistory` sheet under the same script lock used for the job mutation.
- Source links are shown only after strict absolute HTTP(S) validation; scheme-relative, credential-bearing, malformed, non-web, and invalid-port URLs are rejected.
- Rejected records leave the active queue but remain in a labeled recoverable section. Records with absent/old `last_seen_at` are described honestly rather than as current.

## Current data contract

`Jobs` retains the Phase 1/2 schema and is the stored-record source. Phase 3 relies especially on:

- Identity/provenance: `id`, `external_id`, `source`, `url`.
- Presentation: `title`, `company`, `location`, `remote`, `salary_min`, `salary_max`, `currency`, `posted_at`, `discovered_at`, `last_seen_at`, `description`.
- Stored matching: `skills_match`, `experience_match`, `location_match`, `salary_match`, `overall_match`, `recommendation`, `why_matches`, `gaps`.
- Workflow: `status`, `saved_at`, `notes`, `record_version`.

`JobHistory` is a new append-only initialized sheet with exact headers:

`id, job_id, action, from_status, to_status, note, created_at`

Accepted statuses are `New`, `Reviewed`, `Saved`, `Ready to Apply`, `Applied`, `Interview`, `Offer`, and `Rejected`. A status retry to the already-current status is a no-op and does not append a duplicate history entry. Every successful status change increments `record_version`; the first transition to Saved sets `saved_at`.

## Files changed or created for Phase 3

- `Database.gs` — adds `JobHistory`; refactors private locked append/update helpers so a job mutation and its audit append use one script lock.
- `Jobs.gs` — **created** stored queue reads, URL validation, status transitions, notes, and history endpoints.
- `Index.html` — replaces the Phase 2 Jobs placeholder with the Phase 3 queue controls and safe containers.
- `Styles.html` — adds responsive queue/card, history, stale, rejected, and quarantine styles.
- `JavaScript.html` — adds safe DOM-only jobs rendering, filters/sorts, actions, notes, history, error/empty/loading states, and rejected recovery.
- `.claspignore` — adds `Jobs.gs` to the intentionally deployed-file whitelist; development fixtures and tests remain excluded.
- `dev/mock-google-script-run.js` — adds an explicitly development-only stored jobs fixture and query scenarios for local preview; it is not on the deployment whitelist.
- `tests/phase1.test.js` — updates the expected initialized schema for the additive `JobHistory` sheet.
- `tests/phase3.test.js` — **created** deterministic Phase 3 data-layer coverage.
- `tests/static-checks.test.js` — expands deployment/static checks for the Phase 3 surface and public endpoints.
- `PHASE_3_HANDOFF_TO_USER.md` — **created** this closeout record.

## Verification performed

### Deterministic local/static checks — passed

Command run from the application folder:

```text
node --test tests\phase1.test.js tests\phase2.test.js tests\phase3.test.js tests\static-checks.test.js
```

Result after the user-requested 80% career-transition threshold update: **250 tests passed; 0 failed, cancelled, skipped, or todo.** The boundary regression includes an active 80% record and excludes an otherwise-valid 79% record, while Rejected records remain excluded regardless of score.

This includes the Phase 1 and Phase 2 regression suites, 14 Phase 3 data-layer tests, parsing checks for all deployed `.gs` files and the browser script, manifest/include checks, public-function checks, and banned-pattern checks. The static checks confirm no `UrlFetchApp`, `fetch(`, `XMLHttpRequest`, runtime AI/model path, unsafe HTML sink, Calendar write method, permissive frame option, demo seeding, or forbidden manifest scope appears in deployed files.

Phase 3 cases exercised locally include:

- initialized append-only `JobHistory` schema;
- read-only stored active/rejected queue behavior;
- quarantine of malformed, duplicate-ID, missing-title, unknown-status, and unsafe-URL rows;
- stale/unknown last-seen messaging;
- strict absolute HTTP(S) URL validation;
- allowed transitions plus server audit rows and version increments;
- idempotent retry to current status without duplicate audit entries;
- invalid transition/unknown-status/blank-ID no-write behavior;
- Saved timestamp and Rejected-to-Reviewed recovery;
- preflight of `JobHistory` schema before a Job mutation;
- note validation, update, versioning, and append-only history;
- newest-first valid history while malformed audit rows are counted rather than leaked.

### Isolated local browser preview — passed where noted

The preview was started only at `http://127.0.0.1:4173/` using the excluded development adapter. No Google account, Sheet, Calendar, Apps Script deployment, external job source, or AI service was contacted.

Verified in the desktop local preview:

- Home rendered mock dashboard and Calendar content without blocking the page.
- Jobs navigation moved focus to the Jobs heading and showed accessible filter/sort controls, safe source links, job details, action controls, and a recoverable rejected section.
- A mock status action changed `New` to `Reviewed` and exposed the next valid actions.
- A mock note saved and rendered as stored content.
- The activity-history disclosure expanded and showed a note audit row and state-change audit row.
- Remote filtering and Salary sorting selected the expected values and reduced the queue to the matching stored record.
- A rejected mock record recovered to Reviewed without being lost.
- `?jobs=unavailable&calendar=unavailable` showed independent, retryable safe error states. Home remained usable and Calendar failure did not prevent navigation to Jobs.
- Keyboard Tab reached the Jobs refresh control, and the local screenshot showed the 3px visible focus outline.

Not run / limitation: the available browser automation could not set a phone-sized viewport. The `@media (max-width: 430px)`, 44px control sizes, focus rules, and reduced-motion override were inspected statically, but a rendered 375px-by-812px check remains unverified.

## Live behavior not verified

No live Google system was changed or used. The following remain **not run — authorization was not provided**:

- Apps Script V8 execution and `google.script.run` behavior;
- Script Property access to a real `DATABASE_SHEET_ID`;
- real Google Sheet read/write, locking, formats, schema mismatch behavior, and cross-sheet audit consistency;
- Apps Script authorization for Calendar read-only access;
- deployment, sharing, OAuth consent, `clasp` authentication, push, or version creation.

The browser adapter is a local development simulation, not evidence of Apps Script runtime behavior or persistence to Google Sheets.

## Source-adapter assumptions for a future phase

Phase 4 or any future source adapter must preserve these constraints:

- It may only introduce records that satisfy the existing `Jobs` schema and have unique nonblank `id` values.
- URLs must pass the Phase 3 strict absolute HTTP(S) validator before they can reach the browser.
- It must preserve original `source`, `external_id`, `discovered_at`, and `last_seen_at` provenance; it must not claim a record is current without fresh, explicitly authorized verification.
- It must not bypass `setJobStatus`, `addJobNote`, `record_version`, `saved_at`, or the append-only `JobHistory` contract.
- Discovery, scraping, network access, scheduled triggers, automated scoring, and external integrations require separate user authorization and must not be added incidentally.

## Known risks and remaining user decisions

- The lock serializes the normal job-update plus history-append path, but Google Sheets does not provide a cross-sheet database transaction. A real Apps Script test should verify handling of an interrupted write between those operations.
- Individual malformed records are quarantined in the queue response. A future maintenance workflow may need an authorized, auditable way to repair data rather than silently discard it.
- The current implementation accepts only the explicit transition map described above. Any new workflow state or back-transition should be decided deliberately and accompanied by tests/history semantics.
- The local development fixture contains synthetic records solely for preview and is excluded from deployment. It must remain inaccessible through production setup.

## Phase boundary

No Phase 4 work has begun. No deployment, live data change, trigger, source search, scraping, runtime AI call, application automation, or Calendar write has occurred.

**PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
