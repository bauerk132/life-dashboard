'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes');

const PHASE3_FILES = ['Database.gs', 'Code.gs', 'Tasks.gs', 'Calendar.gs', 'Jobs.gs'];

function schema_() {
  return loadAppsScriptContext_({ files: PHASE3_FILES }).testExports.SCHEMA;
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
    external_id: 'source-1',
    source: 'Example Board',
    url: 'https://jobs.example.org/posting/1',
    title: 'Data Analyst',
    company: 'Northwind',
    location: 'Remote, US',
    remote: true,
    salary_min: 70000,
    salary_max: 90000,
    currency: 'USD',
    posted_at: '2026-09-10T12:00:00.000Z',
    discovered_at: '2026-09-11T12:00:00.000Z',
    last_seen_at: new Date(),
    description: 'Analyze data',
    overall_match: 94,
    recommendation: 'Strong match',
    why_matches: 'SQL and reporting experience',
    gaps: 'No stated Tableau requirement',
    status: 'New',
    notes: '',
    record_version: 0
  };
  return rowFor_(schema, 'Jobs', Object.assign(base, overrides || {}));
}

function historyRow_(schema, overrides) {
  const base = {
    id: 'history-1',
    job_id: 'job-1',
    action: 'change_status',
    from_status: 'New',
    to_status: 'Reviewed',
    note: '',
    created_at: '2026-09-11T12:00:00.000Z'
  };
  return rowFor_(schema, 'JobHistory', Object.assign(base, overrides || {}));
}

function context_(jobs, histories, extra) {
  const schema = schema_();
  const sheets = initializedSheets_(schema);
  sheets.Jobs.rows = jobs || [];
  sheets.JobHistory.rows = histories || [];
  const ctx = loadAppsScriptContext_(Object.assign({
    files: PHASE3_FILES,
    initialSheets: sheets
  }, extra || {}));
  ctx.schema = schema;
  return ctx;
}

function jobField_(ctx, rowIndex, field) {
  return ctx.sheetsByName.Jobs.data[rowIndex][ctx.schema.Jobs.indexOf(field)];
}

describe('Phase 3 schema and queue reads', () => {
  it('adds JobHistory as an append-only initialized schema', () => {
    const ctx = loadAppsScriptContext_({ files: PHASE3_FILES });
    const schema = ctx.testExports.SCHEMA;
    assert.deepEqual(schema.JobHistory, [
      'id', 'job_id', 'action', 'from_status', 'to_status', 'note', 'created_at'
    ]);
    ctx.sandbox.initializeDatabase();
    assert.deepEqual(ctx.sheetsByName.JobHistory.data[0], schema.JobHistory);
  });

  it('returns stored active and rejected records without any write', () => {
    const schema = schema_();
    const ctx = context_([
      jobRow_(schema, { id: 'active-1', status: 'Reviewed' }),
      jobRow_(schema, { id: 'rejected-1', status: 'Rejected' })
    ]);
    const before = JSON.stringify(ctx.sheetsByName.Jobs.data);
    const result = hostify_(ctx.sandbox.getJobsQueue());

    assert.equal(result.status, 'ok');
    assert.equal(result.activeJobs.length, 1);
    assert.equal(result.rejectedJobs.length, 1);
    assert.equal(result.activeJobs[0].sourceUrl, 'https://jobs.example.org/posting/1');
    assert.equal(result.activeJobs[0].remote, true);
    assert.equal(result.activeJobs[0].overallMatch, 94);
    assert.equal(result.quarantined.length, 0);
    assert.equal(JSON.stringify(ctx.sheetsByName.Jobs.data), before, 'queue browsing must not write Jobs rows');
  });

  it('quarantines only malformed rows and never returns their unsafe URLs', () => {
    const schema = schema_();
    const ctx = context_([
      jobRow_(schema, { id: 'good', title: 'Good record' }),
      jobRow_(schema, { id: 'unsafe', title: 'Unsafe URL', url: 'javascript:alert(1)' }),
      jobRow_(schema, { id: '', title: 'No identifier' }),
      jobRow_(schema, { id: 'dup', title: 'Duplicate one' }),
      jobRow_(schema, { id: 'dup', title: 'Duplicate two' })
    ]);
    const result = hostify_(ctx.sandbox.getJobsQueue());

    assert.equal(result.activeJobs.length, 1);
    assert.equal(result.activeJobs[0].id, 'good');
    assert.equal(result.quarantined.length, 4);
    assert.ok(result.quarantined.every((issue) => issue.reason.indexOf('URL') === -1 || issue.reason === 'invalid source URL'));
    assert.equal(JSON.stringify(result).includes('javascript:alert'), false);
  });

  it('marks absent or old last_seen_at honestly instead of calling a job current', () => {
    const schema = schema_();
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const ctx = context_([
      jobRow_(schema, { id: 'old', last_seen_at: old }),
      jobRow_(schema, { id: 'unknown', last_seen_at: '' })
    ]);
    const result = hostify_(ctx.sandbox.getJobsQueue());

    assert.equal(result.activeJobs[0].freshness, 'stale');
    assert.equal(result.activeJobs[1].freshness, 'unknown');
  });

  it('accepts only strict absolute HTTP(S) URLs', () => {
    const ctx = context_();
    ['https://jobs.example.org/a', 'http://jobs.example.org:8080/a?q=1#details'].forEach((url) => {
      assert.equal(ctx.sandbox.validateSourceUrl_(url), url);
    });
    [
      'javascript:alert(1)', 'data:text/plain,hi', '//jobs.example.org/a',
      'https:// user@example.org', 'https://user@example.org/a',
      'https://jobs.example.org:99999/a', 'https://jobs.example.org\\evil'
    ].forEach((url) => {
      assert.throws(() => ctx.sandbox.validateSourceUrl_(url), (err) => {
        assert.equal(err.code, 'INVALID_URL');
        return true;
      });
    });
  });
});

describe('setJobStatus', () => {
  it('moves a job through an allowed transition and appends a server audit row', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema)]);
    const result = hostify_(ctx.sandbox.setJobStatus('job-1', 'Reviewed'));

    assert.equal(result.status, 'Reviewed');
    assert.equal(jobField_(ctx, 1, 'status'), 'Reviewed');
    assert.equal(jobField_(ctx, 1, 'record_version'), 1);
    assert.equal(ctx.sheetsByName.JobHistory.getLastRow(), 2);
    assert.equal(ctx.sheetsByName.JobHistory.data[1][ctx.schema.JobHistory.indexOf('action')], 'change_status');
    assert.equal(ctx.sheetsByName.JobHistory.data[1][ctx.schema.JobHistory.indexOf('from_status')], 'New');
    assert.equal(ctx.sheetsByName.JobHistory.data[1][ctx.schema.JobHistory.indexOf('to_status')], 'Reviewed');
  });

  it('treats a retry to the already-current status as a no-op with no second audit row', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { status: 'Reviewed', record_version: 3 })]);
    const result = hostify_(ctx.sandbox.setJobStatus('job-1', 'Reviewed'));

    assert.equal(result.status, 'Reviewed');
    assert.equal(ctx.sheetsByName.JobHistory.getLastRow(), 1);
    assert.equal(jobField_(ctx, 1, 'record_version'), 3);
  });

  it('rejects an invalid transition without writing either Jobs or JobHistory', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { status: 'New' })]);
    const beforeJob = JSON.stringify(ctx.sheetsByName.Jobs.data);
    const beforeHistory = JSON.stringify(ctx.sheetsByName.JobHistory.data);

    assert.throws(() => ctx.sandbox.setJobStatus('job-1', 'Applied'), (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
    assert.equal(JSON.stringify(ctx.sheetsByName.Jobs.data), beforeJob);
    assert.equal(JSON.stringify(ctx.sheetsByName.JobHistory.data), beforeHistory);
  });

  it('rejects an unknown target status and a blank id without writes', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema)]);
    const before = JSON.stringify(ctx.sheetsByName.Jobs.data);
    assert.throws(() => ctx.sandbox.setJobStatus('job-1', 'Hired'), (err) => err.code === 'INVALID_STATUS');
    assert.throws(() => ctx.sandbox.setJobStatus('', 'Reviewed'), (err) => err.code === 'INVALID_ID');
    assert.equal(JSON.stringify(ctx.sheetsByName.Jobs.data), before);
  });

  it('records saved_at once and recovers a rejected job only to Reviewed', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { status: 'Reviewed', record_version: 0 })]);
    ctx.sandbox.setJobStatus('job-1', 'Saved');
    assert.ok(Object.prototype.toString.call(jobField_(ctx, 1, 'saved_at')) === '[object Date]');
    ctx.sandbox.setJobStatus('job-1', 'Ready to Apply');
    ctx.sandbox.setJobStatus('job-1', 'Rejected');
    const recovered = hostify_(ctx.sandbox.setJobStatus('job-1', 'Reviewed'));
    assert.equal(recovered.status, 'Reviewed');
    assert.equal(ctx.sheetsByName.JobHistory.data[4][ctx.schema.JobHistory.indexOf('action')], 'recover_job');
  });

  it('checks the JobHistory schema before changing a job', () => {
    const schema = schema_();
    const sheets = initializedSheets_(schema);
    sheets.Jobs.rows = [jobRow_(schema)];
    delete sheets.JobHistory;
    const ctx = loadAppsScriptContext_({ files: PHASE3_FILES, initialSheets: sheets });
    const before = JSON.stringify(ctx.sheetsByName.Jobs.data);

    assert.throws(() => ctx.sandbox.setJobStatus('job-1', 'Reviewed'), (err) => err.code === 'MISSING_SHEET');
    assert.equal(JSON.stringify(ctx.sheetsByName.Jobs.data), before);
  });
});

describe('addJobNote and getJobHistory', () => {
  it('appends notes, increments version, and preserves an append-only audit record', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { notes: 'Existing note', record_version: 2 })]);
    const updated = hostify_(ctx.sandbox.addJobNote('job-1', '  Follow up on Monday.  '));

    assert.match(updated.notes, /^Existing note\n\[/);
    assert.match(updated.notes, /Follow up on Monday\.$/);
    assert.equal(updated.record_version, 3);
    assert.equal(ctx.sheetsByName.JobHistory.getLastRow(), 2);
    assert.equal(ctx.sheetsByName.JobHistory.data[1][ctx.schema.JobHistory.indexOf('action')], 'add_note');
    assert.equal(ctx.sheetsByName.JobHistory.data[1][ctx.schema.JobHistory.indexOf('note')], 'Follow up on Monday.');
  });

  it('rejects invalid notes without modifying a job or history', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema)]);
    const beforeJob = JSON.stringify(ctx.sheetsByName.Jobs.data);
    const beforeHistory = JSON.stringify(ctx.sheetsByName.JobHistory.data);
    ['', '   ', 'x'.repeat(1001), null].forEach((note) => {
      assert.throws(() => ctx.sandbox.addJobNote('job-1', note), (err) => err.code === 'INVALID_FIELD');
    });
    assert.equal(JSON.stringify(ctx.sheetsByName.Jobs.data), beforeJob);
    assert.equal(JSON.stringify(ctx.sheetsByName.JobHistory.data), beforeHistory);
  });

  it('returns newest-first valid history and reports malformed audit rows without leaking them', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema)], [
      historyRow_(schema, { id: 'old', created_at: '2026-09-10T08:00:00.000Z' }),
      historyRow_(schema, { id: 'new', action: 'add_note', note: 'A note', created_at: '2026-09-11T08:00:00.000Z' }),
      historyRow_(schema, { id: '', note: 'malformed data', created_at: '2026-09-12T08:00:00.000Z' })
    ]);
    const result = hostify_(ctx.sandbox.getJobHistory('job-1'));

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.entries.map((entry) => entry.id), ['new', 'old']);
    assert.equal(result.quarantinedCount, 1);
    assert.equal(JSON.stringify(result).includes('malformed data'), false);
  });
});
