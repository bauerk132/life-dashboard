'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes');

// node:assert/strict aliases deepEqual to deepStrictEqual, which compares
// [[Prototype]] as well as structure. A value returned by calling a
// sandboxed function (or read off ctx.testExports) was built with the vm
// sandbox's own Object/Array/Date constructors, not this file's — so it
// is structurally identical to a host-realm literal but fails
// deepStrictEqual anyway, and a genuine Date from the sandbox fails
// `instanceof Date` here for the same reason. hostify_ (see gas-fakes.js)
// rebuilds such a value using this file's own realm before comparison.
// Rule of thumb: wrap the sandbox-derived side of any deepEqual, and any
// value you're about to run `instanceof Date` against.

function deepCopy(v) {
  return JSON.parse(JSON.stringify(v));
}

function bootstrapSchema() {
  // A throwaway context, used only to read SCHEMA/PLAIN_TEXT_FIELDS_ out
  // via the test-only trailer (see gas-fakes.js) before setting up a
  // scenario-specific context for the actual test.
  return loadAppsScriptContext_().testExports.SCHEMA;
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

function contextWithRows(rowsBySheet) {
  const schema = bootstrapSchema();
  const sheets = fullyInitializedSheets(schema);
  Object.keys(rowsBySheet || {}).forEach((name) => {
    sheets[name].rows = rowsBySheet[name];
  });
  const ctx = loadAppsScriptContext_({ initialSheets: sheets });
  ctx.schema = schema;
  return ctx;
}

function taskRow(overrides) {
  const base = {
    id: 't1', title: 'Row one', due_date: '', priority: 'Medium', status: 'Open',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', completed_at: ''
  };
  return Object.assign(base, overrides || {});
}

describe('test harness sanity', () => {
  it('exposes SCHEMA and PLAIN_TEXT_FIELDS_ via the test-only trailer', () => {
    const ctx = loadAppsScriptContext_();
    assert.deepEqual(
      Object.keys(ctx.testExports.SCHEMA).sort(),
      ['Applications', 'JobHistory', 'Jobs', 'Settings', 'Tasks']
    );
    assert.ok(Array.isArray(ctx.testExports.PLAIN_TEXT_FIELDS_.Tasks));
  });
});

describe('initializeDatabase', () => {
  it('creates every sheet with the correct header on a fresh spreadsheet', () => {
    const ctx = loadAppsScriptContext_({ initialSheets: {} });
    const schema = ctx.testExports.SCHEMA;

    const result = ctx.sandbox.initializeDatabase();
    assert.deepEqual(hostify_(result), { status: 'ok' });

    Object.keys(schema).forEach((name) => {
      const sheet = ctx.sheetsByName[name];
      assert.ok(sheet, 'sheet ' + name + ' should exist');
      assert.deepEqual(sheet.data[0], schema[name]);
      assert.equal(sheet.getLastRow(), 1, name + ' should have only a header row');
    });
  });

  it('is idempotent on a second run', () => {
    const ctx = loadAppsScriptContext_({ initialSheets: {} });
    const schema = ctx.testExports.SCHEMA;

    ctx.sandbox.initializeDatabase();
    const afterFirst = {};
    Object.keys(schema).forEach((name) => { afterFirst[name] = deepCopy(ctx.sheetsByName[name].data); });

    const secondResult = ctx.sandbox.initializeDatabase();
    assert.deepEqual(hostify_(secondResult), { status: 'ok' });

    Object.keys(schema).forEach((name) => {
      assert.deepEqual(ctx.sheetsByName[name].data, afterFirst[name], name + ' must be unchanged by a second run');
    });
  });

  it('throws and writes nothing when a sheet is missing a header column', () => {
    const schema = bootstrapSchema();
    const sheets = fullyInitializedSheets(schema);
    sheets.Tasks.header = schema.Tasks.slice(0, -1); // drop "completed_at"
    sheets.Tasks.rows = [rowValuesFor(schema, 'Tasks', taskRow()).slice(0, -1)];

    const ctx = loadAppsScriptContext_({ initialSheets: sheets });
    const before = deepCopy(ctx.sheetsByName.Tasks.data);

    assert.throws(() => ctx.sandbox.initializeDatabase(), (err) => {
      assert.equal(err.code, 'SCHEMA_MISMATCH');
      assert.match(err.message, /Tasks/);
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data, before, 'mismatched sheet must not be modified');
  });

  it('throws when a sheet has reordered headers', () => {
    const schema = bootstrapSchema();
    const sheets = fullyInitializedSheets(schema);
    const reordered = schema.Tasks.slice();
    const tmp = reordered[0]; reordered[0] = reordered[1]; reordered[1] = tmp;
    sheets.Tasks.header = reordered;

    const ctx = loadAppsScriptContext_({ initialSheets: sheets });
    const before = deepCopy(ctx.sheetsByName.Tasks.data);

    assert.throws(() => ctx.sandbox.initializeDatabase(), (err) => {
      assert.equal(err.code, 'SCHEMA_MISMATCH');
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data, before);
  });

  it('throws when a sheet has an unexpected trailing header column', () => {
    const schema = bootstrapSchema();
    const sheets = fullyInitializedSheets(schema);
    sheets.Jobs.header = schema.Jobs.concat(['legacy_extra_column']);
    sheets.Jobs.rows = [schema.Jobs.map(() => 'x').concat(['old data'])];

    const ctx = loadAppsScriptContext_({ initialSheets: sheets });
    const before = deepCopy(ctx.sheetsByName.Jobs.data);

    assert.throws(() => ctx.sandbox.initializeDatabase(), (err) => {
      assert.equal(err.code, 'SCHEMA_MISMATCH');
      assert.match(err.message, /Jobs/);
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Jobs.data, before);
  });

  it('treats a blank row 1 over existing data as a mismatch, not a fresh sheet (regression)', () => {
    const schema = bootstrapSchema();
    const sheets = fullyInitializedSheets(schema);
    // Row 1 (the header) is entirely blank, but row 2 holds real-looking
    // data — e.g. someone left row 1 as a visual spacer. This must NOT be
    // treated the same as a genuinely empty sheet.
    sheets.Tasks.header = schema.Tasks.map(() => '');
    sheets.Tasks.rows = [rowValuesFor(schema, 'Tasks', taskRow({ id: 'real-task', title: 'Do not overwrite me' }))];

    const ctx = loadAppsScriptContext_({ initialSheets: sheets });
    const before = deepCopy(ctx.sheetsByName.Tasks.data);

    assert.throws(() => ctx.sandbox.initializeDatabase(), (err) => {
      assert.equal(err.code, 'SCHEMA_MISMATCH');
      assert.match(err.message, /Tasks/);
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data, before, 'row 1 must not be overwritten while row 2 holds data');
  });

  it('still initializes unrelated sheets when only one sheet is mismatched', () => {
    const schema = bootstrapSchema();
    const sheets = { Tasks: { header: schema.Tasks.slice(0, -1), rows: [] } };
    const ctx = loadAppsScriptContext_({ initialSheets: sheets });

    assert.throws(() => ctx.sandbox.initializeDatabase());

    ['Jobs', 'Settings', 'Applications'].forEach((name) => {
      const sheet = ctx.sheetsByName[name];
      assert.ok(sheet, name + ' should have been created despite the Tasks error');
      assert.deepEqual(sheet.data[0], schema[name]);
    });
  });

  it('sets plain-text format only on the intended free-text columns, never on Date or numeric columns', () => {
    const ctx = loadAppsScriptContext_({ initialSheets: {} });
    const schema = ctx.testExports.SCHEMA;
    const plainTextFields = ctx.testExports.PLAIN_TEXT_FIELDS_;
    const dateOnlyFields = ctx.testExports.DATE_ONLY_FIELDS_;

    // Independent invariant, checked BEFORE using PLAIN_TEXT_FIELDS_ below
    // as the source of truth for what "should" be formatted: no field may
    // appear in both PLAIN_TEXT_FIELDS_ and DATE_ONLY_FIELDS_ for the same
    // sheet. Without this, a field wrongly added to both (as due_date once
    // was) would make the per-column assertions below tautological — they
    // derive "expected" from PLAIN_TEXT_FIELDS_ itself, so they'd just
    // confirm the bug, not catch it.
    Object.keys(dateOnlyFields).forEach((sheetName) => {
      const plainText = plainTextFields[sheetName] || [];
      dateOnlyFields[sheetName].forEach((field) => {
        assert.equal(
          plainText.indexOf(field), -1,
          sheetName + '.' + field + ' is a DATE_ONLY_FIELDS_ column and must not also be in PLAIN_TEXT_FIELDS_'
        );
      });
    });

    // Independent, hardcoded anchor: these specific Jobs columns are
    // numeric and the dashboard compares them numerically (overall_match >= 80).
    // Named explicitly rather than derived from any list under test, so a
    // future edit that accidentally adds one to PLAIN_TEXT_FIELDS_.Jobs
    // fails here even if every other check in this describe block would not
    // catch it.
    ['salary_min', 'salary_max', 'skills_match', 'experience_match', 'location_match',
      'salary_match', 'overall_match', 'record_version'].forEach((field) => {
      assert.equal(
        (plainTextFields.Jobs || []).indexOf(field), -1,
        'Jobs.' + field + ' is numeric and must not be in PLAIN_TEXT_FIELDS_'
      );
    });

    ctx.sandbox.initializeDatabase();

    Object.keys(schema).forEach((sheetName) => {
      const sheet = ctx.sheetsByName[sheetName];
      const expected = plainTextFields[sheetName] || [];
      schema[sheetName].forEach((field, colIndex0) => {
        const format = sheet.getRange(2, colIndex0 + 1, 1, 1).getNumberFormats()[0][0];
        if (expected.indexOf(field) !== -1) {
          assert.equal(format, '@', sheetName + '.' + field + ' should be plain-text formatted');
        } else {
          assert.equal(format, 'General', sheetName + '.' + field + ' should NOT be plain-text formatted');
        }
      });
    });
  });
});

describe('appendRecord_', () => {
  it('rejects a non-object record with no write', () => {
    const ctx = contextWithRows({});
    [null, 'x', 42, ['a']].forEach((bad) => {
      assert.throws(() => ctx.sandbox.appendRecord_('Tasks', bad), (err) => {
        assert.equal(err.code, 'INVALID_RECORD');
        return true;
      });
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1, 'header only, no writes');
  });

  it('rejects unknown fields with no write', () => {
    const ctx = contextWithRows({});
    assert.throws(() => ctx.sandbox.appendRecord_('Tasks', { title: 'X', bogus: 1 }), (err) => {
      assert.equal(err.code, 'UNKNOWN_FIELD');
      return true;
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 1);
  });

  it('rejects an unknown sheet name', () => {
    const ctx = contextWithRows({});
    assert.throws(() => ctx.sandbox.appendRecord_('NotASheet', { title: 'X' }), (err) => {
      assert.equal(err.code, 'UNKNOWN_SHEET');
      return true;
    });
  });

  it('generates an id and real Date created_at/updated_at when absent', () => {
    const ctx = contextWithRows({});
    const result = ctx.sandbox.appendRecord_('Tasks', { title: 'Write the report' });

    assert.ok(result.id, 'id should be generated');
    assert.equal(result.title, 'Write the report');

    const createdIndex = ctx.schema.Tasks.indexOf('created_at');
    const updatedIndex = ctx.schema.Tasks.indexOf('updated_at');
    const idIndex = ctx.schema.Tasks.indexOf('id');
    const rawRow = ctx.sheetsByName.Tasks.data[1];
    // appendRecord_ ran inside the vm sandbox, so these Date values are
    // real Dates from the SANDBOX's Date constructor — `instanceof Date`
    // here (this file's Date) would wrongly report false. hostify_
    // rebuilds them with this file's Date first.
    assert.ok(hostify_(rawRow[createdIndex]) instanceof Date, 'created_at must be stored as a real Date');
    assert.ok(hostify_(rawRow[updatedIndex]) instanceof Date, 'updated_at must be stored as a real Date');
    assert.equal(rawRow[idIndex], result.id);
  });

  it('accepts a caller-supplied id when it does not already exist', () => {
    const ctx = contextWithRows({});
    const result = ctx.sandbox.appendRecord_('Tasks', { id: 'client-uuid-1', title: 'Retryable create' });
    assert.equal(result.id, 'client-uuid-1');
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 2);
  });

  it('rejects a duplicate id with no write (DUPLICATE_ID)', () => {
    const ctx = contextWithRows({});
    ctx.sandbox.appendRecord_('Tasks', { id: 'dup-1', title: 'First' });
    assert.throws(() => ctx.sandbox.appendRecord_('Tasks', { id: 'dup-1', title: 'Second' }), (err) => {
      assert.equal(err.code, 'DUPLICATE_ID');
      return true;
    });
    assert.equal(ctx.sheetsByName.Tasks.getLastRow(), 2, 'only the first row should exist');
  });

  it('preserves 0 and false through append and read', () => {
    const ctx = contextWithRows({});
    const created = ctx.sandbox.appendRecord_('Jobs', {
      title: 'Numeric edge cases', overall_match: 0, salary_min: 0, remote: false
    });
    assert.equal(created.overall_match, 0);
    assert.equal(created.salary_min, 0);
    assert.equal(created.remote, false);

    const rows = ctx.sandbox.readRows_(ctx.spreadsheet, 'Jobs');
    const row = rows.find((r) => r.id === created.id);
    assert.equal(row.overall_match, 0);
    assert.equal(row.salary_min, 0);
    assert.equal(row.remote, false);
  });

  it('rejects a duplicate key on an id-less sheet (regression: Settings had no duplicate protection)', () => {
    const ctx = contextWithRows({});
    ctx.sandbox.appendRecord_('Settings', { key: 'theme', value: 'dark' });
    assert.throws(() => ctx.sandbox.appendRecord_('Settings', { key: 'theme', value: 'light' }), (err) => {
      assert.equal(err.code, 'DUPLICATE_ID');
      return true;
    });
    assert.equal(ctx.sheetsByName.Settings.getLastRow(), 2, 'only the first Settings row should exist');
  });

  it('requires the key field on an id-less sheet when absent (no UUID can be invented for it)', () => {
    const ctx = contextWithRows({});
    assert.throws(() => ctx.sandbox.appendRecord_('Settings', { value: 'dark' }), (err) => {
      assert.equal(err.code, 'MISSING_KEY');
      return true;
    });
    assert.equal(ctx.sheetsByName.Settings.getLastRow(), 1, 'header only, no write');
  });

  it('returns fully-serialized data for an id-less sheet (regression: used to return a raw Date)', () => {
    const ctx = contextWithRows({});
    const created = ctx.sandbox.appendRecord_('Settings', { key: 'theme', value: 'dark' });
    // Every other reader of this sheet gets updated_at as an ISO string
    // (readRows_'s serialization). appendRecord_ must return the same
    // shape, not the raw pre-write object with a live Date in it.
    assert.equal(typeof created.updated_at, 'string');
    assert.equal(created.updated_at, new Date(created.updated_at).toISOString());
  });
});

describe('updateRecordById_', () => {
  it('updates the FIRST data row correctly, preserving untouched fields (regression: row-index bug)', () => {
    const schema = bootstrapSchema();
    const row1 = taskRow({ id: 't1', title: 'First task', priority: 'High' });
    const ctx = contextWithRows({ Tasks: [rowValuesFor(schema, 'Tasks', row1)] });

    const updated = ctx.sandbox.updateRecordById_('Tasks', 't1', { status: 'Done' });

    assert.equal(updated.status, 'Done');
    assert.equal(updated.title, 'First task', 'title must survive the update');
    assert.equal(updated.priority, 'High', 'priority must survive the update');
    assert.equal(updated.id, 't1');
  });

  it('updates the SECOND data row correctly without disturbing the first row', () => {
    const schema = bootstrapSchema();
    const row1 = taskRow({ id: 't1', title: 'First task' });
    const row2 = taskRow({ id: 't2', title: 'Second task', priority: 'Low' });
    const ctx = contextWithRows({
      Tasks: [rowValuesFor(schema, 'Tasks', row1), rowValuesFor(schema, 'Tasks', row2)]
    });
    const beforeRow1 = deepCopy(ctx.sheetsByName.Tasks.data[1]);

    const updated = ctx.sandbox.updateRecordById_('Tasks', 't2', { status: 'Done' });

    assert.equal(updated.status, 'Done');
    assert.equal(updated.title, 'Second task');
    assert.equal(updated.priority, 'Low');
    assert.deepEqual(ctx.sheetsByName.Tasks.data[1], beforeRow1, 'row 1 must be untouched');
  });

  it('rejects a blank id with no write', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [rowValuesFor(schema, 'Tasks', taskRow())] });
    const before = deepCopy(ctx.sheetsByName.Tasks.data);
    assert.throws(() => ctx.sandbox.updateRecordById_('Tasks', '', { status: 'Done' }), (err) => {
      assert.equal(err.code, 'INVALID_ID');
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data, before);
  });

  it('reports NOT_FOUND for a missing id with no write', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [rowValuesFor(schema, 'Tasks', taskRow())] });
    const before = deepCopy(ctx.sheetsByName.Tasks.data);
    assert.throws(() => ctx.sandbox.updateRecordById_('Tasks', 'does-not-exist', { status: 'Done' }), (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data, before);
  });

  it('reports INTEGRITY_ERROR when two rows share an id, with no write', () => {
    const schema = bootstrapSchema();
    const dupRow = taskRow({ id: 'dup', title: 'A' });
    const dupRow2 = taskRow({ id: 'dup', title: 'B' });
    const ctx = contextWithRows({
      Tasks: [rowValuesFor(schema, 'Tasks', dupRow), rowValuesFor(schema, 'Tasks', dupRow2)]
    });
    const before = deepCopy(ctx.sheetsByName.Tasks.data);
    assert.throws(() => ctx.sandbox.updateRecordById_('Tasks', 'dup', { status: 'Done' }), (err) => {
      assert.equal(err.code, 'INTEGRITY_ERROR');
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data, before);
  });

  it('rejects unknown fields with no write', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [rowValuesFor(schema, 'Tasks', taskRow())] });
    const before = deepCopy(ctx.sheetsByName.Tasks.data);
    assert.throws(() => ctx.sandbox.updateRecordById_('Tasks', 't1', { bogus: 1 }), (err) => {
      assert.equal(err.code, 'UNKNOWN_FIELD');
      return true;
    });
    assert.deepEqual(ctx.sheetsByName.Tasks.data, before);
  });

  it('rejects changing id or created_at', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [rowValuesFor(schema, 'Tasks', taskRow())] });
    assert.throws(() => ctx.sandbox.updateRecordById_('Tasks', 't1', { id: 'new-id' }), (err) => {
      assert.equal(err.code, 'IMMUTABLE_FIELD');
      return true;
    });
    assert.throws(() => ctx.sandbox.updateRecordById_('Tasks', 't1', { created_at: '2099-01-01T00:00:00.000Z' }), (err) => {
      assert.equal(err.code, 'IMMUTABLE_FIELD');
      return true;
    });
  });

  it('rejects an unknown sheet name', () => {
    const ctx = contextWithRows({});
    assert.throws(() => ctx.sandbox.updateRecordById_('NotASheet', 'x', {}), (err) => {
      assert.equal(err.code, 'UNKNOWN_SHEET');
      return true;
    });
  });

  it('reports NO_ID_COLUMN, not UNKNOWN_SHEET, for a real sheet with no id column (regression)', () => {
    const ctx = contextWithRows({});
    assert.throws(() => ctx.sandbox.updateRecordById_('Settings', 'theme', { value: 'x' }), (err) => {
      assert.equal(err.code, 'NO_ID_COLUMN');
      return true;
    });
  });

  it('does not mutate the caller-supplied updates object', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [rowValuesFor(schema, 'Tasks', taskRow())] });
    const updates = { status: 'Done' };
    ctx.sandbox.updateRecordById_('Tasks', 't1', updates);
    assert.deepEqual(Object.keys(updates), ['status']);
    assert.equal(updates.status, 'Done');
    assert.equal(updates.updated_at, undefined, 'the caller object itself must not gain updated_at');
  });

  it('preserves 0 and false through update and read', () => {
    const schema = bootstrapSchema();
    const jobRow = { id: 'j1', title: 'X', overall_match: 50, salary_min: 5000, remote: true };
    const ctx = contextWithRows({ Jobs: [rowValuesFor(schema, 'Jobs', jobRow)] });

    const updated = ctx.sandbox.updateRecordById_('Jobs', 'j1', { overall_match: 0, remote: false });
    assert.equal(updated.overall_match, 0);
    assert.equal(updated.remote, false);
    assert.equal(updated.salary_min, 5000, 'field not in the update must survive');
  });
});

describe('readRows_', () => {
  it('skips fully blank rows', () => {
    const schema = bootstrapSchema();
    const row1 = rowValuesFor(schema, 'Tasks', taskRow({ id: 't1', title: 'Keep me' }));
    const blank = schema.Tasks.map(() => '');
    const row2 = rowValuesFor(schema, 'Tasks', taskRow({ id: 't2', title: 'Keep me too' }));
    const ctx = contextWithRows({ Tasks: [row1, blank, row2] });

    const rows = ctx.sandbox.readRows_(ctx.spreadsheet, 'Tasks');
    assert.equal(rows.length, 2);
    assert.deepEqual(hostify_(rows.map((r) => r.id)), ['t1', 't2']);
  });

  it('formats a Date in due_date as yyyy-MM-dd, and a Date in created_at as full ISO', () => {
    const schema = bootstrapSchema();
    const ctx = contextWithRows({ Tasks: [] });
    const dueDateIndex = schema.Tasks.indexOf('due_date');
    const createdIndex = schema.Tasks.indexOf('created_at');
    const idIndex = schema.Tasks.indexOf('id');

    const row = schema.Tasks.map(() => '');
    row[idIndex] = 't1';
    const sameInstantNoonUtc = new Date(Date.UTC(2026, 8, 15, 12, 0, 0));
    row[dueDateIndex] = sameInstantNoonUtc;
    row[createdIndex] = sameInstantNoonUtc;
    ctx.sheetsByName.Tasks.data[1] = row;

    const rows = ctx.sandbox.readRows_(ctx.spreadsheet, 'Tasks');
    assert.equal(rows[0].due_date, '2026-09-15');
    assert.equal(rows[0].created_at, sameInstantNoonUtc.toISOString());
  });

  it('throws on a mismatched sheet instead of returning partial data', () => {
    const schema = bootstrapSchema();
    const sheets = fullyInitializedSheets(schema);
    sheets.Tasks.header = schema.Tasks.slice(0, -1);
    const ctx = loadAppsScriptContext_({ initialSheets: sheets });
    assert.throws(() => ctx.sandbox.readRows_(ctx.spreadsheet, 'Tasks'), (err) => {
      assert.equal(err.code, 'SCHEMA_MISMATCH');
      return true;
    });
  });
});

describe('getAppStatus', () => {
  it('returns ok with the spreadsheet name and no sheetId when configured correctly', () => {
    const ctx = loadAppsScriptContext_({ sheetId: 'secret-sheet-id-123', spreadsheetName: 'My Life Dashboard' });
    const result = ctx.sandbox.getAppStatus();
    assert.equal(result.status, 'ok');
    assert.equal(result.message, 'Connected to spreadsheet: My Life Dashboard');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'sheetId'), false);
    assert.ok(!JSON.stringify(result).includes('secret-sheet-id-123'), 'sheet id must never appear in the response');
  });

  it('returns a safe message with no property name when DATABASE_SHEET_ID is missing', () => {
    const ctx = loadAppsScriptContext_({ scriptProperties: {} });
    const result = ctx.sandbox.getAppStatus();
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'The database is not configured yet.');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'sheetId'), false);
  });

  it('returns a generic message (not the raw error) for an unexpected failure, but still logs it server-side', () => {
    const ctx = loadAppsScriptContext_({
      sheetId: 'configured-id',
      scriptProperties: { DATABASE_SHEET_ID: 'a-different-unrecognized-id' }
    });
    const result = ctx.sandbox.getAppStatus();
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'The dashboard could not connect to its database.');
    assert.ok(!result.message.includes('unrecognized-id'));
    assert.ok(ctx.consoleFake._errors.length > 0, 'the real error should still be logged server-side');
  });
});

describe('no demo/mock job seeding', () => {
  it('does not expose any seed-data function on the global object', () => {
    const ctx = loadAppsScriptContext_();
    assert.equal(typeof ctx.sandbox.seedDemoData, 'undefined');
    assert.equal(typeof ctx.sandbox.seedDemoData_, 'undefined');
  });
});
