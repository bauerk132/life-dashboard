# Life Dashboard — Controlled Phase 2 and Phase 3 Handoff

## Authorization and hard boundaries

The user has authorized implementation of the next two planned product phases:

1. **Phase 2 — Core Dashboard**, assigned to Claude (or a later substitute implementing the Claude assignment below).
2. **Phase 3 — Ready-to-Go Jobs Queue**, assigned to Codex.

This authorization does **not** authorize Phase 4 or any later phase. It does not authorize public deployment, live Google Sheet changes, Calendar writes, third-party job searches, AI/model API calls, source scraping, trigger creation, or spending money.

Claude must implement **Phase 2 only**, write the required Phase 2 handoff, and stop. Claude must not implement, begin, speculate on, or make opportunistic changes for Phase 3. Codex begins Phase 3 only after reviewing the Phase 2 handoff and the actual files delivered.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

## Current project state — read before editing

Primary project folder:

`outputs/life-dashboard-apps-script/`

Controlling plan:

`outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`

Phase 1 is **not approved as delivered**. The original shared project folder contains an earlier pre-plan draft. A later Gemini submission is preserved separately in:

`outputs/life-dashboard-apps-script/phase-1-gemini-submission/`

The preserved submission improves the Phase 1 contract but has bounded issues that must be fixed before Phase 2 depends on its data layer:

- `updateRecordById()` uses an incorrect array index for the first data row, which can overwrite unchanged fields.
- Existing-schema checks accept mismatched headers instead of failing safely.
- The Apps Script `ALLOWALL` frame setting weakens default clickjacking protection without a replacement.
- Raw database helpers are browser-callable, duplicate IDs are not rejected, and the manifest/configuration need least-privilege alignment.

The detailed evidence and required correction list are in:

`outputs/PHASE_1_CODEX_GATE_REVIEW_SUBMISSION.md`

Treat the Phase 1 repair as a **prerequisite integration correction**, not as permission to add Phase 2 or Phase 3 features early. No live Google resource may be changed as part of it.

## Codex preflight — before delegating Phase 2

Codex owns this bounded preflight. It must complete it locally before Claude starts Phase 2:

1. Review the controlling plan, both Phase 1 gate-review artifacts, the old draft, and the preserved Gemini submission.
2. Correct and integrate only a minimal safe Phase 1 foundation into the primary project folder:
   - Script Property configuration using `DATABASE_SHEET_ID`.
   - Exact ordered header validation that fails safely for non-empty mismatched sheets.
   - `LockService` protection for initialization and writes.
   - private helpers using trailing `_`, with public endpoints narrowly scoped to their intended browser actions.
   - robust ID updates: exactly one nonblank matching ID, known writable fields only, no mutation of the caller's update object, and correct first/second-row behavior.
   - date serialization and blank-row handling that preserve valid `0` and `false` values.
   - default frame protection, safe browser errors, and least-privilege manifest/documentation alignment.
   - no production-accessible demo-job seeding.
3. Add deterministic local regression checks for first and second data rows, duplicate IDs, invalid sheet names, unknown update fields, exact header count/order, and no implicit mock-job insertion.
4. Keep all live Apps Script, deployment, Sheet, Calendar, and authorization checks marked **not run** unless an authorized real test actually occurs.
5. Record the exact files reconciled and static checks in a new additive artifact named `PHASE_1_INTEGRATION_PREFLIGHT_FOR_PHASE_2.md`.

Codex must not begin the Phase 3 queue while completing this preflight.

## Claude assignment — Phase 2 only

Copy this section into a fresh Claude conversation together with the controlling plan, this handoff, the Phase 1 preflight artifact, and the project folder.

---

You are implementing **Phase 2 only — Core Dashboard** for a private Google Apps Script Life Dashboard.

Read these first:

- `outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`
- `outputs/PHASE_2_TO_3_CONTROLLED_HANDOFF.md`
- `outputs/life-dashboard-apps-script/PHASE_1_INTEGRATION_PREFLIGHT_FOR_PHASE_2.md`
- every existing file in `outputs/life-dashboard-apps-script/`

Work only in `outputs/life-dashboard-apps-script/`. Preserve existing work, make narrowly scoped edits, and do not use a live Google account, deploy, create a Sheet, write Calendar events, create triggers, search job sources, call an AI API, or add secrets.

### Phase 2 objective

Turn the safe Phase 1 foundation into a daily dashboard without automated job discovery or Phase 3 Jobs-queue functionality.

### In scope

- Responsive Home, Tasks, and a **placeholder-only** Jobs navigation surface.
- Home indicators for date, open/completed tasks, stored strong-match job count, applications sent, and an upcoming-calendar area.
- Task creation, completion, reopening, and optional archive using stable IDs and narrow server-side actions.
- Read-only Calendar retrieval for the next seven days, with permission denial and server failure isolated from Tasks and Home.
- Accessible loading, empty, success, and failure states; usable desktop and mobile layout; clear keyboard focus and button labels.
- An optional isolated development adapter or fixture so the interface can be previewed locally without writing sample data into a production Sheet.
- Local repeatable checks and preview notes.

### Explicitly out of scope

- No job cards, queue filters, sorting, status state machine, job notes/history, or status timestamps. Those are Phase 3.
- No source discovery, scraping, APIs, scheduled triggers, AI calls, model scoring, applications workflow, Calendar writes, public deployment, or live-resource changes.
- No fabricated jobs in production. An isolated UI fixture is acceptable only when labeled as development-only and impossible to invoke through the production setup path.

### Non-negotiable implementation rules

- Browser code may call only narrow intended public server functions through `google.script.run`; it must never access Sheets directly.
- Server actions must validate user input, use stable IDs, and return browser-safe errors.
- Rendering of Sheet/Calendar-derived text must escape content before inserting it into HTML.
- Normal dashboard load, navigation, refresh, and scrolling must produce zero job-source calls and zero AI/model calls.
- Do not widen the manifest or change deployment settings without documenting why; do not weaken frame protection.

### Required acceptance checks

- Task create, complete, reopen, and archive behavior is deterministic by inspection and local tests/fixtures where possible.
- Retried browser actions do not intentionally create duplicate task rows; report any unverified Apps Script runtime behavior honestly.
- A Calendar denial/error leaves Home and Tasks usable.
- Keyboard focus, labels, contrast, responsive/mobile behavior, and empty states have been checked in a local preview if available.
- The placeholder Jobs page clearly says that stored-job review is planned for Phase 3 and does not itself offer a queue implementation.

### Required deliverables

1. Phase 2 application edits in `outputs/life-dashboard-apps-script/`.
2. Any deterministic local fixture/test file required for repeatable checks, clearly kept out of production setup.
3. A new additive `PHASE_2_HANDOFF_TO_CODEX.md` in `outputs/life-dashboard-apps-script/`, containing:
   - status;
   - files read, changed, and created;
   - UI/interaction decisions;
   - exact tests and results;
   - preview or screenshot notes;
   - live Google behavior not verified;
   - known issues/blockers;
   - confirmation that no Phase 3 work began.
4. End with the required stop statement below.

After writing the handoff, stop. Do not proceed to Phase 3.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

---

## Codex assignment — Phase 3 only, after the Phase 2 handoff

Codex must begin this phase only after verifying that `PHASE_2_HANDOFF_TO_CODEX.md` exists, identifies the actual edited files, and confirms that Phase 3 was not started. Reconcile discrepancies between the handoff and the filesystem before changing code.

### Phase 3 objective

Create a fast, safe review queue for **stored, already-filtered** job records. Opening, refreshing, filtering, sorting, and scrolling the queue must make zero job-source calls and zero AI/model calls.

### Required functionality

- Render job cards using stored title, company, location, remote status, salary, age, source, match score, recommendation, reasons, and gaps.
- Tolerate malformed individual rows: visibly omit/quarantine a bad row instead of breaking the whole queue.
- Provide filters: All, 90%+, Remote, New Today, Saved, and Ready to Apply.
- Provide deterministic sorting: match, posting date, discovery date, and salary. Explicitly document null/malformed-value ordering.
- Implement server-validated job transitions and timestamp/audit recording:

  `New -> Reviewed -> Saved -> Ready to Apply -> Applied -> Interview -> Offer`

  `Reviewed`, `Saved`, and `Ready to Apply` may transition to `Rejected` as defined in the controlling plan. Rejected jobs leave the active queue but remain recoverable.

- Add notes and a concise, append-only history/audit trail that records state change time and the server-side action performed. Do not silently rewrite history.
- Support direct source links only after strict URL validation (`https:`/`http:` only; reject dangerous, malformed, and scheme-relative URLs). Keep source URL, external ID, and last-seen time visible enough to avoid claiming that a record is live/current when it is not.
- Include honest empty and stale-job states.
- Preserve saved state and, where practical, refresh filters without allowing browser state to bypass server validation.

### Required safety and integrity checks

- Reject duplicate/blank IDs, unknown fields, unsafe URLs, and invalid status transitions without writes.
- Verify rejected jobs are recoverable and no valid record is lost on a rejected transition.
- Verify all mutations are server-side and protected consistently with the Phase 1 foundation.
- Verify queue browsing has no job-source or AI/model call paths by code inspection and documented deterministic tests.
- Do not implement source discovery, scheduled runs, AI scoring, application automation, Calendar writes, deployments, or any Phase 4+ scope.

### Required final artifact

Create `outputs/life-dashboard-apps-script/PHASE_3_HANDOFF_TO_USER.md`. It must include:

- current data contract, including the job columns/statuses/history representation used;
- files changed/created;
- tests and exact outcomes;
- static/local checks versus unverified live Apps Script or Google Sheet behavior;
- source-adapter assumptions that Phase 4 must preserve;
- known risks, malformed-data behavior, and any user decisions still needed;
- confirmation that no Phase 4 work began.

End with:

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

## Final owner checklist

Before presenting the Phase 3 handoff to the user, Codex must confirm:

- Phase 2 was delivered and stopped at its documented boundary.
- No later phase was begun.
- All created handoffs are additive and the master plan is unchanged.
- No live external system, deployment, API, trigger, source, secret, or account setting was changed unless specifically authorized and directly evidenced.
- Completion claims distinguish static/local validation from live Apps Script/Sheets verification.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
