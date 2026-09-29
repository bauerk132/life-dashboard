const CONFIG = {
  // Paste the ID from the URL of your Google Sheet after creating it.
  SPREADSHEET_ID: '',
  SHEETS: {
    TASKS: 'Tasks',
    JOBS: 'Jobs',
    SETTINGS: 'Settings'
  }
};

const HEADERS = {
  Tasks: ['id', 'title', 'due_date', 'priority', 'status', 'created_at', 'completed_at'],
  Jobs: [
    'id', 'title', 'company', 'location', 'remote', 'salary_min', 'salary_max',
    'posted_at', 'source', 'url', 'description', 'skills_match', 'experience_match',
    'location_match', 'salary_match', 'overall_match', 'recommendation', 'why_matches',
    'gaps', 'status', 'saved_at', 'notes', 'external_id', 'last_seen_at'
  ],
  Settings: ['key', 'value', 'updated_at']
};

function getSpreadsheet_() {
  if (!CONFIG.SPREADSHEET_ID) {
    throw new Error('Set CONFIG.SPREADSHEET_ID in Database.gs to the ID of your Google Sheet.');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function ensureSchema_() {
  const ss = getSpreadsheet_();
  Object.keys(HEADERS).forEach(function(name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS[name].length)
        .setFontWeight('bold')
        .setBackground('#dbeafe');
    }
  });
}

function getRows_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter(function(row) { return row.some(function(value) { return value !== ''; }); })
    .map(function(row) {
      return headers.reduce(function(record, header, index) {
        record[header] = serializeCell_(row[index]);
        return record;
      }, {});
    });
}

function serializeCell_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function appendRecord_(sheetName, record) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  sheet.appendRow(headers.map(function(header) { return record[header] || ''; }));
}

function appendRecords_(sheetName, records) {
  if (!records || records.length === 0) return;
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  const rows = records.map(function(record) {
    return headers.map(function(header) { return record[header] || ''; });
  });

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, headers.length).setValues(rows);
}

function updateRecord_(sheetName, id, updates) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idColumn = headers.indexOf('id');
  const rowIndex = values.findIndex(function(row, index) {
    return index > 0 && String(row[idColumn]) === String(id);
  });
  if (rowIndex === -1) throw new Error('Record not found.');
  Object.keys(updates).forEach(function(key) {
    const column = headers.indexOf(key);
    if (column !== -1) sheet.getRange(rowIndex + 1, column + 1).setValue(updates[key]);
  });
}

function getTimeZone_() {
  return Session.getScriptTimeZone() || 'America/New_York';
}

function seedDemoData_() {
  if (getRows_(CONFIG.SHEETS.TASKS).length || getRows_(CONFIG.SHEETS.JOBS).length) {
    return;
  }
  const now = new Date();
  appendRecord_('Tasks', {
    id: Utilities.getUuid(), title: 'Customize job-search filters', due_date: now,
    priority: 'High', status: 'Open', created_at: now
  });
  appendRecord_('Tasks', {
    id: Utilities.getUuid(), title: 'Review two ready-to-go jobs', due_date: now,
    priority: 'Medium', status: 'Open', created_at: now
  });
  [
    { title: 'Junior Data Analyst', company: 'Northwind Labs', location: 'Remote (US)', remote: 'Yes', salary_min: 70000, salary_max: 85000, overall_match: 94, recommendation: 'Strong apply', why_matches: 'Python, SQL, dashboard projects', gaps: 'Tableau preferred', source: 'Demo', url: 'https://example.com/jobs/1' },
    { title: 'Software Engineer I', company: 'Cedar Systems', location: 'Boston, MA', remote: 'Hybrid', salary_min: 82000, salary_max: 102000, overall_match: 89, recommendation: 'Apply', why_matches: 'JavaScript, APIs, portfolio fit', gaps: '1 year experience preferred', source: 'Demo', url: 'https://example.com/jobs/2' },
    { title: 'Operations Associate', company: 'Harbor & Co.', location: 'New York, NY', remote: 'No', salary_min: 60000, salary_max: 74000, overall_match: 78, recommendation: 'Review', why_matches: 'Analysis and communication', gaps: 'On-site role', source: 'Demo', url: 'https://example.com/jobs/3' }
  ].forEach(function(job) {
    const timestamp = new Date();
    appendRecord_('Jobs', Object.assign({
      id: Utilities.getUuid(), posted_at: timestamp, description: '', skills_match: '',
      experience_match: '', location_match: '', salary_match: '', status: 'New',
      saved_at: '', notes: '', external_id: '', last_seen_at: timestamp
    }, job));
  });
}
