'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadAppsScriptContext_,
  hostify_
} = require('./gas-fakes.js');

const ALL_DEPLOYED_GS = [
  'Code.gs', 'Database.gs', 'Tasks.gs', 'Calendar.gs', 'Jobs.gs',
  'JobProfile.gs', 'JobSource_JSearch.gs', 'JobFilters.gs', 'JobDedupe.gs', 'Discovery.gs',
  'Applications.gs', 'AIProvider_Gemini.gs', 'JobScoring.gs'
];

function createMockGeminiResponse(scoreData, usageData) {
  const score = Object.assign({
    skills_match: 85,
    experience_match: 80,
    education_match: 75,
    location_match: 90,
    salary_match: 85,
    overall_match: 84, // Will be overridden by weighted sum
    recommendation: 'Strong Match',
    // Verbatim substrings of the sample job description (see insertSampleJob)
    // so the default fixture passes strict evidence grounding.
    evidence: ['IT Help Desk Technician skilled in Windows 11', 'Active Directory, and customer troubleshooting'],
    gaps: ['Requires macOS support experience which is unconfirmed']
  }, scoreData || {});

  const usage = Object.assign({
    promptTokenCount: 520,
    candidatesTokenCount: 140,
    totalTokenCount: 660
  }, usageData || {});

  return {
    code: 200,
    body: JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: JSON.stringify(score) }
            ]
          }
        }
      ],
      usageMetadata: usage
    })
  };
}

/**
 * Fake response for the mandatory pre-dispatch countTokens call. Every
 * non-cached scoring attempt now makes exactly one of these before the
 * generateContent call (see AIProvider_Gemini.gs geminiPrepareScoringRequest_).
 */
function createCountTokensResponse(totalTokens) {
  return {
    code: 200,
    body: JSON.stringify({ totalTokens: (typeof totalTokens === 'number') ? totalTokens : 650 })
  };
}

function initializedSheets_(schema) {
  const sheets = {};
  Object.keys(schema).forEach((name) => {
    sheets[name] = { header: schema[name].slice(), rows: [] };
  });
  return sheets;
}

function createContext(overrides) {
  overrides = overrides || {};
  const scriptProps = Object.assign({
    DATABASE_SHEET_ID: 'FAKE_SHEET_ID',
    GEMINI_API_KEY: 'test_gemini_api_key_12345'
  }, overrides.scriptProperties || {});

  if (overrides.omitKey) {
    delete scriptProps.GEMINI_API_KEY;
  }

  // Pre-load schema to format initial sheets correctly
  const tempCtx = loadAppsScriptContext_({ files: ['Database.gs'] });
  const schema = tempCtx.testExports.SCHEMA;
  const initialSheets = overrides.initialSheets || initializedSheets_(schema);

  return loadAppsScriptContext_({
    files: ALL_DEPLOYED_GS,
    scriptProperties: scriptProps,
    initialSheets: initialSheets,
    urlFetch: overrides.urlFetch || { responses: [] },
    fakeClock: overrides.fakeClock
  });
}

function insertSampleJob(ctx, overrides) {
  const ss = ctx.sandbox.getDb_();
  const job = Object.assign({
    external_id: 'ext-test-1',
    source: 'jsearch',
    url: 'https://example.org/job-1',
    title: 'Help Desk Technician',
    company: 'Acme Corp',
    location: 'Pittsburgh, PA',
    remote: false,
    salary_min: 50000,
    salary_max: 60000,
    currency: 'USD',
    posted_at: '2026-09-10T00:00:00Z',
    discovered_at: '2026-09-11T00:00:00Z',
    last_seen_at: '2026-09-11T00:00:00Z',
    description: 'We are seeking an IT Help Desk Technician skilled in Windows 11, Active Directory, and customer troubleshooting.',
    skills_match: '',
    experience_match: '',
    location_match: '',
    salary_match: '',
    overall_match: '',
    recommendation: '',
    why_matches: '',
    gaps: '',
    status: 'New',
    saved_at: '',
    notes: '',
    record_version: 1
  }, overrides || {});

  return ctx.sandbox.appendRecordInDb_(ss, 'Jobs', job);
}

describe('Phase 5 Milestone 2: AI Scoring & Evidence Ledger', () => {

  describe('Suite 1: Configuration & Structured Gemini Call', () => {
    it('T01: missing GEMINI_API_KEY throws MISSING_API_KEY and makes 0 fetch calls', () => {
      const ctx = createContext({ omitKey: true });
      insertSampleJob(ctx);

      assert.throws(() => {
        ctx.sandbox.geminiCallScoringEndpoint_('test prompt');
      }, (err) => {
        return err.code === 'MISSING_API_KEY';
      });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(ctx.urlFetch.calls.length, 0, 'Must make zero outbound calls if key is missing');
    });

    it('T02: valid Gemini 2.5 Flash response publishes score, creates JobScores record, and updates Jobs table', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), mockResponse] }
      });
      const job = insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.scored, 1);
      assert.equal(summary.attempted, 1);

      // Each non-cached attempt makes a countTokens call, then a generateContent call.
      assert.equal(ctx.urlFetch.calls.length, 2);
      const countCall = ctx.urlFetch.calls[0];
      assert.equal(countCall.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:countTokens');
      const call = ctx.urlFetch.calls[1];
      assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      assert.equal(call.params.headers['x-goog-api-key'], 'test_gemini_api_key_12345');

      // Verify JobScores record
      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores.length, 1);
      assert.equal(scores[0].job_id, job.id);
      assert.equal(scores[0].status, 'Validated');
      assert.equal(scores[0].overall_match, 84); // 85*0.35 + 80*0.25 + 75*0.10 + 90*0.15 + 85*0.15 = 83.5 -> 84
      assert.equal(scores[0].recommendation, 'Strong Match');
      assert.equal(scores[0].input_tokens, 520);
      assert.equal(scores[0].output_tokens, 140);
      assert.ok(scores[0].estimated_cost > 0);

      // Verify Jobs table update
      const jobs = ctx.sandbox.readRows_(ss, 'Jobs');
      assert.equal(jobs[0].overall_match, 84);
      assert.equal(jobs[0].recommendation, 'Strong Match');
      assert.ok(jobs[0].why_matches.includes('Active Directory'));

      // Verify AIUsage record (reservation + reconcile)
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage.length, 2);
      assert.equal(usage[0].status, 'Reserved');
      assert.equal(usage[1].job_id, job.id);
      assert.equal(usage[1].status, 'Completed');
      assert.equal(usage[1].input_tokens, 520);
      assert.equal(usage[1].output_tokens, 140);
      assert.equal(usage[1].operation, 'reconcile');
    });

    it('T03: a formula-trigger character leading an evidence item is rejected outright, not escaped-and-published', () => {
      // Per Section 8, every evidence item must begin and end with a
      // letter/digit; this incidentally blocks formula-leading text as a
      // second layer even when the text is a verbatim (grounded) substring
      // of the job description. There is no escape-and-publish path left —
      // the whole score is rejected (Quarantined) instead.
      const injectedDescription = 'The compensation is =HYPERLINK(evil) for this Windows systems administrator role requiring Active Directory expertise.';
      const maliciousResponse = createMockGeminiResponse({
        evidence: ['=HYPERLINK(evil) for this Windows systems administrator role']
      });
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), maliciousResponse] }
      });
      insertSampleJob(ctx, { description: injectedDescription });

      ctx.sandbox.scorePendingJobs(1);

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'EVIDENCE_TOO_SHORT');
      assert.equal(scores[0].evidence_json, '');
    });

    it('T03b: a formula-trigger character leading a gaps item is rejected outright (INVALID_GAPS)', () => {
      const maliciousResponse = createMockGeminiResponse({
        gaps: ['=cmd|/c calc unconfirmed']
      });
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), maliciousResponse] }
      });
      insertSampleJob(ctx);

      ctx.sandbox.scorePendingJobs(1);

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_GAPS');
    });

    it('T04: prompt minimization excludes candidate PII and transmits only approved profile fields', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), mockResponse] }
      });
      insertSampleJob(ctx);

      ctx.sandbox.scorePendingJobs(1);

      // Index 1: the generateContent call (index 0 is countTokens).
      const payload = JSON.parse(ctx.urlFetch.calls[1].params.payload);
      const promptText = payload.contents[0].parts[0].text;

      // PII checks
      assert.equal(/john|jane|bauer|smith|doe/i.test(promptText), false, 'Prompt must not contain candidate name');
      assert.equal(/@.*\.com/i.test(promptText), false, 'Prompt must not contain personal email address');
      assert.equal(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(promptText), false, 'Prompt must not contain phone number');

      // Approved fields present
      assert.ok(promptText.includes('TARGET CANDIDATE PROFILE:'), 'Target candidate profile must be labeled');
      assert.ok(promptText.includes('<untrusted_job_description>'), 'Job description must be wrapped in untrusted boundary');
      assert.ok(promptText.includes('SECURITY POLICY:'), 'Prompt must declare security policy against overrides');
    });
  });

  describe('Suite 2: Caching & Deduplication', () => {
    it('T05: rescoring unchanged job returns cached status with zero new UrlFetchApp calls', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), mockResponse] }
      });
      insertSampleJob(ctx);

      // First run: calls API (countTokens + generateContent)
      const res1 = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(res1.scored, 1);
      assert.equal(ctx.urlFetch.calls.length, 2);

      // Second run: should be cached
      const res2 = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(res2.attempted, 0, 'No unscored jobs remaining');
      assert.equal(ctx.urlFetch.calls.length, 2, 'UrlFetchApp must not be called again');
    });

    it('T06: changed job description creates new cache entry and triggers rescoring', () => {
      const mockResponse1 = createMockGeminiResponse({ overall_match: 75 });
      // Evidence must be grounded against the UPDATED description below.
      const mockResponse2 = createMockGeminiResponse({
        overall_match: 92, recommendation: 'Strong Match',
        evidence: ['requiring specialized cloud certifications and Kubernetes']
      });
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), mockResponse1, createCountTokensResponse(), mockResponse2] }
      });
      const job = insertSampleJob(ctx);

      // First run
      ctx.sandbox.scorePendingJobs(1);
      assert.equal(ctx.urlFetch.calls.length, 2);

      // Update description and clear overall_match to simulate materially changed job
      const ss = ctx.sandbox.getDb_();
      ctx.sandbox.updateRecordByIdInDb_(ss, 'Jobs', job.id, {
        description: 'Updated description requiring specialized cloud certifications and Kubernetes.',
        overall_match: ''
      });

      // Second run
      const res2 = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(res2.scored, 1);
      assert.equal(ctx.urlFetch.calls.length, 4, 'New countTokens + generateContent pair must be made for changed description');

      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores.length, 2, 'Two distinct score records must exist in JobScores');
    });
  });

  describe('Suite 3: Hard Spending Ceilings & Budget Enforcement', () => {
    it('T07: budget boundary - reservation allowed at exactly $1.00 total, blocked one unit over', () => {
      // Case A: prior spend $0.99365 + reservation $0.00635 = $1.00000 exactly -> allowed.
      const ctxA = createContext();
      const ssA = ctxA.sandbox.getDb_();
      ctxA.sandbox.appendRecordInDb_(ssA, 'AIUsage', {
        run_id: 'prior_run_a', job_id: 'prior_job_a', provider: 'Google Gemini', model: 'gemini-2.5-flash',
        operation: 'reconcile', profile_version: '1.0.0', prompt_version: '1.0.0',
        request_started_at: new Date(), request_finished_at: new Date(),
        input_tokens: 1000, output_tokens: 1000, estimated_cost: 0.99365, currency: 'USD',
        status: 'Completed', error_code: ''
      });
      assert.doesNotThrow(() => {
        ctxA.sandbox.checkAndReserveMonthlyBudgetInDb_(ssA, 'job_a', 'run_a', '1.0.0');
      }, 'Exactly at the $1.00 ceiling must be allowed, not treated as exceeding it');

      // Case B: prior spend $0.99366 + reservation $0.00635 = $1.00001 -> blocked, zero network calls.
      const ctxB = createContext();
      const ssB = ctxB.sandbox.getDb_();
      ctxB.sandbox.appendRecordInDb_(ssB, 'AIUsage', {
        run_id: 'prior_run_b', job_id: 'prior_job_b', provider: 'Google Gemini', model: 'gemini-2.5-flash',
        operation: 'reconcile', profile_version: '1.0.0', prompt_version: '1.0.0',
        request_started_at: new Date(), request_finished_at: new Date(),
        input_tokens: 1000, output_tokens: 1000, estimated_cost: 0.99366, currency: 'USD',
        status: 'Completed', error_code: ''
      });
      insertSampleJob(ctxB);
      const summary = hostify_(ctxB.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'BUDGET_EXCEEDED');
      assert.equal(ctxB.urlFetch.calls.length, 0, 'Zero network calls must be made when budget is exceeded');
    });

    it('T08: getScoringBudgetStatus accurately reports monthly spend and remaining budget', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();

      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: 'prior_run',
        job_id: 'prior_job',
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: new Date(),
        request_finished_at: new Date(),
        input_tokens: 1000000,
        output_tokens: 100000,
        estimated_cost: 0.105,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      const status = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(status.monthlyCeilingUsd, 1.00);
      assert.equal(status.currentSpendUsd, 0.105);
      assert.equal(status.remainingSpendUsd, 0.895);
      assert.equal(status.currency, 'USD');
      assert.equal(status.totalCallsThisMonth, 1);
    });
  });

  describe('Suite 4: Validation, Quarantine & Provider Errors', () => {
    it('T09: out-of-range numeric score is quarantined and not published to Jobs', () => {
      const invalidScoreResponse = createMockGeminiResponse({
        skills_match: 150 // Invalid: exceeds 100
      });
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), invalidScoreResponse] }
      });
      const job = insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.quarantined, 1);

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores.length, 1);
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_SCORE_RANGE');

      // Verify Jobs table overall_match was NOT updated
      const jobs = ctx.sandbox.readRows_(ss, 'Jobs');
      assert.equal(jobs[0].overall_match, '');
    });

    it('T10: invalid recommendation category is quarantined', () => {
      const invalidRecResponse = createMockGeminiResponse({
        recommendation: 'Guaranteed Offer' // Not in closed enum
      });
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), invalidRecResponse] }
      });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.quarantined, 1);

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_RECOMMENDATION');
    });

    it('T11: HTTP 503 Provider Unavailable records Failed in AIUsage and throws PROVIDER_UNAVAILABLE', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [
            createCountTokensResponse(),
            { code: 503, body: 'Service Unavailable' }
          ]
        }
      });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);

      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      // Reservation + Reconcile = 2 rows
      assert.equal(usage.length, 2);
      assert.equal(usage[1].status, 'Failed');
      assert.equal(usage[1].error_code, 'PROVIDER_UNAVAILABLE');
    });
  });

  describe('Suite 5: Zero-Cost Ordinary Dashboard Operations', () => {
    it('T12: getJobsQueue and getJobHistory make zero calls to UrlFetchApp', () => {
      const ctx = createContext();
      insertSampleJob(ctx);

      // Browse jobs queue
      const queue = hostify_(ctx.sandbox.getJobsQueue());
      assert.ok(Array.isArray(queue.activeJobs));

      // Fetch history
      const history = hostify_(ctx.sandbox.getJobHistory(queue.activeJobs[0].id));
      assert.ok(Array.isArray(history.entries));

      // Assert 0 network calls
      assert.equal(ctx.urlFetch.calls.length, 0, 'Browsing queue and history must never invoke UrlFetchApp');
    });
  });

  describe('Phase 5 Milestone 2 - R1-R6, F7, F9, F10 Repairs', () => {
    it('T13: R1 corrected - unknown key is rejected before grounding is even considered', () => {
      const mockResponse = createMockGeminiResponse({
        evidence: ['Has CCNA certification'], // not in desc, and there's also an unknown key
        extra_key: 123
      });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx, { description: 'Needs Windows experience.' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.quarantined, 1);

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'UNKNOWN_FIELD');
    });

    it('T13b: R1 corrected - fabricated (ungrounded) evidence rejects the whole score, never tags-and-publishes', () => {
      const mockResponse2 = createMockGeminiResponse({
        evidence: ['Has CCNA certification']
      });
      const ctx2 = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse2] } });
      insertSampleJob(ctx2, { description: 'Needs Windows experience.' });

      hostify_(ctx2.sandbox.scorePendingJobs(1));
      const ss2 = ctx2.sandbox.getDb_();
      const scores2 = ctx2.sandbox.readRows_(ss2, 'JobScores');
      // Old (buggy) behavior tagged this '[UNGROUNDED]' and still published it as Validated.
      // Corrected behavior rejects the whole score outright.
      assert.equal(scores2[0].status, 'Quarantined');
      assert.equal(scores2[0].error_code, 'EVIDENCE_UNSUPPORTED');
    });

    it('T14: R2 corrected - published overall is deterministic weighted sum, model overall override ignored', () => {
      const mockResponse = createMockGeminiResponse({
        skills_match: 70, experience_match: 70, education_match: 70,
        location_match: 70, salary_match: 70, overall_match: 84
      });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].overall_match, 70); // 70 * weights = 70
    });

    it('T15: R4 corrected - Pricing math at $0.30/$2.50 rates', () => {
      const ctx = createContext();
      // 1,000,000 in = $0.30, 1,000,000 out = $2.50
      const cost = ctx.sandbox.calculateCostUsd_(2000000, 1000000); // 0.60 + 2.50 = 3.10
      assert.equal(cost, 3.10);
    });

    it('T16: R4 corrected - reservation cost equals ceil(worst-case tokens at published rates)', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      const resId = ctx.sandbox.checkAndReserveMonthlyBudgetInDb_(ss, 'job123', 'run123', '1.0.0');
      const rows = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(rows[0].id, resId);
      // ceil((4096*30 + 2048*250) / 1e6) integer 1e-5-USD units = 635 -> $0.00635
      assert.equal(rows[0].estimated_cost, 0.00635);
    });

    it('T17: R5 corrected - Cache lookup with obsolete profile version is not a cache hit', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), mockResponse, createCountTokensResponse(), mockResponse] }
      });
      const job = insertSampleJob(ctx);

      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      // change profile version of the existing score
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      ctx.sandbox.updateRecordByIdInDb_(ss, 'JobScores', scores[0].id, { profile_version: '0.9.0' });
      // clear jobs overall_match
      ctx.sandbox.updateRecordByIdInDb_(ss, 'Jobs', job.id, { overall_match: '' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.scored, 1);
      assert.equal(summary.cached, 0);
      assert.equal(ctx.urlFetch.calls.length, 4);
    });

    it('T18: R5 corrected - Cache lookup matching ALL fields is a cache hit', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), mockResponse] }
      });
      const job = insertSampleJob(ctx);

      hostify_(ctx.sandbox.scorePendingJobs(1));
      ctx.sandbox.updateRecordByIdInDb_(ctx.sandbox.getDb_(), 'Jobs', job.id, { overall_match: '' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.cached, 1);
      assert.equal(ctx.urlFetch.calls.length, 2, 'no new call on a cache hit');
    });

    it('T19: R6 corrected - formatScoringPrompt_ with actual JOB_PROFILE_', () => {
      const ctx = createContext();
      const job = { description: 'test desc' };
      const profile = {
        configVersion: 2,
        priorities: {
          p1: { titleTerms: ['Help Desk'] },
          p2: { titleTerms: [] },
          p3: { titleTerms: [] }
        },
        requiredSkills: ['Windows', 'Mac'],
        optionalSkills: ['Linux'],
        compensation: { minHourlyUsd: 20, minAnnualUsd: 40000 },
        workMode: { remotePreferred: true }
      };
      const prompt = ctx.sandbox.formatScoringPrompt_(job, profile);
      assert.ok(prompt.includes('Target Titles: Help Desk'));
      assert.ok(prompt.includes('Required: Windows, Mac'));
      assert.ok(prompt.includes('Optional: Linux'));
      assert.ok(prompt.includes('Min Hourly: $20 / Min Annual: $40000'));
      assert.ok(prompt.includes('Remote preferred'));
    });

    it('T20: R6 corrected - formatScoringPrompt_ with missing profile fields throws INVALID_PROFILE', () => {
      const ctx = createContext();
      const job = { description: 'test desc' };
      assert.throws(() => {
        ctx.sandbox.formatScoringPrompt_(job, {});
      }, err => err.code === 'INVALID_PROFILE');
    });

    it('T21: F7 corrected - scorePendingJobs with changed description is eligible for rescore', () => {
      const mockResponse1 = createMockGeminiResponse({ overall_match: 50 });
      // Evidence must be grounded against the UPDATED description below.
      const mockResponse2 = createMockGeminiResponse({ overall_match: 99, evidence: ['Completely different description'] });
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), mockResponse1, createCountTokensResponse(), mockResponse2] }
      });
      const job = insertSampleJob(ctx);

      hostify_(ctx.sandbox.scorePendingJobs(1));

      // change description, keep overall_match
      const ss = ctx.sandbox.getDb_();
      ctx.sandbox.updateRecordByIdInDb_(ss, 'Jobs', job.id, { description: 'Completely different description' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.scored, 1);
      assert.equal(ctx.urlFetch.calls.length, 4);
    });

    it('T22: F9 corrected - reconcileUsageInDb_ appends a new row instead of mutating reservation', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      const resId = ctx.sandbox.checkAndReserveMonthlyBudgetInDb_(ss, 'job123', 'run123', '1.0.0');

      const before = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(before.length, 1);
      assert.equal(before[0].status, 'Reserved');

      ctx.sandbox.reconcileUsageInDb_(ss, resId, 100, 50, 'Completed', '');

      const after = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(after.length, 2);
      assert.equal(after[0].id, resId); // reservation
      assert.equal(after[0].status, 'Reserved');
      assert.equal(after[1].status, 'Completed');
      assert.equal(after[1].operation, 'reconcile');
    });

    it('T23: F10 corrected - Budget period uses America/New_York', () => {
      const ctx = createContext();
      // Ensure getNewYorkYearMonth_ matches format yyyy-MM
      const ym = ctx.sandbox.getNewYorkYearMonth_(new Date('2026-01-01T02:00:00Z')); // Jan 1st 2am UTC is Dec 31st 9pm EST
      assert.equal(ym, '2025-12');
    });

    it('T24: Post-dispatch failure preserves cost and the aggregator counts the pair exactly once', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      const resId = ctx.sandbox.checkAndReserveMonthlyBudgetInDb_(ss, 'job123', 'run123', '1.0.0');

      ctx.sandbox.reconcileUsageInDb_(ss, resId, 1000, 500, 'Failed', 'API_ERROR');

      const after = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(after[1].status, 'Failed');
      assert.equal(after[1].input_tokens, 1000);
      assert.equal(after[1].output_tokens, 500);
      assert.ok(after[1].estimated_cost > 0);

      const status = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(status.totalCallsThisMonth, 1, 'A reservation+reconcile pair counts as exactly one call');
      assert.ok(Math.abs(status.currentSpendUsd - after[1].estimated_cost) < 1e-9,
        'Only the reconcile cost is counted once resolved, not the reservation placeholder as well');
    });

    it('T25: R3 corrected - missing usageMetadata throws MISSING_USAGE_METADATA and invalid tokens throw INVALID_USAGE_DATA', () => {
      // 1. Missing usageMetadata
      const ctx1 = createContext({
        urlFetch: {
          responses: [{
            code: 200,
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 70 }) }] } }]
            })
          }]
        }
      });
      assert.throws(() => {
        ctx1.sandbox.geminiCallScoringEndpoint_('Test prompt');
      }, (err) => {
        return err.code === 'MISSING_USAGE_METADATA';
      });

      // 2. Invalid negative token counts
      const ctx2 = createContext({
        urlFetch: {
          responses: [{
            code: 200,
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 70 }) }] } }],
              usageMetadata: { promptTokenCount: -5, candidatesTokenCount: 10, totalTokenCount: 5 }
            })
          }]
        }
      });
      assert.throws(() => {
        ctx2.sandbox.geminiCallScoringEndpoint_('Test prompt');
      }, (err) => {
        return err.code === 'INVALID_USAGE_DATA';
      });
    });

    it('T26: R3 corrected - thoughtsTokenCount is parsed and added to outputTokens', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [{
            code: 200,
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 80 }) }] } }],
              usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 150, thoughtsTokenCount: 300, totalTokenCount: 950 }
            })
          }]
        }
      });
      const res = ctx.sandbox.geminiCallScoringEndpoint_('Test prompt');
      assert.equal(res.inputTokens, 500);
      assert.equal(res.outputTokens, 450); // totalTokenCount(950) - promptTokenCount(500)
    });
  });

  describe('Suite 6: Residual correction B1-B6 — orphan reservations, ledger integrity, strict grounding', () => {
    it('B1/B2: a pre-dispatch countTokens failure creates zero AIUsage rows (no orphan reservation)', () => {
      const ctx = createContext({ urlFetch: { responses: [{ code: 500, body: 'error' }] } });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'TOKEN_COUNT_UNAVAILABLE');
      assert.equal(ctx.urlFetch.calls.length, 1, 'Only the failed countTokens call is attempted, never generateContent');

      const ss = ctx.sandbox.getDb_();
      assert.equal(ctx.sandbox.readRows_(ss, 'AIUsage').length, 0, 'A pre-dispatch failure must never leave an orphaned reservation');
    });

    it('B1/B2: an INPUT_TOO_LARGE rejection also creates zero AIUsage rows and does not stop the run', () => {
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(3585)] } });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.notEqual(summary.stoppedReason, 'INPUT_TOO_LARGE', 'A single oversized job must not halt the whole run');

      const ss = ctx.sandbox.getDb_();
      assert.equal(ctx.sandbox.readRows_(ss, 'AIUsage').length, 0);
    });

    it('Boundary: countTokens exactly at the input-limit margin (3584) is accepted', () => {
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(3584)] } });
      const prepared = ctx.sandbox.geminiPrepareScoringRequest_('some prompt text');
      assert.equal(prepared.countedTokens, 3584);
    });

    it('Boundary: countTokens one token over the margin (3585) throws INPUT_TOO_LARGE', () => {
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(3585)] } });
      assert.throws(() => {
        ctx.sandbox.geminiPrepareScoringRequest_('some prompt text');
      }, err => err.code === 'INPUT_TOO_LARGE');
    });

    it('Conservative charge: a transport timeout charges the full reserved input/output tokens', () => {
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), { throws: 'timeout while connecting' }] }
      });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'TIMEOUT');

      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage.length, 2);
      assert.equal(usage[1].status, 'Failed');
      assert.equal(usage[1].error_code, 'TIMEOUT');
      assert.equal(usage[1].input_tokens, 4096);
      assert.equal(usage[1].output_tokens, 2048);
    });

    it('Conservative charge: missing usageMetadata after a 200 response charges the full reserved tokens', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [createCountTokensResponse(), {
            code: 200,
            body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 70 }) }] } }] })
          }]
        }
      });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);

      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage[1].error_code, 'MISSING_USAGE_METADATA');
      assert.equal(usage[1].input_tokens, 4096);
      assert.equal(usage[1].output_tokens, 2048);
    });

    it('Dispatch usage exceeding the bound throws USAGE_BOUND_EXCEEDED and charges the actual (validated) tokens', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [createCountTokensResponse(3000), {
            code: 200,
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 70 }) }] } }],
              usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 100, totalTokenCount: 5100 }
            })
          }]
        }
      });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'USAGE_BOUND_EXCEEDED');

      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage[1].error_code, 'USAGE_BOUND_EXCEEDED');
      assert.equal(usage[1].input_tokens, 5000, 'Actual charged tokens are used once usage has been validated');
      assert.equal(usage[1].output_tokens, 100);
    });

    it('A historical USAGE_BOUND_EXCEEDED reconcile blocks all future dispatch (ledger integrity)', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: 'hist_run', job_id: 'hist_job', provider: 'Google Gemini', model: 'gemini-2.5-flash',
        operation: 'reconcile', profile_version: '1.0.0', prompt_version: '1.0.0',
        request_started_at: new Date(), request_finished_at: new Date(),
        input_tokens: 4096, output_tokens: 2048, estimated_cost: 0.00635, currency: 'USD',
        status: 'Failed', error_code: 'USAGE_BOUND_EXCEEDED'
      });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'LEDGER_INTEGRITY_BLOCKED');
      assert.equal(ctx.urlFetch.calls.length, 0, 'Blocked before any network call once ledger integrity is compromised');

      const status = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(status.remainingSpendUsd, 0, 'A blocked ledger reports zero remaining spend');
    });

    it('Aggregator: an orphan reconcile with no matching reservation still counts toward spend', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: 'orphan_run', job_id: 'orphan_job', provider: 'Google Gemini', model: 'gemini-2.5-flash',
        operation: 'reconcile', profile_version: '1.0.0', prompt_version: '1.0.0',
        request_started_at: new Date(), request_finished_at: new Date(),
        input_tokens: 1000, output_tokens: 500, estimated_cost: 0.00155, currency: 'USD',
        status: 'Completed', error_code: ''
      });
      const status = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.ok(status.currentSpendUsd > 0, 'An orphan reconcile row must not be silently dropped from spend');
      assert.equal(status.totalCallsThisMonth, 1);
    });

    it('Aggregator: a negative estimated_cost on a ledger row blocks further dispatch fail-closed', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: 'bad_run', job_id: 'bad_job', provider: 'Google Gemini', model: 'gemini-2.5-flash',
        operation: 'reconcile', profile_version: '1.0.0', prompt_version: '1.0.0',
        request_started_at: new Date(), request_finished_at: new Date(),
        input_tokens: 100, output_tokens: 50, estimated_cost: -0.5, currency: 'USD',
        status: 'Completed', error_code: ''
      });
      insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(ctx.urlFetch.calls.length, 0, 'Malformed ledger data blocks dispatch before any network call');
    });

    it('finishReason other than STOP is rejected as INCOMPLETE_RESPONSE with the actual validated tokens charged', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [createCountTokensResponse(), {
            code: 200,
            body: JSON.stringify({
              candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"skills_match":70' }] } }],
              usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100, totalTokenCount: 600 }
            })
          }]
        }
      });
      insertSampleJob(ctx);
      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);

      // INCOMPLETE_RESPONSE is thrown by the dispatch step itself (like
      // USAGE_BOUND_EXCEEDED), so it never reaches a JobScores quarantine
      // record — it is recorded as a Failed reconcile in AIUsage instead.
      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage[1].status, 'Failed');
      assert.equal(usage[1].error_code, 'INCOMPLETE_RESPONSE');
      assert.equal(usage[1].input_tokens, 500);
      assert.equal(usage[1].output_tokens, 100);
    });

    it('Fractional thoughtsTokenCount is rejected as INVALID_USAGE_DATA with the conservative charge applied', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [createCountTokensResponse(), {
            code: 200,
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 70 }) }] } }],
              usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100, thoughtsTokenCount: 10.5, totalTokenCount: 610.5 }
            })
          }]
        }
      });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage[1].error_code, 'INVALID_USAGE_DATA');
      assert.equal(usage[1].input_tokens, 4096, 'Conservative charge applies before usage is trusted');
      assert.equal(usage[1].output_tokens, 2048);
    });

    it('B6: a negative thoughtsTokenCount (e.g. -100) is rejected as INVALID_USAGE_DATA, never silently treated as zero', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [createCountTokensResponse(), {
            code: 200,
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 70 }) }] } }],
              usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100, thoughtsTokenCount: -100, totalTokenCount: 500 }
            })
          }]
        }
      });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage[1].status, 'Failed');
      assert.equal(usage[1].error_code, 'INVALID_USAGE_DATA');
      assert.equal(usage[1].input_tokens, 4096, 'Conservative charge applies before usage is trusted');
      assert.equal(usage[1].output_tokens, 2048);
    });

    it('totalTokenCount inconsistent with prompt+candidates+thoughts is rejected as INVALID_USAGE_DATA', () => {
      const ctx = createContext({
        urlFetch: {
          responses: [createCountTokensResponse(), {
            code: 200,
            body: JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ skills_match: 70 }) }] } }],
              usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100, totalTokenCount: 550 }
            })
          }]
        }
      });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const usage = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usage[1].error_code, 'INVALID_USAGE_DATA');
    });

    it('An oversized evidence item is rejected as INVALID_EVIDENCE rather than truncated', () => {
      const longItem = 'Windows '.repeat(80); // > 500 chars
      const mockResponse = createMockGeminiResponse({ evidence: [longItem] });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_EVIDENCE');
    });

    it('A non-string evidence array element is rejected as INVALID_EVIDENCE', () => {
      const mockResponse = createMockGeminiResponse({ evidence: [12345] });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_EVIDENCE');
    });

    it('An evidence item containing a control character is rejected as INVALID_EVIDENCE', () => {
      const mockResponse = createMockGeminiResponse({ evidence: ['Windows 11 experience verified here'] });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_EVIDENCE');
    });

    it('A gap beginning with a formula-trigger character is rejected as INVALID_GAPS even though gaps are not grounded', () => {
      const mockResponse = createMockGeminiResponse({ gaps: ['=HYPERLINK("evil") Windows 11'] });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_GAPS');
    });

    it('A non-integer score is rejected as INVALID_SCORE_RANGE', () => {
      const mockResponse = createMockGeminiResponse({ skills_match: 85.5 });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'INVALID_SCORE_RANGE');
    });

    it('Evidence shorter than the minimum grounding length is rejected as EVIDENCE_TOO_SHORT', () => {
      const mockResponse = createMockGeminiResponse({ evidence: ['Windows 11'] });
      const ctx = createContext({ urlFetch: { responses: [createCountTokensResponse(), mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'EVIDENCE_TOO_SHORT');
    });

    it('scorePendingJobs stops the run on a run-stopping code other than BUDGET_EXCEEDED (e.g. AUTH_ERROR)', () => {
      const ctx = createContext({
        urlFetch: { responses: [createCountTokensResponse(), { code: 401, body: 'unauthorized' }] }
      });
      insertSampleJob(ctx);
      insertSampleJob(ctx, { external_id: 'ext-test-2', url: 'https://example.org/job-2' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(2));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'AUTH_ERROR');
      assert.equal(ctx.urlFetch.calls.length, 2, 'The second candidate must never be attempted after AUTH_ERROR');
    });
  });

  describe('Suite 7: Ledger-edge test suite', () => {
    it('Test 1: duplicate reservation rows are not collapsed into one low-cost attempt and block at ceiling', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      const now = new Date();
      const currentYM = ctx.sandbox.getNewYorkYearMonth_(now);

      // Two 'score_job' reservations for the exact same run_id + job_id.
      // Each reservation is $0.50 USD (50,000 units). Together they sum to $1.00 USD (100,000 units),
      // which equals the monthly budget ceiling.
      const runId = 'dup_run_1';
      const jobId = 'dup_job_1';

      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: runId,
        job_id: jobId,
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'score_job',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: now,
        request_finished_at: '',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost: 0.50,
        currency: 'USD',
        status: 'Reserved',
        error_code: ''
      });

      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: runId,
        job_id: jobId,
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'score_job',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: now,
        request_finished_at: '',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost: 0.50,
        currency: 'USD',
        status: 'Reserved',
        error_code: ''
      });

      // 1. Direct aggregator verification
      const usageRows = ctx.sandbox.readRows_(ss, 'AIUsage');
      const agg = ctx.sandbox.aggregateLedgerForPeriod_(usageRows, currentYM);

      // Prove the aggregator follows its frozen conservative policy:
      // It counts every relevant duplicate row (50,000 + 50,000 = 100,000 units)
      // rather than collapsing into a single low-cost reservation (50,000 units)
      assert.equal(agg.anomaly, true, 'agg.anomaly must be true when duplicate reservation rows exist');
      assert.equal(agg.spendUnits, 100000, 'Duplicate reservation rows must not be collapsed; both must be counted in spend');
      assert.equal(agg.totalCallsThisMonth, 2, 'Both duplicate reservation rows must be counted in totalCallsThisMonth');
      assert.equal(agg.blocked, false, 'Duplicate reservation rows trigger anomaly flag but do not corrupt ledger into hard block');

      // 2. Budget status inspection
      const status = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(status.monthlyCeilingUsd, 1.00);
      assert.equal(status.currentSpendUsd, 1.00, 'Current spend must reflect conservative sum of both duplicate reservations');
      assert.equal(status.remainingSpendUsd, 0, 'Zero remaining spend when conservative total reaches $1.00 ceiling');
      assert.equal(status.totalCallsThisMonth, 2);

      // 3. Prove a later reservation is blocked whenever the conservative total reaches the monthly ceiling
      // If the duplicates had been collapsed into one ($0.50), then $0.50 + $0.00635 = $0.50635 <= $1.00,
      // which would have erroneously succeeded.
      // Because both are counted ($1.00), $1.00 + $0.00635 = $1.00635 > $1.00, so it must throw BUDGET_EXCEEDED.
      assert.throws(() => {
        ctx.sandbox.checkAndReserveMonthlyBudgetInDb_(ss, 'new_job_1', 'new_run_1', '1.0.0');
      }, (err) => {
        assert.equal(err.code, 'BUDGET_EXCEEDED', 'Must throw BUDGET_EXCEEDED when conservative total reaches monthly ceiling');
        return true;
      });

      // 4. Verify higher-level scorePendingJobs also halts with BUDGET_EXCEEDED and 0 network calls
      insertSampleJob(ctx);
      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'BUDGET_EXCEEDED');
      assert.equal(ctx.urlFetch.calls.length, 0, 'Zero network calls must be made when conservative total blocks reservation');
    });

    it('Test 2: duplicate reconciliation rows do not hide either recorded charge and are conservatively summed', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      const now = new Date();
      const currentYM = ctx.sandbox.getNewYorkYearMonth_(now);

      const runId = 'dup_rec_run_1';
      const jobId = 'dup_rec_job_1';

      // Two 'reconcile' rows for the same pairing key (run_id + job_id)
      const cost1Usd = 0.00155; // 155 monetary units
      const cost2Usd = 0.00186; // 186 monetary units
      const cost1Units = ctx.sandbox.usdToMonetaryUnits_(cost1Usd);
      const cost2Units = ctx.sandbox.usdToMonetaryUnits_(cost2Usd);
      const expectedSumUnits = cost1Units + cost2Units; // 341 units
      const expectedSumUsd = expectedSumUnits / 100000; // 0.00341 USD

      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: runId,
        job_id: jobId,
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: now,
        request_finished_at: now,
        input_tokens: 1000,
        output_tokens: 500,
        estimated_cost: cost1Usd,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: runId,
        job_id: jobId,
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: now,
        request_finished_at: now,
        input_tokens: 1200,
        output_tokens: 600,
        estimated_cost: cost2Usd,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      // 1. Direct aggregator verification
      const usageRows = ctx.sandbox.readRows_(ss, 'AIUsage');
      const agg = hostify_(ctx.sandbox.aggregateLedgerForPeriod_(usageRows, currentYM));

      // Prove current-period spend is conservatively summed (both rows included in spendUnits)
      assert.equal(agg.spendUnits, expectedSumUnits, 'spendUnits must include both reconciliation rows');
      assert.notEqual(agg.spendUnits, cost1Units, 'spendUnits must not be silently reduced to row 1');
      assert.notEqual(agg.spendUnits, cost2Units, 'spendUnits must not be silently reduced to row 2');
      assert.ok(agg.spendUnits > cost1Units && agg.spendUnits > cost2Units, 'spendUnits must strictly exceed either individual row charge');

      // Prove agg.anomaly is true
      assert.equal(agg.anomaly, true, 'agg.anomaly must be true when duplicate reconciliation rows exist for the same pairing key');
      assert.equal(agg.blocked, false, 'Duplicate reconciliations without USAGE_BOUND_EXCEEDED do not hard-block dispatch');

      // 2. Budget status inspection (proving currentSpendUsd includes both rows)
      const status = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(status.monthlyCeilingUsd, 1.00);
      assert.equal(status.currentSpendUsd, expectedSumUsd, 'currentSpendUsd must reflect conservative sum of both duplicate reconciliations');
      assert.notEqual(status.currentSpendUsd, cost1Usd, 'currentSpendUsd must not be reduced to row 1');
      assert.notEqual(status.currentSpendUsd, cost2Usd, 'currentSpendUsd must not be reduced to row 2');
      assert.equal(status.remainingSpendUsd, (100000 - expectedSumUnits) / 100000);

      // 3. Prove that when a reservation row is also present with duplicate reconciliations,
      // all entries for the pairing key are conservatively summed and neither charge is hidden.
      const pairedCtx = createContext();
      const ssPaired = pairedCtx.sandbox.getDb_();
      const resCostUsd = 0.00635;
      const resCostUnits = pairedCtx.sandbox.usdToMonetaryUnits_(resCostUsd); // 635 units

      pairedCtx.sandbox.appendRecordInDb_(ssPaired, 'AIUsage', {
        run_id: 'paired_run',
        job_id: 'paired_job',
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'score_job',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: now,
        request_finished_at: '',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost: resCostUsd,
        currency: 'USD',
        status: 'Reserved',
        error_code: ''
      });
      pairedCtx.sandbox.appendRecordInDb_(ssPaired, 'AIUsage', {
        run_id: 'paired_run',
        job_id: 'paired_job',
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: now,
        request_finished_at: now,
        input_tokens: 1000,
        output_tokens: 500,
        estimated_cost: cost1Usd,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });
      pairedCtx.sandbox.appendRecordInDb_(ssPaired, 'AIUsage', {
        run_id: 'paired_run',
        job_id: 'paired_job',
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: now,
        request_finished_at: now,
        input_tokens: 1200,
        output_tokens: 600,
        estimated_cost: cost2Usd,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      const pairedRows = pairedCtx.sandbox.readRows_(ssPaired, 'AIUsage');
      const aggPaired = hostify_(pairedCtx.sandbox.aggregateLedgerForPeriod_(pairedRows, currentYM));
      assert.equal(aggPaired.anomaly, true, 'agg.anomaly must be true for pairing key with duplicate reconciles');
      assert.equal(aggPaired.spendUnits, resCostUnits + expectedSumUnits, 'Reservation plus both reconcile rows must all be summed');
    });

    it('Test 3: invalid or absent date does not vanish from current period, ensuring conservative accounting and preventing budget bypass', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      const now = new Date();
      const currentYM = ctx.sandbox.getNewYorkYearMonth_(now);

      // 1. Direct unit verification of ledgerRowPeriod_ fallback logic
      // Absent dates (empty string, null, undefined) must attribute to targetYearMonth
      assert.equal(
        ctx.sandbox.ledgerRowPeriod_({ request_started_at: '' }, currentYM),
        currentYM,
        'Empty string request_started_at must fall back to targetYearMonth'
      );
      assert.equal(
        ctx.sandbox.ledgerRowPeriod_({ request_started_at: null }, currentYM),
        currentYM,
        'Null request_started_at must fall back to targetYearMonth'
      );
      assert.equal(
        ctx.sandbox.ledgerRowPeriod_({}, currentYM),
        currentYM,
        'Omitted request_started_at must fall back to targetYearMonth'
      );

      // Invalid/unparseable date string must attribute to targetYearMonth
      assert.equal(
        ctx.sandbox.ledgerRowPeriod_({ request_started_at: 'NOT_A_VALID_DATE_STRING' }, currentYM),
        currentYM,
        'Malformed/unparseable date string must fall back to targetYearMonth'
      );

      // In contrast, a valid timestamp belonging to another month must NOT attribute to currentYM
      const otherMonth = currentYM === '2026-08' ? '2026-07' : '2026-08';
      assert.equal(
        ctx.sandbox.ledgerRowPeriod_({ request_started_at: `${otherMonth}-15T12:00:00Z` }, currentYM),
        otherMonth,
        'Valid timestamp from a different period must resolve to its own period, not targetYearMonth'
      );

      // 2. Integration proof: an absent date row does not vanish and is included in currentSpendUsd
      const absentDateCostUsd = 0.25;
      const absentDateCostUnits = ctx.sandbox.usdToMonetaryUnits_(absentDateCostUsd); // 25,000 units
      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: 'absent_date_run',
        job_id: 'absent_date_job',
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: '',
        request_finished_at: '',
        input_tokens: 1000,
        output_tokens: 500,
        estimated_cost: absentDateCostUsd,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      const usageRows1 = ctx.sandbox.readRows_(ss, 'AIUsage');
      const agg1 = hostify_(ctx.sandbox.aggregateLedgerForPeriod_(usageRows1, currentYM));
      assert.equal(agg1.spendUnits, absentDateCostUnits, 'Spend with absent date must be counted in target period units');
      assert.equal(agg1.totalCallsThisMonth, 1, 'Absent date orphan reconcile must be counted in totalCallsThisMonth');

      const status1 = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(status1.currentSpendUsd, absentDateCostUsd, 'currentSpendUsd must include absent date row cost');
      assert.equal(status1.remainingSpendUsd, 0.75, 'remainingSpendUsd must reflect deduction of absent date row');

      // 3. Integration proof: an invalid date row that brings total spend near ceiling blocks reservation and prevents budget bypass
      // Reset DB with a new context to isolate the ceiling-bypass test cleanly
      const bypassCtx = createContext();
      const bypassSs = bypassCtx.sandbox.getDb_();

      // Near ceiling: $0.99500 (99,500 units). Adding reservation $0.00635 (635 units) = $1.00135 (100,135 units) > $1.00000.
      const nearCeilingCostUsd = 0.99500;
      bypassCtx.sandbox.appendRecordInDb_(bypassSs, 'AIUsage', {
        run_id: 'invalid_date_run',
        job_id: 'invalid_date_job',
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: 'INVALID_TIMESTAMP_2026_XYZ',
        request_finished_at: '',
        input_tokens: 1000,
        output_tokens: 1000,
        estimated_cost: nearCeilingCostUsd,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      // Verify currentSpendUsd includes the row with invalid date
      const bypassStatus = hostify_(bypassCtx.sandbox.getScoringBudgetStatus());
      assert.equal(bypassStatus.currentSpendUsd, nearCeilingCostUsd, 'currentSpendUsd must include row with invalid date');
      assert.equal(bypassStatus.remainingSpendUsd, 0.00500, 'remainingSpendUsd must be $0.00500');

      // Prove budget bypass is prevented: checkAndReserveMonthlyBudgetInDb_ blocks with BUDGET_EXCEEDED
      // If the row with the invalid date had vanished, spend would be 0 and the reservation would bypass budget.
      assert.throws(() => {
        bypassCtx.sandbox.checkAndReserveMonthlyBudgetInDb_(bypassSs, 'bypass_job_1', 'bypass_run_1', '1.0.0');
      }, (err) => {
        assert.equal(err.code, 'BUDGET_EXCEEDED', 'checkAndReserveMonthlyBudgetInDb_ must block when invalid-date row brings total to ceiling');
        return true;
      });

      // Prove end-to-end scorePendingJobs also halts before dispatch with zero network calls
      insertSampleJob(bypassCtx);
      const summary = hostify_(bypassCtx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'BUDGET_EXCEEDED', 'scorePendingJobs must stop with BUDGET_EXCEEDED');
      assert.equal(bypassCtx.urlFetch.calls.length, 0, 'Zero network calls must be made; budget bypass was prevented');

      // 4. Prove reservation row with absent date is also counted conservatively in target period
      const resCtx = createContext();
      const resSs = resCtx.sandbox.getDb_();
      const reservationCostUsd = 0.00635;
      const reservationCostUnits = resCtx.sandbox.usdToMonetaryUnits_(reservationCostUsd);

      resCtx.sandbox.appendRecordInDb_(resSs, 'AIUsage', {
        run_id: 'absent_res_run',
        job_id: 'absent_res_job',
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'score_job',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: '',
        request_finished_at: '',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost: reservationCostUsd,
        currency: 'USD',
        status: 'Reserved',
        error_code: ''
      });

      const resRows = resCtx.sandbox.readRows_(resSs, 'AIUsage');
      const resAgg = hostify_(resCtx.sandbox.aggregateLedgerForPeriod_(resRows, currentYM));
      assert.equal(resAgg.spendUnits, reservationCostUnits, 'In-flight reservation with absent date must be counted in period spend');
      assert.equal(resAgg.totalCallsThisMonth, 1, 'In-flight reservation with absent date must be counted in totalCallsThisMonth');
    });

    it('Test 4: cross-period pairing attributes cost to reconciliation period while preserving attempt count in reservation period', () => {
      // 1. Initialize context with fakeClock in New York calendar month 2026-01
      const ctx = createContext({ fakeClock: '2026-01-15T12:00:00Z' });
      const ss = ctx.sandbox.getDb_();

      const runId = 'cross_period_run_1';
      const jobId = 'cross_period_job_1';

      // Timestamps chosen to fall into distinct New York calendar months (UTC-5):
      // Jan 20, 2026 10:00 EST -> 2026-01
      // Feb 10, 2026 10:00 EST -> 2026-02
      const resDate = new Date('2026-01-20T15:00:00Z');
      const recDate = new Date('2026-02-10T15:00:00Z');

      assert.equal(ctx.sandbox.getNewYorkYearMonth_(resDate), '2026-01', 'resDate must resolve to New York 2026-01');
      assert.equal(ctx.sandbox.getNewYorkYearMonth_(recDate), '2026-02', 'recDate must resolve to New York 2026-02');

      const resCostUsd = 0.00635;
      const resCostUnits = ctx.sandbox.usdToMonetaryUnits_(resCostUsd); // 635 units
      const recCostUsd = 0.00051; // 520 in ($0.000156) + 140 out ($0.000350) = 51 units ($0.00051)
      const recCostUnits = ctx.sandbox.usdToMonetaryUnits_(recCostUsd); // 51 units

      // 2. Append a reservation in New York month 2026-01
      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: runId,
        job_id: jobId,
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'score_job',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: resDate,
        request_finished_at: '',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost: resCostUsd,
        currency: 'USD',
        status: 'Reserved',
        error_code: ''
      });

      // 3. Append its single reconciliation in New York month 2026-02
      ctx.sandbox.appendRecordInDb_(ss, 'AIUsage', {
        run_id: runId,
        job_id: jobId,
        provider: 'Google Gemini',
        model: 'gemini-2.5-flash',
        operation: 'reconcile',
        profile_version: '1.0.0',
        prompt_version: '1.0.0',
        request_started_at: recDate,
        request_finished_at: new Date('2026-02-10T15:00:02Z'),
        input_tokens: 520,
        output_tokens: 140,
        estimated_cost: recCostUsd,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      const usageRows = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(usageRows.length, 2, 'Two rows must exist in AIUsage ledger');

      // 4. Low-level aggregation verification for 2026-01:
      // Single pair across all rows resolved: reconcile replaces reservation for cost,
      // but because the reconcile row belongs to 2026-02, 2026-01 spend is exactly 0.
      const aggJan = hostify_(ctx.sandbox.aggregateLedgerForPeriod_(usageRows, '2026-01'));
      assert.equal(aggJan.spendUnits, 0, '2026-01 spendUnits must be 0 (reconciliation cost attributed to 2026-02)');
      assert.equal(aggJan.totalCallsThisMonth, 1, '2026-01 totalCallsThisMonth must record the reservation attempt call');
      assert.equal(aggJan.anomaly, false, 'Single 1:1 reservation+reconciliation pair must not be flagged as anomaly');
      assert.equal(aggJan.blocked, false, 'Valid cross-period pair must not block ledger');

      // 5. Low-level aggregation verification for 2026-02:
      // Reconcile row cost is attributed to 2026-02. No new reservation in 2026-02, so totalCallsThisMonth is 0.
      const aggFeb = hostify_(ctx.sandbox.aggregateLedgerForPeriod_(usageRows, '2026-02'));
      assert.equal(aggFeb.spendUnits, recCostUnits, '2026-02 spendUnits must equal reconcile cost');
      assert.equal(aggFeb.totalCallsThisMonth, 0, '2026-02 totalCallsThisMonth must be 0 (attempt belongs to 2026-01)');
      assert.equal(aggFeb.anomaly, false, 'Single 1:1 reservation+reconciliation pair must not be flagged as anomaly');
      assert.equal(aggFeb.blocked, false, 'Valid cross-period pair must not block ledger');

      // 6. Anti-double-counting and conservation proofs:
      // (a) Spend conservation across periods: sum of monthly spend equals reconcile cost exactly once.
      assert.equal(aggJan.spendUnits + aggFeb.spendUnits, recCostUnits, 'Combined spend across periods must equal reconcile cost');
      // (b) Reservation placeholder is not charged in either month.
      assert.notEqual(aggJan.spendUnits, resCostUnits, 'Reservation cost must not be charged in 2026-01');
      assert.notEqual(aggFeb.spendUnits, resCostUnits, 'Reservation cost must not be charged in 2026-02');
      // (c) Call conservation across periods: total calls across both months is exactly 1.
      assert.equal(aggJan.totalCallsThisMonth + aggFeb.totalCallsThisMonth, 1, 'Single attempt must count as exactly 1 call across all periods');

      // 7. High-level budget status verification in 2026-01 (clock at 2026-01-15)
      const statusJan = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(statusJan.monthlyCeilingUsd, 1.00);
      assert.equal(statusJan.currentSpendUsd, 0, 'Jan budget status currentSpendUsd must be 0');
      assert.equal(statusJan.remainingSpendUsd, 1.00, 'Jan budget status remainingSpendUsd must be 1.00');
      assert.equal(statusJan.totalCallsThisMonth, 1, 'Jan totalCallsThisMonth must be 1');

      // 8. High-level budget status verification in 2026-02 (advance clock to 2026-02-15)
      ctx.clock.setNow(new Date('2026-02-15T12:00:00Z').getTime());
      const statusFeb = hostify_(ctx.sandbox.getScoringBudgetStatus());
      assert.equal(statusFeb.monthlyCeilingUsd, 1.00);
      assert.equal(statusFeb.currentSpendUsd, recCostUsd, 'Feb budget status currentSpendUsd must be reconcile cost');
      assert.equal(statusFeb.remainingSpendUsd, (100000 - recCostUnits) / 100000, 'Feb remainingSpendUsd must reflect reconcile cost deduction');
      assert.equal(statusFeb.totalCallsThisMonth, 0, 'Feb totalCallsThisMonth must be 0');

      // 9. Prove reservations and budget checks in both periods behave correctly:
      // (a) In 2026-01, full budget is available for reservations
      ctx.clock.setNow(new Date('2026-01-25T12:00:00Z').getTime());
      assert.doesNotThrow(() => {
        ctx.sandbox.checkAndReserveMonthlyBudgetInDb_(ss, 'jan_job_2', 'jan_run_2', '1.0.0');
      }, 'Reservation in 2026-01 must succeed because 2026-01 spend is 0');

      // (b) In 2026-02, reservation succeeds within remaining budget ($0.99949 remaining)
      ctx.clock.setNow(new Date('2026-02-20T12:00:00Z').getTime());
      assert.doesNotThrow(() => {
        ctx.sandbox.checkAndReserveMonthlyBudgetInDb_(ss, 'feb_job_2', 'feb_run_2', '1.0.0');
      }, 'Reservation in 2026-02 must succeed within remaining budget');
    });
  });
});
