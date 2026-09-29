'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes');

// See phase1.test.js for the full explanation of the vm cross-realm rule
// this file also follows: wrap the sandbox-derived side of any deepEqual,
// and any value about to be checked with `instanceof Date`, in hostify_.

const PHASE2_FILES = ['Database.gs', 'Code.gs', 'Tasks.gs', 'Calendar.gs'];

function bootstrapSchema() {
  return loadAppsScriptContext_({ files: PHASE2_FILES }).testExports.SCHEMA;
}

function fullyInitializedSheets(schema) {
  const sheets = {};
  Object.keys(schema).forEach((name) => {
    sheets[name] = { header: schema[name].slice(), rows: [] };
  });
  return sheets;
}

function rowValuesFor(schema, sheetName, obj) {
  return schema[sheetName].map((f) => (obj[f] !== undefined ? obj[f] : ''));
}

/**
 * Builds a Phase 2 context with every sheet present and correctly
 * headered (so getDashboardData's Tasks read never fails), optionally
 * seeded with rows, and optional CalendarApp / lock scenario options.
 */
function contextWithRows(rowsBySheet, extraOptions) {
  const schema = bootstrapSchema();
  const sheets = fullyInitializedSheets(schema);
  Object.keys(rowsBySheet || {}).forEach((name) => {
    sheets[name].rows = rowsBySheet[name];
  });
  const options = Object.assign({ files: PHASE2_FILES, initialSheets: sheets }, extraOptions || {});
  const ctx = loadAppsScriptContext_(options);
  ctx.schema = schema;
  return ctx;
}

function taskRow(schema, overrides) {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Row one',
    due_date: '',
    priority: 'Medium',
    status: 'Open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    completed_at: ''
  };
  return rowValuesFor(schema, 'Tasks', Object.assign(base, overrides || {}));
}

function jobRow(schema, overrides) {
  const base = { id: 'job-1', title: 'Some Job', status: 'New' };
  return rowValuesFor(schema, 'Jobs', Object.assign(base, overrides || {}));
}

const VALID_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('createTask', () => {
  it('creates a task with a valid id, trimmed title, priority, and Open status', () => {
    const ctx = contextWithRows({});
    const result = ctx.sandbox.createTask({ id: VALID_ID_1, title: '  Write cover letter  ', priority: 'High' });
    assert.equal(result.id, VALID_ID_1);
    assert.equal(result.title, 'Write cover letter');
    assert.equal(result.priority, 'High');
    assert.equal(result.status, 'Open');
    assert.equal(result.due_date, '');
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 2);
  });

  it('accepts a valid yyyy-MM-dd due date and stores it as a real Date', () => {
    const ctx = contextWithRows({});
    const result = ctx.sandbox.createTask({ id: VALID_ID_1, title: 'Follow up', priority: 'Low', dueDate: '2026-03-15' });
    assert.equal(result.due_date, '2026-03-15');
    const dueIndex = ctx.schema.Tasks.indexOf('due_date');
    const rawRow = ctx.sheetsByName.Tasks.data[1];
    assert.ok(hostify_(rawRow[dueIndex]) instanceof Date, 'due_date must be stored as a real Date');
  });

  it('rejects a non-UUID id with no write', () => {
    const ctx = contextWithRows({});
    ['not-a-uuid', '', 12345, null, undefined].forEach((bad) => {
      assert.throws(() => ctx.sandbox.createTask({ id: bad, title: 'X', priority: 'Low' }), (err) => {
        assert.equal(err.code, 'INVALID_ID');
        return true;
      });
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1, 'header only, no writes');
  });

  it('rejects a blank or whitespace-only title with no write', () => {
    const ctx = contextWithRows({});
    ['', '   ', undefined, null, 42].forEach((bad) => {
      assert.throws(() => ctx.sandbox.createTask({ id: VALID_ID_1, title: bad, priority: 'Low' }), (err) => {
        assert.equal(err.code, 'INVALID_FIELD');
        return true;
      });
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1);
  });

  it('rejects a title over 200 characters with no write', () => {
    const ctx = contextWithRows({});
    const longTitle = 'x'.repeat(201);
    assert.throws(() => ctx.sandbox.createTask({ id: VALID_ID_1, title: longTitle, priority: 'Low' }), (err) => {
      assert.equal(err.code, 'INVALID_FIELD');
      return true;
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1);
  });

  it('rejects an invalid priority with no write', () => {
    const ctx = contextWithRows({});
    ['Urgent', '', undefined, 'low'].forEach((bad) => {
      assert.throws(() => ctx.sandbox.createTask({ id: VALID_ID_1, title: 'X', priority: bad }), (err) => {
        assert.equal(err.code, 'INVALID_FIELD');
        return true;
      });
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1);
  });

  it('rejects a due date not in yyyy-MM-dd format with no write', () => {
    const ctx = contextWithRows({});
    ['03/15/2026', '2026-3-15', 'tomorrow', 20260315, '2023/01/01', ' ', 'invalid-date'].forEach((bad) => {
      assert.throws(() => ctx.sandbox.createTask({ id: VALID_ID_1, title: 'X', priority: 'Low', dueDate: bad }), (err) => {
        assert.equal(err.code, 'INVALID_FIELD');
        return true;
      });
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1);
  });

  it('rejects a due date that is not a real calendar date (e.g. Feb 30) with no write', () => {
    const ctx = contextWithRows({});
    assert.throws(() => ctx.sandbox.createTask({ id: VALID_ID_1, title: 'X', priority: 'Low', dueDate: '2026-02-30' }), (err) => {
      assert.equal(err.code, 'INVALID_FIELD');
      return true;
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1);
  });

  it('retrying with the same id and same title returns the existing task, with no duplicate row (idempotent create)', () => {
    const ctx = contextWithRows({});
    const first = ctx.sandbox.createTask({ id: VALID_ID_1, title: 'Same task', priority: 'Medium' });
    const second = ctx.sandbox.createTask({ id: VALID_ID_1, title: 'Same task', priority: 'Medium' });
    assert.equal(second.id, first.id);
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 2, 'exactly one row, not two');
  });

  it('retrying with the same id but a different title throws DUPLICATE_ID with no new write', () => {
    const ctx = contextWithRows({});
    ctx.sandbox.createTask({ id: VALID_ID_1, title: 'Original title', priority: 'Medium' });
    assert.throws(() => ctx.sandbox.createTask({ id: VALID_ID_1, title: 'Different title', priority: 'Medium' }), (err) => {
      assert.equal(err.code, 'DUPLICATE_ID');
      return true;
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 2, 'still exactly one row');
  });
});

describe('completeTask / reopenTask / archiveTask', () => {
  it('completeTask moves an Open task to Done and sets completed_at', () => {
    const ctx = contextWithRows({ Tasks: [taskRow(bootstrapSchema(), { id: VALID_ID_1, status: 'Open' })] });
    const result = ctx.sandbox.completeTask(VALID_ID_1);
    assert.equal(result.status, 'Done');
    assert.notEqual(result.completed_at, '');
  });

  it('completeTask on an already-Done task is a no-op that returns it unchanged (idempotent)', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Done', completed_at: '2026-01-02T00:00:00.000Z' })] });
    const before = ctx.sheetsByName.Tasks.data[1].slice();
    const result = ctx.sandbox.completeTask(VALID_ID_1);
    assert.equal(result.status, 'Done');
    assert.deepEqual(ctx.sheetsByName.Tasks.data[1], before, 'no write for an idempotent no-op');
  });

  it('completeTask on an Archived task throws INVALID_TRANSITION with no write', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Archived' })] });
    const before = ctx.sheetsByName.Tasks.data[1].slice();
    assert.throws(() => ctx.sandbox.completeTask(VALID_ID_1), (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data[1], before);
  });

  it('reopenTask moves a Done task back to Open and clears completed_at', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Done', completed_at: '2026-01-02T00:00:00.000Z' })] });
    const result = ctx.sandbox.reopenTask(VALID_ID_1);
    assert.equal(result.status, 'Open');
    assert.equal(result.completed_at, '');
  });

  it('reopenTask on an already-Open task is a no-op (idempotent)', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Open' })] });
    const before = ctx.sheetsByName.Tasks.data[1].slice();
    const result = ctx.sandbox.reopenTask(VALID_ID_1);
    assert.equal(result.status, 'Open');
    assert.deepEqual(ctx.sheetsByName.Tasks.data[1], before);
  });

  it('reopenTask on an Archived task throws INVALID_TRANSITION with no write', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Archived' })] });
    assert.throws(() => ctx.sandbox.reopenTask(VALID_ID_1), (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });

  it('archiveTask archives an Open task', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Open' })] });
    const result = ctx.sandbox.archiveTask(VALID_ID_1);
    assert.equal(result.status, 'Archived');
  });

  it('archiveTask archives a Done task', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Done' })] });
    const result = ctx.sandbox.archiveTask(VALID_ID_1);
    assert.equal(result.status, 'Archived');
  });

  it('archiveTask on an already-Archived task is a no-op (idempotent)', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, status: 'Archived' })] });
    const before = ctx.sheetsByName.Tasks.data[1].slice();
    const result = ctx.sandbox.archiveTask(VALID_ID_1);
    assert.equal(result.status, 'Archived');
    assert.deepEqual(ctx.sheetsByName.Tasks.data[1], before);
  });

  it('a transition on an unknown id throws NOT_FOUND with no write', () => {
    const ctx = contextWithRows({});
    assert.throws(() => ctx.sandbox.completeTask(VALID_ID_1), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
    assert.throws(() => ctx.sandbox.reopenTask(VALID_ID_1), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
    assert.throws(() => ctx.sandbox.archiveTask(VALID_ID_1), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
  });
});

describe('getDashboardData: tasks', () => {
  it('excludes archived tasks from the tasks array', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({
      Tasks: [
        taskRow(schema, { id: VALID_ID_1, status: 'Open' }),
        taskRow(schema, { id: VALID_ID_2, status: 'Archived' })
      ]
    });
    const data = ctx.sandbox.getDashboardData();
    const ids = data.tasks.map((t) => t.id);
    assert.ok(ids.indexOf(VALID_ID_1) !== -1);
    assert.equal(ids.indexOf(VALID_ID_2), -1, 'archived task must not appear');
  });

  it('tasks persist unchanged across a fresh getDashboardData call on the same fake sheet', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [taskRow(schema, { id: VALID_ID_1, title: 'Persisted' })] });
    const first = ctx.sandbox.getDashboardData();
    const second = ctx.sandbox.getDashboardData();
    assert.equal(first.tasks.length, second.tasks.length);
    assert.equal(second.tasks[0].title, 'Persisted');
  });

  it('computes openTasks and completedTasks correctly', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({
      Tasks: [
        taskRow(schema, { id: VALID_ID_1, status: 'Open' }),
        taskRow(schema, { id: VALID_ID_2, status: 'Done' }),
        taskRow(schema, { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'Open' })
      ]
    });
    const data = ctx.sandbox.getDashboardData();
    assert.equal(data.stats.openTasks, 2);
    assert.equal(data.stats.completedTasks, 1);
  });
});

describe('getDashboardData: job stats', () => {
  it('computes strongMatchJobs and applicationsSent from a well-formed Jobs sheet', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({
      Jobs: [
        jobRow(schema, { id: 'j1', overall_match: 80, status: 'New' }),      // included: exact boundary
        jobRow(schema, { id: 'j2', overall_match: 91, status: 'Rejected' }), // excluded: Rejected
        jobRow(schema, { id: 'j3', overall_match: 79, status: 'New' }),      // excluded: below threshold
        jobRow(schema, { id: 'j4', overall_match: 92, status: 'Applied' }),
        jobRow(schema, { id: 'j5', status: 'Interview' }),
        jobRow(schema, { id: 'j6', status: 'Offer' }),
        jobRow(schema, { id: 'j7', status: 'New' })
      ]
    });
    const data = ctx.sandbox.getDashboardData();
    assert.equal(data.stats.strongMatchJobs, 2, 'j1 at the 80% boundary and j4 only');
    assert.equal(data.stats.applicationsSent, 3, 'j4 (Applied), j5 (Interview), j6 (Offer)');
  });

  it('job stats are null, and tasks are unaffected, when the Jobs sheet has a mismatched header', () => {
    const schema = bootstrapSchema();
    const sheets = fullyInitializedSheets(schema);
    sheets.Jobs.header = ['id', 'title']; // deliberately wrong
    sheets.Tasks.rows = [taskRow(schema, { id: VALID_ID_1 })];
    const ctx = loadAppsScriptContext_({ files: PHASE2_FILES, initialSheets: sheets });

    const data = ctx.sandbox.getDashboardData();
    assert.equal(data.stats.strongMatchJobs, null);
    assert.equal(data.stats.applicationsSent, null);
    assert.equal(data.tasks.length, 1, 'Tasks must still load fine');
    assert.ok(ctx.consoleFake._errors.length > 0, 'the mismatch must be logged server-side');
  });

  it('job stats are null, and tasks are unaffected, when the Jobs sheet is missing entirely', () => {
    const schema = bootstrapSchema();
    const sheets = fullyInitializedSheets(schema);
    delete sheets.Jobs;
    sheets.Tasks.rows = [taskRow(schema, { id: VALID_ID_1 })];
    const ctx = loadAppsScriptContext_({ files: PHASE2_FILES, initialSheets: sheets });

    const data = ctx.sandbox.getDashboardData();
    assert.equal(data.stats.strongMatchJobs, null);
    assert.equal(data.stats.applicationsSent, null);
    assert.equal(data.tasks.length, 1);
  });
});

describe('getUpcomingEvents', () => {
  it('returns ok with mapped {title, start, end, allDay} for events within the 7-day window', () => {
    // Calendar.gs's `new Date()` runs inside the vm sandbox's own realm,
    // which has its own independent built-in Date — there is no way to
    // mock "now" from host-realm test code (overriding this file's
    // global.Date would not touch it). So these fixtures are computed
    // relative to the REAL current time instead of a fixed date, and
    // compared to Calendar.gs's now/until via plain `>`/`<`, which coerce
    // through Date.prototype.valueOf() and so work correctly across the
    // host/vm realm boundary.
    const inWindow = {
      title: 'Interview call',
      start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      end: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      allDay: false
    };
    const outOfWindow = {
      title: 'Far future',
      start: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      allDay: false
    };
    const ctx = contextWithRows({}, { calendarOptions: { events: [inWindow, outOfWindow] } });
    const result = ctx.sandbox.getUpcomingEvents();

    assert.equal(result.status, 'ok');
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].title, 'Interview call');
    assert.equal(result.events[0].allDay, false);
    assert.equal(typeof result.events[0].start, 'string');
  });

  it('returns an empty events array with ok status when there are no events', () => {
    const ctx = contextWithRows({}, { calendarOptions: { events: [] } });
    const result = ctx.sandbox.getUpcomingEvents();
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.events, []);
  });

  it('caps results at 10 events', () => {
    const now = new Date();
    const many = [];
    for (let i = 0; i < 15; i++) {
      const start = new Date(now.getTime() + i * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      many.push({ title: 'Event ' + i, start: start, end: end, allDay: false });
    }
    const ctx = contextWithRows({}, { calendarOptions: { events: many } });
    const result = ctx.sandbox.getUpcomingEvents();
    assert.equal(result.status, 'ok');
    assert.equal(result.events.length, 10);
  });

  it('returns unavailable with a safe generic message and no raw error text when getDefaultCalendar throws', () => {
    const secret = 'INTERNAL: quota exceeded for project 12345';
    const ctx = contextWithRows({}, { calendarOptions: { calendarThrows: new Error(secret) } });
    const result = ctx.sandbox.getUpcomingEvents();
    assert.equal(result.status, 'unavailable');
    // result.events is a [] literal built inside Calendar.gs (vm realm);
    // deepEqual against this file's own [] would hit the same
    // structurally-identical-but-not-reference-equal cross-realm failure
    // documented at the top of this file, so check length instead.
    assert.equal(result.events.length, 0);
    assert.ok(result.message.indexOf(secret) === -1, 'raw error text must never reach the browser');
    assert.ok(ctx.consoleFake._errors.some((e) => e.indexOf(secret) !== -1), 'the real error must still be logged server-side');
  });

  it('returns unavailable when getEvents itself throws', () => {
    const ctx = contextWithRows({}, { calendarOptions: { getEventsThrows: true } });
    const result = ctx.sandbox.getUpcomingEvents();
    assert.equal(result.status, 'unavailable');
    // Same vm-realm [] pitfall as the test above — check length, not deepEqual.
    assert.equal(result.events.length, 0);
  });
});
