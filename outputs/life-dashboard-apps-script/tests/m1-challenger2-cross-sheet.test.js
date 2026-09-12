'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes');

const APP_FILES = ['Database.gs', 'Code.gs', 'Jobs.gs', 'Applications.gs'];

function schema_() {
  return loadAppsScriptContext_({ files: APP_FILES }).testExports.SCHEMA;
}

function initializedSheets_(schema) {
  const sheets = {};
  Object.keys(schema).forEach((name) => {
    sheets[name] = { header: schema[name].slice(), rows: [] };
  });
  return sheets;
}

function rowFor_(schema, sheetName, values) {
  return schema[sheetName].map((field) => (
    Object.prototype.hasOwnProperty.call(values, field) ? values[field] : ''
  ));
}

function jobRow_(schema, overrides) {
  const base = {
    id: 'job-1',
    external_id: 'src-1',
    source: 'JSearch',
    url: 'https://jobs.example.org/posting/1',
    title: 'Senior IT Specialist',
    company: 'TechCorp',
    location: 'Pittsburgh, PA',
    remote: false,
    salary_min: 65000,
    salary_max: 85000,
    currency: 'USD',
    posted_at: '2026-09-10T12:00:00.000Z',
    discovered_at: '2026-09-11T12:00:00.000Z',
    last_seen_at: new Date(),
    description: 'IT Systems support',
    overall_match: 92,
    recommendation: 'Strong Match',
    why_matches: 'WGU IT degree',
    gaps: 'None',
    status: 'Ready to Apply',
    notes: '',
    record_version: 0
  };
  return rowFor_(schema, 'Jobs', Object.assign(base, overrides || {}));
}

function appRow_(schema, overrides) {
  const base = {
    id: 'app-1',
    job_id: 'job-1',
    status: 'Draft',
    applied_at: '',
    follow_up_at: '',
    contact_name: 'Jane Recruiter',
    contact_email: 'jane@techcorp.com',
    interview_at: '',
    outcome: '',
    notes: '',
    created_at: new Date('2026-09-11T12:00:00.000Z'),
    updated_at: new Date('2026-09-11T12:00:00.000Z')
  };
  return rowFor_(schema, 'Applications', Object.assign(base, overrides || {}));
}

function context_(jobs, apps, appHistories, jobHistories, extra) {
  const schema = schema_();
  const sheets = initializedSheets_(schema);
  sheets.Jobs.rows = jobs || [];
  sheets.Applications.rows = apps || [];
  sheets.ApplicationHistory.rows = appHistories || [];
  sheets.JobHistory.rows = jobHistories || [];
  const ctx = loadAppsScriptContext_(Object.assign({
    files: APP_FILES,
    initialSheets: sheets
  }, extra || {}));
  ctx.schema = schema;
  return ctx;
}

describe('Challenger 2 - Dimension 1: Cross-Sheet Synchronization & Failure Modes', () => {
  it('1.1: Deleting Jobs row before transitioning application aborts cleanly without mutating Applications or ApplicationHistory', () => {
    const schema = schema_();
    const ctx = context_(
      [],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    const beforeApps = JSON.stringify(ctx.sheetsByName.Applications.data);
    const beforeAppHist = JSON.stringify(ctx.sheetsByName.ApplicationHistory.data);

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });

    assert.equal(JSON.stringify(ctx.sheetsByName.Applications.data), beforeApps, 'Applications must remain unchanged');
    assert.equal(JSON.stringify(ctx.sheetsByName.ApplicationHistory.data), beforeAppHist, 'ApplicationHistory must remain unchanged');
  });

  it('1.2: Corrupted Jobs row (duplicate job id) aborts cleanly with INTEGRITY_ERROR before writing', () => {
    const schema = schema_();
    const ctx = context_(
      [
        jobRow_(schema, { id: 'job-1', title: 'Job Copy 1' }),
        jobRow_(schema, { id: 'job-1', title: 'Job Copy 2' })
      ],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    const beforeApps = JSON.stringify(ctx.sheetsByName.Applications.data);
    const beforeAppHist = JSON.stringify(ctx.sheetsByName.ApplicationHistory.data);
    const beforeJobs = JSON.stringify(ctx.sheetsByName.Jobs.data);

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'INTEGRITY_ERROR');
      return true;
    });

    assert.equal(JSON.stringify(ctx.sheetsByName.Applications.data), beforeApps);
    assert.equal(JSON.stringify(ctx.sheetsByName.ApplicationHistory.data), beforeAppHist);
    assert.equal(JSON.stringify(ctx.sheetsByName.Jobs.data), beforeJobs);
  });

  it('1.3: Corrupted Jobs sheet header aborts cleanly with SCHEMA_MISMATCH before modifying anything', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    // Corrupt Jobs header
    ctx.sheetsByName.Jobs.data[0] = ['bad_header_1', 'bad_header_2'];

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'SCHEMA_MISMATCH');
      return true;
    });
  });

  it('1.4: Unexpected Jobs status: syncJobStatusFromApplication_ bypasses Jobs.gs transition matrix', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'New', record_version: 0 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    const updatedApp = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Applied'));
    assert.equal(updatedApp.status, 'Applied');

    const jobStatus = ctx.sheetsByName.Jobs.data[1][schema.Jobs.indexOf('status')];
    assert.equal(jobStatus, 'Applied');
  });

  it('1.5: ATOMIC ROLLBACK FAILURE: When Applications update fails after Jobs sync, Jobs is permanently corrupted/desynchronized with no rollback', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply', record_version: 1 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    const origUpdate = ctx.sandbox.updateRecordByIdInDb_;
    ctx.sandbox.updateRecordByIdInDb_ = function (ss, sheetName, id, updates, precondition) {
      if (sheetName === 'Applications') {
        if (typeof precondition === 'function') {
          precondition({ status: 'Withdrawn' });
        }
      }
      return origUpdate.apply(this, arguments);
    };

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'CONFLICT');
      return true;
    });

    const jobStatus = ctx.sheetsByName.Jobs.data[1][schema.Jobs.indexOf('status')];
    const jobHistoryRows = ctx.sheetsByName.JobHistory.data.length;
    const appStatus = ctx.sheetsByName.Applications.data[1][schema.Applications.indexOf('status')];
    const appHistoryRows = ctx.sheetsByName.ApplicationHistory.data.length;

    console.log('[CHALLENGER 2 EMPIRICAL RESULT] Desynchronization state after failed application update:');
    console.log('  Jobs.status:', jobStatus);
    console.log('  JobHistory row count:', jobHistoryRows);
    console.log('  Applications.status:', appStatus);
    console.log('  ApplicationHistory row count:', appHistoryRows);

    assert.equal(jobStatus, 'Applied', 'CRITICAL BUG: Jobs was mutated to Applied despite Application update failure');
    assert.equal(jobHistoryRows, 2, 'CRITICAL BUG: JobHistory recorded transition despite Application failure');
    assert.equal(appStatus, 'Draft', 'Applications remained in Draft');
    assert.equal(appHistoryRows, 1, 'ApplicationHistory was not appended');
  });
});

describe('Challenger 2 - Dimension 2: Concurrency, Locking & Preconditions', () => {
  it('2.1: withLock_ timeout handling in createApplication_ and updateApplicationStatus_', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })],
      [], [],
      { lockOptions: { alwaysFail: true } }
    );

    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft');
    }, (err) => {
      assert.equal(err.code, 'BUSY');
      return true;
    });

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'BUSY');
      return true;
    });

    // Zero modifications to any sheet
    assert.equal(ctx.sheetsByName.Applications.data.length, 2);
    assert.equal(ctx.sheetsByName.Jobs.data.length, 2);
    assert.equal(ctx.sheetsByName.ApplicationHistory.data.length, 1);
    assert.equal(ctx.sheetsByName.JobHistory.data.length, 1);
  });

  it('2.2: Non-reentrancy verification: exactly ONE lock acquire and ONE release per operation', () => {
    const schema = schema_();
    let tryLockCalls = 0;
    let releaseLockCalls = 0;

    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [], [], []
    );

    const origGetScriptLock = ctx.sandbox.LockService.getScriptLock;
    ctx.sandbox.LockService.getScriptLock = function () {
      const lock = origGetScriptLock();
      return {
        tryLock: function (timeout) {
          tryLockCalls++;
          assert.equal(timeout, 15000, 'Expected 15s lock timeout');
          return lock.tryLock(timeout);
        },
        releaseLock: function () {
          releaseLockCalls++;
          return lock.releaseLock();
        }
      };
    };

    ctx.sandbox.createApplication_('job-1', 'Draft');
    assert.equal(tryLockCalls, 1, 'Expected exactly 1 lock acquisition in createApplication_');
    assert.equal(releaseLockCalls, 1, 'Expected exactly 1 lock release in createApplication_');

    tryLockCalls = 0;
    releaseLockCalls = 0;
    const appRows = ctx.sheetsByName.Applications.data;
    const appId = appRows[1][schema.Applications.indexOf('id')];

    ctx.sandbox.updateApplicationStatus_(appId, 'Applied');
    assert.equal(tryLockCalls, 1, 'Expected exactly 1 lock acquisition in updateApplicationStatus_');
    assert.equal(releaseLockCalls, 1, 'Expected exactly 1 lock release in updateApplicationStatus_');
  });

  it('2.3: PRECONDITION VULNERABILITY: updateApplicationStatus_ silently overwrites concurrent note updates because precondition only checks status', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft', notes: '[2026-09-10T10:00:00.000Z] Initial Note' })]
    );

    const origUpdate = ctx.sandbox.updateRecordByIdInDb_;
    ctx.sandbox.updateRecordByIdInDb_ = function (ss, sheetName, id, updates, precondition) {
      if (sheetName === 'Applications') {
        ctx.sheetsByName.Applications.data[1][schema.Applications.indexOf('notes')] =
          '[2026-09-10T10:00:00.000Z] Initial Note\n[2026-09-11T12:00:00.000Z] CONCURRENT IMPORTANT NOTE';
      }
      return origUpdate.apply(this, arguments);
    };

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Applied', {
      notes: 'Submitted via company website'
    }));

    console.log('[CHALLENGER 2 EMPIRICAL RESULT] Final stored notes in Applications:');
    console.log(JSON.stringify(updated.notes));

    const lostNote = updated.notes.includes('CONCURRENT IMPORTANT NOTE');
    assert.equal(lostNote, false, 'CRITICAL FINDING: Concurrent note update was silently clobbered and lost!');
  });

  it('2.4: UNPROTECTED METADATA MUTATION: updateApplicationMetadata_ runs with ZERO precondition checking', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Rejected' })]
    );

    const result = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Rejected', {
      contact_name: 'Post-Rejection Name Change'
    }));

    assert.equal(result.contact_name, 'Post-Rejection Name Change');
  });
});

describe('Challenger 2 - Dimension 3: Schema Integrity & Header Verification', () => {
  it('3.1: JobScores schema matches ANTIGRAVITY_PHASE_5_CONTROLLED_HANDOFF.md:131 exactly (26 cols)', () => {
    const schema = schema_();
    const expectedJobScores = [
      'id', 'job_id', 'job_description_hash', 'profile_version', 'prompt_version', 'schema_version',
      'provider', 'model', 'status', 'skills_match', 'experience_match', 'education_match',
      'location_match', 'salary_match', 'overall_match', 'recommendation', 'evidence_json',
      'gaps_json', 'input_tokens', 'output_tokens', 'estimated_cost', 'currency',
      'request_id_hash', 'created_at', 'validated_at', 'error_code'
    ];

    assert.equal(schema.JobScores.length, 26, 'JobScores must have 26 columns');
    assert.deepEqual(schema.JobScores, expectedJobScores, 'JobScores headers and order must match handoff spec');
  });

  it('3.2: ApplicationHistory schema matches spec (8 cols)', () => {
    const schema = schema_();
    const expectedAppHistory = [
      'id', 'application_id', 'job_id', 'action', 'from_status', 'to_status', 'note', 'created_at'
    ];

    assert.equal(schema.ApplicationHistory.length, 8, 'ApplicationHistory must have 8 columns');
    assert.deepEqual(schema.ApplicationHistory, expectedAppHistory, 'ApplicationHistory headers and order must match spec');
  });

  it('3.3: CRITICAL SCHEMA DISCREPANCY: AIUsage in Database.gs does NOT match ANTIGRAVITY_PHASE_5_CONTROLLED_HANDOFF.md:145', () => {
    const schema = schema_();
    const specRecommendedAIUsage = [
      'id', 'run_id', 'job_id', 'provider', 'model', 'operation',
      'profile_version', 'prompt_version', 'request_started_at', 'request_finished_at',
      'input_tokens', 'output_tokens', 'estimated_cost', 'currency', 'status', 'error_code'
    ];

    console.log('[CHALLENGER 2 EMPIRICAL RESULT] Schema Comparison for AIUsage:');
    console.log('  Spec Recommended:', specRecommendedAIUsage);
    console.log('  Database.gs Current:', schema.AIUsage);

    const missingJobId = schema.AIUsage.indexOf('job_id') === -1;
    const missingProfileVersion = schema.AIUsage.indexOf('profile_version') === -1;
    const missingPromptVersion = schema.AIUsage.indexOf('prompt_version') === -1;
    const missingRequestStartedAt = schema.AIUsage.indexOf('request_started_at') === -1;
    const missingRequestFinishedAt = schema.AIUsage.indexOf('request_finished_at') === -1;

    console.log('  job_id missing from AIUsage:', missingJobId);
    console.log('  profile_version missing from AIUsage:', missingProfileVersion);
    console.log('  prompt_version missing from AIUsage:', missingPromptVersion);

    assert.ok(missingJobId, 'AIUsage in Database.gs is missing job_id');
    assert.ok(missingProfileVersion, 'AIUsage in Database.gs is missing profile_version');
    assert.ok(missingPromptVersion, 'AIUsage in Database.gs is missing prompt_version');
  });
});
