# Phase 4 Entry Gate — Handoff (supersedes the earlier orientation handoff)

## Status

**Entry-gate verification is DONE. Result: paused, not authorized to implement.** This document replaces `CLAUDE_PHASE_4_ORIENTATION_HANDOFF.md` — that file's "still to do" list is now complete; do not re-do any of it. No Phase 4 code exists (`Discovery.gs`, `JobSource_*.gs`, `JobFilters.gs`, `JobDedupe.gs` — none created). No credential entered, no trigger created, no deployment, no live Sheet or Apps Script project touched.

## What was actually verified

The full item-by-item verdict, evidence, and citations live in **[`PHASE_4_ENTRY_GATE_PAUSED_REPORT.md`](PHASE_4_ENTRY_GATE_PAUSED_REPORT.md)** — read that file, not this one, for the substantive conclusions. Summary only:

- Items 1–5 (Phase 3 handoff exists and is non-blocking, current files agree with it, local test suite rerun fresh at 250/250 passing, 80% threshold confirmed in both Home and Jobs, no evidence of a conflicting in-progress process) — **verified**.
- Item 6 (user has explicitly authorized Phase 4) — **not satisfied**. This alone blocks implementation regardless of the rest.
- Items 7–9 (JSearch/RapidAPI plan/terms verified to permit scheduled retrieval; cost/frequency/test-target approved; official docs permit the planned access) — **partially verified only**. Public JSearch pricing tiers and Google Apps Script quota docs were fetched and are recorded in the report; what remains open is account-specific and can only come from you (which RapidAPI tier you're actually on, its quota/overage setting) — not something further research can resolve.
- Item 10 (profile file + résumé) — profile identifier confirmed exact; one open sub-question on which résumé version to use.
- A follow-up read-only reconnaissance pass (two subagents) has since read every file the controlled handoff's required-reading list names, closing that gap — engineering facts worth knowing before implementation are recorded in the report's "Reconnaissance addendum" section (error-handling conventions, `.claspignore`/test-suite registration requirements, current `oauthScopes`, dedup-identity implications, etc.). None of it changes the gate verdict.
- A previously-flagged "scope conflict" (reference `linkedin.py` vs. the JSearch-only mandate) was reassessed and **withdrawn** — both governing documents already resolve it; it's an implementation note, not a blocker.
- A new, real open question was surfaced instead: how the JSearch adapter should label the `Jobs.source` field when a result's publisher is LinkedIn vs. Indeed. Not decided yet; needed before `JobSource_JSearch.gs` can be written.

## The four decisions only you can make

These are listed in full, with the exact recommended authorization phrase, in the paused report's "The four decisions needed from the user" section:

1. Explicit Phase 4 authorization (or don't — staying paused is a valid outcome).
2. Your actual RapidAPI/JSearch plan tier, quota, and overage setting (no key needed, just the numbers).
3. Whether the delivered résumé satisfies the profile's IT-support/help-desk alignment preference, or whether a help-desk-slanted variant should be built first.
4. How `Jobs.source` should be labeled for JSearch-sourced LinkedIn vs. Indeed records.

Nothing else needs your input to close the gate — everything else is either already verified or is Claude-side implementation work that starts only after item 1 above.

## Constraints that continue to bind, unchanged

All standing constraints from `CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md` and `PHASE_4_JOB_PROFILE.md` remain in force verbatim for any future session touching this project: no hardcoded `DATABASE_SHEET_ID`; no `UrlFetchApp`/`fetch`/`XMLHttpRequest`/Calendar-write/runtime AI outside one authorized adapter; no secrets/tokens/résumé text ever stored in a Sheet, Script Property, log, fixture, or handoff; no résumé text sent to JSearch/RapidAPI; at most two subagents for Phase 4 work; stop new implementation at ~90% context usage and hand off rather than push to 92%; WGU B.S. IT shown as in-progress; `clasp` not installed, no push has occurred, `.claspignore` is a correctly configured whitelist scoped to 9 files.

## Next action for whoever picks this up

Do not resume investigation — there is nothing left to investigate that isn't gated on your answers above. The only two paths forward:

- **You answer the four questions** → the next session verifies items 7–9 are now closeable, confirms item 6's authorization phrase was given as-is (not paraphrased), and only then begins Phase 4 implementation per the controlled handoff's architecture section.
- **You don't, yet** → this stays paused indefinitely; no further action needed from Claude until you say otherwise.

**PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
