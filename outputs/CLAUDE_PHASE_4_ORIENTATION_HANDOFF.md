# Phase 4 Orientation — Handoff (context reset)

## Status
**Orientation in progress. No implementation started. No code written or files created/modified for Phase 4 itself.** This document exists purely to let a fresh chat continue without re-reading everything from scratch.

## What Phase 4 is
Scheduled Job-Search Engine for the "Life Dashboard" Google Apps Script project at:
`C:\Users\User\Documents\Codex\2026-09-10\referenced-chatgpt-conversation-this-is-an-2\outputs\life-dashboard-apps-script`

Governing docs (already read in full, all standing, all end with **"PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION."**):
- `outputs/PHASE_4_JOB_PROFILE.md` — the approved search profile (sources, roles, geography, comp floor, exclusions, schedule).
- `outputs/CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md` — the entry-gate checklist that must be verified before any Phase 4 implementation.
- `outputs/life-dashboard-apps-script/PHASE_3_HANDOFF_TO_USER.md` — Phase 3 closeout (stored-jobs review queue, complete, live behavior unverified).
- `outputs/PHASE_2_CODEX_RECEIPT_REVIEW.md` — Phase 2 receipt review.

## The task at hand
Verify the Phase 4 "entry gate" before any implementation. Either proceed (if satisfied) or write a **paused report** identifying exactly what's missing. Do NOT start writing `Discovery.gs` / `JobSource_*.gs` or any Phase 4 code yet.

## Key finding already identified (not yet reported to user)
**Scope conflict between required-reading reference code and the approved profile:**
- `PHASE_4_JOB_PROFILE.md` explicitly says: "Use the existing subscribed JSearch/RapidAPI provider contract as the single technical adapter" for both LinkedIn and Indeed, and explicitly: **"Do not schedule the undocumented LinkedIn guest endpoint from the older local program."**
- But the required-reading reference implementation at `C:\Users\User\OneDrive\Documents\Copilot\Created\chatbo\New folder\scripts\sources\linkedin.py` is exactly that undocumented guest-endpoint scraper (regex-parses `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`).
- Only the reference `indeed.py` (JSearch/RapidAPI `/search-v2`, filtered to `job_publisher` containing "indeed") aligns with what the profile authorizes.
- **Conclusion carried forward:** a real Phase 4 LinkedIn adapter must go through JSearch/RapidAPI (filtered to LinkedIn-published listings), not reuse the reference `linkedin.py` guest-scrape code. This must be surfaced in the paused report as a first-class finding.

## Reference architecture read so far (background only — a DIFFERENT, older project, not the Apps Script code)
Location: `C:\Users\User\OneDrive\Documents\Copilot\Created\chatbo\New folder\`
- `SOURCES_ARCHITECTURE.md` — design doc (dated 2026-09-06) for `scripts/job_scout.py`, a stdlib-only pipeline on bare system Python, scheduled as `KyleJobSearchMorningPipeline`.
- `scripts/sources/base.py` — shared adapter contract: `safe_fetch()` (isolates every adapter failure into `([], SourceHealth, detail)`, pipeline never raises), `classify_category()` (two-tier keyword match against `config/criteria.json`), `dedup_postings()` (slugified `company::title` key, richness-ranked, source priority `usajobs > adzuna > linkedin > indeed > remotive > craigslist`).
- `scripts/sources/linkedin.py` — the undocumented guest-endpoint scraper (see conflict above).
- `scripts/sources/indeed.py` — JSearch/RapidAPI approach, `REQUIRES_ENV`, `METERED = True`.
- Craigslist/USAJobs/Adzuna/Remotive adapters also exist in this reference project but are **explicitly out of scope for Phase 4** per the profile ("Do not add Craigslist, Zillow, Redfin, Remotive, USAJOBS, Adzuna, or another source in Phase 4").

## Still to do before finalizing the paused report
1. (Lower priority — sources are out of scope) Optionally skim `craigslist.py`, `remotive.py`, `usajobs.py`, `adzuna.py`, `__init__.py`, `budget.py` for context only.
2. Read the actual deployable Apps Script files not yet read verbatim, in `outputs/life-dashboard-apps-script/`: `Code.gs`, `Database.gs`, `Jobs.gs`, `Index.html`, `Styles.html`, `JavaScript.html`, `Calendar.gs`, `Tasks.gs`.
3. Read `dev/mock-google-script-run.js`, `dev/preview-server.js`, and the `tests/` source files.
4. Do official-documentation research (WebFetch/WebSearch) for: JSearch/RapidAPI terms of use, cost, and rate limits; Apps Script `UrlFetchApp` scopes; installable time-driven triggers; Lock/Properties Service quotas. This covers entry-gate items 7, 8, 9.
5. **Call `advisor()` before finalizing the paused-report conclusion or committing to any implementation approach — has not been called yet in this whole task.**
6. Write the paused report. Working conclusion so far (subject to advisor review): the entry gate is **not fully satisfied**. Open items expected to land in the report:
   - The LinkedIn-guest-endpoint-vs-JSearch conflict above (new finding).
   - Item 10 (résumé requirement) — substantially addressed; the master résumé (`C:\Users\User\Downloads\Resume-KYLE-BAUER-Master.docx`) has been delivered and confirmed correct by the user. Only the "IT-support-alignment preference" sign-off is potentially still open (profile prefers the IT-support-oriented résumé version — confirm whether the delivered version counts, or a variant is needed).
   - Items 7–9: JSearch/RapidAPI terms/authentication/cost/frequency approval — not yet independently verified against official docs.

## Hard constraints that apply to any Phase 4 work (carry forward verbatim)
- `DATABASE_SHEET_ID` must never be hardcoded in source (Script Properties only).
- No `UrlFetchApp`/`fetch`/`XMLHttpRequest`/runtime AI/Calendar-write/permissive-frame-option in deployed files outside the one authorized adapter.
- "Discovery, scraping, network access, scheduled triggers, automated scoring, and external integrations require separate user authorization and must not be added incidentally."
- No secrets (API keys, tokens, cookies, passwords, OAuth refresh tokens, addresses, résumé text) may ever be stored in a Sheet, Script Property value returned to the browser, log, fixture, or handoff document.
- Résumé text must never be sent to JSearch/RapidAPI.
- Must not expose `.clasp.json` values, Sheet IDs, tokens, source credentials, resumes, addresses, or personal data in any output.
- Must not install, authenticate, deploy, push, create triggers, or modify live resources without corresponding explicit authorization satisfying every entry-gate item.
- At most two subagents for Phase 4 (zero or one preferred); only primary Claude may create them; they may not create sub-subagents.
- If session/context usage reaches ~90%: stop new implementation work, preserve current files, write a Partial `PHASE_4_HANDOFF_TO_CODEX.md` with exact next actions, terminate every subagent/background task, and stop. Must not continue past 92%.
- WGU B.S. in Information Technology must be represented as **in progress**, not completed (user's explicit correction, already applied in the delivered résumé).
- `clasp` is not installed; no push has occurred; `.claspignore` is a whitelist already correctly configured.

## Separate, unrelated closed thread (no action needed)
Résumé regeneralization task is **complete**. `C:\Users\User\Downloads\Resume-KYLE-BAUER-Master.docx` was delivered, WGU education corrected to "(In Progress)", user confirmed "Proceed Wings over is correct." Two optional follow-ups exist only if the user requests them later: add a graduation date; build an IT-support/help-desk-slanted résumé variant (this second one is actually relevant to the Phase-4 "IT-support-alignment" open item above — worth asking the user if it's now needed).

## Separate, unrelated paused project (no activity, not part of this thread)
iMessage relationship analytics project at `C:\Users\User\Desktop\messages\` has its own plan and `HANDOFF.md`. Not part of this Phase 4 work. See `C:\Users\User\.claude\plans\can-you-come-up-compiled-lighthouse.md` if resuming that separately.

## Next action for the new chat
Resume at step 2 above (or skip straight to step 4 official-docs research + step 5 `advisor()` call if time-constrained), then produce the paused report per step 6. Do not begin writing Phase 4 `.gs` source files.
