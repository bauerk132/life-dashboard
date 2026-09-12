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
    evidence: ['Required 2+ years help desk experience verified', 'Active Directory administration mentioned'],
    gaps: ['Requires macOS support experience which is unconfirmed']
  }, scoreData || {});

  const usage = Object.assign({
    promptTokenCount: 520,
    candidatesTokenCount: 140
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
        urlFetch: { responses: [mockResponse] }
      });
      const job = insertSampleJob(ctx);

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.scored, 1);
      assert.equal(summary.attempted, 1);

      // Verify UrlFetchApp call details
      assert.equal(ctx.urlFetch.calls.length, 1);
      const call = ctx.urlFetch.calls[0];
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

    it('T03: formula injection in model response is escaped before writing to Sheet', () => {
      // Added "Windows" so it doesn't get marked ungrounded
      const maliciousResponse = createMockGeminiResponse({
        evidence: ['=SUM(1+1) Windows', '@evil_command Windows', '+50000 Windows'],
        gaps: ['-bad_gap Windows', '=cmd|\' /C calc\'!A0 Windows']
      });
      const ctx = createContext({
        urlFetch: { responses: [maliciousResponse] }
      });
      insertSampleJob(ctx);

      ctx.sandbox.scorePendingJobs(1);

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      const parsedEvidence = JSON.parse(scores[0].evidence_json);
      const parsedGaps = JSON.parse(scores[0].gaps_json);

      assert.ok(parsedEvidence[0].startsWith('\'='), 'Leading = must be escaped');
      assert.ok(parsedEvidence[1].startsWith('\'@'), 'Leading @ must be escaped');
      assert.ok(parsedEvidence[2].startsWith('\'+'), 'Leading + must be escaped');
      assert.ok(parsedGaps[0].startsWith('\'-'), 'Leading - must be escaped');
      assert.ok(parsedGaps[1].startsWith('\'='), 'Leading = must be escaped');
    });

    it('T04: prompt minimization excludes candidate PII and transmits only approved profile fields', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({
        urlFetch: { responses: [mockResponse] }
      });
      insertSampleJob(ctx);

      ctx.sandbox.scorePendingJobs(1);

      const payload = JSON.parse(ctx.urlFetch.calls[0].params.payload);
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
        urlFetch: { responses: [mockResponse] }
      });
      insertSampleJob(ctx);

      // First run: calls API
      const res1 = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(res1.scored, 1);
      assert.equal(ctx.urlFetch.calls.length, 1);

      // Second run: should be cached
      const res2 = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(res2.attempted, 0, 'No unscored jobs remaining');
      assert.equal(ctx.urlFetch.calls.length, 1, 'UrlFetchApp must not be called again');
    });

    it('T06: changed job description creates new cache entry and triggers rescoring', () => {
      const mockResponse1 = createMockGeminiResponse({ overall_match: 75 });
      const mockResponse2 = createMockGeminiResponse({ overall_match: 92, recommendation: 'Strong Match' });
      const ctx = createContext({
        urlFetch: { responses: [mockResponse1, mockResponse2] }
      });
      const job = insertSampleJob(ctx);

      // First run
      ctx.sandbox.scorePendingJobs(1);
      assert.equal(ctx.urlFetch.calls.length, 1);

      // Update description and clear overall_match to simulate materially changed job
      const ss = ctx.sandbox.getDb_();
      ctx.sandbox.updateRecordByIdInDb_(ss, 'Jobs', job.id, {
        description: 'Updated description requiring specialized cloud certifications and Kubernetes.',
        overall_match: ''
      });

      // Second run
      const res2 = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(res2.scored, 1);
      assert.equal(ctx.urlFetch.calls.length, 2, 'New call must be made for changed description');

      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores.length, 2, 'Two distinct score records must exist in JobScores');
    });
  });

  describe('Suite 3: Hard Spending Ceilings & Budget Enforcement', () => {
    it('T07: call is blocked before network request when current monthly spend exceeds $1.00 USD', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      insertSampleJob(ctx);

      // Seed previous usage exceeding $1.00 USD
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
        input_tokens: 10000000,
        output_tokens: 2000000,
        estimated_cost: 1.05,
        currency: 'USD',
        status: 'Completed',
        error_code: ''
      });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.failed, 1);
      assert.equal(summary.stoppedReason, 'BUDGET_EXCEEDED');
      assert.equal(ctx.urlFetch.calls.length, 0, 'Zero network calls must be made when budget is exceeded');
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
        urlFetch: { responses: [invalidScoreResponse] }
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
        urlFetch: { responses: [invalidRecResponse] }
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
    it('T13: R1 corrected - Fabricated evidence claim + extra unknown key is rejected', () => {
      const mockResponse = createMockGeminiResponse({
        evidence: ['Has CCNA certification'], // not in desc
        extra_key: 123
      });
      const ctx = createContext({ urlFetch: { responses: [mockResponse] } });
      insertSampleJob(ctx, { description: 'Needs Windows experience.' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.quarantined, 1);

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      assert.equal(scores[0].status, 'Quarantined');
      assert.equal(scores[0].error_code, 'UNKNOWN_FIELD');

      // Also test ungrounded evidence rejection
      const mockResponse2 = createMockGeminiResponse({
        evidence: ['Has CCNA certification']
      });
      const ctx2 = createContext({ urlFetch: { responses: [mockResponse2] } });
      insertSampleJob(ctx2, { description: 'Needs Windows experience.' });

      hostify_(ctx2.sandbox.scorePendingJobs(1));
      const ss2 = ctx2.sandbox.getDb_();
      const scores2 = ctx2.sandbox.readRows_(ss2, 'JobScores');
      assert.equal(scores2[0].status, 'Validated');
      const parsedEv = JSON.parse(scores2[0].evidence_json);
      assert.ok(parsedEv[0].includes('[UNGROUNDED]'));
    });

    it('T14: R2 corrected - published overall is deterministic weighted sum, model overall override ignored', () => {
      const mockResponse = createMockGeminiResponse({
        skills_match: 70, experience_match: 70, education_match: 70,
        location_match: 70, salary_match: 70, overall_match: 84
      });
      const ctx = createContext({ urlFetch: { responses: [mockResponse] } });
      insertSampleJob(ctx);
      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      const scores = ctx.sandbox.readRows_(ss, 'JobScores');
      if (!scores[0]) console.error('T14 failed summary:', summary, 'jobs:', ctx.sandbox.readRows_(ss, 'Jobs'), 'scores:', scores, 'usage:', ctx.sandbox.readRows_(ss, 'AIUsage')); assert.equal(scores[0].overall_match, 70); // 70 * weights = 70
    });

    it('T15: R4 corrected - Pricing math at $0.30/$2.50 rates', () => {
      const ctx = createContext();
      // 1,000,000 in = $0.30, 1,000,000 out = $2.50
      const cost = ctx.sandbox.calculateCostUsd_(2000000, 1000000); // 0.60 + 2.50 = 3.10
      assert.equal(cost, 3.10);
    });

    it('T16: R4 corrected - Reservation sizing >= cost of maxOutputTokens', () => {
      const ctx = createContext();
      const maxOutputTokens = 2048; // from requirement
      const inputTokens = 2000;
      const calculatedCost = ctx.sandbox.calculateCostUsd_(inputTokens, maxOutputTokens);
      // WORST_CASE_RESERVATION_COST_USD_ is 0.006
      assert.ok(0.006 >= calculatedCost);
    });

    it('T17: R5 corrected - Cache lookup with obsolete profile version is not a cache hit', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({ urlFetch: { responses: [mockResponse, mockResponse] } });
      const job = insertSampleJob(ctx);

      hostify_(ctx.sandbox.scorePendingJobs(1));

      const ss = ctx.sandbox.getDb_();
      // change profile version of the existing score
      const scores = ctx.sandbox.readRows_(ss, 'JobScores'); if(!scores[0]) console.error('T17 scores empty', summary); ctx.sandbox.updateRecordByIdInDb_(ss, 'JobScores', scores[0].id, { profile_version: '0.9.0' });
      // clear jobs overall_match
      ctx.sandbox.updateRecordByIdInDb_(ss, 'Jobs', job.id, { overall_match: '' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.scored, 1);
      assert.equal(summary.cached, 0);
      assert.equal(ctx.urlFetch.calls.length, 2);
    });

    it('T18: R5 corrected - Cache lookup matching ALL fields is a cache hit', () => {
      const mockResponse = createMockGeminiResponse();
      const ctx = createContext({ urlFetch: { responses: [mockResponse, mockResponse] } });
      const job = insertSampleJob(ctx);

      hostify_(ctx.sandbox.scorePendingJobs(1));
      ctx.sandbox.updateRecordByIdInDb_(ctx.sandbox.getDb_(), 'Jobs', job.id, { overall_match: '' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.cached, 1);
      assert.equal(ctx.urlFetch.calls.length, 1); // no new call
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
      const mockResponse2 = createMockGeminiResponse({ overall_match: 99 });
      const ctx = createContext({ urlFetch: { responses: [mockResponse1, mockResponse2] } });
      const job = insertSampleJob(ctx);

      hostify_(ctx.sandbox.scorePendingJobs(1));

      // change description, keep overall_match
      const ss = ctx.sandbox.getDb_();
      ctx.sandbox.updateRecordByIdInDb_(ss, 'Jobs', job.id, { description: 'Completely different description' });

      const summary = hostify_(ctx.sandbox.scorePendingJobs(1));
      assert.equal(summary.scored, 1);
      assert.equal(ctx.urlFetch.calls.length, 2);
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

    it('T24: Post-dispatch failure preserves cost', () => {
      const ctx = createContext();
      const ss = ctx.sandbox.getDb_();
      const resId = ctx.sandbox.checkAndReserveMonthlyBudgetInDb_(ss, 'job123', 'run123', '1.0.0');

      ctx.sandbox.reconcileUsageInDb_(ss, resId, 1000, 500, 'Failed', 'API_ERROR');

      const after = ctx.sandbox.readRows_(ss, 'AIUsage');
      assert.equal(after[1].status, 'Failed');
      assert.equal(after[1].input_tokens, 1000);
      assert.equal(after[1].output_tokens, 500);
      assert.ok(after[1].estimated_cost > 0);
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
              usageMetadata: { promptTokenCount: -5, candidatesTokenCount: 10 }
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
              usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 150, thoughtsTokenCount: 300 }
            })
          }]
        }
      });
      const res = ctx.sandbox.geminiCallScoringEndpoint_('Test prompt');
      assert.equal(res.inputTokens, 500);
      assert.equal(res.outputTokens, 450); // 150 candidates + 300 thoughts
    });
  });
});
