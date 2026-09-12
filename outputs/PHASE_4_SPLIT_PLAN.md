# Life Dashboard — Phase 4 Split Plan (4A Antigravity / 4B Claude)

## Status

Preparatory planning document written by Claude on 2026-09-12. It is **not** authorization to implement any part of Phase 4. It records how the user asked Phase 4 to be divided and what each half owns.

Governing documents (unchanged by this plan):

- `outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md` — master plan
- `outputs/CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md` — Phase 4 controlled assignment
- `outputs/PHASE_4_JOB_PROFILE.md` — profile `phase4-job-profile-v1-2026-09-11`
- `outputs/PHASE_4_ENTRY_GATE_PAUSED_REPORT.md` — gate verdict (paused)

This plan changes only **who implements which slice** of Phase 4. It does not change scope, architecture, privacy rules, or stop gates.

## Why split

The user reassigned the JSearch/RapidAPI integration to **Antigravity** (Google's agentic development platform, running Gemini 3.8 Flash). Claude implements the rest of Phase 4 after the JSearch adapter is in place and handed back.

The split falls on the adapter boundary that the controlled handoff already defines. Adapter rule 7 says an adapter must "return a common record shape without writing to Sheets". Everything that talks to JSearch goes to Antigravity. Everything that decides what to keep and persists it stays with Claude.

## User decisions recorded (2026-09-12, Claude session)

| Decision | Answer |
|---|---|
| RapidAPI/JSearch plan | **Free: 200 requests/month, hard limit** (no overage billing), 1,000 requests/hour |
| `Jobs.source` label | **`linkedin` / `indeed` per publisher**, with the provider route `jsearch` recorded separately |
| Résumé | **Build a help-desk-slanted variant first.** Truthful, from existing résumé files. This is a Phase 4B/profile input and is not needed by 4A, because no résumé text ever goes to JSearch. |
| Phase 4 authorization | **Not given.** Both 4A and 4B still need their own explicit authorization. |

Antigravity cannot see the Claude chat. That is why the recommended 4A authorization phrase repeats these decisions: the user reconfirms them in the message that authorizes Antigravity.

## Phase 4A — Antigravity: JSearch adapter, local only

Controlled assignment: `outputs/ANTIGRAVITY_PHASE_4A_JSEARCH_CONTROLLED_HANDOFF.md`

Owns:

1. `JobSource_JSearch.gs`:
   - request builder for `GET /search-v2` with `num_pages=1` and a bounded query catalog;
   - response validation and failure classification;
   - per-record normalization and quarantine;
   - the publisher → `source` mapping (`linkedin` enabled; `indeed` present but disabled by config);
   - the Free-tier quota guard;
   - key read from Script Property `JSEARCH_RAPIDAPI_KEY`, never logged or returned.
2. Test infrastructure:
   - `UrlFetchApp` fake and `Utilities.computeDigest` fake in `tests/gas-fakes.js`, both backward-compatible;
   - synthetic fixtures under `tests/fixtures/jsearch/`;
   - `tests/phase4a-jsearch.test.js`.
3. Shared-surface edits required by the adapter:
   - add scope `script.external_request` to `appsscript.json` and update the manifest test;
   - narrow the `/UrlFetchApp/` and `/fetch\(/` static bans to that one file;
   - add `JobSource_JSearch.gs` to `DEPLOYED_GS_FILES` and `.claspignore`.
4. Hand-back document `outputs/life-dashboard-apps-script/PHASE_4A_HANDOFF_TO_CLAUDE.md`.

Explicitly **not** in 4A:

- live JSearch calls or entering a key;
- triggers or the `script.scriptapp` scope;
- Sheets writes, `Discovery.gs`, `JobFilters.gs`, `JobDedupe.gs`;
- UI or public functions;
- any change to `Code.gs`, `Database.gs`, `Jobs.gs`, `Tasks.gs`, `Calendar.gs` or the HTML files;
- deployment or push.

## Phase 4B — Claude: pipeline, persistence, schedule, live gate

Starts only after both of these are true:

- `PHASE_4A_HANDOFF_TO_CLAUDE.md` exists with status Complete, and Claude has independently verified it: files, tests, static checks.
- The user gives the full Phase 4 authorization from `CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md:44`, or an amended form the user writes.

Owns:

1. `JobFilters.gs`:
   - deterministic profile filters (geography < 8 mi from Downtown Pittsburgh, PA-remote eligibility, compensation floors, employment type, hard exclusions, seniority);
   - reason codes and the profile identifier.
2. `JobDedupe.gs`: `(source, external_id)` → `(source, URL hash)` → versioned content hash; rediscovery preserves user-owned fields.
3. `Discovery.gs`:
   - one orchestration path shared by manual and trigger runs;
   - `LockService` and checkpoints;
   - `DiscoveryRuns` / `DiscoveryLog` sheets;
   - bounded retry, and safe disable after repeated terminal errors;
   - the 7:00 a.m. `America/New_York` daily trigger (adds `script.scriptapp` and narrows that static ban to the orchestrator).
4. Minimal persistence hooks in `Database.gs` / `Jobs.gs`; an admin/run-status view if required.
5. Help-desk résumé variant (truthful) and deterministic query/skill configuration derived from it.
6. Live gate:
   - private blank Sheet and private Apps Script test project;
   - the user enters the key into Script Properties themselves;
   - first live call records the `x-ratelimit-requests-remaining` before/after delta to settle whether `num_pages` bills per page;
   - LinkedIn path acceptance first, then Indeed enablement.
7. `outputs/life-dashboard-apps-script/PHASE_4_HANDOFF_TO_CODEX.md`. This is the only file that satisfies Phase 5 entry gate item 1 (`ANTIGRAVITY_PHASE_5_CONTROLLED_HANDOFF.md:27`). `PHASE_4A_HANDOFF_TO_CLAUDE.md` does not.

## Interface contract between 4A and 4B

4B depends only on these adapter functions. All are private (`_` suffix) and are not browser-callable. Exact semantics are in the 4A handoff.

| Function | Purpose |
|---|---|
| `jsearchBuildDailyQueries_(dateKey)` | Deterministic, bounded query list for one `America/New_York` day, taken from the catalog only |
| `jsearchFetchPage_(query, options)` | One billed request. Must be called while the caller holds the script lock. Returns a classified result and never throws for upstream failures. |
| `jsearchGetQuotaSnapshot_(nowDate)` | Read-only view of quota state for run logs and the admin view |
| `JSEARCH_ADAPTER_VERSION_` | Version string recorded on every run |

Normalized candidates must already pass `Jobs.gs` `validateSourceUrl_`. 4A proves this with a cross-file test, so URL rejects never show up for the first time during 4B persistence.

## Quota budget (Free tier, 200 requests/month)

- Scheduled cap: **5 requests/day.**
- Reserve for manual runs and retries: **20 requests/period**, with a manual cap of 3 requests/day drawn from the reserve.
- Worst case: `5 × 31 + 20 = 175 ≤ 200`, which leaves 25 requests of margin for reset-date drift.
- The primary signal is RapidAPI's `x-ratelimit-requests-remaining` / `-reset` headers. The quota resets on the subscription anniversary, not on the 1st. The local counter is a conservative secondary guard.
- A request is reserved **before** it is sent, so a timeout still counts.
- No automatic retries inside the adapter.

## Open items for the user

1. **Phase 4A authorization.** Recommended phrase is in the 4A handoff. It is narrower than the full Phase 4 phrase: local code and tests only.
2. **Secret-storage ratification.** The two Phase 4 documents conflict on whether Script Properties may hold the API key; see the 4A handoff, "Secret-storage conflict". The controlling document permits it. The authorization phrase ratifies it.
3. **Timing of the help-desk résumé variant.** It is independent of 4A and can be built before or during 4B.
4. **Later (4B gate):** full Phase 4 authorization, the private test Sheet and Apps Script project, and the user entering the key in Script Properties personally.

**PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
