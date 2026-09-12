# Antigravity Start Here — Finish Life Dashboard Phase 4 Locally

## Entry gate: read before acting

This file transfers the current Phase 4 recovery state to Antigravity. **A handoff transfers knowledge; it is not permission to begin work.**

Before editing, require a new user message that explicitly authorizes Antigravity to finish Phase 4. Until that authorization exists, perform no edits, Git operations, API calls, Google actions, or trigger actions.

Suggested authorization text:

> AUTHORIZE ANTIGRAVITY TO FINISH THE REMAINING PHASE 4 WORK LOCALLY. DO NOT RUN LIVE GOOGLE OR JSEARCH TESTS. DO NOT INSTALL A TRIGGER. DO NOT BEGIN PHASE 5.

The prior authorization named Codex as the only worker. Do not infer that it automatically transfers to Antigravity.

## Objective

Finish the remaining **Phase 4B local implementation only** for the Life Dashboard:

- preserve and build on Claude's and Codex's existing Phase 4 work;
- implement the checkpointed discovery orchestrator and trigger-management functions;
- add deterministic local tests;
- make all local/static tests green;
- write the operating configuration and final truthful Phase 4 handoff;
- stop before any live Google/JSearch operation or Phase 5.

Do not rebuild the profile, filters, adapter, dedupe implementation, Phase 1 foundation, Phase 2 dashboard, or Phase 3 stored-job queue unless a failing test demonstrates a specific defect. Do not create a competing implementation.

## Exact project locations

Recovery worktree to use:

`C:\Users\User\Claude Code\life-dashboard-phase4-recovery`

Recovery branch:

`codex/phase4-recovery`

Application folder:

`C:\Users\User\Claude Code\life-dashboard-phase4-recovery\outputs\life-dashboard-apps-script`

Primary recovery receipt:

`C:\Users\User\Claude Code\life-dashboard-phase4-recovery\outputs\CODEX_PHASE_4_RECOVERY_HANDOFF.md`

Original repository — reference only until final reconciliation:

`C:\Users\User\Documents\Codex\2026-09-10\referenced-chatgpt-conversation-this-is-an-2`

Do not edit the original `main` worktree while the recovery branch is active. Do not delete or reset either worktree.

## Required model selection and usage policy

Use the exact model label shown by the Antigravity interface. Do not claim a model was used unless the interface confirms it.

### Gemini 3.1 Pro

Use **Gemini 3.1 Pro** for:

- the initial implementation plan;
- reasoning about whole-run locking and avoidance of nested locks;
- checkpoint/resume semantics and partial-run recovery;
- dedupe-index update correctness after INSERT and TOUCH;
- terminal-error disablement and retry classification;
- trigger identity validation and idempotent trigger management;
- diagnosing a non-obvious failure after one careful correction attempt;
- one final read-only advisor review of the integrated design, if the Antigravity interface supports an advisor.

The advisor, if used, is read-only. It must not edit files, create agents, run live tests, or independently rebuild `Discovery.gs`. Give it only the frozen contract, the relevant implementation files, and the exact failing or high-risk question. The primary Antigravity task remains responsible for checking every claim against disk.

### Gemini 3.8 Flash

Use **Gemini 3.8 Flash** for:

- bounded source edits after the 3.1 Pro plan is locked;
- deterministic Node test creation and execution;
- fixture and fake-harness adjustments;
- mechanical documentation;
- file inventories, searches, syntax checks, diffs, and count-only scans;
- correcting straightforward failures whose cause is already established.

Do not have 3.1 Pro and 3.8 Flash produce competing implementations. Planning/advice and implementation must form one sequential workflow with one source of truth.

If either requested model is unavailable, record the exact labels offered and stop before editing rather than silently substituting another model.

Expected usage is moderate to high because the discovery orchestrator combines concurrency, persistence, error classification, and audit behavior. Conserve usage by loading only directly relevant files, running targeted tests after each bounded patch, and running the full suite once the targeted suite is green.

## Worker limits

- One primary Antigravity task owns all edits and integration.
- At most one read-only Gemini 3.1 Pro advisor may be used, only as described above.
- No implementation subagents.
- No recursive agents or grandchildren.
- No background agent may remain running when the handoff is written.
- The primary task must inspect every changed file and test result directly.

## Hard safety and phase boundaries

Unless the user separately authorizes the exact action, do not:

- call JSearch, RapidAPI, LinkedIn, Indeed, or any other job source;
- run a live Google Apps Script function;
- access or modify a live Google Sheet;
- push or deploy with `clasp`;
- create, install, modify, or delete a real Apps Script trigger;
- write Calendar data;
- authenticate a tool or install dependencies;
- expose, print, read aloud, copy into a handoff, or commit an API key, Script ID, spreadsheet ID, email address, résumé, home address, or other personal data;
- enable Indeed;
- begin Phase 5;
- merge the isolated unauthorized Phase 5 branch;
- deploy publicly, change sharing, or spend money.

Static Node tests and ScriptApp/Sheet fakes are local simulation only. Label them separately from live Apps Script behavior.

## Required files to read completely before editing

Read these in order:

1. `C:\Users\User\Claude Code\life-dashboard-phase4-recovery\outputs\CODEX_PHASE_4_RECOVERY_HANDOFF.md`
2. `C:\Users\User\.claude\plans\foamy-yawning-hippo.md`
3. `C:\Users\User\AppData\Local\Temp\claude\C--Users-User-Claude-Code\201b520f-4bd5-467e-930a-9d5223318bf9\scratchpad\PHASE4B_CONTRACT.md`
4. `outputs\LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`
5. `outputs\PHASE_4_SPLIT_PLAN.md`
6. `outputs\CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md`
7. `outputs\PHASE_4_JOB_PROFILE.md`
8. Every file directly inside `outputs\life-dashboard-apps-script\`
9. `outputs\life-dashboard-apps-script\tests\gas-fakes.js`
10. `outputs\life-dashboard-apps-script\tests\phase1.test.js`
11. `outputs\life-dashboard-apps-script\tests\phase4a-jsearch.test.js`
12. `outputs\life-dashboard-apps-script\tests\phase4b-filters.test.js`
13. `outputs\life-dashboard-apps-script\tests\phase4b-dedupe.test.js`
14. `outputs\life-dashboard-apps-script\tests\static-checks.test.js`

Do not read `.clasp.json`; it contains a live project identifier and is not needed. Do not search unrelated user folders, drives, repositories, cloud accounts, or job projects.

## Current verified state

### Git history

- `120fa50` — checkpoint of Claude's six interrupted Phase 4 files.
- `bfb46b8` — preserved job-profile worker artifact.
- `5d5238b` — preserved dedupe worker artifact.

The recovery branch also currently has additional uncommitted Codex changes that must be preserved and reviewed. Start with:

```powershell
Set-Location -LiteralPath 'C:\Users\User\Claude Code\life-dashboard-phase4-recovery'
git status --short --branch
git diff --check
git diff --stat
```

Do not reset, checkout over, clean, or discard those changes.

### Locally completed behavior

- Additive `DiscoveryRuns` and `DiscoveryLog` schemas.
- Natural-key append/update support for id-less sheets.
- Narrow discovery INSERT and TOUCH helpers in `Jobs.gs`.
- ScriptApp trigger fake and controllable clock in `tests\gas-fakes.js`.
- Manifest `script.scriptapp` scope and deployed-file whitelist preparation.
- Full approved `JOB_PROFILE_`, strict validator, and LinkedIn-only adapter configuration.
- `jobfilters-v2` stable deterministic filter implementation.
- Versioned L1/L2/L3 dedupe implementation and its 26-test worker suite.
- Adapter-shape correction for `{value, label}` remote values.
- Natural-key string comparison correction in `Database.gs`.
- New `tests\phase4b-filters.test.js`.

### Current test evidence

Focused command:

```powershell
node --test tests\phase4b-filters.test.js tests\phase4b-dedupe.test.js
```

Verified result: **36 passed, 0 failed.**

Full local command:

```powershell
node --test tests\phase1.test.js tests\phase2.test.js tests\phase3.test.js tests\phase4a-jsearch.test.js tests\phase4b-filters.test.js tests\phase4b-dedupe.test.js tests\static-checks.test.js
```

Verified result: **422 total, 421 passed, 1 failed.**

Sole failure:

```text
PUBLIC_ALLOWLIST entry "installDiscoveryTrigger" is not declared in any deployed .gs file
```

That failure is not permission to remove reserved allowlist entries. It proves `Discovery.gs` is still incomplete.

## Frozen profile and filter decisions

Do not change these without new user approval:

- Profile ID: `phase4-job-profile-v1-2026-09-11`.
- Config version: `1`, monotonic if a future approved profile changes.
- P1: IT support, help desk, desktop support, technical support.
- P2: office administration, operations coordinator/support, logistics coordinator/support.
- P3: non-sales customer support/customer success.
- Local center: Downtown Pittsburgh `40.4406,-79.9959`.
- Radius: strictly **less than** eight miles; exactly eight miles is excluded.
- Remote preferred. A remote listing is excluded only if it affirmatively makes Pennsylvania ineligible. No jurisdiction statement is included with `REMOTE_JURISDICTION_UNSTATED`.
- Minimum source-provided compensation: `$19/hour` or `$38,000/year`.
- No listed salary: include.
- Non-provider estimate: include with review flag.
- Range wholly below floor: exclude.
- Range straddling floor: include with review flag.
- Include full-time and contract-to-hire.
- Exclude part-time, temporary, seasonal, internship, volunteer, and bare contractor roles.
- Stable exclusion order: senior leadership, sales, general manager, kitchen manager, driving, heavy travel, relocation, employment type, geography, compensation.
- A role-title track miss is `NO_MATCHED_TRACK`, not exclusion.
- Do not add medical or security-clearance exclusions.
- Only LinkedIn is enabled in Phase 4. Indeed remains disabled.

## Frozen adapter boundary

Do not modify `JobSource_JSearch.gs` unless a deterministic failing test proves a defect and the user separately approves changing the frozen Phase 4A adapter.

Use only:

```javascript
jsearchFetchPage_(queryEntry, {
  mode: 'scheduled' | 'manual',
  nowDate: Date,
  enabledPublishers: ['linkedin']
})
```

The actual adapter result uses:

- `ok`
- `status`
- `retryable`
- `disableSource`
- `adapterVersion`
- `candidates`
- `quarantined`
- `droppedByPublisher`
- `quota`

The actual adapter already normalizes `candidate.remote` to `{value, label}`. Filters and dedupe now handle that shape. Do not change the adapter to force the older raw-value wording in the contract.

Adapter status policy:

- `OK` and `EMPTY`: successful page.
- `BUDGET_BLOCKED` or quota exhaustion: stop without retry and preserve checkpoint.
- `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, and `UPSTREAM_ERROR`: retryable, bounded by the profile retry limit; no immediate busy loop.
- Authentication/subscription terminal failures may set `disableSource: true`; increment the consecutive terminal count and disable only when it reaches the configured threshold.
- Malformed, oversized, bad-content-type, provider, not-found, and unexpected-status responses are nonretryable page errors; audit and advance or fail according to the approved plan without inventing data.
- Never log the raw body, response headers, API key, provider request ID, or query URL.

## Required `Discovery.gs` design

Replace the current incomplete draft with one orchestrator that owns the full run.

### Public entry points

Implement exactly these browser/editor-visible functions already reserved by the static allowlist:

```javascript
runDiscovery(options)
runScheduledDiscovery(event)
installDiscoveryTrigger()
removeDiscoveryTrigger()
resetDiscoverySource()
```

Every other new top-level function must end in `_`.

### Manual run

`runDiscovery(options)`:

- mode is always `manual`;
- accepts no options or a plain object containing only optional `maxPages`;
- validates `maxPages` as an integer from 1 through `JOB_PROFILE_.pagesPerManualRun`;
- is safe for an idempotent retry because the persisted checkpoint and dedupe hierarchy prevent duplicate job rows;
- returns a browser-safe summary containing counts and status, never internal IDs, raw errors, secrets, or provider metadata.

### Scheduled trigger identity guard

`runScheduledDiscovery(event)`:

- requires a nonblank `event.triggerUid`;
- finds exactly one project trigger whose handler is `runScheduledDiscovery`, whose unique ID equals `event.triggerUid`, and whose source is clock/time based;
- refuses missing, forged, duplicate, or stale trigger identities before any source call;
- records an observable `REFUSED_NOT_TRIGGER` run outcome when storage is available;
- returns a safe summary;
- never treats a direct editor call with no event as an authorized scheduled run.

### Trigger management code

`installDiscoveryTrigger()`:

- validates the profile schedule;
- finds triggers for the exact `runScheduledDiscovery` handler;
- creates one only when none exists;
- if duplicates already exist, retains one and deletes only extra triggers for this handler;
- configures every day, hour 7, time zone `America/New_York`;
- returns only safe counts, not trigger IDs;
- must be tested against the fake only in this phase;
- **must not be called against live Apps Script under the current authorization.**

`removeDiscoveryTrigger()` deletes only project triggers for that exact handler and returns a count. It must not delete unrelated triggers.

`resetDiscoverySource()` clears only the nonsecret disable/error state for the JSearch/LinkedIn discovery source. It must not clear the API key, quota history, job rows, run rows, logs, or user-owned queue state.

### Whole-run lock

- Acquire one script lock for the entire run.
- Do not nest another `withLock_` inside it.
- Use `appendRecordInDb_`, `updateRecordByKeyInDb_`, `insertDiscoveredJob_`, and `touchJobLastSeen_` with the same verified spreadsheet handle.
- If lock acquisition fails, return an observable overlap/busy status and make zero source calls and zero writes.
- Always release the lock in `finally` through the established helper.

### Run row and checkpoint

- Use one `DiscoveryRuns` row per `(source, mode, date_key)` resumable attempt, keyed by an opaque `run_id`.
- Resume exactly one row whose status is `IN_PROGRESS` or `PARTIAL` for the same source, mode, and date.
- If multiple resumable rows exist, fail safely with an integrity error; do not choose one silently.
- Checkpoint JSON must be bounded, deterministic, and contain no secret or raw provider data.
- Store at minimum the next query index and bounded retry-attempt state.
- Persist the checkpoint and all counters after every completed page and before returning a partial/budget/error result.
- On resume, continue from the next uncompleted query rather than starting from query zero.
- A crash after a job write but before checkpoint persistence must remain safe: rerun the same page and let dedupe prevent a second row.
- Runtime-budget exhaustion returns `PARTIAL` with a resumable checkpoint.

### Query selection and page limits

- Validate `JOB_PROFILE_` before a source call.
- Build the day's deterministic query set with `jsearchBuildDailyQueries_(dateKey)`.
- Scheduled limit: `JOB_PROFILE_.pagesPerScheduledRun`.
- Manual limit: `JOB_PROFILE_.pagesPerManualRun`, optionally lowered by validated `maxPages`.
- Use `JOB_PROFILE_.adapters.jsearch.publishers`, currently exactly `['linkedin']`.
- Never use a résumé, name, email address, street address, or other PII as a query term.

### Filtering, dedupe, and writes

For each candidate returned from a successful page:

1. Call `filterJobCandidate_(candidate, JOB_PROFILE_)`.
2. If filtered, append one concise `DiscoveryLog` decision and do not touch Jobs.
3. If passed, call `jobDedupeResolveCandidate_(index, candidate, nowIso)`.
4. `INSERT`: formula-escape every source-derived string, call `insertDiscoveredJob_`, and add the stored row to the in-memory index with `_inRun: true`.
5. `TOUCH`: call `touchJobLastSeen_` and then update the in-memory index entry with `_inRun: true`.
6. `DUPLICATE_IN_RUN`: audit only; no write.
7. `QUARANTINE`: audit only; no Jobs write.

Build the index once from actual Jobs rows. Its three methods must return arrays:

```javascript
findByExternalId(source, externalId)
findByUrlHash(source, urlHash)
findByContentHash(source, contentHash)
```

Normalize exactly one leading apostrophe on formula-literal identity inputs so local fakes and live Sheet reads hash identically.

TOUCH may write only `last_seen_at`. Never change an existing row's `status`, `saved_at`, `notes`, `record_version`, or JobHistory. Never reopen Rejected jobs.

INSERT uses `status: 'New'`, `record_version: 1`, and `discovered_at === last_seen_at`.

### Audit and source state

- `DiscoveryLog` is append-only.
- Store only bounded reason codes, hashes, source/external ID when safe, profile version, and resulting job ID.
- Do not store full descriptions, raw candidate JSON, request/response bodies, headers, credentials, or provider request IDs.
- Keep source disable/error state in the approved `Settings` record or existing nonsecret Script Property design; do not place secrets in Sheets.
- Exactly one nonblank Settings key match is required for update. Duplicate keys are an integrity error.
- Successful source communication resets the consecutive terminal-failure count.
- Terminal disable state must be explicit and recoverable only through `resetDiscoverySource()`.

## Required deterministic tests

Create:

`outputs\life-dashboard-apps-script\tests\phase4b-discovery.test.js`

Use only in-memory fakes and injected local adapter result envelopes. No test may perform a real network or Google call.

Cover at minimum:

1. Successful manual run inserts one passing LinkedIn job and writes run/log rows.
2. A filtered job produces a filter log and no Jobs write.
3. Existing L1 identity touches only `last_seen_at`; all user-owned fields and JobHistory remain unchanged.
4. Repeated candidate in one run becomes `DUPLICATE_IN_RUN` and creates only one job.
5. Rerunning/resuming the same page cannot create a duplicate job.
6. Profile validation failure produces zero source calls and zero job writes.
7. Lock overlap/busy produces zero source calls and zero writes.
8. Scheduled call without an event is refused with zero source calls.
9. Scheduled call with a forged/stale trigger UID is refused.
10. Scheduled call with the one matching fake clock trigger runs.
11. Trigger install is idempotent and removes only duplicate same-handler triggers.
12. Trigger removal preserves unrelated triggers.
13. Per-page checkpoint advances only after processing the page.
14. `PARTIAL` resumes from the stored next query index.
15. Ambiguous resumable run rows fail without source or Jobs writes.
16. Runtime budget exhaustion saves a resumable checkpoint.
17. Retryable status obeys `retryLimit` and does not spin indefinitely.
18. `RATE_LIMITED`/`BUDGET_BLOCKED`/quota stop behavior preserves the checkpoint.
19. First terminal error increments state but leaves source enabled; the configured second consecutive terminal error disables it.
20. Source-disabled run makes zero adapter calls until `resetDiscoverySource()`.
21. Nonretryable malformed/oversized/provider errors are audited without fabricating jobs.
22. Formula-like title/company/location/external ID values are stored as literal text and never executed.
23. Run and log counters agree with actual row decisions.
24. Returned summaries and persisted audit data contain no raw errors, API key, headers, body, request ID, résumé text, or PII.

Also extend `tests\phase4b-dedupe.test.js` with an explicit INSERT test proving `{value: true, label: 'Remote'}` stores `remote: true`.

If a small test seam is needed, add the narrowest private adapter wrapper in `Discovery.gs` or a test-only harness override. Do not add production test flags, fixture paths, or mock data seeding.

## Required validation sequence

After each bounded patch, inspect the diff and run the smallest relevant test. Final validation must include:

```powershell
node --test tests\phase4b-filters.test.js tests\phase4b-dedupe.test.js tests\phase4b-discovery.test.js
```

Then:

```powershell
node --test tests\phase1.test.js tests\phase2.test.js tests\phase3.test.js tests\phase4a-jsearch.test.js tests\phase4b-filters.test.js tests\phase4b-dedupe.test.js tests\phase4b-discovery.test.js tests\static-checks.test.js
```

Also run:

```powershell
git diff --check
git status --short
```

Search deployed source for:

- secrets and credential labels;
- email addresses, street addresses, and résumé text;
- unexpected `UrlFetchApp`, `fetch(`, `XMLHttpRequest`, or AI calls;
- Calendar write methods;
- trigger code outside `Discovery.gs`;
- public top-level functions not in the static allowlist;
- Indeed enablement;
- Phase 5 files or behavior;
- mock fixture paths reachable from production.

Report only count-based or redacted scan results. Never print a found secret or identifier into output.

Do not describe Node/static checks as Apps Script V8 or live integration verification.

## Documentation and final handoff

Create:

`outputs\life-dashboard-apps-script\PHASE_4_OPERATING_CONFIG.md`

It must document, without containing live IDs or secrets:

- required Script Properties by name only;
- database initialization expectations;
- profile/adapter/filter/identity versions;
- LinkedIn-only publisher state and disabled Indeed state;
- quota and retry controls;
- source disable/reset behavior;
- manual-run and trigger-install functions;
- requested daily 7 a.m. America/New_York schedule;
- local-only validation already completed;
- separately authorized future live-check steps, clearly marked as not run;
- rollback/removal function for the trigger, clearly marked as code only and not executed.

Then update the existing:

`outputs\life-dashboard-apps-script\PHASE_4_HANDOFF_TO_CODEX.md`

The final handoff must include:

- status: **Partial — local implementation complete; live gate not run**;
- exact Antigravity model label(s) used and whether 3.1 Pro advisor review occurred;
- every file read, changed, and created;
- exact commands and outcomes;
- local test totals;
- advisor scope/findings and confirmation it stopped, if used;
- source/auth/profile/filter/identity versions;
- schedule, quota, lock, checkpoint, retry, and disable decisions;
- no-live proof and checks not run;
- known risks;
- recommended Codex review steps;
- explicit confirmation that no trigger was installed, no live source was called, and Phase 5 was not started.

Re-open both documentation files from disk, verify their first headings, file sizes, changed-file lists, and exact final stop statement.

## Git close-out

- Preserve the current recovery branch history.
- Do not force-push, reset, clean, or rewrite history.
- Commit only after tests, scans, and handoff verification are complete.
- Reconcile into original `main` only if the user's new Antigravity authorization explicitly includes that local merge.
- Do not push to GitHub unless the user explicitly includes GitHub push authority in the new authorization.
- Never commit `.clasp.json`, API keys, live IDs, or test output containing sensitive values.

## Stop condition

Stop when the local Phase 4 implementation, tests, operating configuration, and truthful handoff are complete. Do not perform the live gate. Do not install the trigger. Do not begin Phase 5.

End the handoff and final response with this exact statement:

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
