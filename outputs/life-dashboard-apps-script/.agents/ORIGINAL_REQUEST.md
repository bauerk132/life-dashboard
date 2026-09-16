# Original User Request

## 2026-09-13T23:55:38Z

# Teamwork Project Prompt — Launched

> Status: Launched — Delegated to teamwork_preview
> Goal: Perform independent post-design regression test after Claude's visual design pass
> Requested team: Small, focused team — independent verification and regression testing

Perform an independent post-design regression test and verification of the Life Dashboard application after Claude's visual design pass. Confirm that the application functions correctly, all existing automated checks pass, and no regressions were introduced to critical user flows, accessibility, or safety boundaries.

Working directory: C:\Users\User\Claude Code\life-dashboard-design-pass-20260913\outputs\life-dashboard-apps-script
Repository root: C:\Users\User\Claude Code\life-dashboard-design-pass-20260913
Branch / Commit: claude/design-pass-20260913 (HEAD at db9789d with working tree design-pass changes)
Integrity mode: development

## Design-Pass Changes Inspected
1. `Index.html`: Added `<html lang="en">` for document accessibility.
2. `JavaScript.html`: Added jobs-container error banner rendering, cleared stale error messages before status/note actions, updated job card title heading hierarchy to `h4`, and added `.is-warning` class assignment for near-limit budget alerts.
3. `Styles.html`: Added `--field-line: #64748b` for WCAG-compliant form input borders, `.state-message.is-warning` styling, `.app-actions button.is-destructive` styling, and improved mobile responsive navigation/button stacking (`max-width: 430px`).
4. `dev/preview-server.js`: Replaced string replacement with replacer functions to prevent `$'` regex replacement corruption during template assembly.

## Requirements

### R1. Automated Suite & Static Boundary Verification
Run and verify all automated test suites and static checks. Ensure zero regressions across pre-existing baseline functionality, Phase 5B UI tests, and security boundary assertions.
- Execute `node --test "tests/*.test.js"` and confirm all test suites pass with zero failures.
- Execute `node --test tests/static-checks.test.js` and confirm all 323 static checks pass.
- Verify that banned patterns (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `fetch(`, `XMLHttpRequest`) remain completely absent from all deployed files.
- Confirm zero modifications to backend `.gs` files, `Database.gs`, or deployment manifests.

### R2. Critical User Journeys & State Flow Verification
Verify the critical path in a local preview environment (`dev/preview-server.js` on `http://127.0.0.1:4173/`):
- Navigation across Home, Tasks, and Jobs views.
- Job queue browsing, status updates, and note entry.
- Single queue-level scoring action ("Score next eligible job") with double-click suppression and pending state indicators.
- Safe rendering of all four scoring states (`unscored`, `current`, `stale`, `quarantined`) and budget telemetry tiles (`normal`, `near-limit`, `exceeded`, `ledger-blocked`).
- Application workflow: creation confirmation, status transitions, metadata editing allowlist, activity history drawer, and error recovery (`CONFLICT`, `INVALID_TRANSITION`).
- Verify untrusted strings (job descriptions, notes, whyMatches, gaps) remain inert text without evaluation.

### R3. Responsive & Accessibility Validation
Verify that visual and interactive design changes maintain accessibility and responsive ergonomics:
- Test responsive layouts at desktop (1280x800) and narrow mobile (375x812) viewports. Ensure no horizontal scrolling or clipped interactive elements.
- Verify keyboard tab navigation, visible `:focus-visible` indicators on all actionable controls, and proper ARIA live region announcements for state updates.
- Verify minimum 44x44px touch targets on buttons and form inputs.
- Verify `prefers-reduced-motion` compliance.

### R4. Strict Boundary & Non-Destructive Execution
Operate strictly within local offline fixtures and mocks:
- Zero live external network calls (no live Gemini API, JSearch RapidAPI, Google Sheets, Drive, or Calendar API).
- No git push, remote branch creation, public deployment (`clasp push`), or trigger installation.
- If a low-risk regression introduced by the design pass is discovered, fix it surgically, re-verify all tests, and document the change. For product ambiguities or architectural blocks, halt and document.

## Acceptance Criteria

### Automated Verification
- [ ] `node --test "tests/*.test.js"` passes with 0 failures (minimum 653 tests).
- [ ] `node --test tests/static-checks.test.js` passes with 0 failures (323/323 checks).
- [ ] `git diff --check` exits with code 0 (clean whitespace/formatting).
- [ ] Tracked git status is clean or contains only documented, low-risk fixes to design-pass regressions.

### Interactive & Responsive Verification
- [ ] Local preview server responds HTTP 200 at `http://127.0.0.1:4173/`.
- [ ] Desktop (1280x800) and mobile (375x812) layouts render cleanly without overflow.
- [ ] Single scoring trigger enforces one-call double-click suppression and reflects budget/scoring state changes.
- [ ] Application creation, transitions, and history drawers operate according to the frozen contract.
- [ ] Zero unhandled console errors during navigation and state transitions.

### Final Release-Gate Report
- [ ] Output one compact, evidence-backed report detailing:
  - Exact project root and commit SHA tested;
  - Files changed in the design pass;
  - All test commands run and full outcomes;
  - Manual/local preview flows tested with viewport dimensions;
  - Any defects found, fixes made, and retest evidence;
  - Explicit recommendation: **READY FOR USER-APPROVED LAUNCH**, **NOT READY**, or **READY WITH NAMED NON-BLOCKING RISKS**.
- [ ] Halt at release gate without launching or deploying.
