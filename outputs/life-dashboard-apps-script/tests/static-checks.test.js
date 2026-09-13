'use strict';

/**
 * Static checks over the deployed application files that .claspignore
 * explicitly whitelists. Development fixtures, tests, preserved prior work,
 * and local configuration remain outside this checked deployment surface.
 *
 * Deliberately scoped to exactly those files, enumerated by name rather
 * than discovered by glob. This project's own docs and test fakes
 * legitimately contain some of the strings being banned below —
 * PHASE_1_TEST_CHECKLIST.md documents the ALLOWALL check by name,
 * gas-fakes.js's HtmlService fake defines an ALLOWALL constant to fake
 * against, this file's own describe/it text mentions seedDemoData, and
 * pre-plan-draft/SOURCE_NOTE.md discusses the rejected example.com
 * seeding pattern. None of that ships to Apps Script; a broader glob
 * would flag all of it as false positives. The claim under test is about
 * what gets pushed, so the file list is the correct scope, not a
 * shortcut.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');

const DEPLOYED_GS_FILES = [
  'Code.gs', 'Database.gs', 'Tasks.gs', 'Calendar.gs', 'Jobs.gs',
  'JobProfile.gs', 'JobSource_JSearch.gs', 'JobFilters.gs', 'JobDedupe.gs', 'Discovery.gs',
  'Applications.gs', 'AIProvider_Gemini.gs', 'JobScoring.gs'
];
const DEPLOYED_HTML_FILES = ['Index.html', 'Styles.html', 'JavaScript.html'];
const ALL_DEPLOYED_FILES = ['appsscript.json'].concat(DEPLOYED_GS_FILES, DEPLOYED_HTML_FILES);

// Functions genuinely meant to be callable from the browser via
// google.script.run, or required verbatim by the Apps Script platform
// (doGet). initializeDatabase is here too: it is meant to be run manually
// from the editor (see Database.gs's own doc comment and README.md), but
// Apps Script has no "editor-only" visibility level — any top-level,
// non-underscore function is reachable via google.script.run for anyone
// with access to the deployment, so it belongs on this list honestly
// rather than pretending it is private.
const PUBLIC_ALLOWLIST = [
  'doGet', 'include', 'getAppStatus', 'initializeDatabase',
  'getDashboardData', 'createTask', 'completeTask', 'reopenTask', 'archiveTask',
  'getUpcomingEvents', 'getJobsQueue', 'setJobStatus', 'addJobNote', 'getJobHistory',
  'runDiscovery',
  // Phase 5 Milestone 1: Applications tracking workflow
  'createApplication', 'setApplicationStatus', 'getApplicationById',
  'getApplicationsByJobId', 'getApplicationHistory', 'updateApplication',
  // Phase 5 Milestone 2: AI scoring and budget status
  'scorePendingJobs', 'getScoringBudgetStatus',
  // Phase 4B (Discovery.gs), editor-run administrative actions. Apps
  // Script has no "editor-only" visibility level (see the note above on
  // initializeDatabase), so each is listed honestly rather than pretending
  // it is private. Deployment stays access:MYSELF, so only the owner can
  // reach these regardless.
  'installDiscoveryTrigger',   // idempotent: creates the one daily 7am trigger
  'removeDiscoveryTrigger',    // deletes any installed discovery trigger(s)
  'resetDiscoverySource',      // clears a disabled source's terminal-error state
  // Deliberately NOT underscore-suffixed: Google's own docs do not
  // guarantee a trigger can invoke a trailing-underscore handler, so this
  // name works either way. It is still safe to expose because it refuses
  // to run any source/filter/dedupe/persistence logic unless its own
  // trigger-identity guard (checked inside the function) passes.
  'runScheduledDiscovery'
];

const BANNED_PATTERNS = [
  { pattern: /ALLOWALL/, label: 'ALLOWALL (must not set permissive frame protection)' },
  { pattern: /USER_ACCESSING/, label: 'USER_ACCESSING (manifest must use USER_DEPLOYING)' },
  // Phase 4B needs this scope, but only in the manifest — no .gs/.html file
  // should ever reference the scope string itself.
  { pattern: /script\.scriptapp/, label: 'script.scriptapp scope (manifest-only; added in Phase 4B for the daily discovery trigger)', allowedIn: ['appsscript.json'] },
  // ScriptApp (trigger install/remove/lookup) is confined to Discovery.gs.
  // No other deployed file — including the Jobs.gs queue paths, Tasks.gs,
  // Calendar.gs, Code.gs, or any HTML — may reference it.
  { pattern: /\bScriptApp\b/, label: 'ScriptApp (trigger management confined to Discovery.gs)', allowedIn: ['Discovery.gs'] },
  { pattern: /seedDemoData/, label: 'seedDemoData (no fabricated/demo data in the shipped app)' },
  { pattern: /example\.com/, label: 'example.com (no fabricated production data)' },
  // Wholesale bans rather than vendor-name string matching: this project
  // makes no outbound network call of any kind (no job source, no site
  // scrape, no runtime AI API), so banning every mechanism capable of
  // making one is a stronger, more maintainable guarantee than trying to
  // blocklist specific API/vendor name strings, which would be both
  // fragile (easy to phrase around) and prone to false positives against
  // this project's own docs and history (several existing project files
  // legitimately discuss Gemini/Codex/Claude by name).
  { pattern: /UrlFetchApp/, label: 'UrlFetchApp (outbound calls only in authorized adapters)', allowedIn: ['JobSource_JSearch.gs', 'AIProvider_Gemini.gs'] },
  { pattern: /fetch\(/, label: 'fetch( (outbound calls only in authorized adapters)', allowedIn: ['JobSource_JSearch.gs', 'AIProvider_Gemini.gs'] },
  { pattern: /XMLHttpRequest/, label: 'XMLHttpRequest (no outbound network calls of any kind)' },
  // Calendar.gs is documented as read-only (see its own file header); these
  // are unambiguous Calendar *write* methods with no legitimate read-only
  // use and no name collision with anything else in this project.
  // Deliberately NOT included: a bare "setTitle" — CalendarEvent has one,
  // but so does the HtmlOutput object Code.gs's doGet() legitimately calls
  // .setTitle('Life Dashboard') on; banning the bare name would be a false
  // positive against code that already exists and is correct.
  { pattern: /createEvent\(/, label: 'createEvent( (Calendar.gs must stay read-only)' },
  { pattern: /createAllDayEvent\(/, label: 'createAllDayEvent( (Calendar.gs must stay read-only)' },
  { pattern: /createEventSeries\(/, label: 'createEventSeries( (Calendar.gs must stay read-only)' },
  { pattern: /deleteEvent\(/, label: 'deleteEvent( (Calendar.gs must stay read-only)' },
  // Unsafe HTML sinks: every deployed file renders exclusively via
  // createElement/textContent (see JavaScript.html), so none of these
  // tokens has any legitimate use. Bare-word bans, same style as ALLOWALL
  // above — comments are stripped first (stripComments_), which is what
  // lets JavaScript.html's own comment discussing *why* a setAttribute
  // call is "not an innerHTML/markup-injection path" coexist with this
  // check instead of tripping it.
  { pattern: /innerHTML/, label: 'innerHTML (render via createElement/textContent only)' },
  { pattern: /outerHTML/, label: 'outerHTML (render via createElement/textContent only)' },
  { pattern: /insertAdjacentHTML\(/, label: 'insertAdjacentHTML( (render via createElement/textContent only)' },
  { pattern: /document\.write\(/, label: 'document.write( (render via createElement/textContent only)' }
];

const JOB_QUEUE_REQUIRED_PATTERNS_ = [
  { file: 'Index.html', pattern: /jobs-container/, label: 'Jobs queue container' },
  { file: 'Index.html', pattern: /jobs-filter/, label: 'Jobs filter control' },
  { file: 'Index.html', pattern: /80%\+ match/, label: 'career-transition 80% strong-match label' },
  { file: 'Index.html', pattern: /jobs-sort/, label: 'Jobs sort control' },
  { file: 'Code.gs', pattern: /STRONG_MATCH_THRESHOLD_\s*=\s*80/, label: 'career-transition 80% server threshold' },
  { file: 'Styles.html', pattern: /job-card/, label: 'job card styling' },
  { file: 'JavaScript.html', pattern: /buildJobCard/, label: 'safe job card builder' },
  { file: 'JavaScript.html', pattern: /getJobsQueue/, label: 'stored queue endpoint call' },
  { file: 'JavaScript.html', pattern: /setJobStatus/, label: 'server-validated status endpoint call' },
  { file: 'JavaScript.html', pattern: /addJobNote/, label: 'server-validated note endpoint call' },
  { file: 'JavaScript.html', pattern: /getJobHistory/, label: 'stored history endpoint call' },
  { file: 'JavaScript.html', pattern: /STRONG_MATCH_THRESHOLD\s*=\s*80/, label: 'career-transition 80% client threshold' }
];

function readDeployed(filename) {
  return fs.readFileSync(path.join(ROOT, filename), 'utf8');
}

/**
 * Strips comments so the banned-pattern scan below checks executable
 * content, not prose. Without this, Code.gs's own doGet() comment
 * explaining *why* it does not call setXFrameOptionsMode(ALLOWALL) would
 * itself trip the ALLOWALL check — documenting a deliberate absence is
 * not the same as the absence failing to hold.
 *
 * The line-comment regex excludes "//" immediately preceded by ":" so it
 * doesn't truncate a "https://..." URL appearing in code (none exists in
 * these files today, but the check should survive one being added).
 */
function stripComments_(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<!:)\/\/[^\n]*/g, '');
}

function extractScriptContent(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  return match ? match[1] : null;
}

function assertParses(source, label) {
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new
    new vm.Script(source, { filename: label });
  }, `${label} must be syntactically valid JavaScript`);
}

function extractTopLevelFunctionNames(source) {
  // Matches only declarations that start at column 0 — this codebase
  // consistently indents every nested/anonymous function, so an
  // unindented `function name(` is reliably a top-level declaration. See
  // the file-level comment for why a regex is acceptable here instead of
  // a full parser.
  const names = [];
  const re = /^function\s+([A-Za-z0-9_]+)\s*\(/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    names.push(m[1]);
  }
  return names;
}

function extractIncludableFiles(codeGsSource) {
  const match = codeGsSource.match(/INCLUDABLE_FILES_\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(match, 'Code.gs must define INCLUDABLE_FILES_ as Object.freeze([...])');
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function extractIncludeCalls(html) {
  const names = [];
  const re = /include\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    names.push(m[1]);
  }
  return names;
}

describe('static checks: appsscript.json', () => {
  it('parses as JSON with the exact expected access and scope configuration', () => {
    const raw = readDeployed('appsscript.json');
    let manifest;
    assert.doesNotThrow(() => { manifest = JSON.parse(raw); }, 'appsscript.json must be valid JSON');

    assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
    assert.equal(manifest.webapp.access, 'MYSELF');
    assert.deepEqual(manifest.oauthScopes, [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.scriptapp'
    ]);
    assert.equal(manifest.runtimeVersion, 'V8');
  });
});

describe('static checks: .gs files parse', () => {
  DEPLOYED_GS_FILES.forEach((filename) => {
    it(`${filename} is syntactically valid JavaScript`, () => {
      assertParses(readDeployed(filename), filename);
    });
  });
});

describe('static checks: browser <script> parses separately', () => {
  it('JavaScript.html contains exactly one <script> block, and it is valid JS on its own', () => {
    const html = readDeployed('JavaScript.html');
    const script = extractScriptContent(html);
    assert.ok(script, 'JavaScript.html must contain a <script>...</script> block');
    assertParses(script, 'JavaScript.html inline script');
  });

  it('Styles.html and Index.html contain no <script> tags', () => {
    assert.equal(extractScriptContent(readDeployed('Styles.html')), null);
    assert.equal(extractScriptContent(readDeployed('Index.html')), null);
  });
});

describe('static checks: include() targets exist', () => {
  it('every include(\'X\') call in the HTML files has a matching X.html on disk and is in INCLUDABLE_FILES_', () => {
    const codeGs = readDeployed('Code.gs');
    const includable = extractIncludableFiles(codeGs);

    const calls = [];
    DEPLOYED_HTML_FILES.forEach((filename) => {
      extractIncludeCalls(readDeployed(filename)).forEach((name) => calls.push({ filename, name }));
    });

    assert.ok(calls.length > 0, 'expected at least one include() call across the deployed HTML files');

    calls.forEach(({ filename, name }) => {
      assert.ok(
        fs.existsSync(path.join(ROOT, name + '.html')),
        `include('${name}') in ${filename} has no matching ${name}.html on disk`
      );
      assert.ok(
        includable.indexOf(name) !== -1,
        `include('${name}') in ${filename} is not in Code.gs's INCLUDABLE_FILES_ allowlist`
      );
    });
  });

  it('INCLUDABLE_FILES_ contains no entry without a matching .html file', () => {
    const includable = extractIncludableFiles(readDeployed('Code.gs'));
    includable.forEach((name) => {
      assert.ok(fs.existsSync(path.join(ROOT, name + '.html')), `${name}.html does not exist on disk`);
    });
  });
});

describe('static checks: banned patterns absent from deployed files', () => {
  ALL_DEPLOYED_FILES.forEach((filename) => {
    BANNED_PATTERNS.forEach(({ pattern, label, allowedIn }) => {
      if (allowedIn && allowedIn.indexOf(filename) !== -1) return;
      it(`${filename} does not contain ${label}`, () => {
        const content = stripComments_(readDeployed(filename));
        assert.equal(pattern.test(content), false, `${filename} unexpectedly matched ${pattern} outside of a comment`);
      });
    });
  });
});

describe('static checks: no browser-callable raw helpers', () => {
  it('every top-level function in Code.gs and Database.gs is either publicly allowlisted or ends in _', () => {
    const offenders = [];
    DEPLOYED_GS_FILES.forEach((filename) => {
      extractTopLevelFunctionNames(readDeployed(filename)).forEach((name) => {
        const isPrivate = name.slice(-1) === '_';
        const isAllowlisted = PUBLIC_ALLOWLIST.indexOf(name) !== -1;
        if (!isPrivate && !isAllowlisted) {
          offenders.push(filename + ':' + name);
        }
      });
    });
    assert.deepEqual(offenders, [], 'every non-underscore top-level function must be on PUBLIC_ALLOWLIST');
  });

  it('PUBLIC_ALLOWLIST names are all actually declared somewhere in the deployed .gs files', () => {
    const declared = new Set();
    DEPLOYED_GS_FILES.forEach((filename) => {
      extractTopLevelFunctionNames(readDeployed(filename)).forEach((name) => declared.add(name));
    });
    PUBLIC_ALLOWLIST.forEach((name) => {
      assert.ok(declared.has(name), `PUBLIC_ALLOWLIST entry "${name}" is not declared in any deployed .gs file`);
    });
  });
});

describe('static checks: Phase 3 stored-jobs queue surface', () => {
  JOB_QUEUE_REQUIRED_PATTERNS_.forEach(({ file, pattern, label }) => {
    it(`${file} contains ${label}`, () => {
      assert.equal(pattern.test(stripComments_(readDeployed(file))), true, `${file} is missing ${label}`);
    });
  });
});

describe('static checks: Phase 4A network boundary', () => {
  it('S1: exactly two UrlFetchApp.fetch( occurrences across all deployed files (JobSource_JSearch.gs and AIProvider_Gemini.gs)', () => {
    let totalCount = 0;
    const occurrences = [];
    ALL_DEPLOYED_FILES.forEach((filename) => {
      const stripped = stripComments_(readDeployed(filename));
      const matches = stripped.match(/UrlFetchApp\.fetch\(/g) || [];
      if (matches.length > 0) {
        totalCount += matches.length;
        occurrences.push({ filename, count: matches.length });
      }
    });
    assert.equal(totalCount, 2, `expected exactly 2 UrlFetchApp.fetch( calls, found ${totalCount}: ${JSON.stringify(occurrences)}`);
    const filenames = occurrences.map((o) => o.filename).sort();
    assert.deepEqual(filenames, ['AIProvider_Gemini.gs', 'JobSource_JSearch.gs']);
  });

  it('S2: adapter only https:// literal is built from JSEARCH_HOST_ and equals jsearch.p.rapidapi.com', () => {
    const content = stripComments_(readDeployed('JobSource_JSearch.gs'));
    const hostMatch = content.match(/JSEARCH_HOST_\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(hostMatch, 'JobSource_JSearch.gs must declare JSEARCH_HOST_');
    assert.equal(hostMatch[1], 'jsearch.p.rapidapi.com');

    const httpsLiterals = [];
    const re = /['"](https:\/\/[^'"]*)['"]/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      httpsLiterals.push(m[1]);
    }
    assert.deepEqual(httpsLiterals, ['https://'], 'adapter must not contain any other https:// URL literal');
  });

  it('S3: JSEARCH_RAPIDAPI_KEY appears in no deployed file other than JobSource_JSearch.gs, and GEMINI_API_KEY only in AIProvider_Gemini.gs', () => {
    ALL_DEPLOYED_FILES.forEach((filename) => {
      const content = readDeployed(filename);
      if (filename !== 'JobSource_JSearch.gs') {
        assert.equal(content.includes('JSEARCH_RAPIDAPI_KEY'), false, `${filename} must not reference JSEARCH_RAPIDAPI_KEY`);
      }
      if (filename !== 'AIProvider_Gemini.gs') {
        assert.equal(content.includes('GEMINI_API_KEY'), false, `${filename} must not reference GEMINI_API_KEY`);
      }
    });
    assert.ok(readDeployed('JobSource_JSearch.gs').includes('JSEARCH_RAPIDAPI_KEY'), 'JobSource_JSearch.gs must reference JSEARCH_RAPIDAPI_KEY');
    assert.ok(readDeployed('AIProvider_Gemini.gs').includes('GEMINI_API_KEY'), 'AIProvider_Gemini.gs must reference GEMINI_API_KEY');
  });

  it('S4: JSearch adapter interface isolation (Discovery.gs allowed to reference public interface, jsearchSendRequest_ strictly private)', () => {
    const internalTargets = ['jsearchSendRequest_'];
    const interfaceTargets = ['jsearchFetchPage_', 'jsearchBuildDailyQueries_'];
    ALL_DEPLOYED_FILES.forEach((filename) => {
      if (filename === 'JobSource_JSearch.gs') return;
      const content = readDeployed(filename);
      internalTargets.forEach((target) => {
        assert.equal(content.includes(target), false, `${filename} must not reference internal ${target}`);
      });
      if (filename !== 'Discovery.gs') {
        interfaceTargets.forEach((target) => {
          assert.equal(content.includes(target), false, `${filename} must not reference ${target}`);
        });
      }
    });
  });

  it('S5: allowedIn is used by exactly these 4 entries, each naming exactly its documented file', () => {
    // Rewritten for Phase 5: allows UrlFetchApp in JobSource_JSearch.gs and AIProvider_Gemini.gs
    const expectedAllowedIn = {
      'UrlFetchApp (outbound calls only in authorized adapters)': ['JobSource_JSearch.gs', 'AIProvider_Gemini.gs'],
      'fetch( (outbound calls only in authorized adapters)': ['JobSource_JSearch.gs', 'AIProvider_Gemini.gs'],
      'script.scriptapp scope (manifest-only; added in Phase 4B for the daily discovery trigger)': ['appsscript.json'],
      'ScriptApp (trigger management confined to Discovery.gs)': ['Discovery.gs']
    };
    const entriesWithAllowedIn = BANNED_PATTERNS.filter((p) => p.allowedIn !== undefined);
    assert.equal(
      entriesWithAllowedIn.length,
      Object.keys(expectedAllowedIn).length,
      `expected exactly ${Object.keys(expectedAllowedIn).length} BANNED_PATTERNS entries with allowedIn, found ${entriesWithAllowedIn.length}`
    );
    entriesWithAllowedIn.forEach((entry) => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(expectedAllowedIn, entry.label),
        `unexpected allowedIn entry not pinned by this test: ${entry.label}`
      );
      assert.deepEqual(entry.allowedIn, expectedAllowedIn[entry.label]);
    });
  });

  it('S6: JavaScript.html contains no fetch(', () => {
    const stripped = stripComments_(readDeployed('JavaScript.html'));
    assert.equal(/fetch\(/.test(stripped), false, 'JavaScript.html must not contain fetch(');
  });

  it('S8: Gemini calls only ever hit :generateContent or :countTokens, and no deployed file contains a "key=" query-string auth pattern', () => {
    const pathLiterals = [];
    const keyEqualsOccurrences = [];
    ALL_DEPLOYED_FILES.forEach((filename) => {
      const stripped = stripComments_(readDeployed(filename));
      if (!/generativelanguage\.googleapis\.com/.test(stripped)) return;
      const pathRe = /['"](\/v1beta\/models\/[^'"]*)['"]/g;
      let m;
      while ((m = pathRe.exec(stripped)) !== null) {
        pathLiterals.push({ filename, path: m[1] });
      }
      if (/key=/.test(stripped)) {
        keyEqualsOccurrences.push(filename);
      }
    });
    assert.ok(pathLiterals.length > 0, 'expected at least one /v1beta/models/... path literal alongside a generativelanguage.googleapis.com reference');
    pathLiterals.forEach(({ filename, path }) => {
      assert.ok(
        /:generateContent$/.test(path) || /:countTokens$/.test(path),
        `${filename} builds a Gemini path that is neither :generateContent nor :countTokens: ${path}`
      );
    });
    assert.deepEqual(keyEqualsOccurrences, [], `no deployed file may contain a "key=" query-string auth pattern; found in: ${keyEqualsOccurrences.join(', ')}`);
  });

  it('S7: .claspignore un-ignores exactly ALL_DEPLOYED_FILES (17 files total)', () => {
    const claspignore = fs.readFileSync(path.join(ROOT, '.claspignore'), 'utf8');
    const unignored = claspignore
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('!'))
      .map((l) => l.slice(1).trim());
    assert.equal(unignored.length, ALL_DEPLOYED_FILES.length, `expected ${ALL_DEPLOYED_FILES.length} unignored files in .claspignore, found ${unignored.length}`);
    assert.deepEqual(unignored.sort(), ALL_DEPLOYED_FILES.slice().sort());
  });
});
