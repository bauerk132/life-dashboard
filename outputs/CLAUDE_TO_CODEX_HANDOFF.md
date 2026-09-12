# Life Dashboard — Claude → Codex Handoff (Phase 2 complete)

## What this file is, and why it has this name and this location

The controlling relay document (`outputs/CLAUDE_GEMINI_START_HERE.md`) names this
file `outputs/CLAUDE_TO_CODEX_HANDOFF.md` and that is where it lives.

A second, earlier document — `outputs/PHASE_2_TO_3_CONTROLLED_HANDOFF.md` —
separately specifies a Phase 2 deliverable named
`outputs/life-dashboard-apps-script/PHASE_2_HANDOFF_TO_CODEX.md`, with a
required-content list (status; files read/changed/created; UI/interaction
decisions; exact tests and results; preview/screenshot notes; live Google
behavior not verified; known issues/blockers; confirmation Phase 3 wasn't
started). **This file is written to satisfy that content list in full**, under
the relay's name and location instead, because the two documents disagree with
each other on where it should live. If you were pointed at this work by
`PHASE_2_TO_3_CONTROLLED_HANDOFF.md` and went looking for
`life-dashboard-apps-script/PHASE_2_HANDOFF_TO_CODEX.md` first: a short pointer
file exists at that exact path redirecting here, so that document's own
instructions still resolve correctly. Read this file as the actual handoff.

## Status

**Phase 2 (Core Dashboard) is implemented, locally tested (225/225 passing),
and browser-verified against a local mock — not against live Apps Script.**
Phase 3 was not started. This session stops here per the relay's rules and
waits for the user's explicit authorization before anything further happens.

Model used: **Claude Sonnet 5** (`claude-sonnet-5`), continuing the same
session that performed the Phase 1 correction recorded in
[`outputs/PHASE_1_CORRECTION_HANDOFF.md`](./PHASE_1_CORRECTION_HANDOFF.md).

## Two missing hand-offs — read this before assuming anything is stale

The relay expected a chain of hand-off documents between models. Two of them
never got written, by anyone, at any point in this project's history. Both
are relevant to what you're reviewing:

1. **`outputs/GEMINI_TO_CLAUDE_HANDOFF.md` does not exist.** Gemini never
   performed the Phase 1 correction. On 2026-09-11 the user reassigned that
   work to Claude directly. `outputs/PHASE_1_CORRECTION_HANDOFF.md` stands in
   for it — it says so at the top of that file. This was already true before
   this Phase 2 session started; it is repeated here so you don't go looking
   for a Gemini artifact that was never produced.

2. **`outputs/life-dashboard-apps-script/PHASE_1_INTEGRATION_PREFLIGHT_FOR_PHASE_2.md`
   does not exist either.** `PHASE_2_TO_3_CONTROLLED_HANDOFF.md`'s "Codex
   preflight" section assigned *you* (Codex) a bounded Phase 1 integration
   pass — reconciling the pre-plan draft and the Gemini submission into a safe
   foundation — to complete *before* Claude started Phase 2, recorded in that
   named file. That preflight was never run under that name. What actually
   happened instead: the two real Codex artifacts that exist
   (`outputs/PHASE_1_CODEX_GATE_REVIEW.md` and
   `outputs/PHASE_1_CODEX_GATE_REVIEW_SUBMISSION.md`) reviewed and rejected
   the Gemini submission, and then the user reassigned the *repair* itself to
   Claude (see point 1). `outputs/PHASE_1_CORRECTION_HANDOFF.md` covers the
   same substantive ground the preflight would have (exact-header validation,
   `LockService` protection, private-helper/public-endpoint separation, safe
   ID updates, blank-row/date handling, default frame protection, least-
   privilege manifest, no demo-job seeding) — implemented and tested rather
   than reviewed-on-paper. Phase 2 was built on top of that corrected
   foundation, not on the original Gemini submission. If your own review
   process depends on a `PHASE_1_INTEGRATION_PREFLIGHT_FOR_PHASE_2.md`
   existing, it doesn't, and this paragraph is what stands in for it.

## Files read this session (before editing)

`Code.gs`, `Database.gs`, `appsscript.json`, `Index.html`, `JavaScript.html`,
`Styles.html`, `.claspignore`, `tests/gas-fakes.js`, `tests/phase1.test.js`,
`outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`,
`outputs/PHASE_2_TO_3_CONTROLLED_HANDOFF.md`, the approved plan file, and the
Phase 1 correction handoff.

## Files changed

- **`Database.gs`** — `updateRecordById_` gained a 4th, optional
  `precondition` parameter: a function called with the row's current field
  values, after the matching row is located but before anything is written,
  while that call's own lock is still held. This lets `Tasks.gs`'s status
  transitions do an atomic check-then-write without nesting a second lock
  acquisition inside an already-held one — `LockService`'s reentrancy
  behavior for a script re-acquiring its own held lock isn't verifiable
  without live Apps Script, so this sidesteps the question rather than
  guessing at it. Fully backward compatible; every Phase 1 caller and test
  still passes unmodified.
- **`Code.gs`** — added `getDashboardData()` (see "Server endpoints" below).
  Everything from Phase 1 (`doGet`, `include`, `INCLUDABLE_FILES_`,
  `getAppStatus`) is unchanged.
- **`appsscript.json`** — `oauthScopes` gained
  `https://www.googleapis.com/auth/calendar` alongside the existing
  `spreadsheets` scope. This is a manifest widening; see "Manifest scope
  widening" under Known issues/risks for the full rationale and the
  alternative that was considered and rejected.
- **`.claspignore`** — whitelist gained `!Tasks.gs` and `!Calendar.gs`.
  `dev/` and `tests/` remain un-whitelisted (never pushed) by construction —
  the file is a whitelist (`**/**` ignored, then explicit un-ignores), so
  anything not explicitly listed stays ignored with no separate rule needed.
- **`Index.html`, `Styles.html`, `JavaScript.html`** — rebuilt from the
  Phase 1 minimal status page into the full Phase 2 client. Verified in
  detail below (server endpoints, then client, then tests, then browser
  checks).

## Files created

- **`Tasks.gs`** — `createTask`, `completeTask`, `reopenTask`, `archiveTask`.
- **`Calendar.gs`** — `getUpcomingEvents`.
- **`tests/phase2.test.js`** — 31 tests for the above.
- **`tests/static-checks.test.js`** additions — deployed-file list, public
  allowlist, and banned-pattern list all extended for Phase 2 (see "Static
  checks" below); file total is now 157 tests (Phase 1 + Phase 2 combined).
- **`dev/mock-google-script-run.js`, `dev/preview-server.js`** — isolated
  local dev adapter, never pushed to Apps Script. See "Dev adapter" below.
- **`outputs/life-dashboard-apps-script/PHASE_2_HANDOFF_TO_CODEX.md`** — a
  short pointer file redirecting to this document, so
  `PHASE_2_TO_3_CONTROLLED_HANDOFF.md`'s literal instructions still resolve.
  It is not the real handoff; this file is.
- This file.

## Files explicitly untouched

`README.md`, `PHASE_1_TEST_CHECKLIST.md`, `pre-plan-draft/`,
`phase-1-gemini-submission/`, every prior handoff and gate review in the
outer `outputs/` folder, the master plan, and `tests/gas-fakes.js` except for
one additive change (below).

## Server endpoints (`Code.gs`, `Tasks.gs`, `Calendar.gs`)

**`getDashboardData()`** returns `{today, tasks, stats}`:
- `today` is formatted in the script time zone; `tasks` excludes archived
  ones.
- `stats = {openTasks, completedTasks, strongMatchJobs, applicationsSent}`.
  The two job-derived stats are read-only computations over the `Jobs` sheet:
  `strongMatchJobs` is `overall_match >= 90` and status not `Rejected`;
  `applicationsSent` is status in `Applied`/`Interview`/`Offer`. **Both are a
  judgment call, not a spec quote** — flagged for your review under Known
  issues/risks below.
- Tasks-read failure propagates as a thrown, user-safe error (Tasks always
  exists post-Phase-1-`initializeDatabase`). Jobs-stat failure (sheet
  missing/mismatched — expected, since Jobs has no Phase 2 endpoints yet)
  degrades those two stats to `null` and logs server-side, never throwing —
  so Home and Tasks can never fail because Jobs is absent or broken.

**`Tasks.gs`** — `createTask({id, title, dueDate, priority})` requires a
client-supplied UUID (never server-generated, unlike other sheets), validates
title (trimmed, required, ≤200 chars), priority (`Low`/`Medium`/`High`), and
optional `dueDate` (`yyyy-MM-dd`). A same-id-same-title `DUPLICATE_ID` retry
returns the existing row unchanged (safe retry after an ambiguous network
failure); same-id-different-title re-throws.

`completeTask`/`reopenTask`/`archiveTask(id)` each do an unlocked pre-check
read for a fast `NOT_FOUND` and an idempotent already-at-target no-op, then
call `updateRecordById_` with a `precondition` that validates the from-status
under the held lock (`INVALID_TRANSITION` otherwise). Re-applying the current
state is safe and returns the task unchanged.

**`Calendar.gs`** — `getUpcomingEvents()` never throws. It wraps all
`CalendarApp` access in try/catch and always returns
`{status: 'ok'|'unavailable', events, message}`; any failure becomes
`unavailable` with one generic, safe message, with the real error logged
server-side only. Called independently of `getDashboardData()` (see
`JavaScript.html`) so a slow or failing Calendar can never block Home or
Tasks. **It uses the full `CalendarApp` service and the full `calendar`
OAuth scope, not a read-only grant** — see "Manifest scope widening" below;
this is the single largest scope decision in this handoff and the one most
worth your independent judgment.

## Client (`Index.html`, `Styles.html`, `JavaScript.html`)

- **Landmarks/structure**: `header` with `nav[aria-label="Primary"]`, `main`,
  one `h1`, one `h2` per view (Home/Tasks/Jobs), each view a `section` with
  `aria-labelledby`. Nav buttons carry `aria-current="page"` on the active
  view.
- **View switching**: `switchView()` toggles each section's `hidden`
  attribute and moves focus to the destination view's `h2` (`tabindex="-1"`)
  — verified live (see Browser verification below): `document.activeElement`
  lands on `tasks-heading` after clicking Tasks, and `home`/`jobs` sections
  report `hidden === true` while `tasks` reports `false`.
- **Rendering**: exclusively `document.createElement`/`textContent`. Grepped
  directly (not just static-checked) for `innerHTML`, `outerHTML`,
  `insertAdjacentHTML(`, `document.write(`, `eval(`, `new Function(` across
  `JavaScript.html` — zero matches outside of one comment discussing why a
  `setAttribute` call is safe (comments are stripped before the automated
  check runs, so that comment doesn't trip it).
- **Dates**: `due_date`/`today` are both `yyyy-MM-dd` strings from the same
  server time zone, so overdue comparison is a plain string compare (no
  timezone risk). Display parsing uses `new Date(y, m-1, d)` (local), never
  `new Date('yyyy-MM-dd')` (which parses as UTC and can show the wrong day).
- **States**: each of the dashboard card, tasks list, and calendar card has
  independent loading (`aria-busy`)/empty/error+Retry states. One
  `role="status"` and one `role="alert"` live region announce
  successes/failures; `announce()`/`announceAlert()` clear-then-reset on a
  30ms timeout so the same message twice in a row still gets a fresh
  assistive-tech announcement.
- **Double-submit control**: while a create/action request is pending, the
  relevant button(s) are disabled — Add-task disables the whole form; a task
  action disables only that task's own buttons, so the rest of the list stays
  usable. The pending create's client-generated UUID is kept across a failed
  retry (same title → same id reused) and only rotated after a success or a
  genuine title change, matching the server's idempotency contract.
- **Styles**: muted text `#475569` (AA contrast), `:focus-visible` 3px
  outline, 44px minimum touch targets, breakpoints at 720px/430px,
  `prefers-reduced-motion` respected. No external fonts, CDNs, or analytics —
  grepped, zero external `<link>`/`@import`/`src=` references.
- **Jobs view**: placeholder text only ("stored-job review is planned for
  Phase 3... nothing to show on this screen yet"). No cards, filters,
  sorting, or status actions — enforced by an automated static check (below),
  not just by inspection.

## Dev adapter (`dev/`, never pushed to Apps Script)

`dev/mock-google-script-run.js` is a DEV-ONLY in-memory fake of the same
seven public functions, driven entirely by the preview page's own query
string:

| Param | Values | Effect |
|---|---|---|
| `tasks` | `empty` | start with zero demo tasks (default: 3, mixed Open/Done) |
| `jobs` | `unavailable` | `getDashboardData`'s job stats come back `null` |
| `calendar` | `ok`\|`empty`\|`unavailable`\|`fail` | `ok`/`empty`: normal success paths. `unavailable`: server-reported failure via the success handler (mirrors `Calendar.gs`'s own try/catch design). `fail`: a genuine **transport** failure — drives `withFailureHandler` instead, a deliberately different failure shape than `unavailable` |
| `latency` | ms | artificial delay before every call resolves, for loading-state/race testing |
| `fail` | `fnName` or `fnName:N` | named function(s) fail their first N calls (default 1) via `withFailureHandler`, then behave normally — lets a manual pass exercise "action fails, retry with the same request succeeds" without restarting the server |

It deliberately does not re-implement every server validation rule
byte-for-byte — it exists to drive the client's rendering/state logic for a
human in a browser, not to replace `tests/phase2.test.js` (which runs the
*real* `Database.gs`/`Tasks.gs`/`Calendar.gs` against `tests/gas-fakes.js` and
is the actual correctness check).

`dev/preview-server.js` is a Node `http`-only server (nothing to install),
bound to **127.0.0.1 only**. On every request it re-reads `Index.html`,
`Styles.html`, `JavaScript.html` from disk, substitutes the two
`<?!= include(...); ?>` scriptlets with their raw file contents (the only
templating it does — `Index.html` uses only these two calls), and injects
the mock script immediately before the inlined `JavaScript.html` so
`window.google.script.run` exists before the app's own script runs.

Added one additive entry to `.claude/launch.json` (`"life-dashboard-dev"`,
port 4173, forward-slash absolute path) — the file's three pre-existing
entries, including their known backslash-mangled paths, are untouched.

## Exact commands and results

```
cd outputs/life-dashboard-apps-script
node --test "tests/*.test.js"
```

```
tests 225
pass 225
fail 0
```

Per-file breakdown (`node --test tests/<file>` individually):

| File | Tests | Pass | Fail |
|---|---|---|---|
| `tests/phase1.test.js` (unchanged from Phase 1) | 37 | 37 | 0 |
| `tests/phase2.test.js` (new) | 31 | 31 | 0 |
| `tests/static-checks.test.js` (Phase 1 + Phase 2 combined) | 157 | 157 | 0 |

`tests/phase2.test.js` covers: `createTask` (9 cases — valid input, each
validation failure, duplicate-id-same-title retry, duplicate-id-different-
title rejection), `completeTask`/`reopenTask`/`archiveTask` (10 cases —
each valid transition, each invalid-from-status rejection, each already-at-
target idempotent no-op, `NOT_FOUND`), `getDashboardData` tasks (3),
`getDashboardData` job stats including a mismatched-Jobs-sheet case (3),
`getUpcomingEvents` (5 — normal events, empty, event-window filtering,
`getDefaultCalendar` throws, `getEvents` throws, both asserting the raw
error text never reaches the returned message).

`tests/static-checks.test.js` additions: deployed-`.gs`-file list extended
to include `Tasks.gs`/`Calendar.gs`; public allowlist extended with
`getDashboardData`, `createTask`, `completeTask`, `reopenTask`,
`archiveTask`, `getUpcomingEvents`; banned patterns extended with a
wholesale ban on `UrlFetchApp`/`fetch(`/`XMLHttpRequest` (this project makes
zero legitimate outbound network calls, so banning every mechanism capable
of one is stronger and more maintainable than blocklisting vendor-name
strings); a ban on Calendar write methods (`createEvent(`,
`createAllDayEvent(`, `createEventSeries(`, `deleteEvent(` — deliberately
*not* a bare `setTitle` ban, since `HtmlOutput.setTitle()` in `Code.gs`'s own
`doGet()` is legitimate and would collide); a ban on unsafe HTML sinks
(`innerHTML`, `outerHTML`, `insertAdjacentHTML(`, `document.write(`); and a
Jobs-placeholder scope-creep guard (`job-card`, `jobs-list`, `job-filter`,
`overall_match`, `renderJob`, `buildJobCard`) scoped to the three client
files only — `Code.gs`/`Database.gs` legitimately reference the real
`overall_match` field for the Home stats computation and Phase 1's `Jobs`
schema, so a wholesale ban across every deployed file would have collided
with already-correct code; this check is scoped to guard only the surface a
premature job-browsing UI would actually touch.

A vm-realm pitfall recurred in two new Calendar-failure tests: code run via
`vm.runInContext` gets its own separate `Array`/`Object` constructors, so
`assert.deepEqual([], theVmRealmArray)` fails ("same structure but not
reference-equal") even though both are genuinely empty arrays. Fixed by
asserting `.length === 0` instead of `deepEqual` against a literal, matching
this project's established `hostify_()` realm-boundary pattern.

## Browser verification — explicitly NOT live Apps Script

Everything in this section ran against `dev/preview-server.js` and the
in-memory mock described above, in this session's Browser pane. **None of it
exercises real `SpreadsheetApp`, `CalendarApp`, `LockService`,
`PropertiesService`, HtmlService templating, or Apps Script's actual
`google.script.run` transport.** Treat it as UI/interaction/accessibility
evidence only, not as proof the server code works under the real runtime —
that's what `tests/phase2.test.js` (running the real `.gs` files through
`gas-fakes.js`) is for, and even that is a fake, not a live deployment.

**Desktop, 1280×800 (Home view, default scenario):** connection status,
today's date, all four stats, and three demo calendar events rendered
correctly; zero console errors.

**Keyboard/focus, scripted via `javascript_tool` (inspection only, no code
changes made this way):** clicking Tasks moved `document.activeElement` to
`tasks-heading`; `view-home`/`view-jobs` reported `hidden: true`,
`view-tasks` reported `hidden: false` — confirmed against the live DOM, not
inferred from the accessibility-tree read (which, as a tool quirk, lists
`[hidden]` elements regardless of visibility — `get_page_text`, which
extracts real rendered `innerText`, was used to confirm only the visible
view's content is actually present on screen).

**Full task lifecycle, live-clicked end to end:** submitted the Add-task
form ("Verify Phase 2 handoff", Medium priority) → task appeared, live
region announced "Task added.", form cleared. Clicked Complete → status
flipped to Done, buttons became Reopen/Archive, live region announced "Task
completed." Clicked Archive → task disappeared from the list (archived tasks
are excluded from `getDashboardData`), live region announced "Task
archived." Zero console errors at any step.

**`?tasks=empty&calendar=unavailable`:** stats correctly showed 0/0 for
open/completed tasks; the calendar card showed the exact safe message
("Calendar is not available right now.") with a Retry button, while Home's
other content (today's date, stats) rendered normally — confirming a
Calendar failure doesn't block the rest of Home, matching the server-side
design.

**Mobile, 375×812:** nav buttons stacked vertically full-width (the
430px-breakpoint rule), stats grid collapsed to one column, all touch
targets visually ≥44px. No console errors.

**What was NOT run in this session, and should be treated as open** (the
plan's B5 called for a wider matrix than time allowed once the user asked
for this handoff): the full keyboard-only Tab-order pass across every
control; a rapid-double-click-on-Add race under artificial latency; the
`?fail=createTask:1` fail-then-retry-succeeds flow; a `calendar=fail`
transport-failure render (as opposed to the `unavailable` server-reported
case, which *was* checked); an in-page contrast-ratio audit via
`javascript_tool`; and the `reopenTask` transition specifically exercised
live in the browser (it is exercised by 10 passing cases in
`tests/phase2.test.js`, but not clicked live end-to-end the way
create/complete/archive were). None of these are known failures — they are
simply unexercised in this session. Recommend either you run them against
the same `dev/` adapter (`preview_start` the `life-dashboard-dev`
`.claude/launch.json` entry, or `node dev/preview-server.js` directly) before
Phase 3, or the user runs them manually per an extended
`PHASE_1_TEST_CHECKLIST.md`-style checklist.

## Independent review (B6)

The plan's optional second Phase-2 subagent (a read-only accessibility/
interaction reviewer) was **not run**. Context: the user authorized two
additional subagents for Phase 2 work this session. The first was spawned to
implement the client UI and dev adapter in the background; it completed the
client HTML/CSS/JS (verified from disk and independently re-checked line by
line in this session — see "Client" above) but **stalled** before finishing
the dev adapter (600-second watchdog, no recovery) and left `dev/` entirely
missing. That work was finished directly in this session rather than
resuming or replacing the stalled subagent, both to avoid burning the second
authorized slot on a channel that had just proven unreliable and because the
remaining work (two small Node files plus one config entry) was mechanical
enough not to need a second model's judgment. Net effect: 1 of the 2 newly
authorized subagents was used (and failed partway); the other was
deliberately not spent. All subagents are confirmed stopped — `ListAgents`
shows none running as of this handoff. **This means the client files got one
independent build pass plus this session's own line-by-line re-verification,
but never a second reviewer's eyes the way the Phase 1 correction did**
(`PHASE_1_CORRECTION_HANDOFF.md` used a dedicated correctness-reviewer
subagent). Your review is the first independent second opinion this Phase 2
work will get — weight your review accordingly, especially for the
accessibility claims above, which rest on this session's own scripted checks
rather than a second reviewer or a screen reader.

## Known issues / risks / decisions worth your judgment

1. **Manifest scope widening — `calendar` (full), not
   `calendar.readonly`.** `CalendarApp`'s only documented authorization
   scopes are the full `calendar` scope or the legacy `calendar/feeds` — this
   was confirmed against the official Apps Script `CalendarApp` reference
   during this session. A genuinely read-only grant exists only through the
   separate Advanced Calendar Service (raw `Calendar.Events.list()` API
   calls), which needs its own `serviceId`/`version`/`userSymbol` manifest
   configuration that this session could not fully, authoritatively verify —
   and which can't be exercised without a live deployment regardless. Rather
   than ship an unverified manifest configuration that could silently fail
   to deploy, this session used the simpler, scope-confirmed `CalendarApp`
   with the broader scope, with a code-level static check (`tests/static-
   checks.test.js`) guaranteeing `Calendar.gs` calls no write method even
   though the grant would technically allow one. This is flagged in
   `Calendar.gs`'s own header comment and here as a candidate follow-up if
   the narrower, unverified grant is worth the added configuration risk to
   you.
2. **`applicationsSent` and `strongMatchJobs` are this session's own
   definitions**, not a quoted spec: `applicationsSent` = status in
   `Applied`/`Interview`/`Offer`; `strongMatchJobs` = `overall_match >= 90`
   and status ≠ `Rejected`. Both are read-only, degrade to `null` (never
   throw) if `Jobs` is missing/mismatched, and have zero Phase 3 state-
   machine dependency — but they encode a judgment call about what "sent"
   and "strong match" mean that you should confirm against whatever Phase 3
   ultimately defines for the Jobs status pipeline.
3. **Plain-text number format round-trip is still unverified against live
   Sheets** — this was already an open item in `PHASE_1_CORRECTION_HANDOFF.md`
   (a task title starting with `=` or shaped like `3/4`) and remains open;
   Phase 2 didn't touch that code path and didn't re-verify it.
4. **`LockService` reentrancy is unverified** — `updateRecordById_`'s new
   `precondition` parameter exists specifically to *avoid* needing to answer
   whether a script can safely re-acquire its own held lock within one
   execution, rather than assuming an answer. If you have authoritative
   documentation on this, it may simplify `Tasks.gs`'s design, but the
   current design doesn't depend on the answer either way.
5. **Everything in "Browser verification" above is against a local mock**,
   never live Apps Script/Sheets/Calendar/OAuth/deployment. No live
   verification was run or attempted anywhere in this session, consistent
   with the relay's constraints.

## Confirmation: no Phase 3 work began

No job-card rendering, filters, sorting, status state machine, notes/history,
source discovery, scraping, AI/model calls, or Calendar writes were added.
The Jobs view is a placeholder paragraph, enforced by an automated static
check (`tests/static-checks.test.js`, "Jobs view stays a Phase 2 placeholder"
describe block) in addition to manual inspection. No live Google account was
used, no deployment occurred, no Script Property was set beyond what Phase 1
already documented, and `clasp` remains not installed.

## Suggested next steps for Codex

1. Read `outputs/life-dashboard-apps-script/PHASE_1_INTEGRATION_PREFLIGHT_FOR_PHASE_2.md`'s
   absence (section above) and `outputs/PHASE_1_CORRECTION_HANDOFF.md` as the
   record of what actually happened in place of your originally-assigned
   preflight.
2. Independently review `Tasks.gs`, `Calendar.gs`, the `Database.gs` diff,
   and the three client files — this Phase 2 work has had one independent
   build pass and this session's own re-verification, but no second
   reviewer (see "Independent review (B6)" above).
3. Re-run `node --test "tests/*.test.js"` from
   `outputs/life-dashboard-apps-script/` yourself rather than trusting this
   count.
4. If you have the means to run the not-yet-run B5 scenarios listed above
   (`dev/preview-server.js`, no dependencies to install), do so before
   treating the client as fully verified.
5. Make your own judgment on the manifest-scope and stats-definition items
   in "Known issues" before Phase 3 depends on either.
6. Do not begin Phase 3 until the user has reviewed this handoff and given
   explicit authorization, per the relay's rules and the stop statement
   below.

---

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
