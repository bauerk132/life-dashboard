# Phase 1 Correction Handoff (Claude)

**This file stands in for `outputs/GEMINI_TO_CLAUDE_HANDOFF.md`.** The relay
assigned Phase 1 correction to Gemini, with the expectation that Gemini
would write that handoff. On 2026-09-11, when this session began, that file
did not exist anywhere in the project and no successor Phase 1 handoff
existed under any name — Gemini had not corrected Phase 1. I reported this
honestly instead of proceeding silently. The user was asked how to proceed
and chose: Claude performs the Phase 1 correction itself, writes this file
in place of the missing Gemini handoff, and stops here for explicit
approval before Phase 2. That is what this document records.

**Model used:** Claude Sonnet 5 (`claude-sonnet-5`), not Opus 5. An earlier
draft of `pre-plan-draft/SOURCE_NOTE.md` incorrectly said "Claude (Opus
5)" — this was caught and corrected to Sonnet 5 before this handoff was
written. Sonnet 5 performed all of Phase 1 correction: the file moves, the
rewritten `Database.gs`/`Code.gs`/browser files, the test suite, the
subagent review and fix verification, and this document.

**Project root:**
`C:\Users\User\Documents\Codex\2026-09-10\referenced-chatgpt-conversation-this-is-an-2`
**App folder:** `outputs\life-dashboard-apps-script\`

---

## Approval sequencing — stated honestly

The user sent `APPROVE PHASE 1 AND AUTHORIZE PHASE 2` before this handoff,
and before the test suite, static checks, and subagent review existed. In
other words, approval was given ahead of the verification artifacts that
are supposed to justify it. I did not treat that as a reason to skip
verification or backfill it loosely — I completed the full Part A
correction and verification work (tests, static checks, one independent
subagent review, and fixes for every confirmed finding) after that
approval message arrived, then wrote this handoff to document what was
actually done and verified, so the approval is retroactively grounded in
real evidence rather than just accepted at face value. The user separately
confirmed "keep going" after an advisor consultation, which is treated
here as instruction not to re-request the same approval phrase a third
time. This handoff still ends with the required stop statement, and Phase
2 work does not begin until this document exists and is verified.

---

## What was done (Part A of the approved plan)

### A1 — Preserved prior work, no deletions
- Moved the pre-plan draft (`Code.gs`, `Database.gs`, `Tasks.gs`, `Jobs.gs`,
  `Calendar.gs`, `Index.html`, `Styles.html`, `JavaScript.html`,
  `README.md`, `appsscript.json`) into
  `outputs/life-dashboard-apps-script/pre-plan-draft/`, with a
  `SOURCE_NOTE.md` explaining why (hardcoded `CONFIG.SPREADSHEET_ID`,
  older headers, `seedDemoData_()` fabricating `example.com` jobs, and
  Phase 3 UI mixed into Phase 1 — all things the Codex gate review already
  rejected).
- `phase-1-gemini-submission/`, both Codex gate review files, the master
  plan, and all existing handoffs were left untouched — nothing was
  overwritten.
- Added `.claspignore` at the app root so only the six real project files
  (`appsscript.json`, `Code.gs`, `Database.gs`, `Index.html`,
  `Styles.html`, `JavaScript.html`) are ever in scope for a push; every
  subfolder (`pre-plan-draft/`, `phase-1-gemini-submission/`, `tests/`)
  is excluded, since Apps Script shares one global scope per project and
  the subfolders declare colliding symbols (`doGet`, `SCHEMA`, `CONFIG`).

### A2 — Corrected foundation files
Rewrote the six root files to the Phase 1 contract:
- **`appsscript.json`**: `executeAs: USER_DEPLOYING`, `access: MYSELF`,
  `oauthScopes` limited to `spreadsheets` only, `runtimeVersion: V8`.
- **`Code.gs`**: `doGet()` sets no `XFrameOptionsMode` (default frame
  protection stays on — `ALLOWALL` is never called). `include(name)` is
  restricted to an explicit `INCLUDABLE_FILES_` allowlist. `getAppStatus()`
  returns only `{status, message}` — no spreadsheet ID, no raw error text;
  unexpected errors are logged server-side via `console.error` and
  replaced with a generic message before reaching the browser.
- **`Database.gs`**: `SCHEMA` for `Tasks`, `Jobs`, `Settings`,
  `Applications`; `initializeDatabase()` (idempotent, lock-protected,
  fails safe — never silently overwrites a mismatched or ambiguous
  header); private helpers `getDb_`, `withLock_`, `assertSheetName_`,
  `getVerifiedSheet_`, `readRows_`, `appendRecord_`, `updateRecordById_`,
  `generateUUID_`, `UserError_`, plus `isDateValue_` and
  `primaryKeyField_` (added during the fix pass below). Plain-text number
  format (`@`) is applied only to genuinely free-text columns at
  sheet-creation time, via an explicit per-sheet whitelist
  (`PLAIN_TEXT_FIELDS_`) that is disjoint from `DATE_ONLY_FIELDS_`.
- **`Index.html` / `Styles.html` / `JavaScript.html`**: minimal status
  page. Renders with `textContent` only — no `innerHTML` on any
  server-sourced value.
- **`README.md`** and **`PHASE_1_TEST_CHECKLIST.md`**: setup steps and the
  manual live-Sheet checklist (see "Not verified" section below).

### A3 — Deterministic local tests (Node, no dependencies installed)
- `tests/gas-fakes.js`: in-memory fakes for `SpreadsheetApp`,
  `PropertiesService`, `LockService`, `Utilities`, `Session`,
  `HtmlService`, `console`, loading the real `.gs` files into a Node `vm`
  context (the same shared global scope Apps Script uses).
- `tests/phase1.test.js`: idempotent init, safe-fail on mismatched or
  ambiguous headers, append/update correctness, duplicate/missing-key
  rejection, `0`/`false`/blank-row handling, no mock-job path, and more.
- `tests/static-checks.test.js`: scoped to exactly the six deployed files
  (matching `.claspignore`). Validates manifest JSON and scopes, `.gs`
  syntax, the browser `<script>` parses standalone, every `include()`
  target exists both directions, no banned patterns
  (`ALLOWALL`, `USER_ACCESSING`, `script.scriptapp`, `seedDemoData`,
  `example.com`) outside of comments, and no browser-callable raw helper
  (every top-level function is either on `PUBLIC_ALLOWLIST` or ends in
  `_`).
- **Command:** `node --test "tests/*.test.js"`, run from
  `outputs/life-dashboard-apps-script/`. (`node --test tests/` fails with
  `MODULE_NOT_FOUND` in this environment — documented in `README.md` as a
  known quirk; use the explicit glob form instead.)
- **Result: 76 / 76 tests passing, 0 failing.**

During test-writing, 14 of the initial 32 tests failed — not because of a
bug in `Database.gs`, but because of a Node `vm` cross-realm mismatch:
code run inside `vm.runInContext` has its own `Object`/`Array`/`Date`
constructors, so `assert/strict`'s `deepEqual` (aliased to
`deepStrictEqual`, which checks `[[Prototype]]`) and `instanceof Date`
both fail across the vm/host boundary even when values are structurally
identical. Fixed by rehoming values at the harness boundary
(`hostify_()` in `gas-fakes.js`), using `Array.from()` instead of
`.slice()` when copying a possibly-vm-realm array into storage, and — as
a genuine production-code improvement, not just a test workaround —
switching `Database.gs` to `Object.prototype.toString.call(v) ===
'[object Date]'` instead of `v instanceof Date`, which is safe across
realms.

### A4 — Independent review (1 subagent used)
One read-only `correctness-reviewer` subagent reviewed `Database.gs` and
`Code.gs` against the test suite. It returned 7 findings. Each was
independently re-verified against the actual file content before any fix
was applied — the subagent's output was not trusted blindly:

| # | Finding | Verified? | Action |
|---|---|---|---|
| 1 | `due_date` listed in both `DATE_ONLY_FIELDS_` and `PLAIN_TEXT_FIELDS_` | Confirmed | Removed from `PLAIN_TEXT_FIELDS_`; comment added explaining why |
| 2 | A blank row 1 over existing data was treated as a fresh sheet and silently got a header written | Confirmed | `initializeDatabase()` now fails safe: blank-row-1-over-data is collected as a mismatch, never auto-written |
| 3 | Caller-supplied ID coercion and unchecked post-write readback in `appendRecord_` | Confirmed | Added `primaryKeyField_()`-based duplicate check and a `READBACK_FAILED` error if the just-written row can't be read back |
| 4 | "Off-by-one" in `FORMAT_ROW_COUNT_` row-count math | **Rejected** — I did the arithmetic myself: `getRange(2, col, 2000, 1)` spans rows 2–2001 inclusive, which is exactly 2000 rows, matching both `FORMAT_ROW_COUNT_ = 2000` and the README's claim. The subagent's math was wrong. | No code change. The genuinely unverifiable part (does Sheets auto-expand its grid when a fresh sheet's default size is exceeded?) was added as an explicit manual-checklist item instead of guessed at with untested defensive code |
| 5 | The "plain-text format" test was tautological (asserted against the same constant it was supposed to check) | Confirmed | Rewrote the test to check independent invariants: no overlap between `PLAIN_TEXT_FIELDS_` and `DATE_ONLY_FIELDS_`, and known-numeric `Jobs` fields are never in `PLAIN_TEXT_FIELDS_` |
| 6 | `appendRecord_` returned an unserialized/raw record for id-less sheets (e.g. `Settings`) | Confirmed | Now always returns the fully serialized stored row via `readRows_`, keyed by `primaryKeyField_()` |
| 7 | `updateRecordById_` on a sheet with no `id` column returned the wrong error code (reused `UNKNOWN_SHEET`, which is misleading — the sheet is real and known, it just has no id column) | Confirmed | New `NO_ID_COLUMN` error code |

Every confirmed fix has a paired regression test. The subagent spawned no
further subagents, made no file changes itself, and is confirmed stopped —
no subagent is running as of this handoff.

**Subagent budget note:** the relay's original limit was two subagents
per primary model assignment. The one `correctness-reviewer` subagent
above is 1 of that 2. Later in this same session, at the user's request, I
also test-spawned a background agent via the Agent tool's `isolation:
"remote"` option to check whether genuine cloud/remote execution was
available (it was not — that option silently fell back to reading the
local filesystem directly, with no real sandbox isolation, since this
project isn't a git repository). That test call also counts as a
subagent spawn under the relay's rule, even though it made no changes and
did no project work. **As of this handoff, 2 of 2 subagents allowed under
the relay's original cap have been used.** The approved plan's optional
Phase 2 second reviewer (B6) is therefore not available without the
user's explicit authorization to exceed the original cap.

### Files read, changed, or created this session
**Changed:** `Database.gs`, `README.md`, `PHASE_1_TEST_CHECKLIST.md`,
`pre-plan-draft/SOURCE_NOTE.md` (model-attribution correction).
**Created:** `Code.gs`, `Index.html`, `Styles.html`, `JavaScript.html`,
`appsscript.json`, `.claspignore`, `tests/gas-fakes.js`,
`tests/phase1.test.js`, `tests/static-checks.test.js`,
`pre-plan-draft/SOURCE_NOTE.md`, this file.
**Moved (not deleted):** the ten pre-plan-draft files listed in A1.
**Untouched:** `phase-1-gemini-submission/`, both Codex gate review files,
`LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`, `CLAUDE_GEMINI_START_HERE.md`,
`PHASE_2_TO_3_CONTROLLED_HANDOFF.md`.

---

## What was verified vs. not verified

**Verified (static/local only):**
- All 76 automated tests pass (`node --test "tests/*.test.js"`).
- Static checks confirm: no banned patterns in the six deployed files, no
  browser-callable raw helper, every `include()` target exists both
  directions, manifest scopes are exact.
- No `node_modules`, no `.clasp.json`, `clasp` is not installed anywhere
  on this machine — confirmed by direct check immediately before writing
  this handoff.
- This project directory is not a git repository — confirmed.

**Static/local checks are not live Apps Script verification**, per the
relay's explicit rule. Nothing in the list above proves real Google
Sheets, Apps Script runtime, or Calendar behavior. The following remain
genuinely unverified and require the user's own manual steps (full list
in `PHASE_1_TEST_CHECKLIST.md`):
- Whether `initializeDatabase()` succeeds on a truly fresh Sheet (default
  1000 rows × 26 columns) given `Jobs` has 27 columns and the plain-text
  format range spans 2000 rows — this assumes Sheets auto-expands the
  grid on write, which could not be confirmed without a live Sheet.
- The plain-text format round-trip (`=1+1`, `3/4` titles staying literal
  text, not being evaluated or coerced).
- Numeric `Jobs` columns (e.g. `overall_match`) staying numeric, not
  coerced to string.
- Frame protection, XSS via a renamed spreadsheet document, and the
  standard web-app-launch/error-handling checks.

**No live Google action of any kind was taken this session:** no Sheet
created or modified, no Apps Script project created or pushed, no
trigger, no Calendar read or write, no OAuth authorization, no
deployment, nothing installed. `clasp` remains uninstalled.

---

## PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.
