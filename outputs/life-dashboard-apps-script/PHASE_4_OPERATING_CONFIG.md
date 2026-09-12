# Life Dashboard — Phase 4 Operating Configuration

## 1. Overview and Scope

This document defines the operational configuration, runtime limits, security boundaries, and lifecycle procedures for the scheduled job discovery pipeline implemented in Phase 4.

All implementations described herein are verified locally via deterministic unit and static analysis tests. **No live Google resources have been accessed or modified, no live Apps Script triggers have been installed, and no live RapidAPI/JSearch calls have been executed.**

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
- Creates default nonsecret records in `Settings` where needed.

### Operational Tables for Phase 4

1. **`DiscoveryRuns`**:
   - `run_id` (PK, opaque UUID string)
   - `source` (`linkedin` or `indeed`)
   - `provider` (`jsearch`)
   - `mode` (`scheduled` or `manual`)
   - `date_key` (`YYYY-MM-DD` in `America/New_York`)
   - `status` (`COMPLETED`, `PARTIAL`, `BUDGET_BLOCKED`, `RATE_LIMITED`, `SOURCE_DISABLED`, `REFUSED_NOT_TRIGGER`, `FAILED`)
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
- **Retry Limit**: Max 2 retry attempts per query catalog entry (`JOB_PROFILE_.retryLimit`).
- **Backoff & Rate Limiting**: If `429 Too Many Requests` or `RATE_LIMITED` is encountered, the run halts gracefully with status `PARTIAL` and persists the checkpoint for the next window. Immediate tight retry loops are prohibited.
- **Runtime Budget**: Maximum 270,000 ms (4.5 minutes) execution budget per run (`JOB_PROFILE_.runtimeBudgetMs`). If elapsed run time exceeds budget, the loop exits gracefully with status `PARTIAL` and `error_code: 'RUNTIME_BUDGET_EXHAUSTED'`, saving checkpoint progress.

---

## 7. Source Error Handling and Disable Circuit Breaker

The system maintains nonsecret health and error counters in the `Settings` sheet under the key `DISCOVERY_SOURCE_STATE`:

- **Terminal Errors**: `AUTH_FAILURE`, `SUBSCRIPTION_INACTIVE`, `ENDPOINT_DISABLED`.
- **Circuit Breaker Threshold**: 2 consecutive terminal errors (`JOB_PROFILE_.terminalErrorDisableThreshold`).
- **Disabled State**: When the consecutive terminal count reaches 2, `enabled` is flipped to `false`, `disabledAt` is timestamped, and `reason` is recorded.
- **Fail-Safe Behavior**: Any subsequent scheduled or manual discovery run checks source state prior to calling adapters. If disabled, it logs a `SOURCE_DISABLED` run row and returns immediately without consuming quota or executing HTTP calls.
- **Automatic Recovery**: Any successful fetch resets the consecutive terminal error counter to 0.
- **Manual Reset**: Call `resetDiscoverySource()` to restore `enabled: true` and reset consecutive error counts to 0.

---

## 8. Schedule and Trigger Architecture

### Daily Scheduled Trigger
- **Execution Target**: `runScheduledDiscovery(event)`
- **Frequency**: Every day (7 days/week)
- **Time**: 7:00 a.m.
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
  - Configures the daily 7:00 a.m. `America/New_York` clock trigger.
  - Returns `{ status: 'ok', installedCount: 1, removedDuplicates: N }` without exposing internal IDs.
  - **Status: Local code complete. NOT executed against live Apps Script.**

- **`removeDiscoveryTrigger()`**:
  - Finds all triggers with handler `runScheduledDiscovery` and removes them via `ScriptApp.deleteTrigger`.
  - Unrelated triggers (e.g. other user automation) are strictly preserved.
  - Returns `{ status: 'ok', removedCount: N }`.
  - **Status: Rollback mechanism verified locally. NOT executed against live Apps Script.**

- **`runDiscovery(options)`**:
  - Browser-callable manual discovery endpoint.
  - Validates `options.maxPages` between 1 and `pagesPerManualRun` (3).
  - Acquires the whole-run script lock (30s timeout).
  - Returns a sanitized browser summary (`acceptedCount`, `updatedCount`, `filteredCount`, `pagesAttempted`, etc.) with zero raw error text, query URLs, or secrets.

---

## 9. Verification Summary

### Completed Local Verification
- **Test Suite Status**: 100% green across 447 tests in 43 suites (`node --test`).
  - `phase1.test.js`: Database, schema, and foundation verification.
  - `phase2.test.js`: Scoring and validation checks.
  - `phase3.test.js`: Jobs queue, status transitions, user notes.
  - `phase4a-jsearch.test.js`: JSearch adapter normalization, quota rollover, publisher filtering.
  - `phase4b-filters.test.js`: 10-step exclusion order, remote PA rule, radius calculations.
  - `phase4b-dedupe.test.js`: L1/L2/L3 identity hierarchy, formula escape normalization, quarantine rules.
  - `phase4b-discovery.test.js`: All 24 end-to-end orchestrator scenarios, checkpoints, locks, trigger guards, circuit breaker.
  - `static-checks.test.js`: Allowlist validation, banned patterns, manifest scopes, network isolation.
- **Git Hygiene**: `git diff --check` clean, zero whitespace/line-ending issues.
- **Secret & PII Audit**: Count-only scan completed with **0 findings**.

### Separately Authorized Future Live-Check Steps (NOT RUN)
The following live verification steps require explicit, separate user authorization and have **NOT** been performed:
1. Pushing code to Google Apps Script via `clasp push`.
2. Setting `DATABASE_SHEET_ID` and `JSEARCH_RAPIDAPI_KEY` in live Script Properties.
3. Running live database initialization on a real Google Sheet.
4. Installing a live Apps Script clock trigger via `installDiscoveryTrigger()`.
5. Executing live HTTP requests to RapidAPI / JSearch.

---

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
