# Codex Phase 4 Recovery Handoff

## Status

**Partial — the Phase 4B profile, deterministic filters, and deduplication milestone is locally integrated and tested. The discovery orchestrator, its tests, operating document, and final Phase 4 handoff are not yet complete.**

This checkpoint exists because the user asked Codex to wrap at a safe point before the current session approached its usage limit. It is a knowledge-transfer artifact, not permission to begin Phase 5 or perform any live action.

## Active authorization and hard boundaries

The user authorized Codex to finish Phase 4 locally as the only worker, with:

- zero subagents;
- preservation and review of Claude's existing work;
- no live Google, Apps Script, Sheets, Calendar, JSearch, RapidAPI, or LinkedIn tests;
- no trigger installation;
- no Phase 5 work.

Those boundaries remain controlling. No live system was changed in this recovery session.

## Model and worker record

- Worker: Codex, based on GPT-5.
- Subagents created by Codex: **zero**.
- Prior abandoned Claude worker artifacts were inspected directly from disk, preserved as local Git commits, and integrated by Codex. They were not resumed and no agent remains running.
- Reasoning allocation: one serious-coding worker at a Sol Medium-equivalent level; no duplicate implementation and no model escalation.

## Repository and branch state

- Original repository: `C:\Users\User\Documents\Codex\2026-09-10\referenced-chatgpt-conversation-this-is-an-2`
- Original branch: `main`, left clean at `b07b031` while recovery work continues separately.
- Recovery worktree: `C:\Users\User\Claude Code\life-dashboard-phase4-recovery`
- Recovery branch: `codex/phase4-recovery`
- Claude interrupted-work checkpoint: `120fa50` (`backup/claude-phase4b-interrupted-2026-09-12`)
- Preserved profile worker artifact integrated as: `bfb46b8`
- Preserved dedupe worker artifact integrated as: `5d5238b`
- Unauthorized Antigravity Phase 5 work remains isolated on the pre-existing backup branch `backup/antigravity-unreviewed-2026-09-12`; it was not merged, inspected for implementation reuse, or advanced.

Do not delete either abandoned temporary worker worktree until the final Phase 4 close-out is complete:

- `C:\Users\User\AppData\Local\Temp\claude\C--Users-User-Claude-Code\201b520f-4bd5-467e-930a-9d5223318bf9\scratchpad\wt-filters`
- `C:\Users\User\AppData\Local\Temp\claude\C--Users-User-Claude-Code\201b520f-4bd5-467e-930a-9d5223318bf9\scratchpad\wt-dedupe`

## Controlling documents read

- `C:\Users\User\.claude\plans\foamy-yawning-hippo.md`
- `C:\Users\User\AppData\Local\Temp\claude\C--Users-User-Claude-Code\201b520f-4bd5-467e-930a-9d5223318bf9\scratchpad\PHASE4B_CONTRACT.md`
- `outputs\LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`
- `outputs\PHASE_4_SPLIT_PLAN.md`
- `outputs\CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md`
- `outputs\PHASE_4_JOB_PROFILE.md`
- `outputs\life-dashboard-apps-script\PHASE_4_HANDOFF_TO_CODEX.md`
- Claude's stopped-session transcript at `C:\Users\User\.claude\projects\C--Users-User-Claude-Code\201b520f-4bd5-467e-930a-9d5223318bf9.jsonl`

Relevant application files and tests were also read, including `Database.gs`, `Jobs.gs`, `JobProfile.gs`, `JobFilters.gs`, `JobDedupe.gs`, `Discovery.gs`, `JobSource_JSearch.gs`, `appsscript.json`, `.claspignore`, `tests\gas-fakes.js`, `tests\phase1.test.js`, `tests\phase4a-jsearch.test.js`, `tests\phase4b-dedupe.test.js`, and `tests\static-checks.test.js`.

## Work completed in this checkpoint

### Preserved Claude's interrupted primary work

Claude's six uncommitted files were committed without alteration to `backup/claude-phase4b-interrupted-2026-09-12` as `120fa50`:

- `Database.gs`
- `Jobs.gs`
- `appsscript.json`
- `tests\gas-fakes.js`
- `tests\phase1.test.js`
- `tests\static-checks.test.js`

That checkpoint contains the additive Phase 4 schemas, formula-literal handling, natural-key update helper, discovery-only Jobs write helpers, ScriptApp/clock fakes, manifest trigger scope, and static allowlist preparation.

### Integrated and strengthened the approved job profile

`JobProfile.gs` now contains the approved `phase4-job-profile-v1-2026-09-11` profile with:

- P1 IT/help desk/desktop/technical support titles;
- P2 office administration/operations/logistics titles;
- P3 non-sales customer support/success titles;
- Downtown Pittsburgh center at `40.4406,-79.9959` and a strict less-than-eight-mile rule;
- remote preference with Pennsylvania eligibility handling;
- `$19/hour` and `$38,000/year` minimums;
- full-time and contract-to-hire inclusion;
- stable exclusions for senior leadership, sales, general manager, kitchen manager, driving, heavy travel, and relocation;
- the 13 frozen JSearch query entries;
- five scheduled pages, three manual pages, two retries, two terminal failures before source disablement, a 270,000 ms runtime budget, and a 7 a.m. America/New_York schedule;
- JSearch enabled for LinkedIn only. Indeed remains disabled.

Codex strengthened the validator to reject blank, untrimmed, overlong, duplicate, wrong-case, out-of-range, fractional, duplicate-query-ID, and non-LinkedIn configuration values.

### Replaced the noncompliant filter draft

`JobFilters.gs` was rewritten as deterministic `jobfilters-v2`. The old draft was unsuitable because it added unapproved medical/clearance exclusions, used `$39,520` instead of the approved `$38,000`, matched role tracks from descriptions, and did not implement the frozen exclusion order.

The replacement:

- returns the exact auditable result shape;
- applies the approved stable exclusion order;
- matches P1/P2/P3 from title only;
- treats no title-track match as `NO_MATCHED_TRACK`, not exclusion;
- treats an unstated employment type, missing coordinates, remote-jurisdiction silence, uncertain compensation unit, compensation estimate, and a straddling salary range as review flags;
- accepts full-time and contract-to-hire;
- excludes part-time, temporary, seasonal, internship, volunteer, and bare contractor roles;
- excludes an on-site/hybrid candidate at or beyond exactly eight miles;
- excludes a remote job only when the listing affirmatively makes Pennsylvania ineligible; silence is included with `REMOTE_JURISDICTION_UNSTATED`;
- excludes compensation only when a source-provided USD range is wholly below the approved hourly or annual floor;
- performs no web, AI, Sheet, or other external call.

### Integrated and corrected deduplication

The preserved worker `JobDedupe.gs` implements:

- L1 `(source, external_id)` identity;
- L2 `(source, canonical URL hash)` only when there is no external ID;
- L3 `(source, content hash)` only when there is no external ID or URL;
- ambiguity quarantine;
- URL/external-ID conflict quarantine;
- in-run duplicate suppression;
- TOUCH limited to `last_seen_at`;
- INSERT with `status: New`, `record_version: 1`, and equal discovery/last-seen timestamps;
- versioned URL, content, and identity transforms;
- one-leading-apostrophe normalization for live-Sheet versus fake-Sheet hash stability.

Codex corrected the adapter boundary so the JSearch adapter's actual normalized remote shape `{value, label}` preserves `true` on INSERT while raw boolean/string fixtures remain supported.

### Corrected natural-key update compatibility

`Database.gs` now compares natural keys by stable string representation during both match and readback. This protects `DiscoveryRuns.run_id` and `Settings.key` updates from Sheet type coercion without changing row data or weakening exact-one-match integrity checks.

## Files changed or created after worker integration

- `outputs\life-dashboard-apps-script\Database.gs`
- `outputs\life-dashboard-apps-script\JobProfile.gs`
- `outputs\life-dashboard-apps-script\JobFilters.gs`
- `outputs\life-dashboard-apps-script\JobDedupe.gs`
- `outputs\life-dashboard-apps-script\tests\phase4b-filters.test.js` (created)
- `outputs\life-dashboard-apps-script\tests\phase4b-dedupe.test.js` (preserved worker test)
- `outputs\CODEX_PHASE_4_RECOVERY_HANDOFF.md` (this file)

No Phase 5 file was created or modified.

## Local checks and exact outcomes

### Focused Phase 4B filter/dedupe check

Command, from `outputs\life-dashboard-apps-script`:

```powershell
node --test tests\phase4b-filters.test.js tests\phase4b-dedupe.test.js
```

Outcome: **PASS — 36 tests, 36 passed, 0 failed.**

### Full local suite at this checkpoint

Command:

```powershell
node --test tests\phase1.test.js tests\phase2.test.js tests\phase3.test.js tests\phase4a-jsearch.test.js tests\phase4b-filters.test.js tests\phase4b-dedupe.test.js tests\static-checks.test.js
```

Outcome: **PARTIAL — 422 tests, 421 passed, 1 failed.**

The sole failure is deterministic and expected for this checkpoint:

```text
PUBLIC_ALLOWLIST entry "installDiscoveryTrigger" is not declared in any deployed .gs file
```

`tests\static-checks.test.js` also reserves the other unfinished discovery entry points (`removeDiscoveryTrigger`, `resetDiscoverySource`, and `runScheduledDiscovery`). Do not remove those allowlist entries to manufacture a green result. Implement the missing Phase 4B discovery contract and rerun the suite.

Static parsing passed for every deployed `.gs` file. Phase 1, Phase 2, Phase 3, Phase 4A adapter, and all added filter/dedupe behavior passed locally. These are Node/in-memory/static results only, not Apps Script V8, Google Sheet, trigger, or live JSearch verification.

## Exact remaining Phase 4 work

1. Replace the incomplete `outputs\life-dashboard-apps-script\Discovery.gs` draft.
2. Implement public entry points already reserved by the static allowlist:
   - `runDiscovery(options)` for a bounded manual run;
   - `runScheduledDiscovery(event)` with a real trigger-identity guard;
   - `installDiscoveryTrigger()` as idempotent code for one daily 7 a.m. America/New_York trigger;
   - `removeDiscoveryTrigger()`;
   - `resetDiscoverySource()`.
3. **Do not call** `installDiscoveryTrigger`, `runDiscovery`, `runScheduledDiscovery`, JSearch, Apps Script, or Google Sheets under the current authorization.
4. Hold one script lock for the full discovery run. A lock failure must return an observable overlap skip and make zero source calls.
5. Validate `JOB_PROFILE_` before a source call. Use `jsearchBuildDailyQueries_(dateKey)` and only LinkedIn from `JOB_PROFILE_.adapters.jsearch.publishers`.
6. Write/resume one `DiscoveryRuns` row by `(source, mode, date_key)` with an opaque `run_id`. Persist checkpoint JSON and counters after every page. Resume `IN_PROGRESS`/`PARTIAL`; reject ambiguous resumable rows rather than guessing.
7. Respect mode page limits, `runtimeBudgetMs`, `retryLimit`, adapter quota results, and terminal-error disablement. Never retry `BUDGET_BLOCKED` or terminal failures. Disable the source only after the configured consecutive terminal threshold.
8. Build the dedupe index from actual Jobs rows. Normalize one leading apostrophe for identity comparisons. After an INSERT or TOUCH, add an `_inRun: true` row to the in-memory index so a repeat becomes `DUPLICATE_IN_RUN` with no second write.
9. For each source candidate: filter, log the decision, dedupe passing candidates, INSERT or TOUCH through the existing narrow Jobs helpers, and update counters. TOUCH must never change status, notes, saved_at, record_version, or JobHistory.
10. Escape all source-derived strings before Sheet writes. Do not store raw provider payloads, headers, request IDs, API keys, résumé text, personal addresses, or full descriptions in `DiscoveryLog`.
11. Add `tests\phase4b-discovery.test.js` covering:
    - manual and scheduled success using injected local adapter envelopes;
    - trigger identity refusal with zero source calls;
    - overlap skip with zero source calls;
    - per-page checkpoint and resume after interruption/runtime budget;
    - idempotent rerun and in-run duplicates;
    - INSERT versus TOUCH write scope;
    - retryable, budget-blocked, and terminal-disable status handling;
    - no job writes on profile/source failure;
    - audit rows/counters and formula-literal treatment;
    - trigger install idempotency and removal, tested only against `ScriptApp` fake.
12. Extend `tests\phase4b-dedupe.test.js` with one explicit `{value: true, label: 'Remote'}` INSERT assertion.
13. Rerun the exact full suite above plus the new discovery test. Every result must be green before close-out.
14. Run a count-only secret/PII scan, inspect `git diff --check`, inspect the actual diff, and confirm the deployed file list remains exactly the `.claspignore` whitelist.
15. Create `outputs\life-dashboard-apps-script\PHASE_4_OPERATING_CONFIG.md` describing setup and disabled-live steps without containing any secret, spreadsheet ID, Script ID, or personal data.
16. Replace the current partial `outputs\life-dashboard-apps-script\PHASE_4_HANDOFF_TO_CODEX.md` with the full truthful handoff required by the approved plan. Final status must remain **Partial — local implementation complete; live gate not run** until separately authorized live Google/JSearch verification exists.
17. Commit the local recovery branch. Reconcile it into the original repository only after tests and scans are green. Do not push, deploy, install a trigger, or start Phase 5 unless current authorization is checked explicitly.

## Live checks not run

- Apps Script V8 execution: **Not run — prohibited by current authorization.**
- Google Sheet schema/write verification: **Not run — prohibited by current authorization.**
- JSearch/RapidAPI/LinkedIn request: **Not run — prohibited by current authorization.**
- Trigger installation or real scheduled execution: **Not run — prohibited by current authorization.**
- GitHub push from this recovery checkpoint: **Not run.**

## Known risks and limitations

- `Discovery.gs` remains the old incomplete draft and must not be treated as Phase 4B complete.
- The complete local suite is intentionally not green until the discovery entry points and tests are implemented.
- Quote-prefix behavior is covered only by the in-memory fake; live Google Sheet coercion remains unverified.
- Script-lock reentrancy is intentionally avoided by the narrow in-database helpers, but only a separately authorized live Apps Script test can establish real service behavior.
- Apps Script time triggers execute near the selected hour, not at an exact minute. The requested configuration is the 7 a.m. America/New_York hour.
- Indeed remains disabled and out of the current Phase 4 implementation. Phase 5 remains unauthorized.

## Resume command

Start from:

```powershell
Set-Location -LiteralPath 'C:\Users\User\Claude Code\life-dashboard-phase4-recovery'
git status --short --branch
```

Then read this handoff, the frozen contract, `Discovery.gs`, `Database.gs`, `Jobs.gs`, `JobSource_JSearch.gs`, and the test harness before editing.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
