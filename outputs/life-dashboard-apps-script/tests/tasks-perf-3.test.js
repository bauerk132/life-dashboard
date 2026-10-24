const test = require('node:test');
const assert = require('node:assert');
const { loadAppsScriptContext_ } = require('./gas-fakes.js');

const ALL_DEPLOYED_GS = [
  'Code.gs', 'Database.gs', 'Tasks.gs', 'Calendar.gs', 'Jobs.gs',
  'Discovery.gs', 'AIProvider_Gemini.gs', 'JobSource_JSearch.gs'
];

test('tasks performance baseline with short-circuiting readRows-like logic', (t) => {
    // 1. We create the context with an empty sheet
    const ctx = loadAppsScriptContext_({
        files: ALL_DEPLOYED_GS,
        scriptProperties: { DATABASE_SHEET_ID: 'FAKE_SHEET_ID' },
    });

    // We need to initialize the db
    ctx.sandbox.initializeDatabase();

    const ss = ctx.sandbox.getDb_();

    // 2. We populate 1000 tasks directly into the fake spreadsheet structure
    const taskSheet = ss.getSheetByName('Tasks');
    const schema = ctx.testExports.SCHEMA['Tasks'];
    taskSheet.data[0] = schema;

    for (let i = 0; i < 1000; i++) {
        const idIdx = schema.indexOf('id');
        const titleIdx = schema.indexOf('title');
        const statusIdx = schema.indexOf('status');
        const priorityIdx = schema.indexOf('priority');

        const row = new Array(schema.length).fill('');
        row[idIdx] = `task-${i}`;
        row[titleIdx] = `Task ${i}`;
        row[statusIdx] = 'Open';
        row[priorityIdx] = 'Medium';

        taskSheet.data.push(row);
    }

    // We inject a native findRecordById_ to test its logic within the sandbox
    ctx.sandbox.findRecordById_ = function(ss, sheetName, id) {
        const sheet = ctx.sandbox.getVerifiedSheet_(ss, sheetName);
        const fields = ctx.testExports.SCHEMA[sheetName];
        const dateOnly = ctx.testExports.DATE_ONLY_FIELDS_[sheetName] || [];
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return null;

        const values = sheet.getRange(2, 1, lastRow - 1, fields.length).getValues();
        const tz = ctx.sandbox.getTimeZone_();

        const idIndex = fields.indexOf('id');
        if (idIndex === -1) return null;

        for (let r = 0; r < values.length; r++) {
            const row = values[r];
            const isBlank = row.every(function (v) { return v === '' || v === null || v === undefined; });
            if (isBlank) continue;

            if (row[idIndex] === id) {
                const obj = {};
                for (let c = 0; c < fields.length; c++) {
                  const field = fields[c];
                  const raw = row[c];
                  if (ctx.sandbox.isDateValue_(raw)) {
                    obj[field] = dateOnly.indexOf(field) !== -1
                      ? ctx.sandbox.formatDate_(raw, tz, 'yyyy-MM-dd')
                      : raw.toISOString();
                  } else {
                    obj[field] = raw;
                  }
                }
                return obj;
            }
        }
        return null;
    };

    const start = process.hrtime.bigint();
    // Warmup
    ctx.sandbox.findRecordById_(ss, 'Tasks', 'task-999');

    // Measure 100 calls
    for(let i=0; i<100; i++) {
       ctx.sandbox.findRecordById_(ss, 'Tasks', `task-${i*10}`);
    }
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1000000;

    console.log(`findRecordById_ x100 (in 1000 rows) took ${durationMs.toFixed(3)} ms`);
});
