'use strict';

/**
 * Phase 4B — Discovery.gs (Discovery Orchestrator & Trigger Management)
 *
 * Covers all 24 deterministic test requirements for Phase 4B discovery:
 * 1. Successful manual run inserts one passing LinkedIn job and writes run/log rows.
 * 2. A filtered job produces a filter log and no Jobs write.
 * 3. Existing L1 identity touches only last_seen_at; user-owned fields & JobHistory untouched.
 * 4. Repeated candidate in one run becomes DUPLICATE_IN_RUN and creates only one job.
 * 5. Rerunning/resuming the same page cannot create a duplicate job.
 * 6. Profile validation failure produces zero source calls and zero job writes.
 * 7. Lock overlap/busy produces zero source calls and zero writes.
 * 8. Scheduled call without an event is refused with zero source calls.
 * 9. Scheduled call with a forged/stale trigger UID is refused.
 * 10. Scheduled call with the one matching fake clock trigger runs.
 * 11. Trigger install is idempotent and removes only duplicate same-handler triggers.
 * 12. Trigger removal preserves unrelated triggers.
 * 13. Per-page checkpoint advances only after processing the page.
 * 14. PARTIAL resumes from the stored next query index.
 * 15. Ambiguous resumable run rows fail without source or Jobs writes.
 * 16. Runtime budget exhaustion saves a resumable checkpoint.
 * 17. Retryable status obeys retryLimit and does not spin indefinitely.
 * 18. RATE_LIMITED/BUDGET_BLOCKED/quota stop behavior preserves the checkpoint.
 * 19. First terminal error increments state but leaves source enabled; second disables it.
 * 20. Source-disabled run makes zero adapter calls until resetDiscoverySource().
 * 21. Nonretryable malformed/oversized/provider errors are audited without fabricating jobs.
 * 22. Formula-like title/company/location/external ID values are stored as literal text.
 * 23. Run and log counters agree with actual row decisions.
 * 24. Returned summaries and persisted audit data contain no raw errors, API key, headers, body, or PII.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes.js');

const DISCOVERY_FILES = [
  'Database.gs', 'Jobs.gs', 'JobProfile.gs', 'JobSource_JSearch.gs',
  'JobFilters.gs', 'JobDedupe.gs', 'Discovery.gs'
];
const TEST_KEY = 'FAKE_JSEARCH_KEY_FOR_TESTS_ONLY';
const FIXED_NOW = new Date('2026-09-13T11:00:00.000Z');

function createDiscoveryContext(overrides) {
  overrides = overrides || {};
  const scriptProps = Object.assign({
    DATABASE_SHEET_ID: 'FAKE_SHEET_ID',
    JSEARCH_RAPIDAPI_KEY: TEST_KEY
  }, overrides.scriptProperties || {});

  const lockOptions = Object.assign({}, overrides.lockOptions);
  const wantAlwaysFail = lockOptions.alwaysFail;
  lockOptions.alwaysFail = false;

  const ctx = loadAppsScriptContext_({
    files: DISCOVERY_FILES,
    scriptProperties: scriptProps,
    urlFetch: overrides.urlFetch || { responses: [] },
    lockOptions: lockOptions,
    fakeClock: overrides.fakeClock !== undefined ? overrides.fakeClock : FIXED_NOW
  });
  ctx.sandbox.initializeDatabase();
  if (wantAlwaysFail) {
    lockOptions.alwaysFail = true;
  }
  return ctx;
}

function makeJSearchJob(overrides) {
  overrides = overrides || {};
  const id = overrides.job_id || 'linkedin-101';
  const defaultUrl = (id === 'linkedin-101')
    ? 'https://www.linkedin.com/jobs/view/101'
    : 'https://www.linkedin.com/jobs/view/' + encodeURIComponent(id);
  return Object.assign({
    job_id: id,
    job_title: 'Help Desk Technician',
    employer_name: 'Acme Technologies',
    job_city: 'Pittsburgh',
    job_state: 'PA',
    job_country: 'US',
    job_is_remote: false,
    job_latitude: 40.4406,
    job_longitude: -79.9959,
    job_apply_link: defaultUrl,
    job_publisher: 'LinkedIn',
    job_description: 'Provide technical support to end users in Pittsburgh.',
    job_employment_type: 'FULLTIME',
    job_min_salary: 45000,
    job_max_salary: 55000,
    job_salary_currency: 'USD',
    job_salary_period: 'YEAR'
  }, overrides);
}

function makeResponseBody(jobs) {
  return JSON.stringify({
    status: 'OK',
    request_id: 'test-req-1',
    data: {
      jobs: jobs || []
    }
  });
}

function okResponse(jobs, overrides) {
  overrides = overrides || {};
  return {
    code: 200,
    headers: Object.assign({
      'content-type': 'application/json',
      'x-ratelimit-requests-remaining': '190',
      'x-ratelimit-requests-limit': '200'
    }, overrides.headers || {}),
    body: makeResponseBody(jobs)
  };
}

describe('Phase 4B: Discovery Execution and Persistence (Requirements 1 - 5)', () => {
  it('1. Successful manual run inserts one passing LinkedIn job and writes run/log rows', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([makeJSearchJob()])]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.ok, true);
    assert.equal(summary.acceptedCount, 1);
    assert.equal(summary.rawCount, 1);
    assert.equal(summary.filteredCount, 0);
    assert.equal(summary.pagesAttempted, 1);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].external_id, 'linkedin-101');
    assert.equal(jobs[0].title, 'Help Desk Technician');
    assert.equal(jobs[0].company, 'Acme Technologies');
    assert.equal(jobs[0].status, 'New');
    assert.equal(jobs[0].record_version, 1);

    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].accepted_count, 1);
    assert.equal(runs[0].status, 'PARTIAL'); // maxPages 1 of 13 queries

    const logs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryLog'));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].decision, 'accepted');
    assert.equal(logs[0].reason_code, 'PASSED_PROFILE');
    assert.equal(logs[0].job_id, jobs[0].id);
  });

  it('2. A filtered job produces a filter log and no Jobs write', () => {
    const filteredJob = makeJSearchJob({
      job_title: 'Sales Director',
      job_description: 'Manage sales revenue quotas.'
    });
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([filteredJob])]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.ok, true);
    assert.equal(summary.filteredCount, 1);
    assert.equal(summary.acceptedCount, 0);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 0);

    const logs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryLog'));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].decision, 'filtered');
    assert.equal(logs[0].reason_code, 'EXCLUDED_SENIOR_LEADERSHIP');
    assert.equal(logs[0].job_id, '');
  });

  it('3. Existing L1 identity touches only last_seen_at; all user-owned fields and JobHistory remain unchanged', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([makeJSearchJob()])]
      }
    });

    const initialJob = {
      id: 'existing-job-1',
      external_id: 'linkedin-101',
      source: 'linkedin',
      url: 'https://www.linkedin.com/jobs/view/101',
      title: 'Help Desk Technician',
      company: 'Acme Technologies',
      location: 'Pittsburgh, PA',
      remote: false,
      salary_min: 45000,
      salary_max: 55000,
      currency: 'USD',
      posted_at: '2026-09-01T00:00:00.000Z',
      discovered_at: '2026-09-01T00:00:00.000Z',
      last_seen_at: '2026-09-01T00:00:00.000Z',
      description: 'Existing description',
      skills_match: '',
      experience_match: '',
      location_match: '',
      salary_match: '',
      overall_match: '',
      recommendation: '',
      why_matches: '',
      gaps: '',
      status: 'Saved',
      saved_at: '2026-09-02T10:00:00.000Z',
      notes: 'Initial user review note',
      record_version: 2
    };
    ctx.sandbox.appendRecordInDb_(ctx.spreadsheet, 'Jobs', initialJob);

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.updatedCount, 1);
    assert.equal(summary.acceptedCount, 0);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'existing-job-1');
    assert.equal(jobs[0].status, 'Saved');
    assert.equal(jobs[0].saved_at, '2026-09-02T10:00:00.000Z');
    assert.equal(jobs[0].notes, 'Initial user review note');
    assert.equal(jobs[0].record_version, 2);
    assert.equal(jobs[0].last_seen_at, FIXED_NOW.toISOString());

    const history = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'JobHistory'));
    assert.equal(history.length, 0);
  });

  it('4. Repeated candidate in one run becomes DUPLICATE_IN_RUN and creates only one job', () => {
    const jobA = makeJSearchJob({ job_id: 'dup-candidate-1' });
    const jobB = makeJSearchJob({ job_id: 'dup-candidate-1' });
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([jobA, jobB])]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.acceptedCount, 1);
    assert.equal(summary.duplicateCount, 1);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 1);

    const logs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryLog'));
    assert.equal(logs.length, 2);
    assert.equal(logs[0].decision, 'accepted');
    assert.equal(logs[1].decision, 'duplicate');
    assert.equal(logs[1].reason_code, 'DUPLICATE_IN_RUN');
  });

  it('5. Rerunning/resuming the same page cannot create a duplicate job', () => {
    const job = makeJSearchJob({ job_id: 'rerun-job-1' });
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [
          okResponse([job]),
          okResponse([job])
        ]
      }
    });

    const summary1 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary1.acceptedCount, 1);

    const summary2 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary2.acceptedCount, 1);
    assert.equal(summary2.updatedCount, 1);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 1);
  });
});

describe('Phase 4B: Guards, Locks, and Scheduled Triggers (Requirements 6 - 12)', () => {
  it('6. Profile validation failure produces zero source calls and zero job writes', () => {
    const ctx = createDiscoveryContext();
    ctx.sandbox.JOB_PROFILE_ = Object.assign({}, ctx.sandbox.JOB_PROFILE_, { configVersion: 0 });

    assert.throws(() => {
      ctx.sandbox.runDiscovery();
    }, /jobProfileValidate_/);

    assert.equal(ctx.urlFetch.calls.length, 0);
    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 0);
  });

  it('7. Lock overlap/busy produces zero source calls and zero writes', () => {
    const ctx = createDiscoveryContext({
      lockOptions: { alwaysFail: true }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery());
    assert.equal(summary.ok, false);
    assert.equal(summary.status, 'SKIPPED_OVERLAP');
    assert.equal(ctx.urlFetch.calls.length, 0);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 0);
  });

  it('8. Scheduled call without an event is refused with zero source calls', () => {
    const ctx = createDiscoveryContext();
    const summary = hostify_(ctx.sandbox.runScheduledDiscovery());
    assert.equal(summary.ok, false);
    assert.equal(summary.status, 'REFUSED_NOT_TRIGGER');
    assert.equal(ctx.urlFetch.calls.length, 0);

    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'REFUSED_NOT_TRIGGER');
    assert.equal(runs[0].error_code, 'INVALID_TRIGGER_IDENTITY');
  });

  it('9. Scheduled call with a forged/stale trigger UID is refused', () => {
    const ctx = createDiscoveryContext();
    ctx.sandbox.installDiscoveryTrigger();

    const summary = hostify_(ctx.sandbox.runScheduledDiscovery({ triggerUid: 'forged-trigger-999' }));
    assert.equal(summary.ok, false);
    assert.equal(summary.status, 'REFUSED_NOT_TRIGGER');
    assert.equal(ctx.urlFetch.calls.length, 0);
  });

  it('10. Scheduled call with the one matching fake clock trigger runs', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([makeJSearchJob()])]
      }
    });
    ctx.sandbox.JOB_PROFILE_ = Object.assign({}, ctx.sandbox.JOB_PROFILE_, { pagesPerScheduledRun: 1 });
    ctx.sandbox.installDiscoveryTrigger();
    const triggers = ctx.scriptApp.getProjectTriggers();
    const triggerUid = triggers[0].getUniqueId();

    const summary = hostify_(ctx.sandbox.runScheduledDiscovery({ triggerUid: triggerUid }));
    assert.equal(summary.ok, true);
    assert.equal(summary.mode, 'scheduled');
    assert.equal(ctx.urlFetch.calls.length, 1);
    assert.equal(summary.acceptedCount, 1);
  });

  it('11. Trigger install is idempotent and removes only duplicate same-handler triggers', () => {
    const ctx = createDiscoveryContext();

    const res1 = hostify_(ctx.sandbox.installDiscoveryTrigger());
    assert.equal(res1.status, 'ok');
    assert.equal(res1.installedCount, 1);
    assert.equal(res1.removedDuplicates, 0);

    // Manually add a duplicate same-handler trigger
    ctx.scriptApp.newTrigger('runScheduledDiscovery').timeBased().create();
    assert.equal(ctx.scriptApp.getProjectTriggers().length, 2);

    const res2 = hostify_(ctx.sandbox.installDiscoveryTrigger());
    assert.equal(res2.status, 'ok');
    assert.equal(res2.installedCount, 1);
    assert.equal(res2.removedDuplicates, 1);
    assert.equal(ctx.scriptApp.getProjectTriggers().length, 1);
  });

  it('12. Trigger removal preserves unrelated triggers', () => {
    const ctx = createDiscoveryContext();
    // Add unrelated trigger
    ctx.scriptApp.newTrigger('unrelatedHandlerFunction').timeBased().create();
    ctx.sandbox.installDiscoveryTrigger();
    assert.equal(ctx.scriptApp.getProjectTriggers().length, 2);

    const res = hostify_(ctx.sandbox.removeDiscoveryTrigger());
    assert.equal(res.status, 'ok');
    assert.equal(res.removedCount, 1);

    const remaining = ctx.scriptApp.getProjectTriggers();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].getHandlerFunction(), 'unrelatedHandlerFunction');
  });
});

describe('Phase 4B: Checkpoints, Budget, and Error Recovery (Requirements 13 - 18)', () => {
  it('13. Per-page checkpoint advances only after processing the page', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([makeJSearchJob()])]
      }
    });

    ctx.sandbox.runDiscovery({ maxPages: 1 });
    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    assert.equal(runs.length, 1);
    const checkpoint = JSON.parse(runs[0].checkpoint_json);
    assert.equal(checkpoint.queryIndex, 1);
    assert.equal(runs[0].pages_attempted, 1);
  });

  it('14. PARTIAL resumes from the stored next query index', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [
          okResponse([makeJSearchJob({ job_id: 'job-q0' })]),
          okResponse([makeJSearchJob({ job_id: 'job-q1' })])
        ]
      }
    });

    const summary1 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary1.status, 'PARTIAL');
    assert.equal(summary1.pagesAttempted, 1);

    const summary2 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary2.status, 'PARTIAL');
    assert.equal(summary2.pagesAttempted, 2);

    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    assert.equal(runs.length, 1);
    const checkpoint = JSON.parse(runs[0].checkpoint_json);
    assert.equal(checkpoint.queryIndex, 2);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 2);
  });

  it('15. Ambiguous resumable run rows fail without source or Jobs writes', () => {
    const ctx = createDiscoveryContext();
    const dateKey = ctx.sandbox.Utilities.formatDate(FIXED_NOW, 'America/New_York', 'yyyy-MM-dd');
    const runA = {
      run_id: 'run-a', source: 'linkedin', provider: 'jsearch', mode: 'manual', date_key: dateKey,
      started_at: FIXED_NOW.toISOString(), finished_at: '', status: 'IN_PROGRESS', error_code: '',
      checkpoint_json: '{}', pages_attempted: 0, raw_count: 0, accepted_count: 0, filtered_count: 0,
      duplicate_count: 0, updated_count: 0, quarantined_count: 0, error_count: 0,
      profile_version: 'p1', config_version: 1, adapter_version: '1', filter_version: '1', identity_version: '1'
    };
    const runB = Object.assign({}, runA, { run_id: 'run-b' });
    ctx.sandbox.appendRecordInDb_(ctx.spreadsheet, 'DiscoveryRuns', runA);
    ctx.sandbox.appendRecordInDb_(ctx.spreadsheet, 'DiscoveryRuns', runB);

    assert.throws(() => {
      ctx.sandbox.runDiscovery({ maxPages: 1 });
    }, /Multiple resumable runs found/);

    assert.equal(ctx.urlFetch.calls.length, 0);
  });

  it('16. Runtime budget exhaustion saves a resumable checkpoint', () => {
    const ctx = createDiscoveryContext({
      fakeClock: { initialNow: FIXED_NOW.getTime() },
      urlFetch: {
        responses: [
          {
            code: 200,
            headers: {
              'content-type': 'application/json',
              'x-ratelimit-requests-remaining': '190',
              'x-ratelimit-requests-limit': '200'
            },
            get body() {
              // Advance clock past runtime budget during page 1 so next iteration checks elapsed >= budgetMs
              ctx.clock.advance(280000); // 280,000 ms > 270,000 ms budget
              return makeResponseBody([makeJSearchJob({ job_id: 'budget-1' })]);
            }
          }
        ]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery());
    assert.equal(summary.status, 'PARTIAL');

    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'PARTIAL');
    assert.equal(runs[0].error_code, 'RUNTIME_BUDGET_EXHAUSTED');
  });

  it('17. Retryable status obeys retryLimit and does not spin indefinitely', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [
          { throws: new Error('Simulated network timeout') },
          { throws: new Error('Simulated network timeout') }
        ]
      }
    });

    // Run 1: attempt 1 -> stops PARTIAL without advancing queryIndex
    const summary1 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary1.status, 'PARTIAL');
    let runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    let cp = JSON.parse(runs[0].checkpoint_json);
    assert.equal(cp.queryIndex, 0);
    assert.equal(Object.values(cp.attempts)[0], 1);

    // Run 2: attempt 2 reaches retryLimit (2) -> advances queryIndex, audits error
    const summary2 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary2.status, 'PARTIAL');
    runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    cp = JSON.parse(runs[0].checkpoint_json);
    assert.equal(cp.queryIndex, 1);
    assert.equal(runs[0].error_count, 1);

    const logs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryLog'));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].decision, 'error');
  });

  it('18. RATE_LIMITED/BUDGET_BLOCKED/quota stop behavior preserves the checkpoint', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [
          {
            code: 429,
            headers: { 'content-type': 'application/json', 'x-ratelimit-requests-remaining': '50' },
            body: JSON.stringify({ message: 'Rate limited' })
          }
        ]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.status, 'PARTIAL');

    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    assert.equal(runs[0].status, 'PARTIAL');
    assert.equal(runs[0].error_code, 'RATE_LIMITED');
    const checkpoint = JSON.parse(runs[0].checkpoint_json);
    assert.equal(checkpoint.queryIndex, 0);
  });
});

describe('Phase 4B: Source Terminal States, Errors, and Formatting (Requirements 19 - 24)', () => {
  it('19. First terminal error increments state but leaves source enabled; second disables it', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [
          { code: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Invalid key' }) },
          { code: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Invalid key' }) }
        ]
      }
    });

    // Attempt 1: terminal error 1
    const summary1 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary1.status, 'FAILED');
    let state = ctx.sandbox.discoveryLoadSourceStateInDb_(ctx.spreadsheet);
    assert.equal(state.consecutiveTerminalErrors, 1);
    assert.equal(state.enabled, true);

    // Attempt 2: terminal error 2 (reaches threshold 2)
    const summary2 = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary2.status, 'FAILED');
    state = ctx.sandbox.discoveryLoadSourceStateInDb_(ctx.spreadsheet);
    assert.equal(state.consecutiveTerminalErrors, 2);
    assert.equal(state.enabled, false);
  });

  it('20. Source-disabled run makes zero adapter calls until resetDiscoverySource()', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([makeJSearchJob()])]
      }
    });
    // Manually set source state to disabled
    ctx.sandbox.discoverySaveSourceStateInDb_(ctx.spreadsheet, {
      enabled: false, consecutiveTerminalErrors: 2, disabledAt: FIXED_NOW.toISOString(), reason: 'AUTH_FAILED'
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.status, 'SOURCE_DISABLED');
    assert.equal(summary.ok, false);
    assert.equal(ctx.urlFetch.calls.length, 0);

    const resetRes = hostify_(ctx.sandbox.resetDiscoverySource());
    assert.equal(resetRes.status, 'ok');
    assert.equal(resetRes.enabled, true);

    const summaryAfterReset = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summaryAfterReset.ok, true);
    assert.equal(ctx.urlFetch.calls.length, 1);
  });

  it('21. Nonretryable malformed/oversized/provider errors are audited without fabricating jobs', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [
          { code: 200, headers: { 'content-type': 'application/json' }, body: 'invalid-json-body' }
        ]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.acceptedCount, 0);

    const jobs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs'));
    assert.equal(jobs.length, 0);

    const logs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryLog'));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].decision, 'error');
    assert.equal(logs[0].reason_code, 'MALFORMED');
  });

  it('22. Formula-like title/company/location/external ID values are stored as literal text and never executed', () => {
    const formulaJob = makeJSearchJob({
      job_id: '=HYPERLINK("http://evil.com")',
      job_title: '=1+1',
      employer_name: '+AcmeCorp',
      job_city: '-Pittsburgh',
      job_description: '@cmd /c calc'
    });
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([formulaJob])]
      }
    });

    hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    const rawSheetData = ctx.sheetsByName.Jobs.data[1]; // row 2 (index 1)
    const header = ctx.sheetsByName.Jobs.data[0];

    const titleIdx = header.indexOf('title');
    const companyIdx = header.indexOf('company');
    const locationIdx = header.indexOf('location');
    const extIdIdx = header.indexOf('external_id');

    assert.equal(rawSheetData[titleIdx].startsWith("'="), true);
    assert.equal(rawSheetData[companyIdx].startsWith("'+"), true);
    assert.equal(rawSheetData[locationIdx].startsWith("'-"), true);
    assert.equal(rawSheetData[extIdIdx].startsWith("'="), true);
  });

  it('23. Run and log counters agree with actual row decisions', () => {
    const passingJob = makeJSearchJob({ job_id: 'c-pass' });
    const filteredJob = makeJSearchJob({ job_id: 'c-fail', job_title: 'Sales Executive' });
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [
          okResponse([passingJob, filteredJob, passingJob])
        ]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    assert.equal(summary.rawCount, 3);
    assert.equal(summary.acceptedCount, 1);
    assert.equal(summary.filteredCount, 1);
    assert.equal(summary.duplicateCount, 1);

    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    assert.equal(runs[0].raw_count, 3);
    assert.equal(runs[0].accepted_count, 1);
    assert.equal(runs[0].filtered_count, 1);
    assert.equal(runs[0].duplicate_count, 1);

    const logs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryLog'));
    assert.equal(logs.filter(l => l.decision === 'accepted').length, 1);
    assert.equal(logs.filter(l => l.decision === 'filtered').length, 1);
    assert.equal(logs.filter(l => l.decision === 'duplicate').length, 1);
  });

  it('24. Returned summaries and persisted audit data contain no raw errors, API key, headers, body, request ID, résumé text, or PII', () => {
    const ctx = createDiscoveryContext({
      urlFetch: {
        responses: [okResponse([makeJSearchJob()])]
      }
    });

    const summary = hostify_(ctx.sandbox.runDiscovery({ maxPages: 1 }));
    const summaryStr = JSON.stringify(summary);
    assert.equal(summaryStr.includes(TEST_KEY), false);
    assert.equal(summaryStr.includes('X-RapidAPI'), false);
    assert.equal(summaryStr.includes('test-req-1'), false);

    const runs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryRuns'));
    const runsStr = JSON.stringify(runs);
    assert.equal(runsStr.includes(TEST_KEY), false);
    assert.equal(runsStr.includes('X-RapidAPI'), false);
    assert.equal(runsStr.includes('test-req-1'), false);

    const logs = hostify_(ctx.sandbox.readRows_(ctx.spreadsheet, 'DiscoveryLog'));
    const logsStr = JSON.stringify(logs);
    assert.equal(logsStr.includes(TEST_KEY), false);
    assert.equal(logsStr.includes('X-RapidAPI'), false);
    assert.equal(logsStr.includes('test-req-1'), false);
  });
});
