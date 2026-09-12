# Source note

These files are the original pre-plan MVP draft that lived at the root of
`outputs/life-dashboard-apps-script/` before the multi-AI handoff plan
existed. They predate the Phase 1 schema contract in
`outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md` and were never reviewed
against it.

They are preserved here, unmodified except for location, so no prior work is
lost. They are not part of the corrected Phase 1 foundation and must not be
copied into an Apps Script project. In particular:

- `Database.gs` here uses a hardcoded `CONFIG.SPREADSHEET_ID` placeholder, an
  older header list, and a `seedDemoData_()` path that inserts fabricated
  `example.com` jobs — all rejected by the Phase 1 gate review process.
- `JavaScript.html` here renders job cards, filters, and a status workflow
  that belong to Phase 3, not Phase 1 or Phase 2.
- Every `.gs` file here declares its own `doGet`, and `Database.gs` declares
  its own `SCHEMA`/`CONFIG` — these would collide with the corrected root
  files' globals in Apps Script's shared script-wide scope if this folder
  were ever pushed alongside them. `../.claspignore` excludes this folder for
  that reason.

Moved into this folder on 2026-09-11 as part of the Phase 1 correction
performed by Claude (Sonnet 5), reassigned from Gemini by the user. See
`outputs/PHASE_1_CORRECTION_HANDOFF.md` for the full record.

No file outside this folder was overwritten by this move, and no live
Google resource was changed.
