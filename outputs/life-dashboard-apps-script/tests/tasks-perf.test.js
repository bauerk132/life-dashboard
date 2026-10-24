const test = require('node:test');
const assert = require('node:assert');
const { loadAppsScriptContext_ } = require('./gas-fakes.js');

const ALL_DEPLOYED_GS = [
  'Code.gs', 'Database.gs', 'Tasks.gs', 'Calendar.gs', 'Jobs.gs',
  'Discovery.gs', 'AIProvider_Gemini.gs', 'JobSource_JSearch.gs'
];

test('tasks performance baseline', (t) => {
    // 1. We create the context with an empty sheet
    const ctx = loadAppsScriptContext_({
        files: ALL_DEPLOYED_GS,
        scriptProperties: { DATABASE_SHEET_ID: 'FAKE_SHEET_ID' },
    });

    // We need to initialize the db
    ctx.sandbox.initializeDatabase();

    const ss = ctx.sandbox.getDb_();

    // 2. We populate 1000 tasks directly into the fake spreadsheet structure (faster than calling appendRecord 1000 times)
    const taskSheet = ss.getSheetByName('Tasks');
    // First row is header
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

    // 3. We measure how long findTaskById_ takes
    const targetId = 'task-999';

    const start = process.hrtime.bigint();
    // Warmup
    ctx.sandbox.findTaskById_(ss, targetId);

    // Measure 100 calls
    for(let i=0; i<100; i++) {
       ctx.sandbox.findTaskById_(ss, `task-${i*10}`);
    }
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1000000;

    console.log(`findTaskById_ x100 (in 1000 rows) took ${durationMs.toFixed(3)} ms`);
});
