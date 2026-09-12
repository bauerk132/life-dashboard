# Life Dashboard — Claude Controlled Assignment for Phase 4

## Purpose and authority

This document is the copy/paste assignment for **Claude to implement Phase 4 only: the Scheduled Job-Search Engine**.

The user has reassigned the Phase 4 owner from Gemini to Claude. This supersedes only the owner label in `outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`; that master plan still controls architecture, privacy, phase order, acceptance criteria, and stop gates.

Creating this instruction file is **not** authorization to start Phase 4, contact a job source, authenticate, spend money, create a trigger, change a live Sheet, or deploy. Claude must pass the entry gate below first.

## Exact project locations

Project root:

`C:\Users\User\Documents\Codex\2026-09-10\referenced-chatgpt-conversation-this-is-an-2`

Application folder:

`C:\Users\User\Documents\Codex\2026-09-10\referenced-chatgpt-conversation-this-is-an-2\outputs\life-dashboard-apps-script`

All relative paths in this assignment are relative to the project root.

## Entry gate — stop before editing unless every condition is satisfied

Claude must verify all of the following from the actual files and the user's explicit messages:

1. `outputs/life-dashboard-apps-script/PHASE_3_HANDOFF_TO_USER.md` exists and reports Phase 3 complete or clearly identifies only non-blocking limitations.
2. The current application files agree materially with that handoff.
3. The local suite passes before Phase 4 edits:
   `node --test tests\phase1.test.js tests\phase2.test.js tests\phase3.test.js tests\static-checks.test.js`
   The latest known result is 250 passing tests, but Claude must rerun it rather than rely on this statement.
4. The Jobs queue uses the user-selected **80% strong-match threshold**, not 90%, in both Home statistics and the Jobs filter.
5. No unfinished process or agent is still modifying the same files.
6. The user has explicitly authorized **Phase 4**. The source scope is already selected: LinkedIn-published and Indeed-published employment listings only, reached through the existing subscribed JSearch/RapidAPI contract described below.
7. Claude has verified that the current subscribed JSearch/RapidAPI plan and provider terms permit the intended personal scheduled retrieval. The undocumented direct LinkedIn guest endpoint is not the scheduled production route.
8. The user has approved any authentication step, API cost, query frequency, and live Google test target required by the selected approach.
9. The selected source's current official API documentation and terms permit the planned access. If the source has no permitted automated route, Claude must stop and propose a compliant alternative; it must not scrape around the restriction.
10. `outputs/PHASE_4_JOB_PROFILE.md` exists, has profile identifier `phase4-job-profile-v1-2026-09-11`, and agrees with the attached current résumé. A résumé conflict is not permission to invent a qualification or silently change a user-selected search preference.

If any entry item is missing, Claude may perform read-only inventory and official-documentation research, but it must not implement an assumed source, enter credentials, call the source, create a trigger, deploy, or modify live data. It must write a concise paused report identifying the exact missing decision.

Recommended user authorization form:

`AUTHORIZE PHASE 4 USING THE EXISTING JSEARCH/RAPIDAPI SUBSCRIPTION FOR LINKEDIN-PUBLISHED RESULTS FIRST AND INDEED-PUBLISHED RESULTS AFTER THE FIRST GATE PASSES, EVERY DAY AT 7:00 A.M. AMERICA/NEW_YORK, WITH A PRIVATE BLANK SHEET AND PRIVATE APPS SCRIPT TEST PROJECT. DO NOT BEGIN PHASE 5.`

## User decisions already locked

- Employment sources: **LinkedIn and Indeed only**.
- Initial technical adapter: the existing subscribed **JSearch/RapidAPI** integration.
- Rollout order: first validate JSearch results whose publisher is LinkedIn; after that path passes normalization, provenance, hard-filter, duplicate-rerun, and failure-isolation acceptance, enable Indeed-published results through the same adapter and pipeline.
- Do not add Craigslist, Zillow, Redfin, Remotive, USAJOBS, Adzuna, or another board during Phase 4. Zillow and Redfin are not currently requested as employment sources or preferred employers.
- Do not schedule the existing undocumented LinkedIn guest-endpoint scraper. It may be inspected as historical reference for normalization/fixtures only.
- Frequency: every day at **7:00 a.m. America/New_York**, including weekends unless the user changes that choice while finalizing the profile.
- Subscription cost: the user reports that required source subscriptions already exist. Claude must verify the current plan and request limits without exposing keys, and must still implement conservative quota/overage protection.
- Live verification: the user authorizes a **private blank Google Sheet and private Apps Script test project**. Keep both private; inspect the exact targets before writing. Do not use unrelated or production data.
- Strong-match review threshold: **80%**, retained for career-transition review. It is not a Phase 4 ingestion cutoff.
- Controlling search profile: `outputs/PHASE_4_JOB_PROFILE.md`, profile identifier `phase4-job-profile-v1-2026-09-11`.
- Phase 5 remains unauthorized.

Existing local reference implementation:

`C:\Users\User\OneDrive\Documents\Copilot\Created\chatbo\New folder`

Claude must inspect the current checkout, especially `SOURCES_ARCHITECTURE.md`, `config/sources.json`, `scripts/sources/base.py`, `scripts/sources/indeed.py`, `scripts/sources/linkedin.py`, `scripts/sources/__init__.py`, and their source tests. Reuse validated normalization, source-health, budget, and fixture-test ideas; do not copy secrets, runtime databases, queues, reports, personal resumes, or the stale packaged copy. The current Python `indeed.py` adapter uses JSearch but filters to Indeed; Phase 4 should refactor the provider-facing concept cleanly so publisher identity remains truthful for LinkedIn and Indeed records.

## Files Claude must read completely before editing

1. `outputs/LIFE_DASHBOARD_MULTI_AI_HANDOFF_PLAN.md`
2. `outputs/PHASE_2_TO_3_CONTROLLED_HANDOFF.md`
3. `outputs/PHASE_2_CODEX_RECEIPT_REVIEW.md`
4. `outputs/life-dashboard-apps-script/PHASE_3_HANDOFF_TO_USER.md`
5. `outputs/CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md`
6. Every deployable file directly inside `outputs/life-dashboard-apps-script/`
7. `outputs/life-dashboard-apps-script/.claspignore`
8. Every file directly inside `outputs/life-dashboard-apps-script/tests/`
9. Every file directly inside `outputs/life-dashboard-apps-script/dev/`
10. `outputs/PHASE_4_JOB_PROFILE.md`
11. The current résumé attached by the user. Use it only as truthful qualification evidence; do not copy its personal details into Sheets, logs, fixtures, source requests, or handoffs.

Preserved directories such as `pre-plan-draft/` and `phase-1-gemini-submission/` are historical evidence. Inventory them, but do not modify, delete, deploy, or use them as the implementation base.

## Phase 4 objective

Populate the existing Jobs sheet from the user-authorized JSearch/RapidAPI adapter on a controlled daily schedule, first accepting LinkedIn-published records and then Indeed-published records only after the initial path passes acceptance. Use deterministic normalization, hard filtering, deduplication, checkpoints, and observability **before any AI scoring**.

The Phase 3 Jobs queue must remain a stored-data browser. Queue load, refresh, navigation, filtering, sorting, and scrolling must continue to perform zero source calls and zero AI/model calls.

## Work organization

Use the proportional Producer → Dev → QA workflow:

- Producer: confirm the exact source, authorization boundary, profile/filter contract, quotas, and acceptance evidence.
- Dev: implement the smallest complete one-source adapter, deterministic pipeline, tests, and self-review.
- QA: independently verify deduplication, filter boundaries, retry/checkpoint behavior, queue isolation, and failure safety.

Claude may use at most two subagents. Zero or one is preferred. Only primary Claude may create them; they may not create agents. A useful split is:

- Source-contract reviewer: read-only review of the selected source's official API/terms, pagination, identifiers, quotas, and authentication. No code edits.
- Data-integrity reviewer: read-only review of normalization, filters, deduplication, locks, checkpoints, and tests. No UI or live-source actions.

Primary Claude owns integration, reruns all checks, inspects every changed file, stops all subagents, and writes the final handoff. A subagent statement is not proof.

## Existing contracts that must be preserved

### Jobs schema

Do not casually reorder or extend the existing exact-header `Jobs` sheet. The current ordered fields are:

`id, external_id, source, url, title, company, location, remote, salary_min, salary_max, currency, posted_at, discovered_at, last_seen_at, description, skills_match, experience_match, location_match, salary_match, overall_match, recommendation, why_matches, gaps, status, saved_at, notes, record_version`

If Phase 4 genuinely requires additional persistent fields, prefer a separate exact-schema operational sheet. If a Jobs schema migration is unavoidable, design an explicit versioned migration, test old and new sheets, perform no live migration without target-specific authorization, and document rollback/recovery.

### Workflow and audit

- Preserve all Phase 3 statuses and transition validation.
- Source ingestion must never overwrite user-managed `status`, `saved_at`, `notes`, `record_version`, or `JobHistory`.
- Existing records may receive refreshed source-owned fields such as `last_seen_at` only through a narrow, tested server helper that preserves user-owned fields.
- The source adapter must not call `setJobStatus`, fabricate history, or silently reopen Rejected jobs.

### Career-transition threshold

The Home strong-match statistic and Jobs filter use **80%** by user decision. Phase 4 performs deterministic eligibility filtering only. It must not reinterpret 80% as a source-ingestion cutoff, generate an AI score, or raise the threshold back to 90%.

### URL and provenance

- Preserve strict absolute HTTP(S) URL validation.
- Every accepted production job must retain `source`, `external_id` when available, canonical source URL, `discovered_at`, and `last_seen_at`.
- Never describe a stale cached record as currently live without a fresh authorized source observation.

## Recommended Phase 4 architecture

Follow current conventions and keep top-level browser-callable functions narrow. Private helpers must end in `_`.

Suggested components; names may be adjusted to match the existing style, but their responsibilities must stay separate:

- `Discovery.gs`: orchestration, batch/checkpoint state, manual administrative run, trigger entry point, and safe run status.
- `JobSource_<AuthorizedSource>.gs`: one source adapter only. Authentication, request construction, pagination, response validation, and source-specific normalization stay here.
- `JobFilters.gs`: pure deterministic filters and explainable rejection reasons.
- `JobDedupe.gs`: canonical identity, normalized URL, content hash, and upsert decisions.
- `Jobs.gs`: retain queue and user workflow behavior. Add only narrow ingestion helpers when necessary; source-specific logic does not belong here.
- `Database.gs`: exact schemas and generic private persistence helpers only.
- `appsscript.json`: add only scopes truly required by the authorized source and trigger design; explain each addition.
- `Index.html`, `Styles.html`, `JavaScript.html`: add a compact private administrative status/manual-run surface only if authorized. Do not mix discovery calls into ordinary queue refresh.

Before adding files, update `.claspignore` deliberately so required production files are included and all tests, fixtures, historical folders, local config, credentials, and sample payloads remain excluded.

## Profile and configuration contract

The controlling user profile is `outputs/PHASE_4_JOB_PROFILE.md`, identifier `phase4-job-profile-v1-2026-09-11`. Claude must implement that file's target-role priorities, Pittsburgh radius, work-mode preference, compensation policy, employment types, seniority defaults, hard exclusions, résumé-handling boundary, schedule, and 80% downstream review threshold without silently broadening them.

In particular:

- prioritize IT support/help desk, desktop support, and technical support;
- also include office administration, operations coordinator, logistics coordinator, and non-sales customer/store-support and customer-success roles;
- prefer remote, while allowing hybrid/on-site jobs less than 8 miles from Downtown Pittsburgh;
- apply the USD 19/hour or USD 38,000/year base-compensation floors to source-provided compensation;
- include jobs with no listed salary, keep source salary distinct from any clearly labeled deterministic estimate, and never filter solely on an estimate;
- include full-time and contract-to-hire work;
- exclude all sales, General Manager, Kitchen Manager, heavy/frequent travel, required relocation, and driving-duty roles;
- use the attached résumé as truthful evidence without transmitting résumé text to the source or storing personal details;
- run every day at 7:00 a.m. in `America/New_York`, including weekends.

Add a deterministic user profile/configuration representation for:

- target titles and title synonyms;
- allowed locations;
- remote/hybrid/on-site preference;
- minimum salary and currency assumptions;
- excluded titles, employers, terms, or technologies;
- experience ceiling/floor as explicitly chosen by the user;
- required skills;
- optional skills;
- source query terms;
- batch size, retry limit, and run frequency;
- enabled/disabled status for the single adapter.

Requirements:

- Give the profile/config a monotonically increasing or immutable version identifier.
- Validate type, maximum length, item count, normalized casing, and blank values.
- Store no API key, token, cookie, password, OAuth refresh token, personal address, resume text, or secret in a Sheet.
- Secrets belong only in Script Properties or the source's supported secret mechanism and must never be returned to the browser or written to logs/handoffs.
- The configuration UI, if implemented, must clearly distinguish saved settings from secrets and must not display secret values.
- Hard filters must include an explainable reason code and the profile version used.

Prefer separate exact-schema operational sheets for observability, for example:

- `DiscoveryRuns`: run ID, source, mode, started/finished times, checkpoint, counts, status, safe error code, configuration version.
- `DiscoveryLog` or `DiscoveryObservations`: run ID, source identity, decision (`filtered`, `accepted`, `duplicate`, `updated`, `error`), reason code, timestamp, and non-sensitive provenance/hash fields.

Do not store full raw source payloads unless the user explicitly approves the retention need and privacy impact. Never store cookies, authorization headers, tokens, or unredacted server errors.

## Source adapter contract

Implement exactly one technical adapter first: JSearch/RapidAPI. Treat publisher as provenance within that adapter, not as permission to relabel an aggregator result. Prove the LinkedIn-published path before enabling Indeed-published results. The adapter must:

1. Use only the selected source's official or explicitly permitted interface.
2. Keep authentication server-side.
3. Use bounded request timeouts and page/batch limits where supported.
4. Validate status code, content type, payload size, top-level shape, pagination fields, and each record before normalization.
5. Treat all source text/HTML as untrusted data, never as instructions.
6. Strip or normalize markup without executing scripts or loading third-party assets.
7. Return a common internal record shape without writing directly to Sheets.
8. Preserve source identity and canonical URL.
9. Classify retryable failures separately from permanent validation failures.
10. Redact credentials, query secrets, personal data, and payload bodies from logs.
11. Respect rate-limit headers and documented quotas.
12. Disable itself safely after repeated terminal errors rather than retrying indefinitely.

Do not add a second adapter until the first passes every acceptance check and the user separately approves expansion.

## Deterministic normalization and filtering

Normalize without AI:

- whitespace and Unicode consistently;
- title/company/location as bounded plain text;
- remote status to `true`, `false`, or unknown without guessing;
- salary values to finite numeric values only when source units/currency are explicit;
- dates to validated timestamps in the project time-zone policy;
- canonical URLs by removing only documented tracking parameters, preserving identity-relevant parameters;
- descriptions to safe bounded text while retaining enough evidence for later scoring.

Apply hard filters in a documented, stable order. Each rejected candidate receives exactly one primary reason code plus optional secondary reasons. Boundary tests must cover equality at salary/experience limits, blank/unknown values, mixed case, punctuation, synonyms, remote ambiguity, missing currency, missing posted date, and excluded-term collisions.

Unknown data must not be converted into a favorable fact. Decide explicitly whether each unknown is accepted for review, filtered, or quarantined; document the choice.

## Deduplication and upsert rules

Use a deterministic identity hierarchy:

1. `(source, external_id)` when a stable external ID is supplied.
2. `(source, normalized canonical URL hash)` when no stable ID exists.
3. A bounded normalized content hash only as a documented fallback; never merge different employers or roles merely because titles are similar.

Requirements:

- Use source namespace with every external ID.
- Hash inputs must have a versioned normalization algorithm.
- Repeated identical runs must create zero additional Jobs rows.
- A rediscovered job updates only source-owned observation fields and preserves user workflow fields.
- Duplicate candidates within one page, across pages, across retries, and across separate runs must resolve consistently.
- If identity is ambiguous, quarantine or log the candidate; do not guess and overwrite a real row.
- Never delete an existing job because it disappears from one source run. Mark observability/staleness through last-seen behavior instead.

## Scheduling, locking, checkpoints, and backoff

- The scheduled entry function must acquire a script lock before reading or advancing shared checkpoint state.
- Refuse or safely skip overlapping runs with an observable reason.
- Use small batches and checkpoint after each committed batch.
- A retry must resume from the last committed checkpoint and remain idempotent.
- Respect Apps Script runtime limits and stop early enough to save state.
- Backoff must be bounded, distinguish retryable statuses, and avoid blocking sleeps that consume the execution window.
- Track run ID, source, page/cursor, attempt, accepted/filtered/duplicate/error counts, start/end, and terminal status.
- A manual administrative run must use the same orchestration path as the trigger, with explicit mode metadata.
- Never create or change a live trigger until the user approves the exact schedule and target. Code and local fakes may be prepared first.

## Browser and administrative behavior

Ordinary Home, Tasks, Calendar, and Jobs browsing must not initiate discovery.

If a manual run/status view is added:

- Label it as an administrative source operation.
- Show selected source, last run, next planned run, checkpoint/status, and safe counts.
- Require a deliberate user action for a manual source call.
- Disable controls while pending and prevent double submission.
- Return safe structured errors; never expose tokens, URLs containing secrets, stack traces, raw payloads, Sheet IDs, or Script Property names.
- Render all source-derived text using safe DOM creation and `textContent`.
- Do not display fabricated production jobs; dev fixtures must remain isolated and excluded from deployment.

## Static and local test requirements

Extend the existing Node/vm harness rather than replacing it. Add purpose-built Phase 4 fakes for `UrlFetchApp`, `ScriptApp`, Properties Service, clocks, quotas, and locks only as needed. Fakes are development-only and must never be deployable.

At minimum test:

- source response validation: success, empty, malformed JSON, wrong content type, oversized/partial payload, 401/403, 404, 429 with retry metadata, 5xx, timeout;
- pagination and final-page behavior;
- normalization boundaries and unsafe markup/text;
- every hard-filter reason and equality boundary;
- unknown salary/location/remote/experience policy;
- stable external-ID dedupe;
- canonical URL/hash dedupe;
- duplicates within a batch and across repeated runs;
- rediscovery updates last-seen/provenance without changing status, notes, saved time, history, or record version improperly;
- malformed/ambiguous identity quarantines without writes;
- source failure preserves all existing Jobs rows;
- overlapping run prevention;
- checkpoint resume after a simulated interrupted batch;
- bounded retry/backoff and adapter disable behavior;
- manual and trigger runs call the same pipeline;
- browser queue load/filter/sort/scroll paths make no source call;
- source calls and trigger APIs exist only in allowlisted server files;
- no AI/model call, score generation, resume generation, cover-letter generation, or application automation exists;
- `.claspignore` includes required server files and excludes tests, fixtures, local config, payload samples, and secrets;
- all Phase 1–3 regression tests remain green.

Do not simply delete the existing static ban on outbound calls. Narrow it so outbound access is allowed only in the authorized adapter/orchestrator and remains prohibited in browser code, queue code, task code, Calendar code, and ordinary dashboard endpoints.

## Official documentation and live verification

Use current official primary documentation for:

- selected source API/terms, quotas, authentication, pagination, and rate limits;
- Apps Script URL Fetch scopes/behavior;
- installable time-driven triggers;
- Lock Service, Properties Service, execution quotas, and runtime limits.

Record exact URLs and the design decision each supports. Documentation is not runtime proof.

Live testing is permitted only after separate target-specific authorization. If authorized:

- inspect the exact Apps Script project and blank/disposable Sheet before writing;
- use the single approved source and smallest useful result set;
- redact source/account IDs and secrets from evidence;
- run once, then repeat to prove deduplication;
- simulate/reproduce a recoverable failure without corrupting existing rows;
- verify the normal Jobs queue performs zero new source requests;
- verify a trigger only after the exact schedule is approved;
- do not widen deployment access or make the app public.

Without live authorization, label every real-source, trigger, Apps Script, and Sheet outcome **Not run — authorization not provided**. Local fakes are not live proof.

## Explicitly out of scope for Claude Phase 4

- AI/model scoring, prompting, embeddings, resume tailoring, cover-letter generation, or token/cost usage.
- Application records/workflow beyond preserving the existing schema.
- Automated job applications, account creation, form submission, recruiter messaging, or representational communication.
- A second source adapter before the first is accepted.
- Scraping disallowed pages, CAPTCHA handling, browser stealth, proxy rotation, paywall/access-control bypass, or terms evasion.
- Public deployment, broad sharing, production migration, destructive cleanup, or secret exposure without separate authorization.
- Phase 5, Phase 6, analytics, or unrelated life modules.

## Files and editing rules

- Search before editing and reuse current helpers/contracts.
- Use patch-based edits and preserve unrelated work.
- Do not modify the master plan, Phase 1/2/3 handoffs, gate reviews, or historical folders.
- Re-read every changed file, inspect a focused diff if available, and rerun deterministic checks.
- Do not expose `.clasp.json` values, Sheet IDs, tokens, source credentials, resumes, addresses, or personal data in output.
- Do not install, authenticate, deploy, push, create triggers, or modify live resources without the corresponding explicit authorization.
- If the interface reports approximately 90% session/context usage, stop new implementation work, preserve the current files, write a Partial `PHASE_4_HANDOFF_TO_CODEX.md` with exact next actions, terminate every subagent/background task, and stop. Do not continue past 92%.

## Required Phase 4 deliverables

1. In-scope application and test edits directly in `outputs/life-dashboard-apps-script/`.
2. A concise operating/configuration document that names the single adapter and distinguishes source settings from secrets.
3. `outputs/life-dashboard-apps-script/PHASE_4_HANDOFF_TO_CODEX.md` containing:
   - status: Complete, Partial, or Blocked;
   - exact Claude model label used;
   - all files read, changed, and created;
   - selected source and why it is permitted;
   - official documentation URLs and terms/access conclusion;
   - authentication method, with no secret values;
   - profile/configuration version and exact hard-filter policy;
   - normalization and identity/hash versions;
   - every configured source, including disabled adapters (normally one enabled and no others);
   - schedule/frequency, batch size, retry/backoff, checkpoint, and lock design;
   - quota and cost estimate with assumptions;
   - exact local commands and outcomes;
   - live tests, real-data proof, source IDs/URLs in redacted form, and duplicate rerun results, or explicit `Not run` entries;
   - failure cases exercised and evidence that existing Jobs were preserved;
   - UI/admin checks and queue-isolation proof;
   - subagents used, scopes/results, and confirmation all stopped;
   - known risks/blockers and user decisions needed;
   - confirmation Phase 5 was not started.

Before finishing, reopen the handoff, verify its heading, size, changed-file list, test totals, live/static labels, and exact final stop statement. Stop every subagent and stop the primary Claude task. Do not begin Phase 5.

**PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
