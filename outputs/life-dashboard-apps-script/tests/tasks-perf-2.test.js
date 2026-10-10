const test = require('node:test');
const assert = require('node:assert');
const { loadAppsScriptContext_ } = require('./gas-fakes.js');

const ALL_DEPLOYED_GS = [
  'Code.gs', 'Database.gs', 'Tasks.gs', 'Calendar.gs', 'Jobs.gs',
  'Discovery.gs', 'AIProvider_Gemini.gs', 'JobSource_JSearch.gs'
];

test('tasks performance baseline with native search', (t) => {
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

    // Custom find function like updateRecordByKeyInDb_ does
    function customFind(ss, id) {
        const sheetName = 'Tasks';
        const fields = schema;
        const keyIndex = fields.indexOf('id');
        const sheet = ss.getSheetByName(sheetName);
        const lastRow = sheet.data.length; // fake method
        if (lastRow < 2) return null;

        const range = sheet.data.slice(1);
        const normalizedKeyValue = String(id);

        for (let i = 0; i < range.length; i++) {
            const row = range[i];
            const isBlank = row.every(function (v) { return v === '' || v === null || v === undefined; });
            if (isBlank) continue;
            if (String(row[keyIndex]) === normalizedKeyValue) {
                 const obj = {};
                 // simplified parsing
                 for (let c = 0; c < fields.length; c++) {
                    obj[fields[c]] = row[c];
                 }
                 return obj;
            }
        }
        return null;
    }

    const start = process.hrtime.bigint();
    // Warmup
    customFind(ss, 'task-999');

    // Measure 100 calls
    for(let i=0; i<100; i++) {
       customFind(ss, `task-${i*10}`);
    }
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1000000;

    console.log(`customFind x100 (in 1000 rows) took ${durationMs.toFixed(3)} ms`);
});
