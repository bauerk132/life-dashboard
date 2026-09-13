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
    urlFetch: overrides.urlFetch || { responses: [] }
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
});
