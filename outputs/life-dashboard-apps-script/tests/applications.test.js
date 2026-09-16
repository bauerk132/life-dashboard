'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes');

const APP_FILES = [
  'Database.gs', 'Code.gs', 'Tasks.gs', 'Calendar.gs', 'Jobs.gs', 'Applications.gs'
];

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
    external_id: 'ext-1',
    source: 'Board',
    url: 'https://example.org/jobs/1',
    title: 'Senior Software Engineer',
    company: 'Acme Corp',
    location: 'Remote',
    remote: true,
    salary_min: 130000,
    salary_max: 160000,
    currency: 'USD',
    posted_at: '2026-09-10T12:00:00.000Z',
    discovered_at: '2026-09-11T12:00:00.000Z',
    last_seen_at: new Date(),
    description: 'Design and build resilient distributed systems',
    overall_match: 96,
    recommendation: 'Strong match',
    why_matches: 'Extensive systems experience',
    gaps: '',
    status: 'Ready to Apply',
    notes: '',
    record_version: 1
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
    contact_email: 'jane@acme.com',
    interview_at: '',
    outcome: '',
    notes: 'Draft application notes',
    created_at: new Date('2026-09-12T10:00:00Z'),
    updated_at: new Date('2026-09-12T10:00:00Z')
  };
  return rowFor_(schema, 'Applications', Object.assign(base, overrides || {}));
}

describe('Applications: Schema & Database Infrastructure', () => {
  it('registers Applications with the exact frozen column specification', () => {
    const schema = schema_();
    assert.deepEqual(schema.Applications, [
      'id', 'job_id', 'status', 'applied_at', 'follow_up_at', 'contact_name', 'contact_email',
      'interview_at', 'outcome', 'notes', 'created_at', 'updated_at'
    ]);
  });

  it('registers ApplicationHistory with all required audit columns', () => {
    const schema = schema_();
    assert.deepEqual(schema.ApplicationHistory, [
      'id', 'application_id', 'job_id', 'action', 'from_status', 'to_status', 'note', 'created_at'
    ]);
  });

  it('registers text fields in PLAIN_TEXT_FIELDS_ for plain-text formatting', () => {
    const ctx = loadAppsScriptContext_({ files: APP_FILES });
    const plainText = ctx.testExports.PLAIN_TEXT_FIELDS_;
    assert.deepEqual(plainText.Applications, [
      'id', 'contact_name', 'contact_email', 'outcome', 'notes'
    ]);
    assert.deepEqual(plainText.ApplicationHistory, [
      'id', 'application_id', 'job_id', 'action', 'from_status', 'to_status', 'note'
    ]);
  });

  it('initializeDatabase creates Applications and ApplicationHistory sheets idempotently', () => {
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: {} });
    const res1 = ctx.sandbox.initializeDatabase();
    assert.equal(res1.status, 'ok');

    const appSheet = ctx.sheetsByName.Applications;
    const histSheet = ctx.sheetsByName.ApplicationHistory;
    assert.ok(appSheet, 'Applications sheet must exist');
    assert.ok(histSheet, 'ApplicationHistory sheet must exist');
    assert.deepEqual(appSheet.data[0], ctx.testExports.SCHEMA.Applications);
    assert.deepEqual(histSheet.data[0], ctx.testExports.SCHEMA.ApplicationHistory);

    const res2 = ctx.sandbox.initializeDatabase();
    assert.equal(res2.status, 'ok');
  });
});

describe('Applications: Application Creation (createApplication)', () => {
  it('creates a Draft application with valid job_id and logs to ApplicationHistory', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-100', status: 'Saved' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const created = ctx.sandbox.createApplication({
      job_id: 'job-100',
      contact_name: 'John Doe',
      contact_email: 'john@example.com',
      notes: 'Submitted resume'
    });

    assert.ok(created.id, 'Application ID must be generated');
    assert.equal(created.job_id, 'job-100');
    assert.equal(created.status, 'Draft');
    assert.equal(created.contact_name, 'John Doe');
    assert.equal(created.contact_email, 'john@example.com');
    assert.equal(created.notes, 'Submitted resume');
    assert.ok(created.created_at, 'created_at must be populated');
    assert.ok(created.updated_at, 'updated_at must be populated');

    // Verify ApplicationHistory
    const histRows = ctx.sheetsByName.ApplicationHistory.data.slice(1);
    assert.equal(histRows.length, 1);
    const hist = histRows[0];
    assert.equal(hist[1], created.id); // application_id
    assert.equal(hist[2], 'job-100');   // job_id
    assert.equal(hist[3], 'create_application'); // action
    assert.equal(hist[4], '');          // from_status
    assert.equal(hist[5], 'Draft');     // to_status

    // Job status should remain unchanged for Draft
    const jobRows = ctx.sheetsByName.Jobs.data.slice(1);
    assert.equal(jobRows[0][23], 'Saved'); // status is column index 23
  });

  it('creates an Applied application and synchronizes status with Jobs.gs', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-200', status: 'Ready to Apply' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const created = ctx.sandbox.createApplication({
      job_id: 'job-200',
      status: 'Applied',
      notes: 'Applied via company portal'
    });

    assert.equal(created.status, 'Applied');
    assert.ok(created.applied_at, 'applied_at should be auto-set');

    // Job should be synced to Applied
    const job = ctx.sandbox.getApplicationById(created.id);
    const jobRecord = ctx.sheetsByName.Jobs.data.slice(1)[0];
    assert.equal(jobRecord[23], 'Applied'); // Jobs.status

    // JobHistory should record application_sync
    const jobHistRows = ctx.sheetsByName.JobHistory.data.slice(1);
    assert.equal(jobHistRows.length, 1);
    assert.equal(jobHistRows[0][1], 'job-200');
    assert.equal(jobHistRows[0][2], 'application_sync');
    assert.equal(jobHistRows[0][3], 'Ready to Apply');
    assert.equal(jobHistRows[0][4], 'Applied');
  });

  it('rejects invalid payload types', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.createApplication(null), (err) => {
      assert.equal(err.code, 'INVALID_RECORD');
      return true;
    });
    assert.throws(() => ctx.sandbox.createApplication('not an object'), (err) => {
      assert.equal(err.code, 'INVALID_RECORD');
      return true;
    });
    assert.throws(() => ctx.sandbox.createApplication([]), (err) => {
      assert.equal(err.code, 'INVALID_RECORD');
      return true;
    });
  });

  it('rejects missing or blank job_id', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.createApplication({}), (err) => {
      assert.equal(err.code, 'INVALID_ID');
      return true;
    });
    assert.throws(() => ctx.sandbox.createApplication({ job_id: '   ' }), (err) => {
      assert.equal(err.code, 'INVALID_ID');
      return true;
    });
  });

  it('rejects nonexistent job_id', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.createApplication({ job_id: 'nonexistent-job' }), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
  });

  it('rejects unknown fields in payload', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1' }));
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.createApplication({
      job_id: 'job-1',
      unknown_field: 'illegal'
    }), (err) => {
      assert.equal(err.code, 'UNKNOWN_FIELD');
      return true;
    });
  });

  it('rejects invalid initial status', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1' }));
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.createApplication({
      job_id: 'job-1',
      status: 'Interview'
    }), (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });
  });

  it('supports caller-supplied ID and safe idempotent retry', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1' }));
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-2' }));
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    const appId = 'app-custom-uuid-1';
    const app1 = ctx.sandbox.createApplication({
      id: appId,
      job_id: 'job-1',
      status: 'Draft',
      notes: 'First attempt'
    });
    assert.equal(app1.id, appId);

    // Identical retry returns existing application
    const app2 = ctx.sandbox.createApplication({
      id: appId,
      job_id: 'job-1',
      status: 'Draft',
      notes: 'First attempt'
    });
    assert.equal(app2.id, appId);
    assert.equal(ctx.sheetsByName.Applications.data.length, 2); // header + 1 row

    // Conflicting retry with different job_id throws DUPLICATE_ID
    assert.throws(() => ctx.sandbox.createApplication({
      id: appId,
      job_id: 'job-2',
      status: 'Draft'
    }), (err) => {
      assert.equal(err.code, 'DUPLICATE_ID');
      return true;
    });
  });
});

describe('Applications: Single Active Application Invariant', () => {
  it('prevents creating a second active application for the same job', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.createApplication({
      job_id: 'job-1',
      status: 'Draft'
    }), (err) => {
      assert.equal(err.code, 'ACTIVE_APPLICATION_EXISTS');
      return true;
    });

    assert.throws(() => ctx.sandbox.createApplication({
      job_id: 'job-1',
      status: 'Applied'
    }), (err) => {
      assert.equal(err.code, 'ACTIVE_APPLICATION_EXISTS');
      return true;
    });
  });

  it('allows creating a new application when prior application was Rejected', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Reviewed' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-prior', job_id: 'job-1', status: 'Rejected' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const newApp = ctx.sandbox.createApplication({
      job_id: 'job-1',
      status: 'Draft',
      notes: 'Re-applying for updated position'
    });

    assert.ok(newApp.id);
    assert.equal(newApp.status, 'Draft');
    assert.equal(ctx.sheetsByName.Applications.data.length, 3); // header + 2 applications
  });

  it('allows creating a new application when prior application was Withdrawn', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Reviewed' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-prior', job_id: 'job-1', status: 'Withdrawn' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const newApp = ctx.sandbox.createApplication({
      job_id: 'job-1',
      status: 'Draft',
      notes: 'Re-opening candidacy'
    });

    assert.ok(newApp.id);
    assert.equal(newApp.status, 'Draft');
  });
});

describe('Applications: State Machine Transitions (setApplicationStatus)', () => {
  it('executes full valid lifecycle Draft -> Applied -> Interview -> Offered -> Rejected', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    // Draft -> Applied
    const app1 = ctx.sandbox.setApplicationStatus('app-1', 'Applied', 'Sent application');
    assert.equal(app1.status, 'Applied');
    assert.ok(app1.applied_at);

    // Applied -> Interview
    const app2 = ctx.sandbox.setApplicationStatus('app-1', 'Interview', 'Technical screen scheduled');
    assert.equal(app2.status, 'Interview');

    // Interview -> Offered
    const app3 = ctx.sandbox.setApplicationStatus('app-1', 'Offered', 'Received official offer letter');
    assert.equal(app3.status, 'Offered');

    // Offered -> Rejected
    const app4 = ctx.sandbox.setApplicationStatus('app-1', 'Rejected', 'Declined offer due to compensation');
    assert.equal(app4.status, 'Rejected');

    // Check ApplicationHistory has all 4 transitions recorded
    const history = ctx.sandbox.getApplicationHistory('app-1');
    assert.equal(history.status, 'ok');
    assert.equal(history.entries.length, 4);
    const toStatuses = history.entries.map((e) => e.toStatus).sort();
    assert.deepEqual(hostify_(toStatuses), ['Applied', 'Interview', 'Offered', 'Rejected']);
  });

  it('allows Withdrawn from any active state where the derived Job transition is legal', () => {
    // Draft→Withdrawn maps App to derived Job status 'Reviewed' (via APP_TO_JOB_STATUS_).
    // 'Reviewed' is only reachable via JOB_TRANSITIONS_ from 'Rejected'.
    // The other active states (Applied, Interview, Offered) map to Job statuses that are
    // legal from those respective Job states. §6.2 fix: Draft withdrawal from a
    // 'Ready to Apply' job is now correctly rejected (see G02 in the guard suite).
    const cases = [
      { appStatus: 'Draft',     jobStatus: 'Rejected'   }, // Draft→Withdrawn→Reviewed; Rejected→Reviewed ✓
      { appStatus: 'Applied',   jobStatus: 'Applied'    }, // Applied→Withdrawn→Reviewed; Applied has no Reviewed ✗
      { appStatus: 'Interview', jobStatus: 'Interview'  }, // Interview→Withdrawn→Reviewed; Interview has no Reviewed ✗
      { appStatus: 'Offered',   jobStatus: 'Offer'      }, // Offered→Withdrawn→Reviewed; Offer has no Reviewed ✗
    ];

    // Only Draft/Rejected is truly a "clean" full Withdrawn sync.
    // For Applied/Interview/Offered the derived Job status for Withdrawn is 'Reviewed'
    // which is NOT in JOB_TRANSITIONS_['Applied'|'Interview'|'Offer']. So those now
    // throw INVALID_TRANSITION when withdrawing, which is the corrected behavior.
    // Test the one legal case.
    const { appStatus, jobStatus } = cases[0]; // Draft + Rejected → legal Withdrawn
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    const jobId = 'job-withdraw-draft';
    const appId = 'app-withdraw-draft';
    sheets.Jobs.rows.push(jobRow_(schema, { id: jobId, status: jobStatus }));
    sheets.Applications.rows.push(appRow_(schema, { id: appId, job_id: jobId, status: appStatus }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const updated = ctx.sandbox.setApplicationStatus(appId, 'Withdrawn', 'Withdrawn by candidate');
    assert.equal(updated.status, 'Withdrawn');

    // Job should reset to Reviewed (legal from Rejected)
    const ss = ctx.sandbox.getDb_();
    const jobs = ctx.sandbox.readRows_(ss, 'Jobs').filter((j) => j.id === jobId);
    assert.equal(jobs[0].status, 'Reviewed', 'Job must be synced to Reviewed when withdrawing from Rejected state');

    // Verify that the now-illegal cases (Applied/Interview/Offered Withdrawn→Reviewed)
    // throw INVALID_TRANSITION to confirm the guard is enforced broadly.
    ['Applied', 'Interview', 'Offered'].forEach((illegalAppStatus, i) => {
      const illegalJobStatus = { 'Applied': 'Applied', 'Interview': 'Interview', 'Offered': 'Offer' }[illegalAppStatus];
      const schema2 = schema_();
      const sheets2 = initializedSheets_(schema2);
      const jobId2 = 'job-withdraw-illegal-' + i;
      const appId2 = 'app-withdraw-illegal-' + i;
      sheets2.Jobs.rows.push(jobRow_(schema2, { id: jobId2, status: illegalJobStatus }));
      sheets2.Applications.rows.push(appRow_(schema2, { id: appId2, job_id: jobId2, status: illegalAppStatus }));
      const ctx2 = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets2 });
      assert.throws(() => {
        ctx2.sandbox.setApplicationStatus(appId2, 'Withdrawn', '');
      }, (err) => err.code === 'INVALID_TRANSITION',
      illegalAppStatus + '→Withdrawn must throw INVALID_TRANSITION (Job cannot reach Reviewed from ' + illegalJobStatus + ')');
    });
  });


  it('rejects invalid state machine skipping and backward transitions', () => {
    const invalidTransitions = [
      { from: 'Draft', to: 'Interview' },
      { from: 'Draft', to: 'Offered' },
      { from: 'Draft', to: 'Rejected' },
      { from: 'Applied', to: 'Draft' },
      { from: 'Interview', to: 'Draft' },
      { from: 'Interview', to: 'Applied' },
      { from: 'Offered', to: 'Draft' },
      { from: 'Offered', to: 'Applied' },
      { from: 'Offered', to: 'Interview' },
      { from: 'Rejected', to: 'Draft' },
      { from: 'Rejected', to: 'Applied' },
      { from: 'Rejected', to: 'Withdrawn' },
      { from: 'Withdrawn', to: 'Draft' },
      { from: 'Withdrawn', to: 'Applied' }
    ];

    invalidTransitions.forEach(({ from, to }) => {
      const schema = schema_();
      const sheets = initializedSheets_(schema);
      sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' }));
      sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', status: from }));

      const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
      assert.throws(() => ctx.sandbox.setApplicationStatus('app-1', to), (err) => {
        assert.equal(err.code, 'INVALID_TRANSITION', `Transition ${from} -> ${to} must throw INVALID_TRANSITION`);
        return true;
      });
    });
  });

  it('is idempotent when setting already-current status', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Applied' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const unchanged = ctx.sandbox.setApplicationStatus('app-1', 'Applied');
    assert.equal(unchanged.status, 'Applied');

    // No new history entry should be appended
    assert.equal(ctx.sheetsByName.ApplicationHistory.data.length, 1); // header only
    assert.equal(ctx.sheetsByName.JobHistory.data.length, 1); // header only
  });

  it('rejects invalid status string and missing application ID', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.setApplicationStatus('app-1', 'NonExistentStatus'), (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });

    assert.throws(() => ctx.sandbox.setApplicationStatus('', 'Applied'), (err) => {
      assert.equal(err.code, 'INVALID_ID');
      return true;
    });

    assert.throws(() => ctx.sandbox.setApplicationStatus('nonexistent-app', 'Applied'), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
  });
});

describe('Applications: Bidirectional Cross-Sheet Synchronization', () => {
  it('guards precondition: cannot set Application to Applied when Job is New or Rejected', () => {
    ['New', 'Rejected'].forEach((badJobStatus) => {
      const schema = schema_();
      const sheets = initializedSheets_(schema);
      sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: badJobStatus }));
      sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' }));

      const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
      assert.throws(() => ctx.sandbox.setApplicationStatus('app-1', 'Applied'), (err) => {
        assert.equal(err.code, 'INVALID_TRANSITION');
        return true;
      });

      // Assert no partial writes occurred
      const app = ctx.sheetsByName.Applications.data.slice(1)[0];
      assert.equal(app[2], 'Draft'); // Applications.status unchanged
      const job = ctx.sheetsByName.Jobs.data.slice(1)[0];
      assert.equal(job[23], badJobStatus); // Jobs.status unchanged
      assert.equal(ctx.sheetsByName.ApplicationHistory.data.length, 1);
    });
  });

  it('synchronizes Application Offered to Job Offer with proper naming translation', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Interview' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Interview' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    ctx.sandbox.setApplicationStatus('app-1', 'Offered', 'Received verbal offer');

    const job = ctx.sheetsByName.Jobs.data.slice(1)[0];
    assert.equal(job[23], 'Offer'); // Job status is Offer, not Offered

    const jobHistory = ctx.sheetsByName.JobHistory.data.slice(1);
    assert.equal(jobHistory.length, 1);
    assert.equal(jobHistory[0][1], 'job-1');
    assert.equal(jobHistory[0][2], 'application_sync');
    assert.equal(jobHistory[0][3], 'Interview');
    assert.equal(jobHistory[0][4], 'Offer');
  });

  it('reverse sync: setJobStatus in Jobs.gs automatically updates active Application and records history', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1', status: 'Applied', record_version: 1 }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    // Call setJobStatus on Jobs.gs
    ctx.sandbox.setJobStatus('job-1', 'Interview');

    // Verify Application was updated to Interview
    const app = ctx.sandbox.getApplicationById('app-1');
    assert.equal(app.status, 'Interview');

    // Verify ApplicationHistory has sync_from_job action
    const history = ctx.sandbox.getApplicationHistory('app-1');
    assert.equal(history.status, 'ok');
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].action, 'sync_from_job');
    assert.equal(history.entries[0].fromStatus, 'Applied');
    assert.equal(history.entries[0].toStatus, 'Interview');
  });

  it('reverse sync: setJobStatus on job without application completes safely without errors', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-standalone', status: 'New', record_version: 1 }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const updated = ctx.sandbox.setJobStatus('job-standalone', 'Reviewed');
    assert.equal(updated.status, 'Reviewed');
  });
});

describe('Applications: Query and History Retrieval', () => {
  it('getApplicationById returns matching application', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-find-me', contact_name: 'Alice' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const app = ctx.sandbox.getApplicationById('app-find-me');
    assert.equal(app.id, 'app-find-me');
    assert.equal(app.contact_name, 'Alice');
  });

  it('getApplicationById throws NOT_FOUND for non-existent ID', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.getApplicationById('missing-app'), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
  });

  it('getApplicationsByJobId returns all applications for a job', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-target' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-old', job_id: 'job-target', status: 'Rejected' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-new', job_id: 'job-target', status: 'Draft' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const list = ctx.sandbox.getApplicationsByJobId('job-target');
    assert.equal(list.length, 2);
    assert.deepEqual(hostify_(list).map((a) => a.id).sort(), ['app-new', 'app-old']);
  });

  it('getApplicationsByJobId throws NOT_FOUND if job does not exist', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    assert.throws(() => ctx.sandbox.getApplicationsByJobId('nonexistent-job'), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
  });

  it('getApplicationHistory quarantines corrupted entries and returns valid ones sorted descending', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1' }));

    sheets.ApplicationHistory.rows.push(rowFor_(schema, 'ApplicationHistory', {
      id: 'h-1',
      application_id: 'app-1',
      job_id: 'job-1',
      action: 'change_status',
      from_status: 'Draft',
      to_status: 'Applied',
      note: 'Step 1',
      created_at: new Date('2026-09-12T11:00:00Z')
    }));
    sheets.ApplicationHistory.rows.push(rowFor_(schema, 'ApplicationHistory', {
      id: 'h-2',
      application_id: 'app-1',
      job_id: 'job-1',
      action: 'change_status',
      from_status: 'Applied',
      to_status: 'Interview',
      note: 'Step 2',
      created_at: new Date('2026-09-12T12:00:00Z')
    }));
    // Corrupted entry: missing action
    sheets.ApplicationHistory.rows.push(rowFor_(schema, 'ApplicationHistory', {
      id: 'h-corrupt',
      application_id: 'app-1',
      job_id: 'job-1',
      action: '',
      from_status: '',
      to_status: '',
      created_at: new Date('2026-09-12T13:00:00Z')
    }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const hist = ctx.sandbox.getApplicationHistory('app-1');

    assert.equal(hist.status, 'ok');
    assert.equal(hist.quarantinedCount, 1);
    assert.equal(hist.entries.length, 2);
    // Descending order
    assert.equal(hist.entries[0].id, 'h-2');
    assert.equal(hist.entries[1].id, 'h-1');
  });
});

describe('Applications: Application Update (updateApplication)', () => {
  it('updates mutable fields and logs to ApplicationHistory', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-1' }));
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1', contact_name: 'Old Name' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const updated = ctx.sandbox.updateApplication('app-1', {
      contact_name: 'New Recruiter',
      contact_email: 'recruiter@company.com',
      notes: 'Updated salary expectation',
      outcome: 'Pending screening'
    });

    assert.equal(updated.contact_name, 'New Recruiter');
    assert.equal(updated.contact_email, 'recruiter@company.com');
    assert.equal(updated.notes, 'Updated salary expectation');
    assert.equal(updated.outcome, 'Pending screening');

    const history = ctx.sandbox.getApplicationHistory('app-1');
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].action, 'update_application');
  });

  it('forbids direct status modification via updateApplication', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    assert.throws(() => ctx.sandbox.updateApplication('app-1', { status: 'Offered' }), (err) => {
      assert.equal(err.code, 'FORBIDDEN_FIELD');
      return true;
    });
  });

  it('forbids ID and job_id modification via updateApplication', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1', job_id: 'job-1' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    assert.throws(() => ctx.sandbox.updateApplication('app-1', { id: 'new-id' }), (err) => {
      assert.equal(err.code, 'FORBIDDEN_FIELD');
      return true;
    });
    assert.throws(() => ctx.sandbox.updateApplication('app-1', { job_id: 'new-job' }), (err) => {
      assert.equal(err.code, 'FORBIDDEN_FIELD');
      return true;
    });
  });

  it('rejects unknown fields in updateApplication', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Applications.rows.push(appRow_(schema, { id: 'app-1' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    assert.throws(() => ctx.sandbox.updateApplication('app-1', { custom_random_prop: 123 }), (err) => {
      assert.equal(err.code, 'UNKNOWN_FIELD');
      return true;
    });
  });
});

describe('Applications: Data Integrity & Formula Injection Defense', () => {
  it('escapes formula injection prefixes with leading apostrophe', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-sec' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const app = ctx.sandbox.createApplication({
      job_id: 'job-sec',
      contact_name: '=cmd|’ /C calc’!A0',
      contact_email: '+valid.email@example.com',
      notes: '+SUM(A1:A10)',
      outcome: '-100'
    });

    assert.equal(app.contact_name, "'=cmd|’ /C calc’!A0");
    assert.equal(app.contact_email, "'+valid.email@example.com");
    assert.equal(app.notes, "'+SUM(A1:A10)");
    assert.equal(app.outcome, "'-100");

    // Also verify status transition note escaping
    ctx.sandbox.setApplicationStatus(app.id, 'Applied', '@mention_admin');
    const hist = ctx.sandbox.getApplicationHistory(app.id);
    const historyNotes = hist.entries.map((e) => e.note);
    assert.ok(historyNotes.indexOf("'@mention_admin") !== -1, 'Transition note must be formula-escaped');
  });

  it('enforces string length limits across all text fields', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-len' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    // Contact name > 200
    assert.throws(() => ctx.sandbox.createApplication({
      job_id: 'job-len',
      contact_name: 'A'.repeat(201)
    }), (err) => {
      assert.equal(err.code, 'INVALID_FIELD');
      return true;
    });

    // Notes > 1000
    assert.throws(() => ctx.sandbox.createApplication({
      job_id: 'job-len',
      notes: 'B'.repeat(1001)
    }), (err) => {
      assert.equal(err.code, 'INVALID_FIELD');
      return true;
    });

    // Outcome > 500
    assert.throws(() => ctx.sandbox.createApplication({
      job_id: 'job-len',
      outcome: 'C'.repeat(501)
    }), (err) => {
      assert.equal(err.code, 'INVALID_FIELD');
      return true;
    });

    // Status transition note > 1000
    const app = ctx.sandbox.createApplication({ job_id: 'job-len' });
    assert.throws(() => ctx.sandbox.setApplicationStatus(app.id, 'Applied', 'D'.repeat(1001)), (err) => {
      assert.equal(err.code, 'INVALID_FIELD');
      return true;
    });
  });

  it('validates contact email format strictly', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-mail' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    const invalidEmails = [
      'notanemail',
      'user@',
      '@domain.com',
      'user@domain',
      'user@.com',
      'user name@domain.com'
    ];

    invalidEmails.forEach((email) => {
      assert.throws(() => ctx.sandbox.createApplication({
        job_id: 'job-mail',
        contact_email: email
      }), (err) => {
        assert.equal(err.code, 'INVALID_FIELD', `Email "${email}" should be rejected with INVALID_FIELD`);
        return true;
      });
    });

    // Valid email succeeds
    const app = ctx.sandbox.createApplication({
      job_id: 'job-mail',
      contact_email: 'candidate+jobs@sub.domain.org'
    });
    assert.equal(app.contact_email, 'candidate+jobs@sub.domain.org');
  });
});

describe('Applications: Offline Isolation & UrlFetchApp Invariant', () => {
  it('makes exactly 0 calls to UrlFetchApp across all application operations', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-iso', status: 'Ready to Apply' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    const app = ctx.sandbox.createApplication({
      job_id: 'job-iso',
      contact_name: 'Test Candidate',
      contact_email: 'test@candidate.io',
      notes: 'Testing offline isolation'
    });

    ctx.sandbox.setApplicationStatus(app.id, 'Applied', 'Offline submit');
    ctx.sandbox.setApplicationStatus(app.id, 'Interview', 'Offline interview');
    ctx.sandbox.updateApplication(app.id, { notes: 'Updated notes offline' });
    ctx.sandbox.getApplicationById(app.id);
    ctx.sandbox.getApplicationsByJobId('job-iso');
    ctx.sandbox.getApplicationHistory(app.id);

    // Hard assertion: zero network calls made
    assert.equal(ctx.urlFetch.calls.length, 0, 'UrlFetchApp must never be invoked during application operations');
  });
});

describe('Applications: Concurrency and Replay Repairs (F4, F12)', () => {
  it('F4: setApplicationStatus rejects stale concurrent edit with CONFLICT', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    // §6.2 fix: Draft→Withdrawn derives Job→Reviewed. This is only legal when Job is at Rejected.
    // Use Rejected so the pre-write transition guard passes and the CONFLICT check can fire.
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-f4-1', status: 'Rejected' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const app = ctx.sandbox.createApplication({ job_id: 'job-f4-1', status: 'Draft' });

    // Simulate concurrent edit in sheet before update executes:
    const originalFind = ctx.sandbox.findUniqueApplicationById_;
    ctx.sandbox.findUniqueApplicationById_ = function (ss, id) {
      const result = originalFind.call(this, ss, id);
      // Alter sheet data directly to simulate concurrent modification
      const sheet = ss.getSheetByName('Applications');
      const statusIdx = schema.Applications.indexOf('status');
      sheet.data[1][statusIdx] = 'Applied'; // changed concurrently
      return result;
    };

    assert.throws(() => {
      ctx.sandbox.setApplicationStatus(app.id, 'Withdrawn', 'Test conflict');
    }, (err) => {
      assert.equal(err.code, 'CONFLICT');
      return true;
    });
  });


  it('F4: updateApplication rejects stale concurrent edit with CONFLICT', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-f4-2', status: 'Ready to Apply' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });
    const app = ctx.sandbox.createApplication({ job_id: 'job-f4-2', status: 'Draft' });

    // Simulate concurrent edit in sheet before update executes
    const originalFind = ctx.sandbox.findUniqueApplicationById_;
    ctx.sandbox.findUniqueApplicationById_ = function (ss, id) {
      const result = originalFind.call(this, ss, id);
      const sheet = ss.getSheetByName('Applications');
      const statusIdx = schema.Applications.indexOf('status');
      sheet.data[1][statusIdx] = 'Applied'; // changed concurrently
      return result;
    };

    assert.throws(() => {
      ctx.sandbox.updateApplication(app.id, { notes: 'New notes' });
    }, (err) => {
      assert.equal(err.code, 'CONFLICT');
      return true;
    });
  });

  it('F12: createApplication replay with omitted status on Applied row returns idempotent success', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-f12', status: 'Ready to Apply' }));

    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    // Initial creation with explicit Applied status
    const app = ctx.sandbox.createApplication({
      id: 'app-replay-1',
      job_id: 'job-f12',
      status: 'Applied'
    });
    assert.equal(app.status, 'Applied');

    // Retry with omitted status - should succeed idempotently, not throw DUPLICATE_ID
    const replayed = ctx.sandbox.createApplication({
      id: 'app-replay-1',
      job_id: 'job-f12'
    });
    assert.equal(replayed.id, 'app-replay-1');
    assert.equal(replayed.status, 'Applied');
  });
});

// ---------------------------------------------------------------------------
// Suite: Application-derived Job transition guard (contract §6.2)
// ---------------------------------------------------------------------------
describe('Application-derived Job transition guard (contract §6.2)', () => {

  it('G01: legal Application transition still updates linked Job and appends history', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    // Job starts at Reviewed; Applied Application → setApplicationStatus('Applied')
    // maps App Applied → Job Applied. JOB_TRANSITIONS_['Reviewed'] includes 'Saved','Rejected'
    // — but wait: Reviewed→Applied is not legal. Let's use a proper legal chain:
    // Job at 'Ready to Apply', App transitions Draft→Applied → Job maps to Applied ✓
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-g01', status: 'Ready to Apply' }));
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    const app = ctx.sandbox.createApplication({ job_id: 'job-g01', status: 'Draft' });
    const updated = ctx.sandbox.setApplicationStatus(app.id, 'Applied', '');

    assert.equal(updated.status, 'Applied');

    const ss = ctx.sandbox.getDb_();
    const jobs = ctx.sandbox.readRows_(ss, 'Jobs').filter((j) => j.id === 'job-g01');
    assert.equal(jobs[0].status, 'Applied', 'Job must be synced to Applied');

    const jobHistory = ctx.sandbox.readRows_(ss, 'JobHistory').filter((h) => h.job_id === 'job-g01');
    assert.ok(jobHistory.length > 0, 'JobHistory must have at least one entry for the sync');
    assert.equal(jobHistory[jobHistory.length - 1].to_status, 'Applied');
  });

  it('G02: App Draft→Withdrawn from a Ready to Apply Job throws INVALID_TRANSITION before any write', () => {
    // APP_TO_JOB_STATUS_['Withdrawn'] === 'Reviewed'
    // JOB_TRANSITIONS_['Ready to Apply'] === ['Applied','Rejected'] — does NOT include 'Reviewed'
    // → syncJobFromApplicationStatus_ must throw INVALID_TRANSITION before touching any table.
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-g02', status: 'Ready to Apply' }));
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    const app = ctx.sandbox.createApplication({ job_id: 'job-g02', status: 'Draft' });

    const ss = ctx.sandbox.getDb_();

    // Capture counts before the attempted transition.
    const appsBefore = ctx.sandbox.readRows_(ss, 'Applications').length;
    const jobsBefore = ctx.sandbox.readRows_(ss, 'Jobs').length;
    const appHistBefore = ctx.sandbox.readRows_(ss, 'ApplicationHistory').length;
    const jobHistBefore = ctx.sandbox.readRows_(ss, 'JobHistory').length;
    const jobStatusBefore = ctx.sandbox.readRows_(ss, 'Jobs').find((j) => j.id === 'job-g02').status;

    assert.throws(() => {
      ctx.sandbox.setApplicationStatus(app.id, 'Withdrawn', '');
    }, (err) => {
      return err.code === 'INVALID_TRANSITION';
    }, 'Must throw INVALID_TRANSITION for Ready to Apply → derived Reviewed');

    // Verify atomicity: no table was modified.
    const appsAfter = ctx.sandbox.readRows_(ss, 'Applications').length;
    const jobsAfter = ctx.sandbox.readRows_(ss, 'Jobs').length;
    const appHistAfter = ctx.sandbox.readRows_(ss, 'ApplicationHistory').length;
    const jobHistAfter = ctx.sandbox.readRows_(ss, 'JobHistory').length;
    const jobStatusAfter = ctx.sandbox.readRows_(ss, 'Jobs').find((j) => j.id === 'job-g02').status;

    assert.equal(appsAfter, appsBefore, 'Applications row count must be unchanged');
    assert.equal(jobsAfter, jobsBefore, 'Jobs row count must be unchanged');
    assert.equal(appHistAfter, appHistBefore, 'ApplicationHistory must have no new rows');
    assert.equal(jobHistAfter, jobHistBefore, 'JobHistory must have no new rows');
    assert.equal(jobStatusAfter, jobStatusBefore, 'Job status must be unchanged');
    assert.equal(jobStatusAfter, 'Ready to Apply', 'Job must still be at Ready to Apply');
  });

  it('G03: App transition that maps to null (e.g. Draft stays as Draft Job) is a no-op and does not throw', () => {
    // APP_TO_JOB_STATUS_['Draft'] is null → no Job sync attempted; must not throw.
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-g03', status: 'New' }));
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    // Create Draft application; job stays at New. No sync attempted for Draft app status.
    assert.doesNotThrow(() => {
      ctx.sandbox.createApplication({ job_id: 'job-g03', status: 'Draft' });
    }, 'Creating a Draft application must not attempt Job sync or throw');
  });

  it('G04: legal Rejected transition (Applied Job → App moves to Rejected → Job maps to Rejected) succeeds', () => {
    // JOB_TRANSITIONS_['Applied'] includes 'Rejected' ✓
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows.push(jobRow_(schema, { id: 'job-g04', status: 'Ready to Apply' }));
    const ctx = loadAppsScriptContext_({ files: APP_FILES, initialSheets: sheets });

    // Move App to Applied first (syncs Job to Applied).
    const app = ctx.sandbox.createApplication({ job_id: 'job-g04', status: 'Draft' });
    ctx.sandbox.setApplicationStatus(app.id, 'Applied', '');

    const ss = ctx.sandbox.getDb_();
    const jobAfterApplied = ctx.sandbox.readRows_(ss, 'Jobs').find((j) => j.id === 'job-g04');
    assert.equal(jobAfterApplied.status, 'Applied', 'Pre-condition: job must be Applied');

    // Now transition App to Rejected → should sync Job to Rejected.
    assert.doesNotThrow(() => {
      ctx.sandbox.setApplicationStatus(app.id, 'Rejected', '');
    }, 'Applied→Rejected transition is legal and must not throw');

    const jobAfterRejected = ctx.sandbox.readRows_(ss, 'Jobs').find((j) => j.id === 'job-g04');
    assert.equal(jobAfterRejected.status, 'Rejected', 'Job must be synced to Rejected');
  });
});
