# Phase 1-2 cloud validation receipt

**Executor:** Codex (user reassigned the Gemini cloud-validation scope)

**Date:** 2026-09-11

**Overall status:** **LIVE VALIDATION COMPLETE — NOT APPROVED FOR BROADER DEPLOYMENT.**

The private test deployment is working, but three live defects require correction and another validation pass before any broader release.

## Completed under the authorized scope

1. Corrected the manifest OAuth scope from `https://www.googleapis.com/auth/calendar` to `https://www.googleapis.com/auth/calendar.readonly` in `outputs/life-dashboard-apps-script/appsscript.json`.
2. Updated the corresponding static assertion in `outputs/life-dashboard-apps-script/tests/static-checks.test.js`.
3. Ran the complete local suite after that correction:

   ```text
   tests 225
   suites 19
   pass 225
   fail 0
   ```

4. Created and authenticated the official Apps Script CLI with the owner account, then pushed **exactly eight** runtime files to the newly created private test project:

   - `appsscript.json`
   - `Calendar.gs`
   - `Code.gs`
   - `Database.gs`
   - `Index.html`
   - `JavaScript.html`
   - `Styles.html`
   - `Tasks.gs`

   The project-local `.claspignore` prevented tests, old drafts, and planning files from being pushed.

5. Added the `DATABASE_SHEET_ID` Script Property for the user-owned blank Phase 1-2 validation spreadsheet. The value remains private and is intentionally not reproduced here.
6. Created the private web-app deployment and verified its actual settings, not only the manifest:

   - Type: **Web app**
   - Execute as: **Me (bauerk132@gmail.com)**
   - Who has access: **Only myself**

7. The user completed the owner-account consent flow for the declared Google Sheets and Google Calendar **read-only** scopes. No public sharing or broader Calendar scope was enabled.
8. Ran `initializeDatabase()` twice in the Apps Script editor against the blank test spreadsheet. Both executions completed without an error; the second run was idempotent.
9. Observed the four initialized data tabs alongside the original blank `Sheet1`: `Tasks`, `Jobs`, `Settings`, and `Applications`. The private deployed app then successfully read the Tasks and Jobs schemas and reported zero initial task/job counts.
10. Opened the private `/exec` web app. It connected to the configured test spreadsheet, rendered the dashboard, completed real task mutations, and loaded a redacted read-only Calendar result.
11. Restored the valid Script Property after the safe configuration-failure probe. The private endpoint was reloaded and confirmed connected again.

## Live-test status matrix

| Check | Status | Reason |
|---|---|---|
| L1 Fresh initialization | Pass | Both real initializer executions completed; the four expected data tabs were created beside the blank default tab. Sheet auto-expansion handled the 27-column Jobs schema and formatted range in this live Sheet. |
| L2 Idempotent initialization | Pass | Second real initializer execution completed without duplicating tabs or causing an error. |
| L3 Script Property path | Pass | Script Property configuration drove a connected private endpoint; no spreadsheet ID is embedded in the browser response. |
| L4 Create task | Partial / defect | Real `google.script.run` task creation succeeded and survived reload, but an entered date of 2026-09-15 displayed as Sep 14 in the app. This is an apparent date-only timezone defect. |
| L5 Lifecycle | Pass | The same live task completed, reopened, then archived; it disappeared from the non-archived Tasks view after reload. |
| L6 Retry/idempotency | Not run | Requires a genuine safe ambiguous transport condition. |
| L7 Literal text | Fail | `=1+1` became `2`; `3/4` became `2026-03-04T00:00:00.000Z`. Formula and date coercion were not prevented in the live Sheet/UI. Temporary validation tasks were then archived. |
| L8 Dashboard transport | Pass | The real private `/exec` app connected, loaded stats/Tasks, performed mutations, and refreshed from Apps Script rather than a local preview. |
| L9 Calendar allowed | Pass | The corrected `calendar.readonly` manifest scope was authorized; the private Home view loaded the bounded upcoming-event list. Calendar details are intentionally omitted from this receipt. |
| L10 Calendar unavailable | Not run | Do not revoke scopes or alter production-like configuration merely to create this condition. |
| L11 Private access | Pass | Actual deployment configuration is owner execution with **Only myself** access, and the signed-in owner successfully opened the endpoint. |
| L12 Safe error disclosure | Partial / defect | An invalid test-only property produced the generic connection text `The dashboard could not connect to its database.` as intended, with no ID exposed. The data-load panel additionally rendered `UserError: The dashboard could not load its data.`; it remains non-sensitive but does not exactly meet the expected generic-only presentation. The original property was restored and reconnection verified. |

## Required correction gate before another live run

1. Fix date-only task serialization/rendering so a selected `YYYY-MM-DD` stays that calendar date in Eastern Time.
2. Enforce literal text for task titles at the Sheet write boundary (including `=`, `+`, `-`, and `/`-like coercion cases), then add/repair live coverage for `=1+1` and `3/4`.
3. Remove the `UserError:` prefix from the browser-facing data-load failure message while preserving server-side diagnostics.
4. Rerun the local suite, push a new private version, and repeat L4, L7, and L12. Keep L6/L10 as not-run unless a real, safe condition becomes available.

## Additional evidence limits

- No success-path console logs exist in this source; private UI and actual Sheet/app state were the success evidence.
- Calendar event details were viewed only to establish the live read path and are not reproduced here.
- The historical `Calendar.gs` comment conflicts with the deployed read-only manifest, but the actual L9 runtime call succeeded with the narrow scope. It is documentation debt, not a failed live Calendar call.
