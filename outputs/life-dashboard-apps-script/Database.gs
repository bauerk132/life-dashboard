/**
 * Database.gs — Phase 1 corrected data-access layer.
 *
 * Every read and write to the spreadsheet goes through this file. Public
 * surface is limited to initializeDatabase(), which is meant to be run
 * manually from the Apps Script editor, not called from the browser.
 * Every other function here ends in "_" and is private: Apps Script does
 * not expose trailing-underscore functions to google.script.run.
 */

const SCHEMA = Object.freeze({
  Tasks: Object.freeze(['id', 'title', 'due_date', 'priority', 'status', 'created_at', 'updated_at', 'completed_at']),
  Jobs: Object.freeze([
    'id', 'external_id', 'source', 'url', 'title', 'company', 'location', 'remote',
    'salary_min', 'salary_max', 'currency', 'posted_at', 'discovered_at', 'last_seen_at',
    'description', 'skills_match', 'experience_match', 'location_match', 'salary_match',
    'overall_match', 'recommendation', 'why_matches', 'gaps', 'status', 'saved_at', 'notes',
    'record_version'
  ]),
  // Phase 3's append-only audit log. It is deliberately a separate sheet
  // rather than additional mutable columns on Jobs: every status change and
  // note stays independently timestamped and recoverable without rewriting
  // the accepted Phase 1 Jobs header contract.
  JobHistory: Object.freeze([
    'id', 'job_id', 'action', 'from_status', 'to_status', 'note', 'created_at'
  ]),
  Settings: Object.freeze(['key', 'value', 'updated_at']),
  Applications: Object.freeze([
    'id', 'job_id', 'status', 'applied_at', 'follow_up_at', 'contact_name', 'contact_email',
    'interview_at', 'outcome', 'notes', 'created_at', 'updated_at'
  ]),
  ApplicationHistory: Object.freeze([
    'id', 'application_id', 'job_id', 'action', 'from_status', 'to_status', 'note', 'created_at'
  ]),
  // Phase 5 Milestone 2. Immutable/versioned score records citing stored job
  // description and approved profile fields.
  JobScores: Object.freeze([
    'id', 'job_id', 'job_description_hash', 'profile_version', 'prompt_version',
    'schema_version', 'provider', 'model', 'status', 'skills_match',
    'experience_match', 'education_match', 'location_match', 'salary_match',
    'overall_match', 'recommendation', 'evidence_json', 'gaps_json',
    'input_tokens', 'output_tokens', 'estimated_cost', 'currency',
    'request_id_hash', 'created_at', 'validated_at', 'error_code'
  ]),
  // Phase 5 Milestone 2. Append-only cost and token usage ledger for budget
  // enforcement and accounting.
  AIUsage: Object.freeze([
    'id', 'run_id', 'job_id', 'provider', 'model', 'operation',
    'profile_version', 'prompt_version', 'request_started_at', 'request_finished_at',
    'input_tokens', 'output_tokens', 'estimated_cost', 'currency', 'status',
    'error_code'
  ]),
  // Phase 4B. One row per discovery run (manual or scheduled), keyed on
  // run_id (there is no 'id' column, so primaryKeyField_ falls back to the
  // first field — see that function's comment). Supports checkpoint/resume:
  // an interrupted run is found again by (date_key, mode) and resumed from
  // checkpoint_json rather than restarted.
  DiscoveryRuns: Object.freeze([
    'run_id', 'source', 'provider', 'mode', 'date_key', 'started_at', 'finished_at',
    'status', 'error_code', 'checkpoint_json', 'pages_attempted', 'raw_count',
    'accepted_count', 'filtered_count', 'duplicate_count', 'updated_count',
    'quarantined_count', 'error_count', 'profile_version', 'config_version',
    'adapter_version', 'filter_version', 'identity_version'
  ]),
  // Phase 4B. Append-only, one row per candidate decision within a run.
  // No raw payloads, no URLs with embedded secrets, no full descriptions —
  // just enough to audit why a candidate was filtered/accepted/duplicated/
  // updated/errored, and which job_id it produced (if any).
  DiscoveryLog: Object.freeze([
    'id', 'run_id', 'logged_at', 'source', 'external_id', 'url_hash', 'content_hash',
    'decision', 'reason_code', 'secondary_reasons', 'profile_version', 'job_id'
  ])
});

// Fields that hold a real Date value but must be reported to the browser
// as yyyy-MM-dd (date-only) rather than a full ISO timestamp.
const DATE_ONLY_FIELDS_ = Object.freeze({
  Tasks: Object.freeze(['due_date'])
});

// Fields that hold arbitrary free-text or date-shaped text. These columns
// get plain-text ('@') number format when a sheet is first created, so a
// value like "3/4" or "=1+1" is stored literally instead of Sheets
// re-interpreting it as a date or a formula. Deliberately narrow: it must
// never include a column meant to hold a real Date or a number, because
// forcing plain-text format on those would be actively harmful (Phase 2
// compares Jobs.overall_match numerically). NOT verified against a live
// Sheet — see PHASE_1_TEST_CHECKLIST.md.
// Every sheet's 'id' column is included here too (UUID-shaped text): a
// caller-supplied id that happened to look numeric (e.g. a client bug
// sending "00123") must not be silently coerced by Sheets before the
// duplicate-id check compares it, or the corruption that check exists to
// prevent (two rows the app can no longer tell apart) happens anyway.
const PLAIN_TEXT_FIELDS_ = Object.freeze({
  // NOTE: due_date is deliberately NOT here — it is a DATE_ONLY_FIELDS_
  // column and must stay a real Date (see that constant above); plain-text
  // formatting it would permanently defeat the yyyy-MM-dd read path below.
  Tasks: Object.freeze(['id', 'title']),
  Jobs: Object.freeze([
    'id', 'title', 'company', 'location', 'url', 'source', 'external_id', 'currency', 'remote',
    'description', 'recommendation', 'why_matches', 'gaps', 'notes'
  ]),
  JobHistory: Object.freeze(['id', 'job_id', 'action', 'from_status', 'to_status', 'note']),
  Settings: Object.freeze(['key', 'value']),
  Applications: Object.freeze(['id', 'contact_name', 'contact_email', 'outcome', 'notes']),
  ApplicationHistory: Object.freeze(['id', 'application_id', 'job_id', 'action', 'from_status', 'to_status', 'note']),
  JobScores: Object.freeze([
    'id', 'job_id', 'job_description_hash', 'profile_version', 'prompt_version',
    'schema_version', 'provider', 'model', 'status', 'recommendation',
    'evidence_json', 'gaps_json', 'currency', 'request_id_hash', 'error_code'
  ]),
  AIUsage: Object.freeze([
    'id', 'run_id', 'job_id', 'provider', 'model', 'operation',
    'profile_version', 'prompt_version', 'currency', 'status', 'error_code'
  ]),
  // config_version, pages_attempted and the *_count columns are deliberately
  // EXCLUDED here: they are real numbers (config_version mirrors
  // JOB_PROFILE_.configVersion; the rest are run counters), and Phase 2/3's
  // numeric-column precedent (see the note above on Jobs' match-score
  // columns) applies just as much to Phase 4B's own counters.
  DiscoveryRuns: Object.freeze([
    'run_id', 'source', 'provider', 'mode', 'date_key', 'status', 'error_code',
    'checkpoint_json', 'profile_version', 'adapter_version', 'filter_version',
    'identity_version'
  ]),
  DiscoveryLog: Object.freeze([
    'id', 'run_id', 'source', 'external_id', 'url_hash', 'content_hash', 'decision',
    'reason_code', 'secondary_reasons', 'profile_version', 'job_id'
  ])
});

// Formula-injection defense for Phase 4B discovery writes. A source-derived
// string (job title, company, description snippet, error text) could
// otherwise be interpreted by Sheets as a formula if it starts with one of
// these characters when a cell isn't already covered by PLAIN_TEXT_FIELDS_'s
// '@' number format (e.g. a column added or written to before
// initializeDatabase has run, or defense-in-depth alongside it).
const SHEET_FORMULA_TRIGGER_CHARS_ = Object.freeze(['=', '+', '-', '@', '\t', '\r']);

// Generous bound, independent of any upstream field-length limit (e.g. the
// 4A adapter's own title/description caps) — this is Database.gs's own
// defense-in-depth limit on what it will ever write into one cell.
const ESCAPE_SHEET_FORMULA_MAX_LENGTH_ = 2000;

const SCRIPT_PROP_SHEET_ID_ = 'DATABASE_SHEET_ID';

// Bound on how many data rows get plain-text formatting when a sheet is
// created. Cosmetic/preventive only — never a correctness dependency — so
// a fixed, generous bound is deliberate rather than an unbounded call.
const FORMAT_ROW_COUNT_ = 2000;

/**
 * A safe, user-facing error. `message` is safe to return to the browser
 * as-is. `code` is a short machine-readable string public endpoints (and
 * Phase 2 code) can branch on.
 */
function UserError_(message, code) {
  const err = new Error(message);
  err.name = 'UserError';
  err.code = code || 'ERROR';
  return err;
}

function assertSheetName_(sheetName) {
  if (!Object.prototype.hasOwnProperty.call(SCHEMA, sheetName)) {
    throw UserError_('Unknown data set: ' + sheetName, 'UNKNOWN_SHEET');
  }
}

/**
 * True if `value` is a Date. Deliberately checks
 * Object.prototype.toString.call(value) instead of `value instanceof
 * Date`: instanceof compares against the Date constructor of whichever
 * realm is asking, so it silently returns false for a genuine Date
 * created in a different realm (e.g. a value handed across a Node `vm`
 * boundary in the local test harness). Apps Script itself runs everything
 * in one realm, so this only ever matters for tests, but the toString
 * check is unconditionally correct and costs nothing extra — no reason to
 * carry a check that's merely usually right.
 */
function isDateValue_(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

/**
 * The field appendRecord_ uses to detect and reject a duplicate record,
 * and to read a just-written record back. 'id' for every sheet that has
 * one; otherwise the sheet's first schema field (e.g. Settings has no
 * 'id' column, so its natural key is 'key'). Without this, a sheet like
 * Settings would have no duplicate protection at all and appendRecord_
 * would have no way to look up what it just wrote.
 */
function primaryKeyField_(sheetName) {
  const fields = SCHEMA[sheetName];
  const idIndex = fields.indexOf('id');
  return idIndex !== -1 ? 'id' : fields[0];
}

function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROP_SHEET_ID_);
  if (!id) {
    throw UserError_('The database is not configured yet.', 'NOT_CONFIGURED');
  }
  return SpreadsheetApp.openById(id);
}

function getTimeZone_() {
  return Session.getScriptTimeZone() || 'America/New_York';
}

function generateUUID_() {
  return Utilities.getUuid();
}

/**
 * Trims, bounds the length of, and formula-escapes a source-derived value
 * before it is written to any Sheet cell. Prefixes a literal `'` when the
 * (trimmed) value would otherwise be parsed by Sheets as a formula (starts
 * with =, +, -, @, a tab, or a CR). New, generic Phase 4B code — Phase 5's
 * sanitizePlainText_ is a separate, unrelated helper and is deliberately
 * not reused here, to avoid a cross-phase dependency.
 *
 * null/undefined become '' (never "null"/"undefined" strings). Every other
 * value is coerced with String(value) first, so a number or boolean is
 * safe to pass through unchanged.
 */
function escapeSheetFormula_(value) {
  if (value === null || value === undefined) return '';
  let str = String(value).trim();
  if (str.length > ESCAPE_SHEET_FORMULA_MAX_LENGTH_) {
    str = str.slice(0, ESCAPE_SHEET_FORMULA_MAX_LENGTH_) + '…(truncated)';
  }
  if (str.length > 0 && SHEET_FORMULA_TRIGGER_CHARS_.indexOf(str[0]) !== -1) {
    str = "'" + str;
  }
  return str;
}

/**
 * Runs fn() while holding the script lock, releasing it afterward even if
 * fn() throws. Throws UserError_ (BUSY) if the lock cannot be acquired
 * within timeoutMs.
 */
function withLock_(timeoutMs, fn) {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(timeoutMs);
  if (!acquired) {
    throw UserError_('The database is busy. Please try again.', 'BUSY');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * True if `header` starts with exactly `expected` (same values, same
 * order) and every column beyond expected.length is blank. A non-blank
 * trailing column is treated as a mismatch, not a tolerated extension.
 */
function headersMatch_(header, expected) {
  if (header.length < expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (header[i] !== expected[i]) return false;
  }
  for (let i = expected.length; i < header.length; i++) {
    if (header[i] !== '' && header[i] !== null && header[i] !== undefined) return false;
  }
  return true;
}

/**
 * Returns the named sheet only after verifying its header row matches
 * SCHEMA exactly. Throws UserError_ (SCHEMA_MISMATCH or MISSING_SHEET)
 * otherwise. Called before every read and every write so a mismatched or
 * missing sheet can never be silently read from or written to.
 */
function getVerifiedSheet_(ss, sheetName) {
  assertSheetName_(sheetName);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw UserError_('Missing data set: ' + sheetName, 'MISSING_SHEET');
  }
  const expected = SCHEMA[sheetName];
  const lastColumn = Math.max(sheet.getLastColumn(), expected.length);
  const header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  if (!headersMatch_(header, expected)) {
    throw UserError_('The "' + sheetName + '" data set has an unexpected layout.', 'SCHEMA_MISMATCH');
  }
  return sheet;
}

/**
 * Sets plain-text format on only the PLAIN_TEXT_FIELDS_ columns for
 * sheetName, by column index. Never touches a Date or numeric column.
 */
function applyPlainTextFormat_(sheet, sheetName, headerRow) {
  const fields = PLAIN_TEXT_FIELDS_[sheetName] || [];
  fields.forEach(function (field) {
    const colIndex = headerRow.indexOf(field);
    if (colIndex === -1) return;
    sheet.getRange(2, colIndex + 1, FORMAT_ROW_COUNT_, 1).setNumberFormat('@');
  });
}

function writeHeader_(sheet, sheetName, expected) {
  sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold');
  applyPlainTextFormat_(sheet, sheetName, expected);
  sheet.setFrozenRows(1);
}

/**
 * Idempotent. Meant to be run manually from the Apps Script editor, not
 * exposed to the browser. Creates every missing sheet with the correct
 * header row. An existing sheet that is entirely empty (no content in any
 * row) gets the header written. Any other existing sheet whose header
 * does not match exactly (same length and order) — including one where
 * row 1 is blank but a later row holds data, which looks like "no header
 * yet" but is not "no data yet" — is left completely untouched. Every
 * such sheet is collected and reported together in one error, so a single
 * run surfaces every problem instead of stopping at the first and
 * silently leaving the rest unexamined.
 */
function initializeDatabase() {
  return withLock_(15000, function () {
    const ss = getDb_();
    const mismatched = [];

    Object.keys(SCHEMA).forEach(function (sheetName) {
      const expected = SCHEMA[sheetName];
      let sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        writeHeader_(sheet, sheetName, expected);
        return;
      }

      const lastRow = sheet.getLastRow();
      const lastColumn = sheet.getLastColumn();

      if (lastRow === 0 || lastColumn === 0) {
        writeHeader_(sheet, sheetName, expected);
        return;
      }

      const header = sheet.getRange(1, 1, 1, Math.max(lastColumn, expected.length)).getValues()[0];
      const headerIsBlank = header.every(function (v) { return v === '' || v === null || v === undefined; });

      if (headerIsBlank) {
        // lastRow === 0 already returned above, so reaching this point
        // with a blank row 1 means SOME row (2+, or a column beyond what
        // was just checked) is non-blank. That is indistinguishable from
        // "someone left row 1 as a spacer above real data" — writing a
        // header here would silently make that data look like it matches
        // the new schema. Fail safe: treat it as a mismatch instead of
        // guessing it is safe to initialize.
        mismatched.push(sheetName);
        return;
      }

      if (!headersMatch_(header, expected)) {
        mismatched.push(sheetName);
      }
      // Matching, non-empty sheet: leave it exactly as-is.
    });

    if (mismatched.length > 0) {
      throw UserError_(
        'These data sets already exist with an unexpected layout and were left unchanged: ' +
        mismatched.join(', ') + '. Review them manually before running initialization again.',
        'SCHEMA_MISMATCH'
      );
    }

    return { status: 'ok' };
  });
}

/**
 * Reads every non-blank data row from sheetName as plain objects keyed by
 * the schema's field names. Rows that are entirely blank are skipped.
 * Date cells serialize to an ISO string, except DATE_ONLY_FIELDS_ for this
 * sheet, which serialize as yyyy-MM-dd in the script time zone. 0, false,
 * and '' are preserved exactly as stored.
 */
function readRows_(ss, sheetName) {
  const sheet = getVerifiedSheet_(ss, sheetName);
  const fields = SCHEMA[sheetName];
  const dateOnly = DATE_ONLY_FIELDS_[sheetName] || [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, fields.length).getValues();
  const tz = getTimeZone_();
  const rows = [];

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const isBlank = row.every(function (v) { return v === '' || v === null || v === undefined; });
    if (isBlank) continue;

    const obj = {};
    for (let c = 0; c < fields.length; c++) {
      const field = fields[c];
      const raw = row[c];
      if (isDateValue_(raw)) {
        obj[field] = dateOnly.indexOf(field) !== -1
          ? Utilities.formatDate(raw, tz, 'yyyy-MM-dd')
          : raw.toISOString();
      } else if (raw === undefined || raw === null) {
        obj[field] = '';
      } else {
        obj[field] = raw;
      }
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Appends one new record to sheetName. `record` must be a plain object
 * containing only known fields — an unrecognized key throws rather than
 * being silently dropped. `id` is generated when absent/blank; a supplied
 * id that already exists throws UserError_ with code DUPLICATE_ID and
 * writes nothing. created_at/updated_at are set to the current time as
 * real Date values when absent. Returns the record as it was actually
 * stored (with server-assigned id/timestamps and normal read-path
 * serialization applied).
 */
function appendRecordInDb_(ss, sheetName, record) {
    assertSheetName_(sheetName);
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw UserError_('Invalid record.', 'INVALID_RECORD');
    }

    const fields = SCHEMA[sheetName];
    const unknown = Object.keys(record).filter(function (k) { return fields.indexOf(k) === -1; });
    if (unknown.length > 0) {
      throw UserError_('Unknown field(s): ' + unknown.join(', '), 'UNKNOWN_FIELD');
    }

    const sheet = getVerifiedSheet_(ss, sheetName);

    const toWrite = {};
    fields.forEach(function (f) { toWrite[f] = record[f]; });

    const keyField = primaryKeyField_(sheetName);
    const hasKey = toWrite[keyField] !== undefined && toWrite[keyField] !== null && toWrite[keyField] !== '';

    if (!hasKey) {
      if (keyField === 'id') {
        toWrite.id = generateUUID_();
      } else {
        // Only 'id' can be server-generated (a UUID needs no meaning).
        // A sheet keyed on something else (e.g. Settings.key) has no
        // value the server could invent on the caller's behalf.
        throw UserError_('"' + keyField + '" is required.', 'MISSING_KEY');
      }
    } else {
      // Compared as strings deliberately: a caller-supplied key is
      // written to Sheets as-is, and this codebase's plain-text-format
      // mitigation (PLAIN_TEXT_FIELDS_) is not verified against a live
      // Sheet (see that constant's comment). If a live Sheet ever did
      // coerce a numeric-looking key on write, a strict === comparison
      // against the pre-coercion value here would silently miss the
      // duplicate this check exists to catch.
      const dup = readRows_(ss, sheetName).some(function (row) {
        return String(row[keyField]) === String(toWrite[keyField]);
      });
      if (dup) {
        throw UserError_('A record with this ' + keyField + ' already exists.', 'DUPLICATE_ID');
      }
    }

    const now = new Date();
    if (fields.indexOf('created_at') !== -1 && !toWrite.created_at) {
      toWrite.created_at = now;
    }
    if (fields.indexOf('updated_at') !== -1 && !toWrite.updated_at) {
      toWrite.updated_at = now;
    }

    const rowValues = fields.map(function (f) {
      const v = toWrite[f];
      return v !== undefined ? v : '';
    });

    sheet.appendRow(rowValues);

    // Read back through the same path every other caller sees (ISO-string
    // dates, yyyy-MM-dd for DATE_ONLY_FIELDS_, etc.) rather than returning
    // toWrite as-is, which would hand back e.g. a raw Date object where
    // every other reader gets a string. A miss here would mean the row
    // this function just wrote cannot be found by its own key — a lock is
    // held for the whole call, so nothing else could have written it away;
    // surface that loudly rather than silently returning undefined.
    const stored = readRows_(ss, sheetName).filter(function (r) {
      return String(r[keyField]) === String(toWrite[keyField]);
    })[0];
    if (!stored) {
      throw UserError_('The record was saved but could not be read back.', 'READBACK_FAILED');
    }
    return stored;
}

/**
 * Appends one record under the foundation's normal script lock. Most callers
 * use this. A multi-record mutation can instead acquire withLock_ once and
 * call appendRecordInDb_ with the same verified spreadsheet handle.
 */
function appendRecord_(sheetName, record) {
  return withLock_(10000, function () {
    return appendRecordInDb_(getDb_(), sheetName, record);
  });
}

/**
 * Updates exactly one record identified by id in sheetName, merging
 * `updates` onto the existing row. Requires exactly one non-blank row to
 * match the id: zero matches throws NOT_FOUND, two or more throws
 * INTEGRITY_ERROR — either way nothing is written. `updates` itself is
 * never mutated. `id` and `created_at` may not be changed. Only known
 * fields may appear in `updates`. Returns the record as stored after the
 * update.
 *
 * `precondition`, if given, is called with the row's current field values
 * (read-path raw, before `updates` is merged in) after the matching row
 * is located but before anything is written, while the lock from this
 * call is still held. It should throw to reject the update (e.g. an
 * illegal status transition) or return normally to allow it. This exists
 * so a caller can check-then-write atomically under a single lock
 * acquisition instead of nesting a second withLock_ call inside this
 * one — LockService's reentrancy behavior for a script re-acquiring its
 * own held lock within one execution is not something this project can
 * verify without a live Apps Script deployment, so callers needing an
 * atomic conditional update should use this parameter rather than risk
 * calling this function again from inside their own lock.
 */
function updateRecordByIdInDb_(ss, sheetName, id, updates, precondition) {
  if (id === null || id === undefined || id === '') {
    throw UserError_('An id is required.', 'INVALID_ID');
  }
  return updateRecordByKeyInDb_(ss, sheetName, 'id', id, updates, precondition);
}

/**
 * Generalizes updateRecordByIdInDb_ to update-by-any-key, for sheets like
 * DiscoveryRuns that have no 'id' column and are looked up by their own
 * natural key (run_id) instead — see primaryKeyField_. Same semantics as
 * updateRecordByIdInDb_ (which is now a thin wrapper over this with
 * keyField fixed to 'id', so every existing caller's behavior, including
 * exact error codes, is unchanged): exactly one non-blank match is
 * required (zero -> NOT_FOUND, two or more -> INTEGRITY_ERROR, nothing
 * written either way); keyField and created_at (when present) are
 * immutable; only known fields may appear in `updates`; updated_at (when
 * the sheet has that column) is auto-set; `precondition`, if given, runs
 * against the current row before anything is written, under the same
 * lock this call is made within (see updateRecordByIdInDb_'s doc comment
 * for why this exists instead of a nested withLock_ call).
 */
function updateRecordByKeyInDb_(ss, sheetName, keyField, keyValue, updates, precondition) {
    assertSheetName_(sheetName);
    if (keyValue === null || keyValue === undefined || keyValue === '') {
      throw UserError_('A ' + keyField + ' is required.', 'INVALID_ID');
    }
    if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
      throw UserError_('Invalid update payload.', 'INVALID_RECORD');
    }

    const fields = SCHEMA[sheetName];
    const keyIndex = fields.indexOf(keyField);
    if (keyIndex === -1) {
      // Distinct from UNKNOWN_SHEET: sheetName is a real, known sheet
      // (assertSheetName_ above already confirmed that) — it just has no
      // such column to update by.
      throw UserError_('This data set has no ' + keyField + ' column.', 'NO_ID_COLUMN');
    }
    const unknown = Object.keys(updates).filter(function (k) { return fields.indexOf(k) === -1; });
    if (unknown.length > 0) {
      throw UserError_('Unknown field(s): ' + unknown.join(', '), 'UNKNOWN_FIELD');
    }
    if (Object.prototype.hasOwnProperty.call(updates, keyField)) {
      throw UserError_(keyField + ' cannot be changed.', 'IMMUTABLE_FIELD');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'created_at')) {
      throw UserError_('created_at cannot be changed.', 'IMMUTABLE_FIELD');
    }

    const sheet = getVerifiedSheet_(ss, sheetName);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw UserError_('Record not found.', 'NOT_FOUND');
    }

    const range = sheet.getRange(2, 1, lastRow - 1, fields.length);
    const data = range.getValues();

    // Sheets can coerce numbers/dates while callers commonly use strings.
    // Natural keys are identifiers, so compare their stable string forms
    // rather than relying on realm- or storage-specific value types.
    const normalizedKeyValue = String(keyValue);
    const matches = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const isBlank = row.every(function (v) { return v === '' || v === null || v === undefined; });
      if (isBlank) continue;
      if (String(row[keyIndex]) === normalizedKeyValue) matches.push(i);
    }

    if (matches.length === 0) {
      throw UserError_('Record not found.', 'NOT_FOUND');
    }
    if (matches.length > 1) {
      throw UserError_('Multiple records share this ' + keyField + '. No change was made.', 'INTEGRITY_ERROR');
    }

    const rowOffset = matches[0];          // 0-based index into `data`
    const sheetRow = rowOffset + 2;        // 1-based sheet row (data[0] is sheet row 2)
    const currentRow = data[rowOffset];

    const merged = {};
    fields.forEach(function (f, i) { merged[f] = currentRow[i]; });

    if (typeof precondition === 'function') {
      precondition(merged);
    }

    // Copy updates onto a fresh object; the caller's `updates` is never
    // written to.
    const patch = {};
    Object.keys(updates).forEach(function (k) { patch[k] = updates[k]; });
    if (fields.indexOf('updated_at') !== -1) {
      patch.updated_at = new Date();
    }
    Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });

    const rowValues = fields.map(function (f) {
      const v = merged[f];
      return v !== undefined ? v : '';
    });

    sheet.getRange(sheetRow, 1, 1, fields.length).setValues([rowValues]);
    return readRows_(ss, sheetName).filter(function (r) {
      return String(r[keyField]) === normalizedKeyValue;
    })[0];
}

/**
 * Updates exactly one record under the foundation's normal script lock.
 * Multi-record mutations can acquire withLock_ once and call
 * updateRecordByIdInDb_ with the same verified spreadsheet handle.
 */
function updateRecordById_(sheetName, id, updates, precondition) {
  return withLock_(10000, function () {
    return updateRecordByIdInDb_(getDb_(), sheetName, id, updates, precondition);
  });
}
