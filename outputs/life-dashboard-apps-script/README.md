# Life Dashboard — Apps Script project (Phase 1 foundation)

This folder is the root of the Apps Script project. Only these six files
belong in the actual Apps Script project — copy or push **only these**,
never a subfolder:

```
appsscript.json
Code.gs
Database.gs
Index.html
Styles.html
JavaScript.html
```

`phase-1-gemini-submission/`, `pre-plan-draft/`, `tests/`, and `dev/` (once
Phase 2 adds it) are reference material, prior drafts, and local tooling.
None of them is part of the deployed project. `.claspignore` in this
folder whitelists the six files above for exactly this reason — every
`.gs` file in an Apps Script project shares one global scope, so pushing a
subfolder's files alongside these would collide (duplicate `doGet`,
duplicate `SCHEMA`, and so on).

## What Phase 1 is

A private, single-user database foundation: a Sheet-backed schema for
Tasks, Jobs, Settings, and Applications, safe initialization, and a
minimal status page proving the web app can reach the Sheet. No task,
job, or calendar UI exists yet — that is Phase 2 and later.

## One-time setup

1. Create a new blank Google Sheet (or use an existing one you control).
   Copy its spreadsheet ID from the URL
   (`https://docs.google.com/spreadsheets/d/<ID>/edit`).
2. Create an Apps Script project (from the Sheet: Extensions → Apps
   Script, or a standalone project) and copy in the six root files listed
   above, preserving their names and extensions.
3. In the Apps Script editor: Project Settings → Script Properties → add
   a property named `DATABASE_SHEET_ID` with the spreadsheet ID from step
   1 as its value. The ID is never hardcoded in source.
4. Run `initializeDatabase` once from the editor (select it in the
   function dropdown, click Run). The first run authorizes the script's
   Sheets scope and creates the `Tasks`, `Jobs`, `Settings`, and
   `Applications` sheets with their header rows.
5. **Run `initializeDatabase` a second time.** It must complete without
   error, without duplicating headers, and without touching row 2+. This
   is the idempotence check — confirm it before moving on.
6. Deploy → New deployment → type "Web app". Execute as: **Me**. Who has
   access: **Only myself**. This matches `appsscript.json`
   (`USER_DEPLOYING` / `MYSELF`); do not change either without updating
   the other.
7. Open the deployment URL. It should show "Connected to spreadsheet:
   `<your sheet's name>`".

None of the above has been performed by Claude in this session — steps
1–7 require your own Google account and are yours to run. See
`outputs/PHASE_1_CORRECTION_HANDOFF.md` for exactly what was and was not
verified.

## clasp (optional, not installed)

[`clasp`](https://github.com/google/clasp) is Google's CLI for pushing
local files to an Apps Script project. It is **not installed** in this
environment and nothing here has used it. If you choose to install and
use it yourself later:

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "Life Dashboard"
clasp push
```

`clasp push` respects `.claspignore`, which already whitelists the six
root files. Run it from this folder (`outputs/life-dashboard-apps-script/`).

## Local tests (no Google account needed)

```bash
cd outputs/life-dashboard-apps-script
node --test "tests/*.test.js"
```

These tests run entirely in Node using in-memory fakes for
`SpreadsheetApp`, `PropertiesService`, `LockService`, `Utilities`,
`Session`, and `HtmlService` (see `tests/gas-fakes.js`). They check the
logic in `Database.gs` and `Code.gs` — locking, header verification,
duplicate-id rejection, row-index correctness, and so on — and that the
static source has no disallowed patterns. **They do not run inside real
Apps Script and do not prove live Google Sheets behavior.** Section marked
"Not verified" in the test checklist below still requires the manual
steps against a real Sheet.

## Data model

See `outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md` for the full Phase 1
schema rationale. The exact column lists live in `Database.gs` as
`SCHEMA` — that file is the source of truth; this README does not repeat
the column lists to avoid the two drifting apart.

## Known simplifications

- Plain-text number formatting is applied to a fixed 2000 data rows per
  free-text column when a sheet is first created. A sheet that grows
  beyond that is not a functional problem (existing formatted rows are
  unaffected) but new rows past 2000 won't have the preventive format
  applied. Fine for a personal dashboard; revisit if that ever matters.
- `Settings` and `Applications` sheets are created with their headers in
  Phase 1 but have no read/write endpoints yet — those arrive with the
  phases that use them.
