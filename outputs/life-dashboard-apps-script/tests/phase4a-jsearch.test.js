'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadAppsScriptContext_,
  hostify_,
  createUrlFetchApp_
} = require('./gas-fakes.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'jsearch');
const PHASE4A_FILES = ['Database.gs', 'Jobs.gs', 'JobSource_JSearch.gs'];
const TEST_KEY = 'FAKE_JSEARCH_KEY_FOR_TESTS_ONLY';
const FIXED_NOW = new Date('2026-09-13T11:00:00.000Z');

function readFixture(filename) {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
}

function createContext(overrides) {
  overrides = overrides || {};
  const scriptProps = Object.assign({
    DATABASE_SHEET_ID: 'FAKE_SHEET_ID',
    JSEARCH_RAPIDAPI_KEY: TEST_KEY
  }, overrides.scriptProperties || {});

  if (overrides.omitKey) {
    delete scriptProps.JSEARCH_RAPIDAPI_KEY;
  }

  return loadAppsScriptContext_({
    files: PHASE4A_FILES,
    scriptProperties: scriptProps,
    urlFetch: overrides.urlFetch || { responses: [] }
  });
}

// ---------------------------------------------------------------------------
// Suite 1: Configuration and Request (T01 - T05)
// ---------------------------------------------------------------------------
describe('Phase 4A: Configuration and Request (T01 - T05)', () => {
  it('T01: missing or blank key -> NOT_CONFIGURED, zero fetch calls, quota untouched', () => {
    const ctxMissing = createContext({ omitKey: true });
    const catalogQuery = ctxMissing.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res1 = hostify_(ctxMissing.sandbox.jsearchFetchPage_(catalogQuery, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));
    assert.equal(res1.status, 'NOT_CONFIGURED');
    assert.equal(res1.ok, false);
    assert.equal(res1.retryable, false);
    assert.equal(ctxMissing.urlFetch.calls.length, 0);
    assert.equal(ctxMissing.sandbox.PropertiesService.getScriptProperties().getProperty('JSEARCH_QUOTA_STATE'), null);

    const ctxBlank = createContext({
      scriptProperties: { JSEARCH_RAPIDAPI_KEY: '   ' }
    });
    const res2 = hostify_(ctxBlank.sandbox.jsearchFetchPage_(catalogQuery, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));
    assert.equal(res2.status, 'NOT_CONFIGURED');
    assert.equal(res2.ok, false);
    assert.equal(ctxBlank.urlFetch.calls.length, 0);
  });

  it('T02: exact HTTP request validation (URL, method, headers, options, fixed param order)', () => {
    const emptyJson = readFixture('empty.json');
    const ctx = createContext({
      urlFetch: {
        responses: [
          { code: 200, headers: { 'Content-Type': 'application/json' }, body: emptyJson },
          { code: 200, headers: { 'Content-Type': 'application/json' }, body: emptyJson }
        ]
      }
    });

    const nonRemoteQuery = ctx.testExports.JSEARCH_QUERY_CATALOG_[0]; // p1-helpdesk-pgh
    const res1 = hostify_(ctx.sandbox.jsearchFetchPage_(nonRemoteQuery, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));
    assert.equal(res1.status, 'EMPTY');
    assert.equal(ctx.urlFetch.calls.length, 1);

    const call1 = ctx.urlFetch.calls[0];
    const expectedUrl1 = 'https://jsearch.p.rapidapi.com/search-v2?query=' +
      encodeURIComponent(nonRemoteQuery.query) +
      '&num_pages=1&date_posted=3days&country=us&language=en';
    assert.equal(call1.url, expectedUrl1);
    assert.equal(call1.params.method, 'get');
    assert.deepEqual(call1.params.headers, {
      'X-RapidAPI-Key': TEST_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
    });
    assert.equal(call1.params.muteHttpExceptions, true);
    assert.equal(call1.params.followRedirects, false);
    assert.equal(call1.params.validateHttpsCertificates, true);
    assert.equal(call1.params.timeoutSeconds, 30);

    // Remote query includes work_from_home=true
    const remoteQuery = ctx.testExports.JSEARCH_QUERY_CATALOG_.find(q => q.remote === true);
    ctx.sandbox.jsearchFetchPage_(remoteQuery, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    });
    assert.equal(ctx.urlFetch.calls.length, 2);
    const call2 = ctx.urlFetch.calls[1];
    const expectedUrl2 = 'https://jsearch.p.rapidapi.com/search-v2?query=' +
      encodeURIComponent(remoteQuery.query) +
      '&num_pages=1&date_posted=3days&country=us&language=en&work_from_home=true';
    assert.equal(call2.url, expectedUrl2);
  });

  it('T03: unknown query id or altered query text throws UserError_ UNKNOWN_QUERY, zero calls', () => {
    const ctx = createContext();

    assert.throws(() => {
      ctx.sandbox.jsearchFetchPage_({ id: 'unknown-query-id', query: 'help desk' }, {
        mode: 'scheduled',
        nowDate: FIXED_NOW
      });
    }, (err) => {
      assert.equal(err.code, 'UNKNOWN_QUERY');
      return true;
    });

    const catalogQuery = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    assert.throws(() => {
      ctx.sandbox.jsearchFetchPage_({ id: catalogQuery.id, query: 'altered text by caller' }, {
        mode: 'scheduled',
        nowDate: FIXED_NOW
      });
    }, (err) => {
      assert.equal(err.code, 'UNKNOWN_QUERY');
      return true;
    });

    assert.equal(ctx.urlFetch.calls.length, 0);
  });

  it('T04: jsearchBuildDailyQueries_ deterministic rotation, valid dateKey checks, catalog fidelity', () => {
    const ctx = createContext();

    // Deterministic output for same dateKey
    const queriesA = hostify_(ctx.sandbox.jsearchBuildDailyQueries_('2026-09-13'));
    const queriesB = hostify_(ctx.sandbox.jsearchBuildDailyQueries_('2026-09-13'));
    assert.deepEqual(queriesA, queriesB);

    // Max 5 entries, at least 3 Priority 1
    assert.ok(queriesA.length <= 5 && queriesA.length > 0);
    const p1Count = queriesA.filter(q => q.priority === 1).length;
    assert.ok(p1Count >= 3, `expected >= 3 P1 queries, got ${p1Count}`);

    // Every query string equals an exact catalog string
    queriesA.forEach(q => {
      const match = ctx.testExports.JSEARCH_QUERY_CATALOG_.find(c => c.id === q.id);
      assert.ok(match, `query id ${q.id} not found in catalog`);
      assert.equal(q.query, match.query);
    });

    // Distinct rotation across a 16-day span
    const rotationSignatures = new Set();
    for (let day = 1; day <= 16; day++) {
      const dayStr = '2026-09-' + String(day).padStart(2, '0');
      const qList = hostify_(ctx.sandbox.jsearchBuildDailyQueries_(dayStr));
      rotationSignatures.add(qList.map(q => q.id).join('|'));
    }
    assert.ok(rotationSignatures.size > 1, 'expected diverse query rotations across 16 days');

    // Invalid dateKey validation
    assert.throws(() => ctx.sandbox.jsearchBuildDailyQueries_('invalid-date'), (err) => {
      assert.equal(err.code, 'INVALID_DATE_KEY');
      return true;
    });
    assert.throws(() => ctx.sandbox.jsearchBuildDailyQueries_('2026/09/13'), (err) => {
      assert.equal(err.code, 'INVALID_DATE_KEY');
      return true;
    });
  });

  it('T05: query catalog PII and bounds tripwire', () => {
    const ctx = createContext();
    const catalog = ctx.testExports.JSEARCH_QUERY_CATALOG_;

    catalog.forEach(item => {
      assert.ok(item.query.length <= 80, `query too long: ${item.query}`);
      assert.equal(/\d{5,}/.test(item.query), false, `query contains 5+ consecutive digits: ${item.query}`);
      assert.equal(/@/.test(item.query), false, `query contains @: ${item.query}`);
      assert.equal(/\b\d+\s+[A-Za-z0-9.]+\s+(St|Ave|Rd|Blvd|Street|Avenue|Road)\b/i.test(item.query), false, `query contains street address: ${item.query}`);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Classification Matrix (T06 - T18)
// ---------------------------------------------------------------------------
describe('Phase 4A: Classification Matrix (T06 - T18)', () => {
  it('T06: 200 OK mixed fixture -> OK, exactly 3 LinkedIn candidates, dropped counts correct', () => {
    const mixedJson = readFixture('ok-linkedin-mixed.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }]
      }
    });

    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));

    assert.equal(res.status, 'OK');
    assert.equal(res.ok, true);
    assert.equal(res.candidates.length, 3);
    res.candidates.forEach(c => assert.equal(c.source, 'linkedin'));
    assert.deepEqual(res.droppedByPublisher, {
      indeed: 1,
      glassdoor: 1,
      ziprecruiter: 1,
      other: 0
    });
  });

  it('T07: 200 OK mixed fixture with enabledPublishers [linkedin, indeed] -> 4 candidates', () => {
    const mixedJson = readFixture('ok-linkedin-mixed.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }]
      }
    });

    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, {
      mode: 'scheduled',
      nowDate: FIXED_NOW,
      enabledPublishers: ['linkedin', 'indeed']
    }));

    assert.equal(res.status, 'OK');
    assert.equal(res.candidates.length, 4);
    const indeedJob = res.candidates.find(c => c.source === 'indeed');
    assert.ok(indeedJob, 'Indeed candidate must be present when enabled');
    assert.equal(indeedJob.route, 'jsearch');
    assert.equal(res.droppedByPublisher.indeed, 0);
    assert.equal(res.droppedByPublisher.glassdoor, 1);
  });

  it('T08: empty jobs array fixture -> EMPTY, ok: true, zero candidates', () => {
    const emptyJson = readFixture('empty.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: emptyJson }]
      }
    });

    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));

    assert.equal(res.status, 'EMPTY');
    assert.equal(res.ok, true);
    assert.equal(res.candidates.length, 0);
  });

  it('T09: legacy /search array shape fixture -> MALFORMED', () => {
    const legacyJson = readFixture('legacy-search-shape.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: legacyJson }]
      }
    });

    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));

    assert.equal(res.status, 'MALFORMED');
    assert.equal(res.ok, false);
  });

  it('T10: non-JSON body -> MALFORMED; provider status ERROR -> PROVIDER_ERROR', () => {
    const ctx1 = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: '{invalid json' }]
      }
    });
    const query = ctx1.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res1 = hostify_(ctx1.sandbox.jsearchFetchPage_(query, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));
    assert.equal(res1.status, 'MALFORMED');
    assert.equal(res1.ok, false);

    const providerErrJson = readFixture('provider-error.json');
    const ctx2 = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: providerErrJson }]
      }
    });
    const res2 = hostify_(ctx2.sandbox.jsearchFetchPage_(query, {
      mode: 'scheduled',
      nowDate: FIXED_NOW
    }));
    assert.equal(res2.status, 'PROVIDER_ERROR');
    assert.equal(res2.ok, false);
  });

  it('T11: Content-Type text/html -> BAD_CONTENT_TYPE; application/json; charset=utf-8 accepted', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          { code: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body>error</body></html>' },
          { code: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: readFixture('empty.json') }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res1 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res1.status, 'BAD_CONTENT_TYPE');
    assert.equal(res1.ok, false);

    const res2 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res2.status, 'EMPTY');
    assert.equal(res2.ok, true);
  });

  it('T12: body > 2,000,000 chars -> OVERSIZED; 101 jobs -> OVERSIZED', () => {
    const hugeBody = 'x'.repeat(2000001);
    const jobs101 = [];
    for (let i = 0; i < 101; i++) {
      jobs101.push({ job_id: 'j' + i, job_title: 'Title ' + i });
    }
    const oversizedJobsBody = JSON.stringify({ status: 'OK', data: { jobs: jobs101 } });

    const ctx = createContext({
      urlFetch: {
        responses: [
          { code: 200, headers: { 'Content-Type': 'application/json' }, body: hugeBody },
          { code: 200, headers: { 'Content-Type': 'application/json' }, body: oversizedJobsBody }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res1 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res1.status, 'OVERSIZED');

    const res2 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res2.status, 'OVERSIZED');
  });

  it('T13: HTTP 401 and 403 -> AUTH_FAILED, disableSource: true, retryable: false', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          { code: 401, headers: {}, body: 'Unauthorized' },
          { code: 403, headers: {}, body: 'Forbidden' }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res401 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res401.status, 'AUTH_FAILED');
    assert.equal(res401.disableSource, true);
    assert.equal(res401.retryable, false);

    const res403 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res403.status, 'AUTH_FAILED');
    assert.equal(res403.disableSource, true);
    assert.equal(res403.retryable, false);
  });

  it('T14: 404 with X-RapidAPI-Proxy-Response: true -> NOT_SUBSCRIBED_OR_RETIRED; plain 404 -> NOT_FOUND', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          { code: 404, headers: { 'x-rapidapi-proxy-response': 'true' }, body: 'Not subscribed' },
          { code: 404, headers: {}, body: 'Not found' }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const resProxy = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(resProxy.status, 'NOT_SUBSCRIBED_OR_RETIRED');
    assert.equal(resProxy.disableSource, true);

    const resPlain = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(resPlain.status, 'NOT_FOUND');
    assert.equal(resPlain.disableSource, true);
  });

  it('T15: 429 remaining 0 -> QUOTA_EXHAUSTED; next call -> BUDGET_BLOCKED with zero calls', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          {
            code: 429,
            headers: {
              'x-ratelimit-requests-remaining': '0',
              'x-ratelimit-requests-reset': '3600'
            },
            body: 'Too Many Requests'
          }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res1 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res1.status, 'QUOTA_EXHAUSTED');
    assert.ok(res1.quota.blockedUntil);

    // Second call immediately blocked before network
    const res2 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res2.status, 'BUDGET_BLOCKED');
    assert.equal(ctx.urlFetch.calls.length, 1); // zero additional calls
  });

  it('T16: 429 remaining 50 -> RATE_LIMITED, retryable: true, blockedUntil = now + 1h', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          {
            code: 429,
            headers: { 'x-ratelimit-requests-remaining': '50' },
            body: 'Rate Limit Exceeded'
          }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res.status, 'RATE_LIMITED');
    assert.equal(res.retryable, true);
    assert.ok(res.quota.blockedUntil);
    const blockedDate = new Date(res.quota.blockedUntil);
    const expectedBlocked = new Date(FIXED_NOW.getTime() + 60 * 60 * 1000);
    assert.equal(blockedDate.getTime(), expectedBlocked.getTime());
  });

  it('T17: 500/502/503 -> UPSTREAM_ERROR, retryable: true; 418 -> UNEXPECTED_STATUS', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          { code: 500, headers: {}, body: 'Internal Error' },
          { code: 502, headers: {}, body: 'Bad Gateway' },
          { code: 503, headers: {}, body: 'Service Unavailable' },
          { code: 418, headers: {}, body: "I'm a teapot" }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    [500, 502, 503].forEach(() => {
      const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
      assert.equal(res.status, 'UPSTREAM_ERROR');
      assert.equal(res.retryable, true);
    });

    const res418 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res418.status, 'UNEXPECTED_STATUS');
    assert.equal(res418.retryable, false);
  });

  it('T18: fetch throws timeout -> TIMEOUT; throws network -> NETWORK_ERROR; quota unit reserved in both', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          { throws: new Error('Request timed out after 30 seconds') },
          { throws: new Error('Address unavailable: DNS resolution failed') }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const resTimeout = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(resTimeout.status, 'TIMEOUT');
    assert.equal(resTimeout.retryable, true);
    assert.equal(resTimeout.quota.reserved, true);
    assert.equal(resTimeout.quota.periodCount, 1);

    const resNetwork = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(resNetwork.status, 'NETWORK_ERROR');
    assert.equal(resNetwork.retryable, true);
    assert.equal(resNetwork.quota.reserved, true);
    assert.equal(resNetwork.quota.periodCount, 2);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Normalization and Sanitization (T19 - T26)
// ---------------------------------------------------------------------------
describe('Phase 4A: Normalization and Sanitization (T19 - T26)', () => {
  it('T19: cross-file contract: all candidate URLs from all OK fixtures pass Jobs.gs validateSourceUrl_', () => {
    const okFixtures = ['ok-linkedin-mixed.json', 'ok-html-description.json', 'ok-optional-missing.json'];
    okFixtures.forEach(fixtureName => {
      const body = readFixture(fixtureName);
      const ctx = createContext({
        urlFetch: {
          responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: body }]
        }
      });
      const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
      const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
      assert.ok(res.candidates.length > 0, `fixture ${fixtureName} must yield candidates`);
      res.candidates.forEach(c => {
        assert.doesNotThrow(() => {
          ctx.sandbox.validateSourceUrl_(c.url);
        }, `URL "${c.url}" failed validateSourceUrl_`);
      });
    });
  });

  it('T20: URL cases fixture: fallback cascade, utm stripping, fragment removal, invalid URL quarantine', () => {
    const urlCasesJson = readFixture('ok-url-cases.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: urlCasesJson }]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    assert.equal(res.status, 'OK');
    // First 7 jobs resolve valid candidate URLs via fallback or canonicalization
    assert.equal(res.candidates.length, 7);

    // Job 0: fallback from javascript: apply link to apply_options
    assert.equal(res.candidates[0].url, 'https://www.linkedin.com/jobs/view/9993000001');

    // Job 1: fallback from null apply link to job_google_link
    assert.equal(res.candidates[1].url, 'https://www.google.com/search?q=acme+tech+desktop+support');

    // Job 2: stripped utm_* and fragment, retained refId
    assert.equal(res.candidates[2].url, 'https://www.linkedin.com/jobs/view/9993000003?refId=abc123xyz');

    // Job 3-6: credentials, bad port, .. host, and >2048 chars fell back to apply_options
    for (let i = 3; i <= 6; i++) {
      assert.ok(res.candidates[i].url.startsWith('https://www.linkedin.com/jobs/view/999300000'));
    }

    // Job 7: all URLs invalid -> quarantined with MISSING_VALID_URL
    assert.equal(res.quarantined.length, 1);
    assert.equal(res.quarantined[0].index, 7);
    assert.equal(res.quarantined[0].reason, 'MISSING_VALID_URL');
  });

  it('T21: quarantine fixture: exact reason codes and indices, valid record still returned', () => {
    const quarJson = readFixture('ok-quarantine.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: quarJson }]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    assert.equal(res.status, 'OK');
    assert.equal(res.candidates.length, 1);
    assert.equal(res.candidates[0].external_id, '9991000007-validId');

    const expectedQuarantine = [
      { index: 0, reason: 'MISSING_EXTERNAL_ID' },
      { index: 1, reason: 'MISSING_TITLE' },
      { index: 2, reason: 'MISSING_COMPANY' },
      { index: 3, reason: 'MISSING_VALID_URL' },
      { index: 4, reason: 'INVALID_SALARY' },
      { index: 5, reason: 'INVALID_POSTED_AT' }
    ];
    assert.deepEqual(res.quarantined, expectedQuarantine);
  });

  it('T22: salary normalization (HOUR/YEAR, missing nulls, invalid bounds quarantine, currency 3-letter)', () => {
    const mixedJson = readFixture('ok-linkedin-mixed.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    // Hourly job
    const hourly = res.candidates[0];
    assert.equal(hourly.salary_min, 21);
    assert.equal(hourly.salary_max, 25);
    assert.equal(hourly.salary_period, 'HOUR');
    assert.equal(hourly.currency, 'USD');
    assert.equal(hourly.salary_source, 'provider');

    // Annual job
    const annual = res.candidates[1];
    assert.equal(annual.salary_min, 45000);
    assert.equal(annual.salary_max, 55000);
    assert.equal(annual.salary_period, 'YEAR');
    assert.equal(annual.salary_source, 'provider');

    // Missing salary job
    const noSalary = res.candidates[2];
    assert.equal(noSalary.salary_min, null);
    assert.equal(noSalary.salary_max, null);
    assert.equal(noSalary.salary_period, '');
    assert.equal(noSalary.currency, '');
    assert.equal(noSalary.salary_source, '');
  });

  it('T23: HTML text cleaning (scripts, entities &amp; last, controls, 20k cap, formula verbatim)', () => {
    const htmlJson = readFixture('ok-html-description.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: htmlJson }]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    assert.equal(res.candidates.length, 1);
    const candidate = res.candidates[0];

    // Formula preserved verbatim
    assert.ok(candidate.title.startsWith('=HYPERLINK('));

    // Description checks
    assert.equal(/<script/i.test(candidate.description), false);
    assert.equal(/alert\(/i.test(candidate.description), false);
    assert.equal(/<style/i.test(candidate.description), false);
    assert.ok(candidate.description.includes('&lt;b&gt;Bold Text&lt;/b&gt;')); // &amp; last
    assert.ok(candidate.description.includes('"quoted"'));
    assert.ok(candidate.description.includes("'apostrophe'"));
    assert.equal(/[\x00-\x08\x0b\x0c]/.test(candidate.description), false);

    // Truncation bound
    assert.ok(candidate.description.endsWith(' …[truncated]'));
    assert.ok(candidate.description.length <= 20000 + ' …[truncated]'.length);
  });

  it('T24: remote normalization matches normalizeRemote_, location Remote when city/state blank', () => {
    const mixedJson = readFixture('ok-linkedin-mixed.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    // Non-remote
    assert.deepEqual(res.candidates[0].remote, { value: false, label: 'Not remote' });
    assert.equal(res.candidates[0].location, 'Pittsburgh, PA');

    // Remote
    assert.deepEqual(res.candidates[1].remote, { value: true, label: 'Remote' });
    assert.equal(res.candidates[1].location, 'Remote');
  });

  it('T25: content_hash stability, jsearch-content-v1 prefix, 64 hex chars, changes on desc change', () => {
    const mixedJson = readFixture('ok-linkedin-mixed.json');
    const ctx1 = createContext({
      urlFetch: { responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }] }
    });
    const ctx2 = createContext({
      urlFetch: { responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }] }
    });
    const query = ctx1.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res1 = hostify_(ctx1.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    const res2 = hostify_(ctx2.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    const h1 = res1.candidates[0].content_hash;
    const h2 = res2.candidates[0].content_hash;

    // Stable
    assert.equal(h1, h2);
    // Prefix and length
    assert.ok(h1.startsWith('jsearch-content-v1:'));
    const hex = h1.slice('jsearch-content-v1:'.length);
    assert.equal(hex.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hex));

    // Changes on desc change
    const altered = JSON.parse(mixedJson);
    altered.data.jobs[0].job_description = 'Completely different description text.';
    const ctx3 = createContext({
      urlFetch: { responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(altered) }] }
    });
    const res3 = hostify_(ctx3.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.notEqual(res3.candidates[0].content_hash, h1);
  });

  it('T26: optional missing fixture yields valid candidate with safe defaults, no throw', () => {
    const optJson = readFixture('ok-optional-missing.json');
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: optJson }]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    assert.equal(res.status, 'OK');
    assert.equal(res.candidates.length, 1);
    const c = res.candidates[0];
    assert.equal(c.latitude, null);
    assert.equal(c.longitude, null);
    assert.deepEqual(c.employment_types, []);
    assert.equal(c.posted_at, '');
    assert.equal(c.currency, '');
    assert.equal(c.country, '');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Quota Guard (T27 - T30)
// ---------------------------------------------------------------------------
describe('Phase 4A: Quota Guard (T27 - T30)', () => {
  it('T27: budget arithmetic invariant asserted from exported constants: 5 * 31 + 20 <= 200', () => {
    const ctx = createContext();
    const dailyCap = ctx.testExports.JSEARCH_SCHEDULED_DAILY_CAP_;
    const reserve = ctx.testExports.JSEARCH_PERIOD_RESERVE_;
    const planLimit = ctx.testExports.JSEARCH_PLAN_MONTHLY_LIMIT_;

    assert.equal(dailyCap, 5);
    assert.equal(reserve, 20);
    assert.equal(planLimit, 200);
    assert.ok(dailyCap * 31 + reserve <= planLimit, `${dailyCap} * 31 + ${reserve} must be <= ${planLimit}`);
  });

  it('T28: cap enforcement: 6th scheduled blocked, 4th manual blocked, rollover resets, reserve protection', () => {
    const emptyJson = readFixture('empty.json');
    // Preload responses
    const responses = [];
    for (let i = 0; i < 10; i++) {
      responses.push({ code: 200, headers: { 'Content-Type': 'application/json' }, body: emptyJson });
    }
    const ctx = createContext({ urlFetch: { responses: responses } });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    // 5 scheduled calls succeed
    for (let i = 0; i < 5; i++) {
      const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
      assert.equal(res.status, 'EMPTY');
    }
    assert.equal(ctx.urlFetch.calls.length, 5);

    // 6th scheduled call blocked
    const resBlocked6 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(resBlocked6.status, 'BUDGET_BLOCKED');
    assert.equal(ctx.urlFetch.calls.length, 5);

    // 3 manual calls succeed
    for (let i = 0; i < 3; i++) {
      const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'manual', nowDate: FIXED_NOW }));
      assert.equal(res.status, 'EMPTY');
    }
    assert.equal(ctx.urlFetch.calls.length, 8);

    // 4th manual call blocked
    const resBlockedManual = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'manual', nowDate: FIXED_NOW }));
    assert.equal(resBlockedManual.status, 'BUDGET_BLOCKED');
    assert.equal(ctx.urlFetch.calls.length, 8);

    // Advancing day resets daily caps
    const nextDay = new Date('2026-09-14T11:00:00.000Z');
    const resNextDay = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: nextDay }));
    assert.equal(resNextDay.status, 'EMPTY');
    assert.equal(ctx.urlFetch.calls.length, 9);

    // Test reserve threshold: periodCount >= 180 blocks scheduled, allows manual
    const props = ctx.sandbox.PropertiesService.getScriptProperties();
    const quotaState = JSON.parse(props.getProperty('JSEARCH_QUOTA_STATE'));
    quotaState.periodCount = 180;
    quotaState.dayCountScheduled = 0;
    quotaState.dayCountManual = 0;
    props.setProperty('JSEARCH_QUOTA_STATE', JSON.stringify(quotaState));

    const resSchedAt180 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: nextDay }));
    assert.equal(resSchedAt180.status, 'BUDGET_BLOCKED');
    assert.equal(ctx.urlFetch.calls.length, 9); // no fetch call

    const resManualAt180 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'manual', nowDate: nextDay }));
    assert.equal(resManualAt180.status, 'EMPTY');
    assert.equal(ctx.urlFetch.calls.length, 10);

    // Test both blocked at periodCount = 200
    quotaState.periodCount = 200;
    quotaState.dayCountManual = 0;
    props.setProperty('JSEARCH_QUOTA_STATE', JSON.stringify(quotaState));
    const resManualAt200 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'manual', nowDate: nextDay }));
    assert.equal(resManualAt200.status, 'BUDGET_BLOCKED');

    // Test scheduled blocked when lastRemaining <= 20
    quotaState.periodCount = 50;
    quotaState.lastRemaining = 20;
    props.setProperty('JSEARCH_QUOTA_STATE', JSON.stringify(quotaState));
    const resSchedLowRemaining = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: nextDay }));
    assert.equal(resSchedLowRemaining.status, 'BUDGET_BLOCKED');
  });

  it('T29: headers parsing, observedDelta, periodKey hdr switch, period rollover, state recovery', () => {
    const emptyJson = readFixture('empty.json');
    const ctx = createContext({
      urlFetch: {
        responses: [
          {
            code: 200,
            headers: {
              'Content-Type': 'application/json',
              'x-ratelimit-requests-remaining': '199',
              'x-ratelimit-requests-limit': '200',
              'x-ratelimit-requests-reset': '1209600'
            },
            body: emptyJson
          },
          {
            code: 200,
            headers: {
              'Content-Type': 'application/json',
              'x-ratelimit-requests-remaining': '198',
              'x-ratelimit-requests-limit': '200',
              'x-ratelimit-requests-reset': '1209500'
            },
            body: emptyJson
          }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    // Call 1
    const res1 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res1.status, 'EMPTY');
    assert.equal(res1.quota.remainingAfter, 199);
    assert.equal(res1.quota.limitHeader, 200);
    assert.equal(res1.quota.resetSecondsHeader, 1209600);

    // Call 2 computes delta = 199 - 198 = 1
    const res2 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    assert.equal(res2.status, 'EMPTY');
    assert.equal(res2.quota.remainingBefore, 199);
    assert.equal(res2.quota.remainingAfter, 198);
    assert.equal(res2.quota.observedDelta, 1);

    // Verify snapshot periodKey starts with hdr:
    const snapshot = hostify_(ctx.sandbox.jsearchGetQuotaSnapshot_(FIXED_NOW));
    assert.ok(snapshot.periodKey.startsWith('hdr:'));
    assert.ok(snapshot.lastResetAt);

    // Advance beyond resetDate rolls the period
    const resetDate = new Date(snapshot.lastResetAt);
    const afterReset = new Date(resetDate.getTime() + 1000);
    const snapshotAfterRoll = hostify_(ctx.sandbox.jsearchGetQuotaSnapshot_(afterReset));
    assert.equal(snapshotAfterRoll.periodCount, 0);
    assert.equal(snapshotAfterRoll.lastRemaining, null);

    // Corrupted state recovery
    ctx.sandbox.PropertiesService.getScriptProperties().setProperty('JSEARCH_QUOTA_STATE', 'INVALID_JSON_CORRUPT');
    const recovered = hostify_(ctx.sandbox.jsearchGetQuotaSnapshot_(FIXED_NOW));
    assert.equal(recovered.stateRecovered, true);
    assert.equal(recovered.periodCount, 0);
  });

  it('T30: reservation ordering: quota counter is incremented BEFORE network transmission', () => {
    let countAtMomentOfFetch = null;
    const ctx = createContext();

    // Create a custom UrlFetch fake that inspects the Script Properties at call time
    ctx.sandbox.UrlFetchApp = {
      calls: [],
      fetch: function (url, params) {
        const raw = ctx.sandbox.PropertiesService.getScriptProperties().getProperty('JSEARCH_QUOTA_STATE');
        const state = JSON.parse(raw);
        countAtMomentOfFetch = state.periodCount;
        return {
          getResponseCode: function () { return 200; },
          getHeaders: function () { return { 'Content-Type': 'application/json' }; },
          getAllHeaders: function () { return { 'Content-Type': 'application/json' }; },
          getContentText: function () { return readFixture('empty.json'); }
        };
      }
    };

    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW });

    // Assert that periodCount was already 1 when fetch was executed
    assert.equal(countAtMomentOfFetch, 1);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Security, Redaction, and Determinism (T31 - T34)
// ---------------------------------------------------------------------------
describe('Phase 4A: Security, Redaction, and Determinism (T31 - T34)', () => {
  it('T31: token redaction tripwire: FAKE_JSEARCH_KEY_FOR_TESTS_ONLY appears only in request header', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [
          { code: 200, headers: { 'Content-Type': 'application/json' }, body: readFixture('ok-linkedin-mixed.json') },
          { code: 401, headers: {}, body: 'Unauthorized' }
        ]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res1 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    const res2 = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    const snapshot = hostify_(ctx.sandbox.jsearchGetQuotaSnapshot_(FIXED_NOW));

    const checkNoKey = (targetStr, label) => {
      assert.equal(targetStr.includes(TEST_KEY), false, `${label} unexpectedly contains secret API key token`);
    };

    checkNoKey(JSON.stringify(res1), 'Result 1 JSON');
    checkNoKey(JSON.stringify(res2), 'Result 2 JSON');
    checkNoKey(JSON.stringify(snapshot), 'Snapshot JSON');
    checkNoKey(ctx.sandbox.PropertiesService.getScriptProperties().getProperty('JSEARCH_QUOTA_STATE'), 'Quota state JSON');
    checkNoKey(ctx.consoleFake._warns.join(' '), 'Console warnings');
    checkNoKey(ctx.consoleFake._errors.join(' '), 'Console errors');

    // Key appears only in outbound headers
    assert.equal(ctx.urlFetch.calls[0].params.headers['X-RapidAPI-Key'], TEST_KEY);
  });

  it('T32: return object security scan: zero raw body, headers, or apiKey fields', () => {
    const ctx = createContext({
      urlFetch: {
        responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: readFixture('ok-linkedin-mixed.json') }]
      }
    });
    const query = ctx.testExports.JSEARCH_QUERY_CATALOG_[0];
    const res = hostify_(ctx.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    const forbiddenFields = ['apiKey', 'headers', 'rawBody', 'rawResponse', 'rawHeaders', 'secret'];
    const scanKeys = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(k => {
        assert.equal(forbiddenFields.includes(k), false, `forbidden field "${k}" found in return object`);
        scanKeys(obj[k]);
      });
    };
    scanKeys(res);
  });

  it('T33: determinism: identical fixture, fixed nowDate, and fresh context yield deepEqual output', () => {
    const mixedJson = readFixture('ok-linkedin-mixed.json');
    const ctx1 = createContext({
      urlFetch: { responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }] }
    });
    const ctx2 = createContext({
      urlFetch: { responses: [{ code: 200, headers: { 'Content-Type': 'application/json' }, body: mixedJson }] }
    });
    const query = ctx1.testExports.JSEARCH_QUERY_CATALOG_[0];

    const res1 = hostify_(ctx1.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));
    const res2 = hostify_(ctx2.sandbox.jsearchFetchPage_(query, { mode: 'scheduled', nowDate: FIXED_NOW }));

    assert.deepEqual(res1, res2);
  });

  it('T34: fixture safety audit: zero emails, phone numbers, street addresses, or fake key tokens', () => {
    const fixtureFiles = fs.readdirSync(FIXTURES_DIR);
    assert.equal(fixtureFiles.length, 9, 'expected exactly 9 test fixtures');

    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phonePattern = /\b(?:\+?1[-.]?)?\(?[2-9]\d{2}\)?[-.\s][2-9]\d{2}[-.\s]\d{4}\b/;
    const streetPattern = /\d+\s+[A-Za-z0-9.]+\s+(St|Ave|Rd|Blvd|Street|Avenue|Road)\b/i;

    fixtureFiles.forEach(file => {
      const content = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8');
      assert.equal(emailPattern.test(content), false, `fixture ${file} matched email address pattern`);
      assert.equal(phonePattern.test(content), false, `fixture ${file} matched US phone pattern`);
      assert.equal(streetPattern.test(content), false, `fixture ${file} matched street address pattern`);
      assert.equal(content.includes(TEST_KEY), false, `fixture ${file} contains test secret key token`);
    });
  });
});
