# Phase 5 backend residual correction — implementation receipt (B1–B6)

Prepared 2026-09-13 in response to `08_CLAUDE_BACKEND_RESIDUAL_CORRECTION_IMPLEMENTATION.md`, implementing the frozen contract in `CLAUDE_RESIDUAL_CORRECTION_REVIEW_RETURN.md`. `07_CLAUDE_BACKEND_CORRECTION_ACCEPTANCE_REVIEW.md` is explicitly out of scope for this session — it is reserved for an independent reviewer, and no acceptance decision is self-issued here.

---

## Status: COMPLETE

## 1. Branch, SHA, model, effort

- Integration checkout: `C:\Users\User\Claude Code\life-dashboard-phase5-reconcile-20260912` (git worktree)
- Branch: `codex/phase5-reconcile-20260912`
- Starting HEAD SHA: `595dfbc9e41dee6721503c9606c9d8764cdba29c`
- Implementation SHA: `568ebb1153ec6fa3d85d931235ca6fc44ac694b4` (`fix(scoring): implement B1-B6 residual correction per frozen contract`)
- Test-coverage-gap follow-up SHA: `7434789` (`test(scoring): add explicit negative thoughtsTokenCount case for B6` — adds the literal B6 canonical case, `thoughtsTokenCount: -100`, that the implementation commit's tests did not individually exercise; no implementation change, since the existing guard already covered this input)
- This receipt file is committed separately, after both of the above, in its own `docs(receipt):` commit — consistent with this branch's existing precedent (`595dfbc docs(receipt): ...`).
- Working tree after the receipt commit: clean except the two pre-existing untracked, unignored duplicate artifacts noted in the frozen contract (`outputs - Copy/`, `outputs - Copy.zip`) — neither read, moved, deleted, nor otherwise touched this session.
- Model: Claude Sonnet 5 (`claude-sonnet-5`). Subagents used: **zero**, per standing user preference. No effort-tier control was exposed or invoked in this environment; none is claimed.

## 2. Changed files (exactly these four, all owned by this contract)

| File | Change |
|---|---|
| `outputs/life-dashboard-apps-script/AIProvider_Gemini.gs` (405 lines) | Rewritten: adds `geminiPrepareScoringRequest_` (countTokens + input-limit check, pre-dispatch) and `geminiDispatchScoringRequest_` (generateContent + strict usage validation, post-dispatch), both routed through a single shared `geminiFetch_` fetch call site. Legacy `geminiCallScoringEndpoint_` retained only as a test-only shim, never reachable without a prior reservation in production code paths. |
| `outputs/life-dashboard-apps-script/JobScoring.gs` (866 lines) | Rewritten: reordered `scoreSingleJobInDb_` sequence (cache → budget pre-check → prompt format → prepare/countTokens → reserve → dispatch → reconcile → validate/publish-or-quarantine), single shared ledger aggregator, strict Section-8 schema/grounding validator, named limit/formula constants. |
| `outputs/life-dashboard-apps-script/tests/scoring.test.js` (1545 lines) | Migrated Suites 1–5 for the new dispatch split and strict grounding; added Suite 6 (B1–B6 direct coverage, 21 tests); added Suite 7 (Ledger-edge coverage, 4 permanent behavior tests); T03 replaced with a rejection test. |
| `outputs/life-dashboard-apps-script/tests/static-checks.test.js` (445 lines) | Added standalone `it()` "S8" per the frozen contract §7: asserts every Gemini URL path literal in deployed files resolves to `:generateContent` or `:countTokens`, and no deployed file contains a `key=` query-string auth pattern. **No new `allowedIn` entry added; S5's `expectedAllowedIn` object is unchanged**, as required. |

No other tracked file was modified. `tests/gas-fakes.js` was read only (its `testExportsTrailer` mechanism, confirming which constants are exposed to tests), never edited, per the contract's read-only status for that file.

## 3. Forbidden-surface confirmation

- No live Google/Gemini/JSearch/Sheets/Apps Script/Calendar/Drive calls were made. All test and probe runs used the in-memory `vm`-sandboxed fakes in `tests/gas-fakes.js`.
- No Script Property was changed, no deployment or trigger was created or modified, no email/upload/resume transmission/application submission occurred.
- No API key value was read, displayed, or logged at any point (test fixtures use the literal placeholder strings `'k'` / `'SYNTHETIC_ONLY'`, never a real key).
- No raw provider response, prompt, key, Sheet ID, real job/resume text, or personal data appears in any fixture, log, commit message, or this receipt — all job descriptions and evidence strings used in tests are synthetic (`'IT Help Desk Technician'`, `'Windows systems administrator'`, etc., unchanged in kind from the pre-existing fixture style).
- No push, merge, rebase, force-push, reset, clean, stash, checkout of another branch, or worktree deletion was performed. `git stash` (bare) was never invoked.
- `outputs - Copy/` and `outputs - Copy.zip` were not deleted, relocated, or ignored.
- No UI, draft generation, M6, live scoring, or Phase 6 work was started.
- GPT-6 Astra was not used.

## 4. B1–B6 disposition (implemented exactly as specified in the frozen contract)

| Defect | Fix implemented |
|---|---|
| B1 — Failed reconciliations disappeared from spend | Single shared aggregator (`aggregateLedgerForPeriod_`) counts every reconcile row regardless of status (`Completed` or `Failed`); reservation-vs-reconcile pairing is by `run_id + job_id` across all periods, not just the current month. |
| B2 — Missing/ambiguous usage released a reservation | Pre-dispatch failures (invalid prompt, missing key, `TOKEN_COUNT_UNAVAILABLE`, `INPUT_TOO_LARGE`) now occur **before** any reservation row is created (see reordered sequence, §7 of the contract), so there is nothing to orphan. Every post-dispatch failure reconciles at a conservative or actual charge that the aggregator never hides. |
| B3 — Reservation not a true bound | Replaced the hand-typed `0.006` literal with `SCORING_RESERVATION_COST_UNITS_ = Math.ceil((4096×30 + 2048×250)/1e6)` = 635 units = `SCORING_RESERVATION_COST_USD_ = 0.00635`, derived from named `GEMINI_MAX_INPUT_TOKENS_`/`GEMINI_MAX_OUTPUT_TOKENS_` constants and a real pre-dispatch `countTokens` bound. |
| B4 — Ungrounded evidence validated | Strict deterministic grounding (Section 8): NFKC-normalize + typographic-quote/dash fold + lowercase + collapse whitespace, identically on item and corpus; item must start/end on a letter/digit, have ≥3 word tokens and ≥20 normalized characters, and be an exact substring of the corpus at a word boundary. Any failure rejects the **whole score** (`Quarantined`) — the old "tag `[UNGROUNDED]` but still `Validated`" path is fully removed. |
| B5 — Schema types silently coerced | `validateScoringOutput_` rejects (never coerces/truncates/stringifies/defaults) on: unknown/missing keys, non-integer or out-of-range numeric scores, invalid `recommendation`, non-array or wrong-length `evidence`/`gaps`, non-string/control-character/oversized array elements. |
| B6 — Invalid thought tokens treated as zero | Every *present* token count (including `thoughtsTokenCount`) must be a finite non-negative integer; a present invalid value fails safely (`INVALID_USAGE_DATA`) with the conservative charge retained, never silently coerced to zero. An absent `thoughtsTokenCount` may be treated as 0 only when `totalTokenCount` is present (it already accounts for it). |

## 5. Ledger policy and `totalCallsThisMonth` semantics

- One shared private helper, `aggregateLedgerForPeriod_(rows, yearMonth)`, is the sole aggregation logic used by both `checkAndReserveMonthlyBudgetInDb_` and `getScoringBudgetStatus`.
- Pairing key: `run_id + job_id`. Exactly one reservation + one reconcile for a key → only the reconcile's cost counts, attributed to the reconcile's own period. Reservation with no reconcile yet → the reservation's reserved cost counts in its own period. Orphan reconcile (no matching reservation) → still counts, in its own period. Duplicates sum every row (over-count, never under-count).
- Malformed/negative/non-finite/empty `estimated_cost` on any row blocks dispatch fail-closed.
- Any historical `USAGE_BOUND_EXCEEDED` reconcile anywhere in ledger history blocks all future dispatch until human review.
- `totalCallsThisMonth` = reservation rows in the current period + reconcile rows in the current period with no matching reservation — a count of unique logical attempts, never double-counted. `getScoringBudgetStatus()`'s return shape is unchanged: `{monthlyCeilingUsd, currentSpendUsd, remainingSpendUsd, totalCallsThisMonth, currency}`.

## 6. Bounds, reservation formula, pre/post-dispatch table

- `GEMINI_MAX_INPUT_TOKENS_ = 4096`, `GEMINI_MAX_OUTPUT_TOKENS_ = 2048` (billing/reservation bounds, validated post-dispatch against actual usage).
- Pre-dispatch input refusal margin: 512 tokens (refuse above 4096 − 512 = 3584). Verified at the exact boundary: 3584 accepted, 3585 throws `INPUT_TOO_LARGE` with zero generate calls.
- `SCORING_RESERVATION_COST_USD_ = 0.00635` (635 integer 1e-5-USD units), replacing the undocumented `0.006` literal. Boundary verified: prior spend `$0.99365` + reservation → exactly `$1.00000` (allowed); `$0.99366` + reservation → `$1.00001` (blocked).
- Pre-dispatch failures (invalid prompt/key, `TOKEN_COUNT_UNAVAILABLE`, `INPUT_TOO_LARGE`) write **zero** ledger rows and make **zero** `generateContent` calls.
- Post-dispatch, proven-ambiguous failures (`TIMEOUT`, `NETWORK_ERROR`, `AUTH_ERROR`, `RATE_LIMIT`, `INVALID_ARGUMENT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_ERROR`, outer `MALFORMED_RESPONSE`, `MISSING_USAGE_METADATA`, `INVALID_USAGE_DATA`) reconcile as `Failed` at the **conservative** (reservation-sized) charge.
- Post-dispatch, usage-validated failures (`EMPTY_RESPONSE`, `INCOMPLETE_RESPONSE`, inner `MALFORMED_RESPONSE`, `USAGE_BOUND_EXCEEDED`) reconcile as `Completed` at the **actual** charged tokens; `USAGE_BOUND_EXCEEDED` additionally blocks all future dispatch until human review.
- Schema/grounding rejections (B4/B5) reconcile `Completed` at actual usage (the API call succeeded) and write a `Quarantined` `JobScores` row with the safe `errorCode`, never the raw provider text.

## 7. Schema and grounding rules (Section 8), with limits

- Exact 9-key schema; unknown key → `UNKNOWN_FIELD`; missing key → `MISSING_FIELD`; six numeric fields must be `Number.isInteger` in `[0,100]` (`INVALID_SCORE_RANGE`); `recommendation` must be an accepted enum value (`INVALID_RECOMMENDATION`); `evidence` array length 1–10 (`INVALID_EVIDENCE`), `gaps` array length 0–10 (`INVALID_GAPS`); every element a control-character-free string trimmed to 1–500 chars, rejected (never truncated) if out of bounds; `gaps` items additionally rejected if leading with a formula-trigger character (`=`, `+`, `-`, `@`, tab, CR).
- Evidence grounding: identical normalization (NFKC → typographic-quote/dash fold → lowercase → collapse whitespace) applied to item and corpus (sanitized job description, truncation marker stripped); item must start and end on a letter/digit, have ≥3 word tokens and ≥20 normalized characters, and be an exact substring of the corpus at a word boundary. Any failure rejects the whole score (`EVIDENCE_TOO_SHORT` or `EVIDENCE_UNSUPPORTED`) — no escape-and-publish path remains.
- **Error-code note (disclosed, not a defect):** the frozen contract (line 195) names `EVIDENCE_TOO_SHORT`/`EVIDENCE_UNSUPPORTED` only for the length/token-floor and not-found-in-corpus cases; it enumerates no separate code for the begin/end-on-letter-digit rule (line 192). The implementation returns `EVIDENCE_TOO_SHORT` for a begin/end-on-letter-digit failure too, sharing the same `return` branch as the length/token-floor check (see `JobScoring.gs` lines 548–561). This means a formula-leading item that is otherwise long enough (e.g. T03's fixture, 58 chars / 8 word tokens) is quarantined as `EVIDENCE_TOO_SHORT` rather than a more literally-named code — the rejection itself is correct and contract-required (line 192), only the code label is reused. Since the contract defines no dedicated code for this branch, no new code was invented; this is called out here for the independent 07 reviewer rather than left for them to discover.
- `escapeSheetFormula_` is retained at write time as defense-in-depth only; under this contract it never has live work to do for evidence/gaps, since formula-leading text is rejected upstream. This is directly exercised by the corrected T03/T03b tests (Section 8 below).

## 8. Tests — exact totals

- `node --test tests/scoring.test.js`: **53 pass / 0 fail** (9 suites; Suite 6 "Residual correction B1-B6" with 21 tests, and Suite 7 "Ledger-edge test suite" with 4 tests covering duplicate reservations, duplicate reconciles, absent/invalid date fallback, and cross-period pairing).
- `node --test tests/static-checks.test.js`: **323 pass / 0 fail**, including new **S8** and unchanged **S1–S7** (confirmed `expectedAllowedIn` still has exactly its original 4 entries).
- `node --test "tests/*.test.js"` (full repo suite): **598 pass / 0 fail** across 63 suites.
- **Coverage follow-up (SHA `7434789`, test-only):** an advisor review after the implementation commit noted the contract's canonical B6 example (`thoughtsTokenCount: -100`, contract lines 65/159) was not individually exercised — existing tests covered a negative `promptTokenCount` (T25) and a *fractional* `thoughtsTokenCount`, but not a *negative* `thoughtsTokenCount` specifically. Added one Suite 6 test for exactly that input; confirmed `INVALID_USAGE_DATA` + conservative charge, no implementation change required (the guard at `AIProvider_Gemini.gs` lines 316–322 already covered it).
- **Ledger-edge coverage follow-up (Assignment 09, test-only):** Added Suite 7 with 4 permanent behavior tests:
  1. `Test 1: duplicate reservation rows are not collapsed into one low-cost attempt and block at ceiling` (proves `k>1` triggers `agg.anomaly=true`, sums all reservations, and blocks dispatch at monthly ceiling).
  2. `Test 2: duplicate reconciliation rows do not hide either recorded charge and are conservatively summed` (proves `m>1` triggers `agg.anomaly=true`, sums all reconciles into `currentSpendUsd`, and never reduces to a single row).
  3. `Test 3: invalid or absent date does not vanish from current period, ensuring conservative accounting and preventing budget bypass` (proves `ledgerRowPeriod_` attributes absent/invalid timestamps to target period, preventing budget bypass).
  4. `Test 4: cross-period pairing attributes cost to reconciliation period while preserving attempt count in reservation period` (proves cross-month reservation+reconcile pair attributes cost only to reconciliation period, preserving attempt count in reservation period with zero double-counting).
- **T03 correction (important; documented because a prior attempt in this session got this wrong before self-correcting):** the frozen contract (§8, line: *"An evidence item must begin and end with a letter or digit... this also incidentally blocks formula-leading text as a second layer"*) requires evidence items to be rejected outright when formula-leading, even if verbatim-grounded. T03 is now a rejection test (`EVIDENCE_TOO_SHORT`), and a new T03b asserts the equivalent rejection for a formula-leading `gaps` item (`INVALID_GAPS`) — replacing the old "escaped and published" behavior per contract §9, item 14.

## 9. Static/network proof, diff check, privacy audit

- `git diff --check` on the 4 changed files: clean (only CRLF/LF line-ending warnings, exit 0 — no trailing-whitespace or conflict-marker errors).
- Scoped diff (`git diff --numstat` against starting SHA `595dfbc9e41dee6721503c9606c9d8764cdba29c`, cumulative through the coverage-follow-up SHA `7434789`): `AIProvider_Gemini.gs` +269/−83, `JobScoring.gs` +392/−128, `tests/scoring.test.js` +477/−84, `tests/static-checks.test.js` +25/−0. Total: 1163 insertions, 295 deletions across the 4 files.
- Count-only privacy scan across the 4 changed files: zero `AIza`/`sk-`-style secret literal patterns; the only 3 occurrences of the substring `key=` are the S8 test's own name/regex/assertion-message text (not a live query-string usage); no long-alphanumeric literal resembling a real Sheet ID (all matches over 30 chars are internal identifier/constant names); Gemini/JSearch auth confirmed header-only (`x-goog-api-key`) in source, never a URL query parameter.
- `phase5-acceptance-probes.cjs` (relay folder, diagnostic-only, **not modified**) was re-run read-only against this branch: its first probe (B1: orphan-reservation / $0-spend-after-Failed-reconcile) now throws (`Cannot read properties of undefined (reading 'status')`) before reaching its original assertion, because no `AIUsage` reconcile row with `operation:'reconcile'` and the pre-fix `Failed`-but-hidden shape exists anymore under the corrected sequence — i.e. the defect the probe targets is confirmed no longer reproducible. This is the expected post-fix outcome per the task instructions, not a new defect.

## 10. Live actions taken this session

**All: Not run.** No live Google/Gemini/JSearch/Sheets/Apps Script/Calendar/Drive call, key setup, Script Property change, deployment, trigger, email, upload, resume transmission, or application submission occurred at any point.

## 11. Residual risks (carried forward, unresolved by design — live-gate items)

- **Pricing/API facts refresh:** the $0.30/$2.50 per-million-token Gemini 2.5 Flash pricing and the `x-goog-api-key` header-auth mechanism were confirmed against `ai.google.dev` documentation as of 2026-09-13 by the prior review session, not independently re-verified live in this implementation session. Re-check before any live activation.
- **`countTokens` billing status is unverified.** The Developer API pricing page is silent on it; a separate "no charge" statement in Google's Cloud Agent Platform docs appears to describe Vertex/Cloud usage, not `generativelanguage.googleapis.com`. The reservation formula has no `countTokens` cost term; if a live check later shows it is billed, the formula needs a term added before activation.
- **`finishReason` presence behavior is unverified live.** The implementation treats `finishReason` as significant only when present and not `STOP` (a proto3 zero-valued `FINISH_REASON_UNSPECIFIED` may be legitimately omitted). This has not been confirmed against a live response and should be re-verified before activation.

## 12. Explicitly not started

UI, draft generation, M6, live scoring, deploy, triggers, push, merge, application submission, and Phase 6 were not started. `07_CLAUDE_BACKEND_CORRECTION_ACCEPTANCE_REVIEW.md` remains for an independent reviewer; no acceptance decision was self-issued by this session.

---

PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.
