/**
 * Safe Google Sheets Database interactions
 */

const SCHEMA = {
  'Tasks': ['id', 'title', 'due_date', 'priority', 'status', 'created_at', 'updated_at', 'completed_at'],
  'Jobs': ['id', 'external_id', 'source', 'url', 'title', 'company', 'location', 'remote', 'salary_min', 'salary_max', 'currency', 'posted_at', 'discovered_at', 'last_seen_at', 'description', 'skills_match', 'experience_match', 'location_match', 'salary_match', 'overall_match', 'recommendation', 'why_matches', 'gaps', 'status', 'saved_at', 'notes', 'record_version'],
  'Settings': ['key', 'value', 'updated_at'],
  'Applications': ['id', 'job_id', 'status', 'applied_at', 'follow_up_at', 'contact_name', 'contact_email', 'interview_at', 'outcome', 'notes', 'created_at', 'updated_at']
};

function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty('DATABASE_SHEET_ID');
  if (!id) throw new Error('DATABASE_SHEET_ID property is missing.');
  return SpreadsheetApp.openById(id);
}

/**
 * Idempotent initialization. Will not overwrite existing data.
 */
function initializeDatabase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Could not acquire lock for initialization.');

  try {
    const ss = getDb_();

    for (const [sheetName, headers] of Object.entries(SCHEMA)) {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
      } else {
        const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
        const isMatch = headers.every((h, i) => existingHeaders[i] === h);

        if (!isMatch && existingHeaders.length === 1 && existingHeaders[0] === '') {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
        } else if (!isMatch) {
          console.warn(`Sheet '${sheetName}' exists but headers differ. Manual migration required.`);
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function generateUUID() {
  return Utilities.getUuid();
}

function readRows(sheetName) {
  const sheet = getDb_().getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} not found.`);

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((header, index) => {
      const val = data[i][index];
      obj[header] = (val instanceof Date) ? val.toISOString() : val;
    });
    rows.push(obj);
  }
  return rows;
}

function appendRecord(sheetName, record) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Lock timeout writing to ' + sheetName);

  try {
    const sheet = getDb_().getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet ${sheetName} not found.`);

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowData = headers.map(header => {
      if (header === 'id' && !record[header]) return generateUUID();
      if (header === 'created_at' && !record[header]) return new Date().toISOString();
      return record[header] !== undefined ? record[header] : '';
    });

    sheet.appendRow(rowData);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function updateRecordById(sheetName, id, updates) {
  if (!id) throw new Error('ID is required for update.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Lock timeout updating ' + sheetName);

  try {
    const sheet = getDb_().getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet ${sheetName} not found.`);

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) throw new Error('Sheet is empty.');

    const headers = data[0];
    const idIndex = headers.indexOf('id');
    if (idIndex === -1) throw new Error(`No 'id' column in ${sheetName}`);

    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIndex] === id) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) throw new Error(`Record ID ${id} not found.`);

    const currentRow = data[rowIndex - 2];
    updates['updated_at'] = new Date().toISOString();

    const updatedRow = headers.map((header, index) => {
      return updates[header] !== undefined ? updates[header] : currentRow[index];
    });

    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedRow]);
    return true;
  } finally {
    lock.releaseLock();
  }
}
