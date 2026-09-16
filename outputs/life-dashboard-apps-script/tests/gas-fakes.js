'use strict';

/**
 * In-memory fakes for the Apps Script global services, plus a loader that
 * runs the project's own .gs files against them.
 *
 * IMPORTANT: all requested .gs files are concatenated into ONE source
 * string and executed via a single vm.runInContext() call. This mirrors
 * real Apps Script, where every .gs file in a project shares one global
 * script scope. Running each file through a SEPARATE runInContext() call
 * would be wrong: top-level `const`/`let` bindings (e.g. `const SCHEMA`)
 * only live in the lexical scope of the single script execution that
 * declared them and would be invisible to code from a different file —
 * only top-level `function` declarations attach to the shared global
 * object across separate calls. Concatenating avoids that trap and also
 * means a real hazard (two files declaring the same top-level name) fails
 * the same way here as it would in a real Apps Script project.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJECT_ROOT = path.join(__dirname, '..');

function createSheet_(name) {
  return {
    name: name,
    data: [], // data[rowIdx0][colIdx0]; rowIdx0 0 == sheet row 1
    formats: [], // formats[rowIdx0][colIdx0], parallel to data

    getSheetName: function () { return this.name; },

    getLastRow: function () {
      for (let r = this.data.length - 1; r >= 0; r--) {
        const row = this.data[r] || [];
        const hasValue = row.some(function (v) { return v !== undefined && v !== null && v !== ''; });
        if (hasValue) return r + 1;
      }
      return 0;
    },

    getLastColumn: function () {
      let max = 0;
      this.data.forEach(function (row) {
        for (let c = row.length - 1; c >= 0; c--) {
          const v = row[c];
          if (v !== undefined && v !== null && v !== '') {
            if (c + 1 > max) max = c + 1;
            break;
          }
        }
      });
      return max;
    },

    getRange: function (row, col, numRows, numCols) {
      if (numRows === undefined) numRows = 1;
      if (numCols === undefined) numCols = 1;
      const sheet = this;
      return {
        getValues: function () {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const srcRow = sheet.data[row + r - 1] || [];
            const outRow = [];
            for (let c = 0; c < numCols; c++) {
              const v = srcRow[col + c - 1];
              outRow.push(v === undefined ? '' : v);
            }
            out.push(outRow);
          }
          return out;
        },
        setValues: function (values) {
          for (let r = 0; r < numRows; r++) {
            const sheetRow = row + r - 1;
            if (!sheet.data[sheetRow]) sheet.data[sheetRow] = [];
            for (let c = 0; c < numCols; c++) {
              sheet.data[sheetRow][col + c - 1] = values[r][c];
            }
          }
          return this;
        },
        setFontWeight: function () { return this; },
        setNumberFormat: function (fmt) {
          for (let r = 0; r < numRows; r++) {
            const sheetRow = row + r - 1;
            if (!sheet.formats[sheetRow]) sheet.formats[sheetRow] = [];
            for (let c = 0; c < numCols; c++) {
              sheet.formats[sheetRow][col + c - 1] = fmt;
            }
          }
          return this;
        },
        getNumberFormats: function () {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const srcRow = sheet.formats[row + r - 1] || [];
            const outRow = [];
            for (let c = 0; c < numCols; c++) {
              outRow.push(srcRow[col + c - 1] || 'General');
            }
            out.push(outRow);
          }
          return out;
        }
      };
    },

    appendRow: function (values) {
      const nextIndex = this.getLastRow(); // 0-based index of the row right after the current last row
      // Array.from (called bare, so it resolves to THIS module's host-realm
      // Array), not values.slice(). `values` is usually produced inside the
      // vm sandbox (e.g. Database.gs's `fields.map(...)`), and
      // Array.prototype.slice on a vm-realm array returns another
      // vm-realm array (ArraySpeciesCreate follows the receiver's
      // constructor). That would leave sheet.data holding a vm-realm
      // array container, which later fails Node's realm-sensitive
      // assert.deepStrictEqual against a host-realm expected value even
      // when every element matches. Array.from always constructs using
      // the Array it's called on here (host), regardless of the input's
      // realm, so the stored row is reliably a plain host array.
      this.data[nextIndex] = Array.from(values);
    },

    setFrozenRows: function () { /* no-op */ }
  };
}

function createSpreadsheet_(name, sheetsByName) {
  return {
    getName: function () { return name; },
    getSheetByName: function (sheetName) {
      return Object.prototype.hasOwnProperty.call(sheetsByName, sheetName) ? sheetsByName[sheetName] : null;
    },
    insertSheet: function (sheetName) {
      if (Object.prototype.hasOwnProperty.call(sheetsByName, sheetName)) {
        throw new Error('Fake SpreadsheetApp: sheet already exists: ' + sheetName);
      }
      const sheet = createSheet_(sheetName);
      sheetsByName[sheetName] = sheet;
      return sheet;
    }
  };
}

function createPropertiesStore_(initial) {
  const store = Object.assign({}, initial);
  const properties = {
    getProperty: function (key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setProperty: function (key, value) { store[key] = value; },
    deleteProperty: function (key) { delete store[key]; }
  };
  return {
    getScriptProperties: function () { return properties; }
  };
}

function createLockService_(options) {
  options = options || {};
  let locked = false;
  return {
    getScriptLock: function () {
      return {
        tryLock: function () {
          if (options.alwaysFail) return false;
          if (locked) return false;
          locked = true;
          return true;
        },
        releaseLock: function () { locked = false; }
      };
    }
  };
}

function createUrlFetchApp_(options) {
  options = options || {};
  const responses = (options.responses || []).slice();
  const calls = [];

  return {
    calls: calls,
    fetch: function (url, params) {
      calls.push({
        url: url,
        params: JSON.parse(JSON.stringify(params || {}))
      });

      if (responses.length === 0) {
        throw new Error('Fake UrlFetchApp: unexpected network call to ' + url);
      }

      const next = responses.shift();
      if (next.throws) {
        throw (next.throws instanceof Error ? next.throws : new Error(String(next.throws)));
      }

      const code = (next.code !== undefined) ? next.code : 200;
      const body = (next.body !== undefined) ? next.body : '';
      const headers = Object.assign({}, next.headers || {});

      return {
        getResponseCode: function () { return code; },
        getContentText: function () { return body; },
        getHeaders: function () { return Object.assign({}, headers); },
        getAllHeaders: function () { return Object.assign({}, headers); }
      };
    }
  };
}

function createUtilities_() {
  let counter = 0;
  return {
    getUuid: function () {
      counter += 1;
      return 'test-uuid-' + counter;
    },
    formatDate: function (date, tz, pattern) {
      // Create a date shifted to UTC so Intl.DateTimeFormat with a timeZone gives the expected calendar string
      // when the input 'date' is fundamentally a local midnight but the runtime is UTC.
      // We fake Utilities.formatDate by formatting it in 'UTC' explicitly since GAS's native Date objects
      // carry implicit local time zones that Intl otherwise shifts.
      // But since we are mocking, and the tests instantiate Dates using new Date(y,m,d),
      // we can get the actual parts if we use the default system timezone.

      const pad = function (n) { return (n < 10 ? '0' : '') + n; };
      if (pattern === 'yyyy-MM-dd') {
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
      }
      if (pattern === 'yyyy-MM') {
        return date.getFullYear() + '-' + pad(date.getMonth() + 1);
      }
      return date.toISOString();
    },
    computeDigest: function (algorithm, value, charset) {
      if (algorithm !== 'SHA_256') {
        throw new Error('Fake Utilities.computeDigest: unsupported algorithm ' + algorithm);
      }
      const buf = crypto.createHash('sha256').update(String(value), 'utf8').digest();
      return Array.from(new Int8Array(buf.buffer, buf.byteOffset, buf.length));
    },
    DigestAlgorithm: {
      SHA_256: 'SHA_256'
    },
    Charset: {
      UTF_8: 'UTF_8'
    }
  };
}

function createSession_(timeZone) {
  return {
    getScriptTimeZone: function () { return timeZone; }
  };
}

/**
 * Fake ScriptApp, for Discovery.gs's trigger install/remove/guard code.
 * Mirrors the real builder-chain shape closely enough for that code to run
 * unmodified against it:
 *   ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(7)
 *     .inTimezone('America/New_York').create()
 * `getProjectTriggers()`/`deleteTrigger()` operate on one project-wide list
 * shared by every trigger created through this same ScriptApp instance
 * (matching real Apps Script, where triggers are project-scoped, not
 * handler-scoped). `getUniqueId()` returns a String, matching the real
 * Trigger class (confirmed against
 * https://developers.google.com/apps-script/reference/script/trigger).
 */
function createScriptApp_() {
  const triggers = [];
  let nextId = 1;

  function makeTrigger(handlerFunction, config) {
    const uniqueId = 'fake-trigger-' + (nextId++);
    return {
      uniqueId: uniqueId,
      getUniqueId: function () { return uniqueId; },
      getHandlerFunction: function () { return handlerFunction; },
      getTriggerSource: function () { return 'CLOCK'; },
      getEventType: function () { return 'CLOCK'; },
      _config: config
    };
  }

  function createClockTriggerBuilder_(handlerFunction) {
    const config = { everyDays: null, atHour: null, nearMinute: null, timezone: null };
    const builder = {
      everyDays: function (n) { config.everyDays = n; return builder; },
      atHour: function (h) { config.atHour = h; return builder; },
      nearMinute: function (m) { config.nearMinute = m; return builder; },
      inTimezone: function (tz) { config.timezone = tz; return builder; },
      create: function () {
        const trigger = makeTrigger(handlerFunction, config);
        triggers.push(trigger);
        return trigger;
      }
    };
    return builder;
  }

  return {
    newTrigger: function (handlerFunction) {
      return {
        timeBased: function () { return createClockTriggerBuilder_(handlerFunction); }
      };
    },
    getProjectTriggers: function () { return triggers.slice(); },
    deleteTrigger: function (trigger) {
      const idx = triggers.findIndex(function (t) {
        return t.getUniqueId() === (trigger && trigger.getUniqueId());
      });
      if (idx !== -1) triggers.splice(idx, 1);
    },
    getScriptId: function () { return 'fake-script-id'; },
    EventType: { CLOCK: 'CLOCK' },
    TriggerSource: { CLOCK: 'CLOCK' }
  };
}

/**
 * Injectable fake clock for testing time-based logic (Discovery.gs's
 * runtime-budget guard, checkpoint timestamps) without real sleeps.
 * `initialNow` is a Date-constructor-compatible value (ISO string, ms
 * number, or omitted for real wall-clock "now" at creation time).
 * `advance(ms)` and `setNow(value)` mutate the clock; every read
 * (`Date.now()` and no-arg `new Date()` inside the sandbox, once installed
 * via loadAppsScriptContext_'s `fakeClock` option) reflects the latest
 * value. Dated `new Date(x)` calls with explicit arguments are NOT
 * intercepted — only the no-arg constructor and `Date.now()` are, since
 * those are the only two forms that read "the current time" rather than
 * construct a specific one.
 */
function createFakeClock_(initialNow) {
  let nowMs = (initialNow === undefined || initialNow === null)
    ? Date.now()
    : (typeof initialNow === 'number' ? initialNow : new Date(initialNow).getTime());
  return {
    now: function () { return nowMs; },
    advance: function (ms) { nowMs += ms; },
    setNow: function (value) {
      nowMs = (typeof value === 'number') ? value : new Date(value).getTime();
    }
  };
}

/**
 * Fake CalendarApp. `options.events` is an array of plain descriptors
 * `{title, start: Date, end: Date, allDay: boolean}`; getEvents(start,
 * end) returns the ones that overlap the requested window, wrapped as
 * fake CalendarEvent objects (getTitle/getStartTime/getEndTime/
 * isAllDayEvent), matching the real CalendarApp API surface that
 * Calendar.gs actually calls. `options.calendarThrows` /
 * `options.getEventsThrows` simulate a CalendarApp failure at either
 * call site (true for a generic Error, or pass a specific Error/value to
 * throw) — Calendar.gs must turn either into a safe {status:
 * 'unavailable'} response, never let the raw error escape.
 */
function createCalendarApp_(options) {
  options = options || {};
  return {
    getDefaultCalendar: function () {
      if (options.calendarThrows) {
        throw (options.calendarThrows === true
          ? new Error('Fake CalendarApp: default calendar unavailable')
          : options.calendarThrows);
      }
      const defs = options.events || [];
      return {
        getEvents: function (start, end) {
          if (options.getEventsThrows) {
            throw (options.getEventsThrows === true
              ? new Error('Fake CalendarApp: getEvents failed')
              : options.getEventsThrows);
          }
          return defs
            .filter(function (def) { return def.end > start && def.start < end; })
            .map(function (def) {
              return {
                getTitle: function () { return def.title; },
                getStartTime: function () { return def.start; },
                getEndTime: function () { return def.end; },
                isAllDayEvent: function () { return !!def.allDay; }
              };
            });
        }
      };
    }
  };
}

function createHtmlService_(readFile) {
  function makeOutput(content) {
    return {
      _content: content,
      getContent: function () { return this._content; },
      setTitle: function () { return this; },
      addMetaTag: function () { return this; },
      evaluate: function () { return makeOutput(this._content); },
      setXFrameOptionsMode: function () { return this; }
    };
  }
  return {
    createHtmlOutputFromFile: function (filename) {
      return makeOutput(readFile(filename + '.html'));
    },
    createTemplateFromFile: function (filename) {
      const content = readFile(filename + '.html');
      return {
        evaluate: function () { return makeOutput(content); }
      };
    },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' }
  };
}

/**
 * Deep-copies `value` while rehoming every array/object it contains into
 * THIS module's host realm, preserving Date-vs-string identity (unlike
 * JSON.parse(JSON.stringify(...)), which flattens every Date to an ISO
 * string and would make a real-Date assertion meaningless).
 *
 * Why this exists: code loaded into the vm sandbox (any .gs file) builds
 * its plain objects, arrays, and `new Date()` values using the SANDBOX's
 * own Object/Array/Date constructors, which are distinct from this
 * module's. A value returned from a sandboxed function call — e.g.
 * `ctx.sandbox.initializeDatabase()`, `ctx.sandbox.readRows_(...)`, or
 * `ctx.testExports.SCHEMA` — is structurally identical to a host-realm
 * equivalent but fails Node's realm-sensitive assert.deepStrictEqual
 * (aliased from assert.deepEqual by node:assert/strict) with "same
 * structure but not reference-equal", because deepStrictEqual also
 * compares [[Prototype]]. `instanceof Date` has the matching failure mode
 * in the other direction (true value, wrong-realm check).
 *
 * hostify_ walks the value and rebuilds every array/object using a plain
 * `[]`/`{}` literal written in THIS file (so it is always host-realm,
 * regardless of which realm produced the original), and every Date via
 * `new Date(value.getTime())` using the duck-typed
 * Object.prototype.toString check rather than `instanceof Date`, which is
 * exactly what makes it realm-safe. Use it on both sides of a comparison
 * (or on a value you're about to run `instanceof Date` against) whenever
 * that value could have crossed the vm boundary.
 */
function hostify_(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) { // cross-realm-safe, unlike `value instanceof Array`
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(hostify_(value[i]));
    return out;
  }
  const out = {};
  Object.keys(value).forEach(function (k) { out[k] = hostify_(value[k]); });
  return out;
}

function createConsoleFake_() {
  const errors = [];
  const warns = [];
  return {
    log: function () {},
    warn: function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); },
    error: function () { errors.push(Array.prototype.slice.call(arguments).join(' ')); },
    _errors: errors,
    _warns: warns
  };
}

/**
 * Builds a fresh fake Apps Script global context and runs the given .gs
 * files (default: Database.gs + Code.gs) against it as one combined
 * script. Returns the sandbox (call top-level functions as
 * ctx.sandbox.someFunction(...)) plus direct handles to the fake
 * spreadsheet/sheets/console for setting up scenarios and assertions.
 *
 * options:
 *   files             - array of .gs filenames to load, relative to the
 *                        project root (default ['Database.gs', 'Code.gs'])
 *   sheetId            - fake spreadsheet id (default 'FAKE_SHEET_ID')
 *   scriptProperties   - initial Script Properties object; omit the
 *                        DATABASE_SHEET_ID key to simulate "not configured"
 *   timeZone           - script time zone (default 'America/New_York')
 *   spreadsheetName    - fake spreadsheet display name
 *   initialSheets      - { SheetName: { header: [...], rows: [[...], ...] } }
 *   lockOptions        - passed through to createLockService_
 *   fakeClock          - omit for the real vm-realm Date/Date.now(). Pass
 *                        `true` (starts at real wall-clock "now") or an
 *                        ISO-string/ms-number/{initialNow} to install a
 *                        controllable clock: the sandbox's no-arg
 *                        `new Date()` and `Date.now()` are rebound to it
 *                        (explicit-argument `new Date(x)` is untouched).
 *                        The returned context's `.clock` exposes
 *                        `advance(ms)`/`setNow(value)` to drive it from the
 *                        test. See createFakeClock_ above.
 */
function loadAppsScriptContext_(options) {
  options = options || {};
  const sheetId = options.sheetId || 'FAKE_SHEET_ID';
  const scriptProperties = Object.prototype.hasOwnProperty.call(options, 'scriptProperties')
    ? options.scriptProperties
    : { DATABASE_SHEET_ID: sheetId };
  const timeZone = options.timeZone || 'America/New_York';
  const spreadsheetName = options.spreadsheetName || 'Test Spreadsheet';
  const initialSheets = options.initialSheets || {};
  const files = options.files || ['Database.gs', 'Code.gs'];

  const sheetsByName = {};
  Object.keys(initialSheets).forEach(function (name) {
    const sheet = createSheet_(name);
    const def = initialSheets[name] || {};
    if (def.header) sheet.data[0] = def.header.slice();
    (def.rows || []).forEach(function (row, i) {
      sheet.data[i + 1] = row.slice();
    });
    sheetsByName[name] = sheet;
  });

  const spreadsheet = createSpreadsheet_(spreadsheetName, sheetsByName);
  const consoleFake = createConsoleFake_();

  const htmlCache = {};
  function readHtmlFile(filename) {
    if (!Object.prototype.hasOwnProperty.call(htmlCache, filename)) {
      htmlCache[filename] = fs.readFileSync(path.join(PROJECT_ROOT, filename), 'utf8');
    }
    return htmlCache[filename];
  }

  const urlFetch = createUrlFetchApp_(options.urlFetch || { responses: [] });
  const scriptApp = createScriptApp_();

  let fakeClock = null;
  if (options.fakeClock) {
    const initialNow = (options.fakeClock === true)
      ? undefined
      : (Object.prototype.hasOwnProperty.call(options.fakeClock, 'initialNow')
        ? options.fakeClock.initialNow
        : options.fakeClock);
    fakeClock = createFakeClock_(initialNow);
  }

  const sandbox = {
    console: consoleFake,
    SpreadsheetApp: {
      openById: function (id) {
        if (id !== sheetId) throw new Error('Fake SpreadsheetApp: unexpected id ' + id);
        return spreadsheet;
      }
    },
    PropertiesService: createPropertiesStore_(scriptProperties),
    LockService: createLockService_(options.lockOptions),
    Utilities: createUtilities_(),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    UrlFetchApp: urlFetch,
    Session: createSession_(timeZone),
    HtmlService: createHtmlService_(readHtmlFile),
    CalendarApp: createCalendarApp_(options.calendarOptions),
    ScriptApp: scriptApp
  };

  if (fakeClock) {
    // Bridge fn: lets the prelude (running INSIDE the vm context, which has
    // its own realm-isolated globalThis) read the host-side clock's value.
    sandbox.__FAKE_CLOCK_NOW__ = function () { return fakeClock.now(); };
  }

  vm.createContext(sandbox);

  // Top-level `const`/`let` in the loaded files (e.g. `const SCHEMA`) live
  // only in this script execution's lexical scope, not as properties of
  // `sandbox` — only `function` declarations attach to the global object.
  // This trailer runs in that SAME execution (same combined source, same
  // runInContext call), so it can still see those bindings via normal
  // lexical scoping, and copies the ones tests need onto the global
  // object explicitly. It is not part of the real Apps Script project.
  const testExportsTrailer = [
    '',
    '// ---- test harness exports (not part of the real Apps Script project) ----',
    'globalThis.__TEST_EXPORTS__ = {',
    '  SCHEMA: (typeof SCHEMA !== "undefined") ? SCHEMA : undefined,',
    '  PLAIN_TEXT_FIELDS_: (typeof PLAIN_TEXT_FIELDS_ !== "undefined") ? PLAIN_TEXT_FIELDS_ : undefined,',
    '  DATE_ONLY_FIELDS_: (typeof DATE_ONLY_FIELDS_ !== "undefined") ? DATE_ONLY_FIELDS_ : undefined,',
    '  JSEARCH_ADAPTER_VERSION_: (typeof JSEARCH_ADAPTER_VERSION_ !== "undefined") ? JSEARCH_ADAPTER_VERSION_ : undefined,',
    '  JSEARCH_PLAN_MONTHLY_LIMIT_: (typeof JSEARCH_PLAN_MONTHLY_LIMIT_ !== "undefined") ? JSEARCH_PLAN_MONTHLY_LIMIT_ : undefined,',
    '  JSEARCH_SCHEDULED_DAILY_CAP_: (typeof JSEARCH_SCHEDULED_DAILY_CAP_ !== "undefined") ? JSEARCH_SCHEDULED_DAILY_CAP_ : undefined,',
    '  JSEARCH_MANUAL_DAILY_CAP_: (typeof JSEARCH_MANUAL_DAILY_CAP_ !== "undefined") ? JSEARCH_MANUAL_DAILY_CAP_ : undefined,',
    '  JSEARCH_PERIOD_RESERVE_: (typeof JSEARCH_PERIOD_RESERVE_ !== "undefined") ? JSEARCH_PERIOD_RESERVE_ : undefined,',
    '  JSEARCH_QUERY_CATALOG_: (typeof JSEARCH_QUERY_CATALOG_ !== "undefined") ? JSEARCH_QUERY_CATALOG_ : undefined,',
    '  JSEARCH_DEFAULT_ENABLED_PUBLISHERS_: (typeof JSEARCH_DEFAULT_ENABLED_PUBLISHERS_ !== "undefined") ? JSEARCH_DEFAULT_ENABLED_PUBLISHERS_ : undefined',
    '};'
  ].join('\n');

  // Installed BEFORE the project files so any top-level code in them (there
  // shouldn't be any that reads the clock, but function bodies defined
  // there close over whatever `Date` resolves to at CALL time regardless of
  // load order) sees the override. Only the no-arg constructor and
  // `Date.now()` are redirected to the fake clock; `new RealDate(...args)`
  // is used for every other form, so e.g. `new Date('2026-01-01')` and
  // `new Date(y, m, d)` behave exactly as the real Date would. Returning an
  // object from a function invoked with `new` makes `new FakeDate()`
  // evaluate to that object (a genuine RealDate instance) instead of the
  // implicit `this` — so `instanceof Date`/`Object.prototype.toString`
  // checks on the result see a real Date, not a wrapper.
  const fakeClockPrelude = fakeClock ? [
    '// ---- fake clock (test harness only, not part of the real Apps Script project) ----',
    '(function () {',
    '  var RealDate = Date;',
    '  function FakeDate(...args) {',
    '    if (args.length === 0) return new RealDate(globalThis.__FAKE_CLOCK_NOW__());',
    '    return new RealDate(...args);',
    '  }',
    '  FakeDate.prototype = RealDate.prototype;',
    '  FakeDate.now = function () { return globalThis.__FAKE_CLOCK_NOW__(); };',
    '  FakeDate.parse = RealDate.parse;',
    '  FakeDate.UTC = RealDate.UTC;',
    '  globalThis.Date = FakeDate;',
    '})();',
    ''
  ].join('\n') : '';

  const combinedSource = fakeClockPrelude + files.map(function (f) {
    return '// ---- ' + f + ' ----\n' + fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8');
  }).join('\n\n') + '\n\n' + testExportsTrailer;

  vm.runInContext(combinedSource, sandbox, { filename: 'gas-combined.js' });

  // sandbox.__TEST_EXPORTS__ (SCHEMA, PLAIN_TEXT_FIELDS_, DATE_ONLY_FIELDS_)
  // was built inside the vm sandbox, so every array/object in it is
  // vm-realm. Rehost it here, once, at the harness boundary — every test
  // that reads ctx.testExports.SCHEMA (directly, or indirectly through
  // helpers like bootstrapSchema()/rowValuesFor()) then works with plain
  // host arrays, so a later .slice()/.map() on it stays host-realm too
  // instead of silently re-tainting the copy. See hostify_ above.
  const testExports = hostify_(sandbox.__TEST_EXPORTS__);

  return {
    sandbox: sandbox,
    spreadsheet: spreadsheet,
    sheetsByName: sheetsByName,
    consoleFake: consoleFake,
    testExports: testExports,
    urlFetch: urlFetch,
    scriptApp: scriptApp,
    clock: fakeClock // null unless options.fakeClock was passed
  };
}

module.exports = {
  PROJECT_ROOT: PROJECT_ROOT,
  loadAppsScriptContext_: loadAppsScriptContext_,
  createSheet_: createSheet_,
  hostify_: hostify_,
  createCalendarApp_: createCalendarApp_,
  createUrlFetchApp_: createUrlFetchApp_,
  createScriptApp_: createScriptApp_,
  createFakeClock_: createFakeClock_
};
