# Phase 1 Manual Test Checklist

These require a real Google account, a real Sheet, and a real Apps Script
deployment. None of them has been run by Claude — this session performed
no live Google actions. Run these yourself after following the setup
steps in `README.md`.

- [ ] **Property configuration.** `DATABASE_SHEET_ID` is set in Script
      Properties. The ID does not appear anywhere in source.
- [ ] **Idempotent initialization, on a genuinely fresh Sheet.** Use a
      brand-new Google Sheet with its default single blank tab (1000 rows
      × 26 columns) — do not pre-widen or pre-extend it. Run
      `initializeDatabase()` from the editor. `Tasks`, `Jobs`, `Settings`,
      and `Applications` sheets are created with headers matching `SCHEMA`
      in `Database.gs` exactly (same names, same order). This specifically
      checks something this session could not verify locally: `Jobs` has
      27 columns (one more than a sheet's default 26) and
      `applyPlainTextFormat_` requests row 2 through row 2001 (2000 data
      rows) for formatting on a sheet whose default height is 1000 rows.
      This session believes — but could not confirm without a live
      Sheet — that `getRange(...).setValues(...)` and `.setNumberFormat(...)`
      auto-expand a sheet's grid when the requested range exceeds its
      current size. If this run throws instead of succeeding, that
      assumption is wrong and `Database.gs` needs an explicit
      `insertColumnsAfter`/row-expansion step before writing.
- [ ] **Idempotence, second run.** Run `initializeDatabase()` again.
      Confirm no error, no duplicated headers, and rows 2+ untouched.
- [ ] **Mismatched-sheet safety.** Manually add an extra column header (or
      delete/reorder one) on one sheet, then run `initializeDatabase()`.
      Confirm it throws an error naming that sheet, and that the sheet's
      header row is unchanged after the error (compare before/after).
- [ ] **Web app launch.** Open the deployment URL. Confirm the page loads
      and shows "Connected to spreadsheet: `<your sheet's name>`".
- [ ] **Error handling.** Temporarily remove `DATABASE_SHEET_ID` from
      Script Properties and reload the web app. Confirm the page shows a
      generic connection-failure message — not a stack trace, not the
      property name, not the spreadsheet id — then restore the property.
- [ ] **XSS prevention.** Rename the **spreadsheet document itself** (File
      → Rename in Google Sheets, not a sheet/tab) to
      `<script>alert('XSS')</script>`. Reload the web app. Confirm the
      script does not execute and the literal text is visible in the
      status line. (Renaming a tab does not exercise this — `getAppStatus`
      returns the spreadsheet's name via `ss.getName()`, not a tab name.)
      Rename the document back afterward.
- [ ] **Frame protection.** Confirm the deployment does **not** set
      `X-Frame-Options: ALLOWALL` — e.g. try embedding the deployment URL
      in an `<iframe>` on any other page and confirm the browser refuses
      to render it (default Apps Script frame protection blocks this).
- [ ] **No fake data.** Confirm rows 2+ are empty on every sheet after
      initialization — no seeded or example.com rows anywhere.
- [ ] **Plain-text format round-trip (unverified locally).** In the
      `Tasks` sheet, manually type a title of `=1+1` into a data row's
      `title` cell, and a title of `3/4` into another row's `title` cell.
      Reload the web app (or read the cell back via
      `SpreadsheetApp.getActiveSheet().getRange(...).getValue()` in the
      editor). Confirm both cells still read back as the literal text
      `=1+1` and `3/4` — not a calculated `2`, and not a date. This checks
      the `PLAIN_TEXT_FIELDS_` mitigation in `Database.gs`, which this
      session could not verify against a live Sheet.
- [ ] **Numeric columns stay numeric (unverified locally).** In the `Jobs`
      sheet, manually run a script snippet (or use `appendRecord_` once
      Phase 2/3 exposes a caller) that writes a number to
      `overall_match`, e.g. `95`. Confirm `getRange(...).getValue()`
      returns the JS number `95`, not the string `"95"`. This confirms
      `PLAIN_TEXT_FIELDS_` correctly excludes numeric columns and that
      Phase 2's `overall_match >= 90` comparison will work against real
      Sheets data.
