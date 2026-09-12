# Life Dashboard Multi-AI Build and Handoff Plan

## Start here

This document is the controlling plan for building the Google Apps Script Life Dashboard while spreading work across Gemini, Claude, and Codex.

The immediate next action is **Gemini completes Phase 1 only**, writes a new handoff for Codex, and stops. Gemini must not start Phase 2.

Project folder:

`outputs/life-dashboard-apps-script/`

Current state:

- Codex created an early local starter skeleton before the user requested a plan-first workflow.
- That skeleton is a **draft**, not a finished Phase 1 implementation.
- It has not been deployed, connected to a live Google Sheet, authorized, or verified in Google Apps Script.
- It includes clearly labeled sample data helpers. No sample or fabricated job may be inserted into a production job queue.
- Gemini must inspect the draft, keep useful work, correct problems, and report exactly what it verified.

## Non-negotiable working rules

1. Work on the assigned phase only.
2. Do not silently expand scope, redesign later phases, deploy publicly, purchase services, or connect third-party job sources.
3. Do not put secrets, API keys, resume contents, addresses, or other personal information in source files, Sheets cells, logs, screenshots, or handoffs.
4. Use real job data only in production. Mock jobs belong only in isolated tests and must be unmistakably labeled as test data.
5. Preserve this master plan. Do not overwrite it. Each phase creates a separately named handoff file.
6. At the end of a phase, record completed work, tests, unverified items, blockers, files changed, and exact next steps.
7. Stop after writing the handoff. Do not begin the next phase, even if it appears easy.

### Required stop gate

Every phase owner must end their response and handoff with this exact statement:

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

The recommended authorization wording is:

`APPROVE PHASE [number] AND AUTHORIZE PHASE [next number]`

A phase that is incomplete still stops and hands off honestly. It must never describe an incomplete or untested feature as complete.

## Quota-conscious collaboration strategy

Use each model for the work where it offers the most value:

| Role | Best use in this project | Quota strategy |
|---|---|---|
| Gemini | Google ecosystem work, Apps Script boilerplate, schemas, collectors, and repetitive adapters | Give it detailed, bounded implementation instructions and request file edits plus concise results |
| Claude | Interface design, accessibility, interaction quality, explanatory copy, and analytics presentation | Use it for one interface-focused phase at a time; avoid asking it to reread unrelated backend files |
| Codex | Architecture, integration, job workflow, API/AI safeguards, debugging, and final verification | Use short review checkpoints and reserve longer sessions for risky cross-file logic |

Suggested phase ownership:

| Phase | Owner | Review/gate | Reason |
|---|---|---|---|
| 0. Architecture and relay plan | Codex | User | Establish contracts and boundaries once |
| 1. Foundation | Gemini | Codex, then user | Google Apps Script and Sheets foundation is well suited to Gemini |
| 2. Core dashboard | Claude | Codex, then user | UI structure, accessibility, and interaction quality |
| 3. Ready-to-go Jobs queue | Codex | Claude for a short UX review, then user | Central workflow and data-integrity rules need careful integration |
| 4. Scheduled job-search engine | Gemini | Codex, then user | Repetitive normalization/filter adapters and Google triggers |
| 5. AI scoring and application workflow | Codex | Claude for explanation/UX review, then user | Cost controls, validation, security, and state transitions |
| 6. Analytics, polish, and selected life modules | Claude | Codex final verification, then user | Presentation, dashboard clarity, and user-facing polish |

This gives Gemini, Claude, and Codex two main phases each. Codex reviews handoffs briefly between phases but should not redo another model's working code unless verification finds a concrete problem.

### Ways to reduce model usage

- Start each phase in a fresh conversation with only this plan, the latest handoff, and the files listed for that phase.
- Ask the phase owner to edit files directly and summarize changes; do not paste every full source file into chat.
- Use the cheaper model setting for routine edits and tests. Escalate to a stronger setting only for a specific bug, security decision, or failed review.
- Do not run parallel subagents unless the user explicitly authorizes them. Parallel agents can multiply usage quickly.
- Do not ask multiple models to independently build the same feature. One builds, another performs a short targeted review.
- Stop after one phase and inspect the handoff before loading the next phase's context.
- Prefer deterministic checks and small test fixtures over long conversational debugging.

## System architecture that all phases must preserve

```text
Browser
  HTML + CSS + JavaScript
          |
          | google.script.run
          v
Google Apps Script web app
  |              |                     |
  v              v                     v
Google Sheets    Google Calendar       Scheduled job pipeline
Tasks / Jobs /   Read-only initially   Discover -> deduplicate
Settings / Apps                        -> hard-filter -> score
                                         -> store strong jobs
```

Opening or scrolling the dashboard must never trigger a web search or AI call. The dashboard reads stored rows. Discovery and scoring run separately on a schedule or by an explicit administrative action.

## Data and security rules

- The web app is private by default: execute as the deploying user and restrict access to the user.
- All browser-to-server actions use `google.script.run` and server-side validation.
- Escape all Sheet-derived text before inserting it into HTML.
- Use `LockService` around writes that can overlap.
- Use `PropertiesService` for server-side secrets and configuration that should not live in Sheets.
- Never return API keys or internal error details to the browser.
- Use allowed APIs, feeds, or user-provided exports. Do not bypass job-board access controls or terms.
- Deduplicate jobs using a stable source ID when available and a normalized URL/hash fallback.
- Keep raw discovery, filtered candidates, scored candidates, and applications logically distinct.
- Calendar is read-only until a later phase receives explicit permission to create or change events.

---

# Immediate Gemini Handoff: Phase 1 Only

Copy the section below into Gemini and attach or expose the project folder.

## Gemini assignment

You are implementing **Phase 1 only** of a Google Apps Script Life Dashboard. Work in:

`outputs/life-dashboard-apps-script/`

Read `outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md` first. Inspect every existing file in the project folder before editing. The existing code is an unverified draft; reuse sound work but do not assume it runs.

### Phase 1 objective

Produce a clean, minimal Google Apps Script foundation that can be safely connected to a blank Google Sheet and deployed privately as a web app. Phase 1 establishes infrastructure and contracts. It does not implement the full dashboard, Jobs experience, job searching, AI scoring, application analytics, or additional life modules.

### In scope

1. Confirm or correct the Apps Script project structure:
   - `appsscript.json`
   - `Code.gs`
   - `Database.gs`
   - minimal `Index.html`
   - minimal shared CSS and browser JavaScript includes
   - `README.md`
2. Define a maintainable configuration strategy:
   - Prefer Script Properties for the spreadsheet ID.
   - Provide a clear setup function or documented fallback.
   - Never expose secrets to the client.
3. Create idempotent Sheet initialization for these tabs:
   - `Tasks`
   - `Jobs`
   - `Settings`
   - `Applications` may be created now only if it is schema-only and clearly reserved for a later phase.
4. Validate headers when sheets already exist. Do not silently overwrite user rows or rearrange columns.
5. Add safe shared data helpers:
   - read rows as objects
   - append a record by named headers
   - update a record by stable ID
   - serialize dates for the browser
   - consistent user-safe error handling
   - locking for writes that may overlap
6. Provide a minimal `doGet()` page that proves the web app loads and can make one read-only server call such as `getAppStatus()`.
7. Keep manifest scopes as narrow as practical. Document which permissions are expected and why.
8. Update setup documentation for both:
   - manual Apps Script Editor setup
   - `clasp` workflow, but only if `clasp` is actually available or clearly marked optional
9. Ensure production setup does not seed fabricated jobs. If sample data remains, isolate it as test-only, label it unmistakably, require an explicit action, and prevent it from being mistaken for live data.

### Out of scope

- Do not build the full Home dashboard.
- Do not implement task CRUD beyond any tiny foundation stub required to prove the database helper.
- Do not build job cards or filters.
- Do not search job boards or connect job APIs.
- Do not add OpenAI, Gemini, or other AI calls.
- Do not implement Calendar integration.
- Do not deploy publicly.
- Do not begin Phase 2.

### Preferred Phase 1 contracts

Use or refine these minimum headers without deleting later-use fields:

`Tasks`

```text
id, title, due_date, priority, status, created_at, updated_at, completed_at
```

`Jobs`

```text
id, external_id, source, url, title, company, location, remote,
salary_min, salary_max, currency, posted_at, discovered_at, last_seen_at,
description, skills_match, experience_match, location_match, salary_match,
overall_match, recommendation, why_matches, gaps, status, saved_at,
notes, record_version
```

`Settings`

```text
key, value, updated_at
```

Optional reserved `Applications`

```text
id, job_id, status, applied_at, follow_up_at, contact_name,
contact_email, interview_at, outcome, notes, created_at, updated_at
```

Do not create relationships by row number. Use UUIDs and `job_id`.

### Required verification

Perform every check that is possible in the available environment and label everything else as unverified:

- Confirm every referenced include file exists with the exact Apps Script filename.
- Check server-side JavaScript for syntax problems compatible with Apps Script V8.
- Check browser JavaScript separately from server code.
- Verify initialization is idempotent by inspection or tests: a second run must not duplicate headers or erase data.
- Verify update-by-ID cannot edit the wrong row when IDs are missing or duplicated.
- Verify client-rendered values are escaped.
- Verify production setup does not automatically insert mock jobs.
- If Google authorization is available, create or use a blank test Sheet only with the user's permission, run setup twice, and report the exact result.
- If Google authorization is not available, do not claim live verification.

### Required Phase 1 deliverables

1. Updated Phase 1 files in `outputs/life-dashboard-apps-script/`.
2. A concise `PHASE_1_TEST_CHECKLIST.md` containing repeatable manual checks.
3. A new `PHASE_1_HANDOFF_TO_CODEX.md` containing:
   - status: complete, partial, or blocked
   - files read
   - files changed
   - important design decisions
   - tests run and exact outcomes
   - checks not run and why
   - authorization/deployment status
   - known risks or blockers
   - recommended Codex review steps
   - confirmation that Phase 2 was not started
4. A short final response linking or naming those files.

### Gemini tools, skills, and MCP/connectors

Use only those that are actually available:

- Workspace/filesystem editing and fast file search.
- Google Apps Script knowledge or official Apps Script documentation lookup.
- Google Drive and Google Sheets connector/MCP for a blank test Sheet, only if connected and the user authorizes live creation or modification.
- Browser or computer-use control for the Apps Script editor, only if needed and authorized.
- `clasp` for local validation/sync only if installed and authenticated; do not install or authenticate without permission.
- JavaScript linting or syntax checks that do not rewrite unrelated files.

Avoid broad Drive searches, job-site browsing, AI API calls, parallel agents, and exploratory integrations in Phase 1.

### Gemini stopping instruction

After writing `PHASE_1_HANDOFF_TO_CODEX.md`, stop. Do not implement tasks, Calendar, the dashboard UI, the Jobs module, collectors, or scoring.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

---

# Phase 2 — Core Dashboard

**Owner:** Claude  
**Gate:** Codex checks the Phase 1 handoff first; user explicitly authorizes Phase 2.

## Objective

Turn the Phase 1 foundation into a useful daily dashboard without adding automated job discovery.

## Detailed scope

- Create responsive Home, Tasks, and placeholder Jobs navigation.
- Home shows date, open/completed tasks, stored strong-match job count, applications sent, and an upcoming-calendar area.
- Implement task creation, completion, reopening, and optional archive using stable IDs.
- Add read-only Calendar retrieval for the next seven days with graceful permission/error states.
- Add accessible loading, empty, success, and failure states.
- Use a calm responsive design that works on desktop and phone.
- Keep Sheet access behind server functions; never load the spreadsheet directly from browser code.
- Add an optional development data adapter so the interface can be previewed without polluting production Sheets.

## Acceptance checks

- Tasks persist after refresh.
- Double-clicking or retrying does not create duplicate task rows.
- Calendar denial does not prevent Tasks or Home from loading.
- Keyboard focus, button labels, color contrast, and mobile layout are usable.
- No dashboard action searches the web or invokes AI.

## Claude tools, skills, and MCP/connectors

- Web Artifacts Builder or equivalent front-end skill, if available, for interface structure only.
- Browser preview, Playwright, or computer-use for responsive and keyboard checks.
- Accessibility audit tools if available.
- Filesystem/workspace editing.
- Google Calendar and Sheets connectors only for explicitly authorized live verification.

## Required handoff

Create `PHASE_2_HANDOFF_TO_CODEX.md` with files changed, screenshots or preview notes, tests, unverified Google behavior, known issues, and confirmation that no Phase 3 work began.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

---

# Phase 3 — Ready-to-Go Jobs Queue

**Owner:** Codex  
**Optional reviewer:** Claude performs a short Jobs-page usability review only.  
**Gate:** User explicitly authorizes Phase 3.

## Objective

Create a fast queue for reviewing stored, already-filtered job records. No discovery or AI happens while browsing.

## Detailed scope

- Render job cards with title, company, location, remote status, salary, age, source, match score, recommendation, match reasons, and gaps.
- Add filters for All, 90%+, Remote, New Today, Saved, and Ready to Apply.
- Add deterministic sorting by match, posting date, discovery date, and salary.
- Implement the state machine:

```text
New -> Reviewed -> Saved -> Ready to Apply -> Applied -> Interview -> Offer
                     |             |             |
                     +-----------> Rejected <----+
```

- Validate transitions server-side and record timestamps.
- Add direct source links with safe URL handling.
- Add notes and a concise history/audit trail for status changes.
- Provide empty and stale-job states.
- Never label a job current or live unless it came from a real source and retains source URL, external ID, and last-seen time.

## Acceptance checks

- Rejected jobs leave the active queue but remain recoverable.
- Refresh preserves filters where practical and always preserves saved status.
- A malformed Sheet row does not break the full queue.
- Duplicate IDs, unsafe URLs, and invalid status transitions are rejected safely.
- Queue browsing produces zero AI calls and zero job-source calls.

## Codex tools and skills

- Workspace editing and local deterministic tests.
- `review` or Bugbot review skill for the status-transition and data-integrity code.
- Browser/computer-use for interaction checks when available.
- Spreadsheet skill or Google Sheets connector for schema verification if connected and authorized.

## Required handoff

Create `PHASE_3_HANDOFF_TO_USER.md`, including the current data contract and a list of source-adapter assumptions Phase 4 must preserve.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

---

# Phase 4 — Scheduled Job-Search Engine

**Owner:** Gemini  
**Gate:** Codex validates the Phase 3 contract; user selects/authorizes sources and explicitly authorizes Phase 4.

## Objective

Populate the Jobs sheet from permitted, real sources on a schedule, using deterministic deduplication and hard filters before any AI scoring.

## Detailed scope

- Add `Profile`/configuration fields for target titles, locations, remote preference, salary floor, excluded terms, experience ceiling, and required skills.
- Implement a common normalized job record.
- Implement one source adapter first. Add more only after the first adapter passes acceptance checks.
- Use stable external IDs plus normalized URL/content hashes for deduplication.
- Keep discovery, filtered-out, accepted-unscored, and error records observable.
- Use time-based triggers with small batches, checkpoints, retry/backoff, and Apps Script runtime limits in mind.
- Add an administrative manual run and status view.
- Record source, discovery time, last-seen time, and source URL for every accepted job.
- Do not scrape a source that disallows it or attempt to evade access controls.

## Acceptance checks

- All production jobs are traceable to real source URLs and IDs.
- Repeated runs do not duplicate rows.
- A failed source does not erase or corrupt existing jobs.
- Hard filters are explainable and tested with boundary cases.
- Trigger overlap is prevented with locks/checkpoints.
- Current quotas, source terms, and API costs are checked against official documentation before enabling frequency.

## Gemini tools, skills, and MCP/connectors

- Official Apps Script documentation search for triggers, URL Fetch, quotas, locks, and Properties Service.
- Google Sheets/Drive connector for authorized test data.
- Browser/web tools for official source API documentation and terms.
- Apps Script execution logs for bounded debugging.
- No broad crawler, CAPTCHA bypass, stealth browser, or fabricated fallback data.

## Required handoff

Create `PHASE_4_HANDOFF_TO_CODEX.md` with every configured source, authentication method, current frequency, quota estimate, real-data proof, duplicate test results, failures, and disabled adapters.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

---

# Phase 5 — AI Scoring and Application Workflow

**Owner:** Codex  
**Optional reviewer:** Claude reviews score explanations and application-flow clarity.  
**Gate:** User explicitly authorizes a model/provider, spending limit, and Phase 5.

## Objective

Score only new jobs that survive deterministic filtering, then support the user's application pipeline without consuming AI tokens during normal browsing.

## Detailed scope

- Define a versioned structured scoring schema for skills, experience, education, location, salary, total match, recommendation, supporting evidence, and gaps.
- Minimize prompts by trimming boilerplate and sending only relevant job/profile fields.
- Cache by job-description hash, profile version, prompt version, and model.
- Batch conservatively and set daily candidate/token/cost ceilings.
- Validate structured responses and quarantine failures instead of inserting guessed scores.
- Never allow the model to invent requirements, salary, company facts, or application status.
- Implement `Applications` records, follow-up dates, contacts, interviews, outcomes, and notes.
- Add explicit user actions for resume tailoring or cover letters; those are never automatic.
- Display an estimated cost before any heavier per-job generation action when practical.

## Acceptance checks

- The same unchanged job is not rescored.
- Scores cite job-description evidence stored with the job.
- Invalid or truncated responses cannot become production scores.
- The configured cost ceiling stops additional work cleanly.
- API keys remain server-side in Script Properties.
- Application status transitions remain consistent with job status.

## Codex tools and skills

- `openai-docs` for current official API behavior if OpenAI is selected.
- Official provider documentation for the chosen model and current pricing.
- `review-security` for secret handling and untrusted model output.
- `review` or Bugbot for state, caching, and retry logic.
- Browser/computer-use and Google Sheets only for authorized end-to-end testing.

## Required handoff

Create `PHASE_5_HANDOFF_TO_USER.md` with provider/model, prompt and schema versions, tested token/cost figures, configured limits, security review results, and all unverified behavior.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

---

# Phase 6 — Analytics, Polish, and Selected Life Modules

**Owner:** Claude  
**Final integrator:** Codex  
**Gate:** User chooses the exact modules and explicitly authorizes Phase 6.

## Objective

Polish the working application, add decision-useful analytics, and add only the life modules the user chooses.

## Detailed scope

- Add job funnel analytics: discovered, passed filters, strong matches, saved, ready, applied, interviewed, offers.
- Add source-quality analytics: strong-match rate, application rate, interview rate, and stale/duplicate rate.
- Add weekly trend views without overstating small samples.
- Improve mobile layout, loading states, visual hierarchy, keyboard access, and empty states.
- Offer life modules as separate opt-in slices: Habits, Study, Goals, Notes, and Finance.
- Implement one selected module at a time behind a feature flag.
- Add backup/export guidance and a compact privacy/settings screen.
- Produce user-facing setup and operating documentation.

## Acceptance checks

- Every chart can be reconciled to Sheet rows.
- Empty/small datasets display honest explanations.
- New modules do not slow or break the Jobs queue.
- Accessibility and mobile checks pass.
- Backup/export instructions are tested.
- The user can distinguish live data, historical data, and estimates.

## Claude tools, skills, and MCP/connectors

- Web Artifacts Builder or front-end design skill, if available.
- Data visualization or dashboard skill for chart design.
- Browser preview/accessibility tooling.
- Google Sheets connector for authorized reconciliation checks.
- Do not add a module merely because a connector is available.

## Required handoff

Create `PHASE_6_FINAL_HANDOFF_TO_CODEX.md` with selected modules, analytics definitions, reconciliation checks, screenshots/preview notes, performance/accessibility results, and remaining backlog. Codex then performs a final bounded verification; it does not automatically start a new development phase.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**

---

# Standard Handoff Template for Every Model

Create a new file; do not overwrite the prior handoff.

```markdown
# Phase [N] Handoff to [Next Owner]

## Status
Complete / Partial / Blocked

## Scope authorized
[Exact phase scope]

## Work completed
- ...

## Files read
- ...

## Files changed or created
- ...

## Tests and verification
| Check | Result | Evidence |
|---|---|---|
| ... | Pass/Fail/Not run | ... |

## Live systems changed
- Google Sheets created/modified: Yes/No, with names or IDs redacted as needed
- Apps Script deployment changed: Yes/No
- Triggers created/changed: Yes/No
- External APIs contacted: Yes/No

## Unverified items
- ...

## Known risks or blockers
- ...

## Decisions needed from the user
- ...

## Recommended next-owner checks
- ...

## Scope confirmation
Phase [N+1] was not started.

**PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
```

## Final control rule

No model should interpret a handoff as permission to continue. A handoff transfers knowledge, not authorization. Only the user can open the next phase.

> **PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
