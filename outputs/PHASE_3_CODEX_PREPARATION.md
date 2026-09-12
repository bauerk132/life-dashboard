# Codex Phase 3 Preparation — Ready-to-Go Jobs Queue

## Status

**Preparation started; no Phase 3 production source has been changed.**

The user has asked Codex to begin its work while Gemini performs the separate
private cloud validation of completed Phases 1–2. This document records the
bounded Codex work queue so the cloud-validation assignment and later Phase 3
implementation cannot be confused or overlap unsafely.

## Preconditions already reconciled

- `outputs/life-dashboard-apps-script/PHASE_2_HANDOFF_TO_CODEX.md` exists and
  points to the actual receipt at `outputs/CLAUDE_TO_CODEX_HANDOFF.md`.
- The receipt identifies the actual Phase 2 source and confirms the Jobs view
  remains a Phase 2 placeholder.
- Codex independently reran the combined local suite on 2026-09-11:
  `node --test "tests/*.test.js"` → **225 passing, 0 failing**.
- Gemini's separate live-validation task must return
  `outputs/GEMINI_CLOUD_PHASE_1_2_VALIDATION_TO_CODEX.md`. Its presence is
  evidence for a future deployment decision; it does not block local Phase 3
  design work and does not authorize Phase 4.

## Codex-owned work queue

### P3.1 — Freeze and test the stored-job contract

- Read the actual `Jobs` schema in `Database.gs` and document the precise
  browser-safe representation for existing columns.
- Preserve `id`, `external_id`, `source`, `url`, and `last_seen_at` so the UI
  can distinguish stored/historical data from a verified-current listing.
- Define strict server-side validation for: blank/duplicate IDs, enum status,
  numeric match/salary values, date values, and source URLs.
- Make malformed individual rows non-fatal: quarantine/omit the bad row with
  a safe server-visible diagnostic rather than failing the whole queue.

### P3.2 — Add server-owned Jobs endpoints and audit storage

- Add a dedicated Jobs module with narrow public endpoints only; private
  helpers retain trailing underscores.
- Provide read-only queue retrieval with deterministic filters and sorts.
- Implement the Phase 3 state machine server-side:

  ```text
  New -> Reviewed -> Saved -> Ready to Apply -> Applied -> Interview -> Offer
                       |             |             |
                       +-----------> Rejected <----+
  ```

- Make status changes atomic through the existing lock-safe database helper.
- Retain rejected records in storage while excluding them from the default
  active queue; provide an explicit recoverable view/filter.
- Use append-only history/audit records, never rewrite prior history. The
  implementation decision—new strict `JobHistory` sheet versus another
  schema-safe representation—must preserve Phase 1's exact-header safety and
  receive regression coverage.
- Treat editing the existing concise `notes` field separately from immutable
  status-history entries.

### P3.3 — Build the Jobs user interface

- Replace only the Phase 2 placeholder with a stored-data queue.
- Render text only via safe DOM APIs; direct source links must pass strict
  `https:`/`http:` validation before an anchor is created.
- Add filters: All, 90%+, Remote, New Today, Saved, Ready to Apply, and a
  recoverable Rejected view.
- Add deterministic sorting by match, posting date, discovery date, and
  salary. Document a fixed null/malformed ordering in the UI and tests.
- Add honest empty, loading, error/retry, and stale-data states. Do not call
  job sources, AI/model services, or external APIs from browsing, refreshing,
  filtering, sorting, or scrolling.

### P3.4 — Verify and hand off

- Extend the Node harness and regression suite for every state transition,
  invalid transition, malformed row, unsafe URL, duplicate ID, sorting/filter
  boundary, rejected-job recovery, notes, and audit append behavior.
- Extend static checks: deployed-file allowlist, zero outbound job-source/AI
  paths, URL safety, and absence of unsafe DOM sinks.
- Run a local browser preview for queue states; distinguish it from any live
  Google evidence returned by Gemini.
- Write the required additive
  `outputs/life-dashboard-apps-script/PHASE_3_HANDOFF_TO_USER.md`, then stop.

## Scope boundaries

This queue excludes Phase 4 and later work:

- no job discovery, scraping, scheduled trigger, source adapter, external API,
  AI/model call, scoring run, or application automation;
- no public deployment, Calendar write, secret, account setting, or live data
  mutation by Codex;
- no fabricated job data in a production path.

## Coordination rule

Gemini owns only the least-privilege Calendar manifest correction, its affected
test expectation, and private cloud evidence. Codex will not edit those files
while Gemini is working. Codex's first source-changing implementation pass
will begin only after the Gemini return handoff is available or the user
explicitly directs Codex to proceed without it.

## Stop condition

This is a preparation artifact, not a completion receipt. Phase 4 is not
authorized.
