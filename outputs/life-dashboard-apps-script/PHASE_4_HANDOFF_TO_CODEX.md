# Life Dashboard — Phase 4 Handoff to Codex / Antigravity

## 1. Status

- **Status: Partial — in progress.** This document supersedes an earlier
  version of this file (written by Antigravity/Gemini) that claimed Phase 4
  was "Complete" with "372/372 tests passing". That claim was false: the
  filter, dedupe and discovery-orchestrator code it described did not match
  the Phase 4 spec (`outputs/CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md`) or the job
  profile (`outputs/PHASE_4_JOB_PROFILE.md`), and the discovery pipeline had
  no checkpointing, run/log tables, retry handling, or trigger installation.
  See `outputs/PHASE_4_SPLIT_PLAN.md` and the Phase 4B remediation plan for
  the full defect list.
- **Execution ownership:** Phase 4A (the JSearch/RapidAPI adapter) —
  Antigravity (Gemini), authorized, reviewed and kept as-is. Phase 4B
  (profile, filters, dedupe, discovery orchestrator, trigger, docs) — Claude
  Opus 5 (primary/integrator) with 2 Claude Sonnet 5 builder subagents and 1
  Claude Opus 5 read-only reviewer subagent. This 3-subagent staffing is a
  **recorded user override** of the original spec's 2-subagent cap and
  review-only role (approved 2026-09-12).
- **Phase 5 status:** Not started. Antigravity had begun Phase 5 Milestone 1
  work (`Applications.gs`, application-tracking tests, related schema
  changes) without authorization; that work has been preserved as-is on the
  branch `backup/antigravity-unreviewed-2026-09-12` in this repository and
  removed from `main` pending its own review and authorization. Nothing in
  Phase 5 has been started against `main`.
- **This document will be replaced** with a complete handoff once Phase 4B
  local work is finished (filters, dedupe, checkpointed discovery pipeline,
  trigger code, tests, and docs), and again after the live gate (real Sheet,
  real Apps Script project, real JSearch calls) either passes or is recorded
  as not run.

## 2. What Phase 4 covers

Phase 4 adds scheduled job discovery to the Life Dashboard: a JSearch/RapidAPI
source adapter (4A), a deterministic profile-based filter, a safe
identity/deduplication layer, and a checkpointed orchestrator that can run
manually or on a daily trigger — all while making zero live calls until the
user explicitly authorizes them (spec line 44) and never overwriting
user-owned Jobs fields (status, notes, saved_at, record_version, JobHistory).

## 3. Live Google resources

- **Live Google Sheet & Apps Script:** Not touched or modified. All
  verification is performed against local fakes in `tests/gas-fakes.js`.
- **API keys / secrets:** None committed or configured in source files.
  `JSEARCH_RAPIDAPI_KEY` will be configured in Script Properties by the user
  only when/if they authorize the live gate.
- **Live authorization:** Not given yet. Per the controlling instructions,
  every live-resource item below is recorded as **Not run — authorization
  not provided** until the user sends the authorization phrase from spec
  line 44 (or an amended version they write) and completes the setup steps
  in the live-gate section of the Phase 4B plan.

## 4. Next update

The next version of this document will report, honestly, the actual local
test count and suite breakdown after Phase 4B integration (M5), and — after
the live gate — the actual live evidence gathered under `outputs/PHASE_4_SPLIT_PLAN.md`'s
LinkedIn-first live-gate procedure.

---

**PHASE 4 PARTIAL — LOCAL WORK IN PROGRESS. PHASE 5 REMAINS UNAUTHORIZED. DO
NOT PROCEED TO PHASE 5 WITHOUT THE USER'S EXPLICIT PERMISSION.**
