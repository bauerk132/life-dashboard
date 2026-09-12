# Life Dashboard — Phase 4 Operating Configuration

## 1. Overview and Scope

This document defines the operational configuration, runtime limits, security boundaries, and lifecycle procedures for the scheduled job discovery pipeline implemented in Phase 4.

All implementations described herein are verified locally via deterministic unit and static analysis tests. **No live Google resources have been accessed or modified, no live Apps Script triggers have been installed, and no live RapidAPI/JSearch calls have been executed.**

> **Revision note**: This document was corrected during the Claude review pass of the Phase 4B handoff (see [PHASE_4_CLAUDE_REVIEW_HANDOFF.md](./PHASE_4_CLAUDE_REVIEW_HANDOFF.md) for the full list of defects found and fixed in `Discovery.gs`). Sections 2, 3, 6, 7, 8, and 9 below have inline **Correction** notes marking where this document originally diverged from the actual code; nothing else in this document was changed. Original authorship, execution ownership, and version numbering are unchanged.

---

## 2. Required Script Properties

The following Script Properties must be configured in Google Apps Script before any live execution:

| Property Name | Classification | Description | Sample / Format |
| :--- | :--- | :--- | :--- |
| `DATABASE_SHEET_ID` | Operational ID | The Google Drive ID of the backing Google Sheet database. | Alphanumeric string |
| `JSEARCH_RAPIDAPI_KEY` | Secret Credential | API key for JSearch by OpenWeb Ninja on RapidAPI. | Alphanumeric private key |

> [!IMPORTANT]
> - Never store `JSEARCH_RAPIDAPI_KEY` in Google Sheets, source code, Git repositories, or client-visible files.
> - `JSEARCH_RAPIDAPI_KEY` is referenced exclusively by `JobSource_JSearch.gs` and is never exposed in browser summaries or audit logs.

---

## 3. Database and Schema Expectations

Database initialization is managed via `initializeDatabase()` in `Database.gs`:
- Ensures all required sheets exist (`Tasks`, `Jobs`, `JobHistory`, `Settings`, `Applications`, `DiscoveryRuns`, `DiscoveryLog`).
- Writes frozen column headers if sheets are newly created.
- Formats plain-text columns with `@` number format to prevent formula injection or unwanted type coercion.
- **Correction**: `initializeDatabase()` writes only the frozen column headers (`key`, `value`, `updated_at`) for `Settings`; it does **not** write any default rows into `Settings`. In particular, it does not seed `DISCOVERY_SOURCE_STATE` — that key first appears only once `Discovery.gs` writes it (see §7's fail-closed note).

### Operational Tables for Phase 4

1. **`DiscoveryRuns`**:
   - `run_id` (PK, opaque UUID string)
   - `source` (`linkedin` or `indeed`)
   - `provider` (`jsearch`)
   - `mode` (`scheduled` or `manual`)
   - `date_key` (`YYYY-MM-DD` in `America/New_York`)
   - `status` (`IN_PROGRESS`, `COMPLETED`, `PARTIAL`, `BUDGET_BLOCKED`, `SOURCE_DISABLED`, `REFUSED_NOT_TRIGGER`, `FAILED`). Note: `RATE_LIMITED` is not a run-level status — it appears only as an `error_code` value on a `PARTIAL` run. **Correction**: an earlier revision of this document also listed `SKIPPED_OVERLAP` here; verified against `Discovery.gs` (line ~454), `'SKIPPED_OVERLAP'` is returned directly by `discoveryRunPipeline_` when the script lock is busy, *before* a `DiscoveryRuns` row is ever created for that call — it is a lock-contention return value, not a row status, and does not belong in this enum.
   - `error_code` (safe machine-readable error token)
   - `checkpoint_json` (bounded JSON with `queryIndex` and `attempts`)
   - `pages_attempted`, `raw_count`, `accepted_count`, `filtered_count`, `duplicate_count`, `updated_count`, `quarantined_count`, `error_count`
   - `profile_version`, `config_version`, `adapter_version`, `filter_version`, `identity_version`

2. **`DiscoveryLog`**:
   - `id` (PK, opaque UUID string)
   - `run_id` (FK to `DiscoveryRuns.run_id`)
   - `logged_at` (ISO 8601 timestamp)
   - `source` (`linkedin` or `indeed`)
   - `external_id` (formula-escaped external posting ID)
   - `url_hash` (`jobdedupe-url-v1:<sha256>`)
   - `content_hash` (formula-escaped hash)
   - `decision` (`accepted`, `filtered`, `duplicate`, `updated`, `quarantine`, `error`)
   - `reason_code` (safe code, e.g., `PASSED_PROFILE`, `EXCLUDED_SENIOR_LEADERSHIP`, `DUPLICATE_IN_RUN`, `IDENTITY_TOUCH`)
   - `secondary_reasons` (comma-separated review flags or secondary filter codes)
   - `profile_version`
   - `job_id` (FK to `Jobs.id` when accepted or updated)

---

## 4. Component and Version Control

The discovery subsystem operates under strict semantic versioning tags:

- **Job Profile ID**: `phase4-job-profile-v1-2026-09-11` (`JOB_PROFILE_.profileId`)
- **Profile Config Version**: `1` (`JOB_PROFILE_.configVersion`)
- **Source Adapter Version**: `4A.1` (`JSEARCH_ADAPTER_VERSION_`)
- **Adapter Normalizer Version**: `jsearch-normalize-v1` (`JSEARCH_NORMALIZER_VERSION_`)
- **Hard Filter Version**: `jobfilters-v2` (`DISCOVERY_FILTER_VERSION_`)
- **Identity & Dedupe Version**: `jobdedupe-identity-v1` (`DISCOVERY_IDENTITY_VERSION_`)
- **Canonical URL Hash Version**: `jobdedupe-url-v1` (`JOBDEDUPE_URL_VERSION_`)
- **Content Hash Version**: `jobdedupe-content-v1` (`JOBDEDUPE_CONTENT_VERSION_`)

---

## 5. Publisher Governance

- **Active Publisher**: `linkedin` (strictly enabled in `JOB_PROFILE_.adapters.jsearch.publishers = ['linkedin']`).
- **Disabled Publishers**: `indeed` is disabled by default in Phase 4. All other aggregator publishers (`glassdoor`, `ziprecruiter`, etc.) are dropped by the adapter without persistence.
- Publisher identity is treated as provenance within the adapter and never fabricated or relabeled.

---

## 6. Quota, Budget, and Retry Policies

### Quota Caps (JSearch Free Tier)
- **Monthly Hard Limit**: 200 requests/month (`JSEARCH_PLAN_MONTHLY_LIMIT_`).
- **Monthly Safety Reserve**: 20 requests reserved (`JSEARCH_PERIOD_RESERVE_`), preventing accidental monthly overages.
- **Daily Scheduled Run Budget**: Max 5 pages/day (`JSEARCH_SCHEDULED_DAILY_CAP_` / `JOB_PROFILE_.pagesPerScheduledRun`).
- **Daily Manual Run Budget**: Max 3 pages/day (`JSEARCH_MANUAL_DAILY_CAP_` / `JOB_PROFILE_.pagesPerManualRun`).

### Retry and Timeout Controls
- **Request Timeout**: 30 seconds (`JSEARCH_TIMEOUT_SECONDS_`).
- **Retry Limit**: `JOB_PROFILE_.retryLimit = 2` caps **total attempts** per query catalog entry at 2 (1 initial attempt + 1 retry), not 2 retries after the initial attempt. On the 2nd failure the query is logged as an error and skipped, not retried further.
- **Backoff & Rate Limiting**: If `429 Too Many Requests` or `RATE_LIMITED` is encountered, the run halts gracefully with status `PARTIAL` and persists the checkpoint for the next window. Immediate tight retry loops are prohibited.
- **Runtime Budget**: Maximum 270,000 ms (4.5 minutes) execution budget per run (`JOB_PROFILE_.runtimeBudgetMs`). If elapsed run time exceeds budget, the loop exits gracefully with status `PARTIAL` and `error_code: 'RUNTIME_BUDGET_EXHAUSTED'`, saving checkpoint progress.

---

## 7. Source Error Handling and Disable Circuit Breaker

The system maintains nonsecret health and error counters in the `Settings` sheet under the key `DISCOVERY_SOURCE_STATE`:

- **Terminal Errors** (`disableSource: true` in the adapter's fetch result, counted toward the circuit breaker): `AUTH_FAILED` (HTTP 401/403), `NOT_SUBSCRIBED_OR_RETIRED` (HTTP 404 with the RapidAPI proxy header), `NOT_FOUND` (HTTP 404 without that header). **Correction**: these three tokens — not `AUTH_FAILURE` / `SUBSCRIPTION_INACTIVE` / `ENDPOINT_DISABLED` — are the actual values, defined in `JobSource_JSearch.gs`'s classification matrix.
- **Non-circuit-breaker terminal stops** (halt the run immediately but do not count toward the disable threshold): `NOT_CONFIGURED` (no API key present — run ends `FAILED` without advancing the checkpoint or logging a per-query error) and `QUOTA_EXHAUSTED` (monthly/period quota exhausted — run ends `BUDGET_BLOCKED`, checkpoint preserved). Neither of these was documented in the original config.
- **Circuit Breaker Threshold**: 2 consecutive terminal errors (`JOB_PROFILE_.terminalErrorDisableThreshold`).
- **Disabled State**: When the consecutive terminal count reaches 2, `enabled` is flipped to `false`, `disabledAt` is timestamped, and `reason` is recorded.
- **Fail-Safe Behavior**: Any subsequent scheduled or manual discovery run checks source state prior to calling adapters. If disabled, it logs a `SOURCE_DISABLED` run row and returns immediately without consuming quota or executing HTTP calls.
- **Automatic Recovery**: Any successful fetch resets the consecutive terminal error counter to 0.
- **Manual Reset**: Call `resetDiscoverySource()` to restore `enabled: true` and reset consecutive error counts to 0.
- **Fail-Closed on Corrupt State (operator runbook)**: If the `DISCOVERY_SOURCE_STATE` row exists but its value is blank, unparseable, or not a plain JSON object, the loader treats the source as `enabled: false` with `reason: 'STATE_CORRUPT'` rather than silently defaulting to enabled. This is a new operator-visible failure mode: if discovery runs start returning `SOURCE_DISABLED` with `reason: 'STATE_CORRUPT'`, the only recovery path is calling `resetDiscoverySource()`, which overwrites the record directly rather than reading it first. This fail-closed behavior is safe for a first live run specifically because `initializeDatabase()` never seeds this key (see §3) — a missing row is read as `enabled: true` by default, which is a separate code path from a malformed-but-present row.

---

## 8. Schedule and Trigger Architecture

### Daily Scheduled Trigger
- **Execution Target**: `runScheduledDiscovery(event)`
- **Frequency**: Every day (7 days/week)
- **Time**: Configured via `ScriptApp.newTrigger(...).timeBased().atHour(JOB_PROFILE_.schedule.hour)`, where `JOB_PROFILE_.schedule.hour = 7`. **Correction**: `atHour()` selects an hour, not an exact minute, so the original doc's flat "7:00 a.m." overstates the precision actually configured. This document does not assert a specific dispatch minute or window — that is Apps Script platform behavior, not something set in this codebase, and was not independently verified here.
- **Time Zone**: `America/New_York`

### Trigger Identity Guard
- `runScheduledDiscovery(event)` enforces strict origin validation:
  1. Verifies `event` is present and contains a valid, nonblank `triggerUid`.
  2. Queries `ScriptApp.getProjectTriggers()` to confirm exactly one matching clock trigger exists with handler `runScheduledDiscovery` and ID matching `triggerUid`.
  3. Direct invocations from the Apps Script code editor or forged events are refused with status `REFUSED_NOT_TRIGGER` and audited in `DiscoveryRuns`.

### Trigger Management Functions

- **`installDiscoveryTrigger()`**:
  - Idempotent: checks existing project triggers.
  - If a trigger for `runScheduledDiscovery` already exists, duplicates are removed and the primary is retained.
  - Configures the daily `atHour(7)` `America/New_York` clock trigger (see the hour-vs-minute correction above).
  - Returns `{ status: 'ok', handler: 'runScheduledDiscovery', installedCount: 1, removedDuplicates: N, scheduleHour: 7, timeZone: 'America/New_York' }` without exposing internal trigger IDs. **Correction**: the original doc omitted the `handler`, `scheduleHour`, and `timeZone` fields, which are present in the actual return object.
  - **Status: Local code complete. NOT executed against live Apps Script.**

- **`removeDiscoveryTrigger()`**:
  - Finds all triggers with handler `runScheduledDiscovery` and removes them via `ScriptApp.deleteTrigger`.
  - Unrelated triggers (e.g. other user automation) are strictly preserved.
  - Returns `{ status: 'ok', handler: 'runScheduledDiscovery', removedCount: N }`. **Correction**: the original doc omitted the `handler` field.
  - **Status: Rollback mechanism verified locally. NOT executed against live Apps Script.**

- **`runDiscovery(options)`**:
  - Browser-callable manual discovery endpoint.
  - Validates `options.maxPages` between 1 and `pagesPerManualRun` (3). The public option allow-list accepts only `maxPages` — a `nowDate` override is not accepted from the browser (see the Phase 4B review follow-up in §9 for why this was removed).
  - Acquires the whole-run script lock (30s timeout).
  - Returns a sanitized browser summary (`acceptedCount`, `updatedCount`, `filteredCount`, `pagesAttempted`, `errorCode`, etc.) with zero raw error text, query URLs, or secrets. **Correction**: the original doc did not mention `errorCode` — it is a new field (added in the Phase 4B review follow-up) that surfaces the same safe, fixed-token terminal error code recorded in `DiscoveryRuns.error_code` (e.g. `NOT_CONFIGURED`, `QUOTA_EXHAUSTED`, `AUTH_FAILED`, `RUNTIME_BUDGET_EXHAUSTED`) or `null` when the run completed without a terminal error. It is never derived from raw exception messages or upstream response text.

---

## 9. Verification Summary

### Completed Local Verification
- **Test Suite Status**: 100% green across **452 tests in 44 suites** (`node --test`). **Correction**: the original doc reported 447/43 — the count grew by 5 tests and 1 `describe` block during the Phase 4B Claude review follow-up (see below), and the original "24 end-to-end orchestrator scenarios" is now 29.
  - `phase1.test.js`: Database, schema, and foundation verification.
  - `phase2.test.js`: Task lifecycle (`createTask`, `completeTask`/`reopenTask`/`archiveTask`), dashboard data (tasks and job stats), and upcoming-events retrieval. **Correction**: the original doc described this file as "Scoring and validation checks," which does not match its actual `describe` blocks.
  - `phase3.test.js`: Jobs queue, status transitions, user notes.
  - `phase4a-jsearch.test.js`: JSearch adapter normalization, quota rollover, publisher filtering.
  - `phase4b-filters.test.js`: 10-step exclusion order, remote PA rule, radius calculations.
  - `phase4b-dedupe.test.js`: L1/L2/L3 identity hierarchy, formula escape normalization, quarantine rules.
  - `phase4b-discovery.test.js`: All 29 end-to-end orchestrator scenarios (the original 24, plus 5 added by the Phase 4B Claude review follow-up describe block covering apostrophe symmetry, `NOT_CONFIGURED`/`QUOTA_EXHAUSTED` handling, `nowDate` option removal, fail-closed `STATE_CORRUPT`, and the `errorCode` summary field), checkpoints, locks, trigger guards, circuit breaker.
  - `static-checks.test.js`: Allowlist validation, banned patterns, manifest scopes, network isolation.
- **Git Hygiene**: `git diff --check` clean, zero whitespace/line-ending issues (autocrlf notices only).
- **Secret & PII Audit**: Count-only scan of the Phase 4B Claude review follow-up diff completed with **0 findings**.

### Separately Authorized Future Live-Check Steps (NOT RUN)
The following live verification steps require explicit, separate user authorization and have **NOT** been performed:
1. Pushing code to Google Apps Script via `clasp push`.
2. Setting `DATABASE_SHEET_ID` and `JSEARCH_RAPIDAPI_KEY` in live Script Properties.
3. Running live database initialization on a real Google Sheet.
4. Installing a live Apps Script clock trigger via `installDiscoveryTrigger()`.
5. Executing live HTTP requests to RapidAPI / JSearch.

---

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
