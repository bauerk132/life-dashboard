# Life Dashboard — Phase 4B Claude Review Follow-up

## 1. Purpose and Scope

This document records the Claude-side review of Antigravity's `PHASE_4_HANDOFF_TO_CODEX.md`, performed per its own "Recommended Codex Review Steps" (§8 of that file). It does **not** replace or rewrite that handoff or `PHASE_4_OPERATING_CONFIG.md` — both remain in place as originally authored, with the operating config carrying inline `Correction` notes where this review found it to be inaccurate. This document is the record of what was actually found, fixed, tested, and verified.

Review scope was strictly: (1) `Discovery.gs` lock/checkpoint discipline, (2) the original 24 `phase4b-discovery.test.js` scenarios, (3) a full local test suite run, (4) an accuracy check of `PHASE_4_OPERATING_CONFIG.md`. No Phase 5 work was started or reviewed. No live Google/RapidAPI resources were touched.

---

## 2. Confirmed Defects and Fixes

Five defects were confirmed in `Discovery.gs` and fixed. Each fix is covered by a new deterministic test in `tests/phase4b-discovery.test.js`, under the `describe` block "Phase 4B: Claude Review Follow-up (Requirements 25 - 29)".

1. **Apostrophe-symmetry bug in `discoveryBuildIndex_`** — `registerRow` and `findByExternalId` normalized leading apostrophes inconsistently, which could cause a formula-escaped stored value and an unescaped in-memory value to hash to different dedupe keys for the same job. Fixed by routing both call sites through `jobDedupeStripLeadingApostrophe_(...)`. (Test 25.)

2. **Missing explicit `NOT_CONFIGURED` / `QUOTA_EXHAUSTED` handling** in `discoveryRunPipeline_`, and `pages_attempted` not gated on whether a page fetch actually reserved quota. Fixed by adding explicit terminal branches for both statuses (`NOT_CONFIGURED` → `FAILED`, no checkpoint advance, no per-query error log; `QUOTA_EXHAUSTED` → `BUDGET_BLOCKED`, checkpoint preserved) and gating `pages_attempted` increments on `fetchResult.quota.reserved === true`. (Tests 26, 27.)

3. **Unauthorized `nowDate` override reachable from the public `runDiscovery(options)` API** — the browser-callable entry point accepted an `options.nowDate` and passed it through to `discoveryRunPipeline_`, letting a caller spoof "now" for quota/schedule logic. Fixed by removing `nowDate` from the public option allow-list; `runDiscovery` now accepts only `maxPages`. Swept for other call sites: `nowDate` remains legitimate as an internal parameter in `JobSource_JSearch.gs`'s adapter functions (never public-facing) and is not referenced anywhere in `JavaScript.html`, so no live frontend call site depended on the removed option. (Test 28.)

4. **Silent fail-open on corrupt `DISCOVERY_SOURCE_STATE`** — `discoveryLoadSourceStateInDb_` previously treated a present-but-unparseable/blank/non-object Settings value the same as "not present," defaulting to `enabled: true`. Fixed to fail closed: a present-but-malformed row now returns `{ enabled: false, reason: 'STATE_CORRUPT' }`, recoverable only via `resetDiscoverySource()`. Verified this is safe for the first live run: `initializeDatabase()` in `Database.gs` never seeds `DISCOVERY_SOURCE_STATE` (confirmed by direct inspection — it only writes the `Settings` sheet's column headers, no rows), and the "row genuinely absent" case is a separate code path that still correctly defaults to `enabled: true`. (Test 29.)

5. **Browser-facing run summary omitted the terminal error code** — `runDiscovery`'s sanitized return object had no way to convey *why* a run stopped, only that it did. Fixed by adding `errorCode: terminalErrorCode || null` to the summary. Verified this introduces no leak of raw error text: every assignment to `terminalErrorCode` in `Discovery.gs` is either a fixed literal token (`'NOT_CONFIGURED'`, `'QUOTA_EXHAUSTED'`, `'BUDGET_BLOCKED'`, `'RATE_LIMITED'`, `'RUNTIME_BUDGET_EXHAUSTED'`) or `fetchResult.status`, which is itself always one of a fixed enum of safe machine-readable tokens defined in `JobSource_JSearch.gs`'s HTTP-status classification matrix (`AUTH_FAILED`, `NOT_SUBSCRIBED_OR_RETIRED`, `NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`, `UPSTREAM_ERROR`, `UNEXPECTED_STATUS`, `OK`) — never `err.message` or raw response body text. (Covered incidentally by tests 26-29, which all assert on `errorCode`.)

### Validation methodology

Each fix was validated with a control-run technique in addition to the new tests passing: the pre-fix version of `Discovery.gs` was temporarily restored, the full discovery test file was re-run to confirm the 5 new tests (25-29) failed against the unfixed code, then the fixed version was restored and the full suite re-confirmed green. This rules out tests that pass vacuously against either version of the code.

---

## 3. Test Suite: New Baseline

- **Before this review**: 447 tests in 43 suites (Antigravity's original claim, `phase4b-discovery.test.js` at 24 scenarios).
- **After this review**: **452 tests in 44 suites**, 0 failures — `phase4b-discovery.test.js` now has 29 scenarios (the original 24 plus the 5 above), adding one new `describe` block.

Full command and result:
```bash
node --test tests/phase1.test.js tests/phase2.test.js tests/phase3.test.js tests/phase4a-jsearch.test.js tests/phase4b-filters.test.js tests/phase4b-dedupe.test.js tests/phase4b-discovery.test.js tests/static-checks.test.js
```
Result: **452/452 pass, 0 fail**, 44 suites, duration ~676ms.

`git diff --check`: clean (only benign CRLF-conversion notices, no whitespace errors or conflict markers).

**Count-only PII/secrets scan** of the diff (`Discovery.gs` + `tests/phase4b-discovery.test.js` only): 0 email addresses, 0 phone-number patterns, 0 SSN patterns, 0 AWS-style key patterns, 0 key/secret/token/password literal assignments. Two hits on a generic 32+-character alphanumeric-token heuristic, both confirmed to be the function name `jobDedupeStripLeadingApostrophe_`, not a secret.

---

## 4. `PHASE_4_OPERATING_CONFIG.md` Accuracy Check

Per review step 4, the operating config was checked against the actual code and found to contain multiple inaccuracies predating this review. Rather than being rewritten, the file was corrected in place with inline `Correction` notes so the diff is auditable; a summary of what was wrong:

| Section | Original claim | Actual |
| :--- | :--- | :--- |
| §2 `DiscoveryRuns.status` | Lists `RATE_LIMITED` as a run status; omits `IN_PROGRESS` | `RATE_LIMITED` is an `error_code`, not a status; actual status enum is `IN_PROGRESS`, `COMPLETED`, `PARTIAL`, `BUDGET_BLOCKED`, `SOURCE_DISABLED`, `REFUSED_NOT_TRIGGER`, `FAILED`. (`'SKIPPED_OVERLAP'` is returned directly by `discoveryRunPipeline_` on lock contention — before any `DiscoveryRuns` row is created — so it is not a row status and was excluded from this enum after verifying its call site.) |
| §3 | "Creates default nonsecret records in Settings where needed" | `initializeDatabase()` only writes `Settings`' column headers; it writes zero default rows |
| §6 | "Retry Limit: Max 2 retry attempts" | `retryLimit: 2` caps **total** attempts (1 initial + 1 retry), not 2 retries after the initial attempt |
| §7 | Terminal errors named `AUTH_FAILURE`, `SUBSCRIPTION_INACTIVE`, `ENDPOINT_DISABLED`; no mention of `NOT_CONFIGURED`/`QUOTA_EXHAUSTED` or `STATE_CORRUPT` | Actual tokens are `AUTH_FAILED`, `NOT_SUBSCRIBED_OR_RETIRED`, `NOT_FOUND`; `NOT_CONFIGURED`/`QUOTA_EXHAUSTED` are separate non-circuit-breaker terminal stops; `STATE_CORRUPT` is a new fail-closed state recoverable only via `resetDiscoverySource()` |
| §8 | "Time: 7:00 a.m." | Trigger is built via `.atHour(JOB_PROFILE_.schedule.hour)` with `schedule.hour = 7`; `atHour()` selects an hour, not an exact minute, so "7:00 a.m." overstates the precision actually configured. (Apps Script's own dispatch-minute behavior within that hour was not independently verified and is not asserted here.) |
| §8 | `installDiscoveryTrigger()` returns `{status, installedCount, removedDuplicates}`; `removeDiscoveryTrigger()` returns `{status, removedCount}` | Both also return a `handler` field; `installDiscoveryTrigger()` additionally returns `scheduleHour` and `timeZone` |
| §8 | `runDiscovery()` summary fields listed without `errorCode` | `errorCode` is a new field on the summary (fix #5 above) |
| §9 | "447 tests in 43 suites," "24 end-to-end orchestrator scenarios," `phase2.test.js` described as "Scoring and validation checks" | 452/44/29 (this review); `phase2.test.js` actually covers task lifecycle, dashboard data, and upcoming events — no scoring/validation logic lives there |

---

## 5. Known Limitations and Out-of-Scope Items (Informational)

These are surfaced for awareness, not as blockers, and were not acted on beyond reporting:

- **Pre-existing PII on `origin/main`**: `outputs/GEMINI_CLOUD_PHASE_1_2_VALIDATION_TO_CODEX.md` (already on `origin/main`, predating this review) contains what appears to be a personal mailbox reference. This was not introduced by this review and is out of scope for it. Redaction, if wanted, should be a separately approved forward-only change — repository history is not rewritten here.
- **Local `main` has an unreviewed Phase 5 M1 commit** (`8413eb9`) not present on this branch or on `origin/main`. This review did not touch, merge, or evaluate that commit. Whether `.agents/ORIGINAL_REQUEST.md` accurately reflects the user's actual request, and whether that commit should be reviewed or backed up, is deferred to a future user-facing gate.
- **`PHASE_4_HANDOFF_TO_CODEX.md` itself was not modified.** Its line reference in §8 ("`Discovery.gs` lines 424-892") no longer points at the same content: the fixes in §2 above added a net 31 lines to `Discovery.gs` (`git diff --numstat`: 50 inserted, 19 deleted), and as of this review `discoveryRunPipeline_` — the orchestrator function the handoff meant to point at — spans current lines 442-921 (lock acquisition at line 450), not 424-892. The file is left as Antigravity originally wrote it; this document is the corrective record instead.
- No live gates were run: zero live Google Sheets/Calendar/Apps Script/RapidAPI/JSearch calls, zero triggers installed, zero `clasp push`. The M6 live gate remains unstarted.

---

## 6. Commands Executed and Outcomes

| Command | Outcome |
| :--- | :--- |
| `node --test tests/phase4b-discovery.test.js` (pre-fix control run) | 5 failing (tests 25-29), 24 passing — confirms new tests are not vacuous |
| `node --test <all 8 test files>` (post-fix) | **452/452 pass, 0 fail, 44 suites** |
| `git diff --check` | Clean (CRLF notices only) |
| Count-only PII/secrets scan of the diff | 0 findings |
| `git status --short` | Exactly 2 modified files: `Discovery.gs`, `tests/phase4b-discovery.test.js` |

---

## 7. Files Changed by This Review

- `Discovery.gs` — 5 fixes described in §2.
- `tests/phase4b-discovery.test.js` — 5 new tests (25-29) plus a stale-comment correction on test 1.
- `PHASE_4_OPERATING_CONFIG.md` — inline corrections described in §4; no content removed, only corrected/annotated.
- `PHASE_4_CLAUDE_REVIEW_HANDOFF.md` — this document (new).

No other files were touched. No Phase 5 work was started.

---

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
