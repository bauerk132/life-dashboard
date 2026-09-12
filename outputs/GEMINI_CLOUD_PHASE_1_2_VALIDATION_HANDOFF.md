# Gemini Assignment: Private Cloud Validation of Life Dashboard Phases 1–2

## Status

**Authorized to begin: bounded private cloud validation only.**

The Life Dashboard's Phase 1 foundation and Phase 2 core dashboard are already
implemented locally and their Node suite currently passes **225/225**. The
local mock/browser work does **not** prove live Google Apps Script, Sheets,
Script Properties, OAuth, Calendar, or `google.script.run` behavior.

Your assignment is to supply that missing live evidence against a newly created,
blank, private test Sheet and a private Apps Script test deployment. It is not
permission to begin Phase 3 or any later phase.

## Scope authorized

You may do all of the following, and only the following:

1. Read the project and its prior receipts:
   - `outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`
   - `outputs/PHASE_1_CORRECTION_HANDOFF.md`
   - `outputs/CLAUDE_TO_CODEX_HANDOFF.md`
   - `outputs/life-dashboard-apps-script/PHASE_1_TEST_CHECKLIST.md`
   - the currently deployed-source candidates in
     `outputs/life-dashboard-apps-script/`
2. Make the narrow least-privilege correction described in **Required source
   correction** below, update its affected local assertion(s), and re-run the
   local suite before cloud work.
3. Create and use a **new, blank, private test Google Sheet** that is owned by
   the user or their connected Google account. Do not use an existing personal
   spreadsheet or any future production dashboard Sheet.
4. Create/import a private Apps Script project from the exact application
   source. Set the `DATABASE_SHEET_ID` Script Property to the test Sheet ID.
5. Run a private Apps Script **test deployment** / development deployment;
   execute as the deploying user and restrict access to that user only.
6. Authorize the necessary scopes in the user's own Google session, run the
   live test matrix below, inspect execution logs, and document all results.
7. Write the required return receipt described below, then stop.

## Explicitly out of scope

Do **not**:

- start Phase 3, including Jobs UI, filters, sorting, job state transitions,
  notes/history, discovery, scraping, AI/model calls, scoring, or triggers;
- create a scheduled trigger, call an external API, scrape a source, seed a
  job, or write fabricated data;
- deploy publicly, share a URL with anyone else, relax access from `MYSELF`,
  or change execution identity away from `USER_DEPLOYING`;
- use an existing production/personal Sheet as the test target;
- change unrelated source, restructure the app, or overwrite any earlier
  handoff or review;
- continue after a failure by weakening checks, permissions, or access rules.

## Required source correction before cloud validation

The app currently requests:

```json
"https://www.googleapis.com/auth/calendar"
```

Replace it in `outputs/life-dashboard-apps-script/appsscript.json` with:

```json
"https://www.googleapis.com/auth/calendar.readonly"
```

The only current Calendar calls are `CalendarApp.getDefaultCalendar()` and
`Calendar.getEvents()`. Google’s Apps Script reference lists the read-only
scope as valid for both calls. Keep all existing static bans on Calendar write
methods; do not add any write call. Update the manifest expectation in
`tests/static-checks.test.js`, then run:

```powershell
cd outputs/life-dashboard-apps-script
node --test "tests/*.test.js"
```

Proceed to cloud validation only if the complete suite passes. Record the exact
test totals in the return receipt.

## Private test deployment configuration

- Use the source in `outputs/life-dashboard-apps-script/` only. Do not push
  `tests/`, `dev/`, `pre-plan-draft/`, or `phase-1-gemini-submission/`.
- Confirm the deployed manifest retains:
  - `webapp.executeAs: "USER_DEPLOYING"`
  - `webapp.access: "MYSELF"`
  - Spreadsheet scope, because the app creates and updates its own test data
  - `calendar.readonly`, never full Calendar access
- Set Script Property `DATABASE_SHEET_ID` to the new test Sheet's ID. Do not
  place that ID in source or handoff text; redact it in evidence.
- Use a test/development web-app endpoint first. It must not be public.
- If the user must authenticate or approve an OAuth screen, pause for them to
  do it. Never request credentials, tokens, cookies, or a copied Sheet ID in
  chat.

## Live validation matrix

Run the following through the real private web-app endpoint and inspect the
actual Sheet and Apps Script execution log after each relevant action.

| ID | Required live check | Passing evidence |
|---|---|---|
| L1 | Fresh initialization | Four expected sheets are created; names, header order/count, and no unexpected seed job are verified directly in the test Sheet. |
| L2 | Idempotent initialization | A second initialization leaves schema and existing data intact. |
| L3 | Script Property path | The app works using `DATABASE_SHEET_ID`; no spreadsheet ID is hardcoded or exposed to the client. |
| L4 | Task creation | Create a task with title, priority, and optional due date; inspect the stored row and displayed task. |
| L5 | Task lifecycle | Complete, reopen, and archive a task; verify each server result and resulting Sheet state. |
| L6 | Retry/idempotency | Perform a controlled ambiguous/retry case if possible without browser tampering; confirm the same task ID never creates a duplicate row. If not possible, mark it not run rather than simulating proof. |
| L7 | Literal-text safety | Create titles beginning with `=` and shaped like `3/4`; confirm they remain literal text in the actual Sheet and do not evaluate/coerce. |
| L8 | Dashboard transport | Open Home and Tasks through real `google.script.run`; record success/failure handlers, visible data, and execution-log evidence. |
| L9 | Calendar allowed | With `calendar.readonly` granted, confirm upcoming events load and that execution logs contain no Calendar write attempt. Redact all event titles/details from screenshots and handoff text. |
| L10 | Calendar unavailable | Deny/revoke Calendar permission only if safely possible, or use a controlled unavailable condition; confirm the dashboard stays usable and shows the generic safe fallback. If not safely practical, mark not run. |
| L11 | Private access | Confirm the deployment is private to the deployer and runs as the deployer; do not test by making it public. |
| L12 | Error disclosure | Intentionally use one safe configuration failure only if reversible (for example, a temporary invalid test-only Script Property) and confirm the browser sees a generic safe message while detail stays in execution logs. Restore the correct property immediately. If not safely practical, mark not run. |

## Evidence and privacy requirements

- Do not paste OAuth codes, access tokens, cookies, Sheet IDs, Script IDs,
  deployment URLs, event titles, attendees, descriptions, or personal data
  into the return handoff.
- You may include redacted screenshots or neutral descriptions such as
  `test Sheet created`, `private /dev endpoint opened`, and `Calendar card
  rendered N redacted events`.
- Clearly label each result **Pass**, **Fail**, or **Not run**. A local test or
  mock result must never be labeled as live proof.
- On any unexpected destructive or permission-expanding action, stop and
  report it rather than attempting remediation outside this scope.

## Required return handoff to Codex

Create this new file; do not overwrite any prior receipt:

`outputs/GEMINI_CLOUD_PHASE_1_2_VALIDATION_TO_CODEX.md`

Use this exact structure:

```markdown
# Gemini → Codex: Private Cloud Validation Receipt for Phases 1–2

## Status
Complete / Partial / Blocked

## Scope completed
- Exact work completed, including whether the least-privilege manifest correction was made.

## Files read
- ...

## Files changed or created
- ...

## Local verification
| Command | Result | Exact totals |
|---|---|---|
| `node --test "tests/*.test.js"` | Pass/Fail/Not run | ... |

## Live validation evidence
| ID | Result: Pass/Fail/Not run | What was observed | Redacted evidence/location |
|---|---|---|---|
| L1 | ... | ... | ... |

## Live systems changed
- New blank test Google Sheet created/modified: Yes/No; name/ID redacted
- Apps Script project created/imported: Yes/No; ID redacted
- Test deployment created/changed: Yes/No; URL redacted
- Script Properties changed: Yes/No; identify key names only, never values
- OAuth scopes approved: exact scope names only
- Triggers created/changed: Yes/No
- External APIs contacted: Yes/No

## Live behavior still unverified
- ...

## Failures, risks, or blockers
- Include relevant execution-log error summaries with secrets and personal data removed.

## Decisions required from the user
- ...

## Recommended Codex checks
- Include the exact source files and receipts Codex should inspect.

## Scope confirmation
Phase 3 was not started. No public deployment, scheduled trigger, job discovery, job data, scraping, AI/model call, Calendar write, or production Sheet was used.

**PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
```

## Stop condition

After writing `outputs/GEMINI_CLOUD_PHASE_1_2_VALIDATION_TO_CODEX.md`, stop.
The return handoff transfers evidence to Codex; it does not authorize Phase 3
or production deployment.
