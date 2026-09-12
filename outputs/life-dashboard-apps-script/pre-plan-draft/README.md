# Life Dashboard — Google Apps Script MVP

A personal dashboard powered by a Google Sheet. The first version includes a task list, a read-only view of upcoming Calendar events, and a fast Jobs module for reviewing an already-prepared, ranked queue.

## Product and architecture decisions

```text
Browser interface
  HTML + CSS + JavaScript
        | google.script.run
Google Apps Script web app
  |            |              |
Google Sheet   Calendar        Scheduled job collector (next phase)
Tasks + Jobs   read-only       discover -> deduplicate -> filter -> score -> Jobs sheet
```

The dashboard reads the `Jobs` sheet and never searches, scrapes, or runs AI merely because someone scrolls. Expensive discovery and scoring are deliberately isolated in a scheduled collector. That keeps the queue instant, predictable, and inexpensive.

## Files

| File | Responsibility |
|---|---|
| `Code.gs` | Web-app entry point and dashboard loader |
| `Database.gs` | Sheet configuration, schema, and safe row helpers |
| `Tasks.gs` | Task creation and completion |
| `Jobs.gs` | Ready-to-go job queue, status changes, collector intake |
| `Calendar.gs` | Upcoming Calendar event read |
| `Index.html`, `Styles.html`, `JavaScript.html` | Interactive front end |

## Setup

1. Create a blank Google Sheet and copy its ID from the URL.
2. Create a standalone Apps Script project at [script.google.com](https://script.google.com), then add these files (or use `clasp` to push this folder).
3. In `Database.gs`, set `CONFIG.SPREADSHEET_ID` to the copied ID.
4. Run `setupLifeDashboard` once and authorize Sheets access. It creates `Tasks`, `Jobs`, and `Settings` headers.
5. Optionally run `seedDemoData` to preview the dashboard with clearly labeled demo jobs.
6. Deploy as **Web app**. Start with access set to **Only myself**. Apps Script will request Calendar permission only when Calendar data is loaded.

## Job data contract

Any job collector can call `upsertDiscoveredJobs(postings)` with plain objects containing `externalId`, `title`, `company`, `location`, `remote`, `salaryMin`, `salaryMax`, `postedAt`, `source`, `url`, and `description`. This function deduplicates before storing records. A later scorer should fill `overall_match`, component scores, `why_matches`, `gaps`, and `recommendation` only for new, pre-filtered records.

## Implementation roadmap

### Phase 1 — functional personal dashboard (included)

- Sheet schema and one-time setup
- Interactive tasks that save to Sheets
- Read-only upcoming Calendar list
- Job cards, filters, direct link-out, and progression from New to Applied

### Phase 2 — job-search engine

- Add a `Profile` settings form for target roles, locations, salary, skills, and deal-breakers.
- Connect only permitted sources/APIs; normalize each result to the job contract.
- Run a time-based trigger every 1–2 hours; use `externalId`/URL to deduplicate.
- Apply deterministic filters first (location, title, salary, experience) and retain a raw discovery log separately if needed.

### Phase 3 — scoring and application workflow

- Score only new surviving postings in small batches. Store structured component scores plus a concise match/gap explanation.
- Add application deadline, contacts, outreach, and interview fields, preferably in a separate `Applications` sheet.
- Add a daily digest and weekly source/conversion analytics.

### Phase 4 — remaining life modules

- Habits, study sessions, finance imports, goals, notes, and widget-level weekly analytics.
- Add modules one at a time; retain the Jobs queue as a fast, independent surface.

## Usage and cost guardrails

- Browsing the stored queue uses no model calls.
- Hard filtering and deduplication should precede AI scoring. Score new qualifying jobs once, then persist the result.
- A reasonable planning target is 40 scored candidates/day at roughly 800–1,200 input plus 100–200 output tokens each: around 36k–56k tokens/day or 252k–392k/week. The actual total depends on job-description length and model.
- OpenAI API use is billed separately from ChatGPT/Codex development limits. Dashboard operation does not use a Codex five-hour or weekly development allowance; only future coding work does.
- Apps Script limits, job-board/API terms, and model pricing can change. Confirm them before enabling a high-frequency collector.

## Before production

Do not place API keys in browser JavaScript or Sheets cells. Store server-side credentials in Apps Script Properties, use authorized APIs rather than prohibited scraping, keep deployment access restricted, and avoid writing personal profile data into public logs.
