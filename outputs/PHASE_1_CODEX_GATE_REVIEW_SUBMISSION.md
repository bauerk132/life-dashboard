# Phase 1 Codex Gate Review — Gemini Submission

## Gate decision

**Not approved yet. Return to Gemini for a small, bounded correction pass. Do not authorize Phase 2.**

The missing Gemini files were supplied as pasted text and have been preserved in:

`outputs/life-dashboard-apps-script/phase-1-gemini-submission/`

They were intentionally kept separate from the pre-plan draft until the blocking issues below are corrected. No live Google resource was changed.

## What now passes

| Requirement | Result | Notes |
|---|---|---|
| Spreadsheet ID stored in Script Properties | Pass | Uses `DATABASE_SHEET_ID` |
| Tasks, Jobs, Settings, and Applications schemas present | Pass | Header lists match the Phase 1 plan |
| Locks used for initialization and writes | Pass | Script locks with bounded waits |
| Minimal status page and `getAppStatus()` | Pass | Suitable Phase 1 proof of communication |
| No fabricated production jobs | Pass | Initialization creates headers only |
| Test checklist delivered | Pass | Preserved with the submission |
| Phase 2 functionality added | Pass | No Phase 2 implementation in the submission |
| Manifest JSON syntax | Pass | Parsed locally |
| Server JavaScript syntax | Pass | Both `.gs` files passed a basic syntax check |
| Live Apps Script and Sheets execution | Not run | Still requires Google authorization and a blank test Sheet |

## Blocking findings

### P1 — `updateRecordById()` corrupts unchanged fields

Location: `phase-1-gemini-submission/Database.gs`, current-row lookup near the end of `updateRecordById()`.

When a match is found at Sheet row 2, `rowIndex` becomes `2`. The code then reads:

```javascript
const currentRow = data[rowIndex - 2];
```

Because `data[0]` is the header row, updating the first record uses the headers as its existing values. Every field not included in `updates` can therefore be overwritten with text such as `id`, `title`, or `status`.

Required correction:

```javascript
const currentRow = data[rowIndex - 1];
```

Add a regression test that updates one field in the first and second records and verifies every non-updated field remains unchanged.

### P1 — Schema mismatches do not stop initialization

Location: `phase-1-gemini-submission/Database.gs`, `initializeDatabase()`.

The code logs a warning when existing headers differ and then returns normally. A user can see a successful execution even though the database is incompatible. The match also checks only required positions, so a sheet with all expected headers plus unexpected trailing columns is treated as matching.

Required correction:

- Require the exact expected count and exact order, unless an explicitly documented migration rule permits otherwise.
- Collect mismatched sheet names and throw one clear error after inspection, or return a structured failure that the setup instructions explicitly check.
- Do not modify a non-empty mismatched sheet automatically.
- Add checks for missing, reordered, and unexpected trailing headers.

### P1 — Default frame protection is disabled without replacement protection

Location: `phase-1-gemini-submission/Code.gs`, `doGet()`.

The call to `setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)` lets any website embed the web app. Google documents that an app using `ALLOWALL` must implement its own clickjacking protection. This private dashboard has no embedding requirement and no replacement protection.

Required correction: remove the `ALLOWALL` call and retain Apps Script's default frame protection.

Official reference: <https://developers.google.com/apps-script/reference/html/x-frame-options-mode>

## Important corrections before approval

### P2 — Database helpers are exposed to the HTML client

`readRows`, `appendRecord`, and `updateRecordById` are top-level functions without trailing underscores. Apps Script allows `google.script.run` to call public server functions; functions ending in `_` are private to the server.

Required correction:

- Rename raw helpers to `readRows_`, `appendRecord_`, `updateRecordById_`, and `generateUUID_`.
- Later phases should expose small action-specific public functions that validate allowed fields and state transitions.
- Validate `sheetName` against `SCHEMA` even inside private helpers.

Official reference: <https://developers.google.com/apps-script/guides/html/communication#private_functions>

### P2 — Duplicate IDs can update the wrong row

The update loop stops at the first matching ID. It should find all matches and require exactly one. Zero matches should report not found; two or more should report a data-integrity error and perform no write.

### P2 — The manifest asks for an unnecessary trigger-management scope

The explicit `script.scriptapp` scope is used for Apps Script publishing/trigger-management operations, but Phase 1 does not call `ScriptApp` or create triggers. Remove it for least privilege. Phase 4 can add only the permissions its scheduled collector actually needs.

Official references:

- <https://developers.google.com/apps-script/reference/script/script-app>
- <https://developers.google.com/apps-script/guides/services/authorization#set_explicit_scopes>

### P2 — Deployment identity conflicts with the README

The manifest says `USER_ACCESSING`, while the README says deploy as the owner (“Execute as: You”), which corresponds to `USER_DEPLOYING`. With `MYSELF`, both point to the same person today, but the configuration and documentation should agree so a future access change does not alter behavior unexpectedly.

Required correction: use `USER_DEPLOYING` for this private personal dashboard and keep `access: MYSELF`, unless the user explicitly chooses another model later.

Official reference: <https://developers.google.com/apps-script/manifest/web-app-api-executable>

### P2 — The status response exposes unnecessary internal details

`getAppStatus()` returns the spreadsheet ID and passes raw exception messages to the browser. The UI only needs a connection status and a user-safe explanation.

Required correction:

- Do not return `sheetId` to the browser.
- Log the detailed server error and return a generic, actionable user message.
- The spreadsheet name is acceptable for this owner-only Phase 1 page, but avoid it later if the app is shared.

### P2 — Input and row integrity need basic guards

Before later phases use the helpers:

- Reject a null/non-object record or updates payload.
- Reject unknown sheet names.
- Reject or ignore unknown update fields deliberately and document the choice.
- Do not mutate the caller's `updates` object when adding `updated_at`.
- Skip completely blank rows in `readRows_()`.
- Prefer actual `Date` values in Sheets and serialize them only when reading for the browser.

## Checklist corrections

- The XSS check should rename the **spreadsheet document**, because `getAppStatus()` returns `ss.getName()`; renaming a worksheet tab does not exercise that value.
- Add tests for the update-preserves-fields regression, duplicate IDs, invalid sheet names, exact header length/order, and default frame protection.
- Static syntax checks must not be described as Apps Script V8 runtime verification. Only a live Apps Script run can verify the platform behavior.

## Exact Gemini correction assignment

Give Gemini this document plus the preserved submission folder and say:

1. Correct only the Phase 1 submission files in `outputs/life-dashboard-apps-script/phase-1-gemini-submission/`.
2. Fix all P1 items and the listed P2 items; do not add Phase 2 features.
3. Add deterministic tests or a clearly repeatable manual check for every corrected item.
4. Update the checklist and create a new successor handoff named `PHASE_1_HANDOFF_TO_CODEX_V2.md`; do not overwrite the first handoff.
5. Report live Google tests as unverified unless they actually ran against a blank authorized Sheet.
6. Stop and return the V2 handoff to Codex.

## Scope confirmation

Codex preserved the pasted submission and performed a read-only review of its application code. The pre-plan draft was not overwritten, no source correction was implemented, no Google resource was accessed, and Phase 2 was not started.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
