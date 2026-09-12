'use strict';

/**
 * Phase 4B — JobDedupe.gs (identity resolution / deduplication)
 *
 * Covers the frozen contract's identity hierarchy end to end: L1
 * (source, external_id), L2 (source, canonical URL hash), L3 (source,
 * content hash), both ambiguity reason codes, IDENTITY_INSUFFICIENT,
 * in-run duplicate detection via `_inRun`, TOUCH field-scoping, INSERT
 * field-setting, and apostrophe-vs-unprefixed hash stability for both
 * jobDedupeComputeUrlHash_ and jobDedupeComputeContentHash_.
 *
 * jobDedupeResolveCandidate_ needs Utilities.computeDigest (for the
 * hashes) and normalizeRemote_ (Jobs.gs, for the INSERT record's `remote`
 * field), so the sandbox loads Jobs.gs alongside JobDedupe.gs. Jobs.gs's
 * normalizeRemote_ and the constants above it have no dependency on
 * Database.gs at parse time, so loading it standalone here is safe.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes.js');

const DEDUPE_FILES = ['Jobs.gs', 'JobDedupe.gs'];
const NOW_ISO = '2026-09-12T12:00:00.000Z';

function createContext_() {
  return loadAppsScriptContext_({ files: DEDUPE_FILES });
}

/**
 * A plain in-memory fake `index` implementing exactly the three frozen
 * lookup methods, built the same way Primary's real index will be: by
 * hashing stored JobsRow-shaped objects with the SAME
 * jobDedupeCanonicalizeUrl_ / jobDedupeComputeUrlHash_ /
 * jobDedupeComputeContentHash_ functions Builder B's own dedupe logic
 * uses. `rows` is a plain array of JobsRow-like objects (Jobs schema
 * fields, plus optional `_inRun: true`); callers mutate/replace it
 * between assertions as needed within a single test.
 */
function createFakeIndex_(sandbox, rows) {
  return {
    rows: rows,
    findByExternalId: function (source, externalId) {
      if (!externalId) return [];
      return this.rows.filter(function (row) {
        return row.source === source && String(row.external_id || '') === String(externalId);
      });
    },
    findByUrlHash: function (source, urlHash) {
      return this.rows.filter(function (row) {
        if (row.source !== source || !row.url) return false;
        const canonical = sandbox.jobDedupeCanonicalizeUrl_(row.url);
        if (!canonical) return false;
        return sandbox.jobDedupeComputeUrlHash_(row.source, canonical) === urlHash;
      });
    },
    findByContentHash: function (source, contentHash) {
      return this.rows.filter(function (row) {
        if (row.source !== source) return false;
        return sandbox.jobDedupeComputeContentHash_(row.source, row.company, row.title, row.location) === contentHash;
      });
    }
  };
}

function baseCandidate_(overrides) {
  return Object.assign({
    normalizerVersion: '4A.1',
    route: 'jsearch',
    source: 'linkedin',
    external_id: 'ext-100',
    url: 'https://jobs.example.org/posting/100',
    title: 'Help Desk Technician',
    company: 'Acme Corp',
    location: 'Pittsburgh, PA',
    remote: false,
    salary_min: 40000,
    salary_max: 50000,
    salary_period: 'YEAR',
    currency: 'USD',
    salary_source: 'provider',
    posted_at: '2026-09-10T00:00:00.000Z',
    employment_types: ['FULLTIME'],
    latitude: 40.44,
    longitude: -79.99,
    country: 'US',
    publisher_raw: 'LinkedIn',
    description: 'Provide desktop support.',
    content_hash: 'adapter-own-hash-not-used-by-dedupe'
  }, overrides || {});
}

function jobsRow_(overrides) {
  return Object.assign({
    id: 'row-1',
    external_id: '',
    source: 'linkedin',
    url: '',
    title: '',
    company: '',
    location: '',
    remote: false,
    salary_min: '',
    salary_max: '',
    currency: '',
    posted_at: '',
    discovered_at: '2026-09-01T00:00:00.000Z',
    last_seen_at: '2026-09-01T00:00:00.000Z',
    description: '',
    status: 'New',
    saved_at: '',
    notes: '',
    record_version: 1
  }, overrides || {});
}

describe('Phase 4B JobDedupe: L1 (source, external_id)', () => {
  it('1 match -> TOUCH, existingId set, updates scoped to last_seen_at only', () => {
    const ctx = createContext_();
    const existing = jobsRow_({ id: 'row-A', external_id: 'ext-100', url: 'https://jobs.example.org/posting/100' });
    const index = createFakeIndex_(ctx.sandbox, [existing]);
    const candidate = baseCandidate_();

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'TOUCH');
    assert.equal(result.existingId, 'row-A');
    assert.deepEqual(Object.keys(result.updates), ['last_seen_at']);
    assert.equal(result.updates.last_seen_at, NOW_ISO);
    assert.equal(result.identityVersion, 'jobdedupe-identity-v1');
    assert.equal(result.record, undefined);
    assert.equal(result.reasonCode, undefined);
  });

  it('0 matches, no conflict -> INSERT with full record fields set correctly', () => {
    const ctx = createContext_();
    const index = createFakeIndex_(ctx.sandbox, []);
    const candidate = baseCandidate_({ remote: true, salary_min: null, salary_max: null });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'INSERT');
    assert.equal(result.identityVersion, 'jobdedupe-identity-v1');
    const record = result.record;
    assert.equal(record.external_id, 'ext-100');
    assert.equal(record.source, 'linkedin');
    assert.equal(record.url, candidate.url);
    assert.equal(record.title, candidate.title);
    assert.equal(record.company, candidate.company);
    assert.equal(record.location, candidate.location);
    assert.equal(record.remote, true);
    assert.equal(record.salary_min, '');
    assert.equal(record.salary_max, '');
    assert.equal(record.status, 'New');
    assert.equal(record.record_version, 1);
    assert.equal(record.discovered_at, NOW_ISO);
    assert.equal(record.last_seen_at, NOW_ISO);
    assert.equal(record.saved_at, '');
    assert.equal(record.notes, '');
    assert.equal(Object.prototype.hasOwnProperty.call(record, 'id'), false, 'INSERT record must not set id — Database.gs auto-generates it');
  });

  it('>1 match -> QUARANTINE AMBIGUOUS_MULTI_MATCH', () => {
    const ctx = createContext_();
    const rowA = jobsRow_({ id: 'row-A', external_id: 'ext-100' });
    const rowB = jobsRow_({ id: 'row-B', external_id: 'ext-100' });
    const index = createFakeIndex_(ctx.sandbox, [rowA, rowB]);
    const candidate = baseCandidate_();

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'QUARANTINE');
    assert.equal(result.reasonCode, 'AMBIGUOUS_MULTI_MATCH');
    assert.equal(result.identityVersion, 'jobdedupe-identity-v1');
  });

  it('0 matches by external_id, but same URL hash exists on a row with a DIFFERENT non-empty external_id -> QUARANTINE AMBIGUOUS_URL_ID_CONFLICT', () => {
    const ctx = createContext_();
    const conflicting = jobsRow_({
      id: 'row-conflict',
      external_id: 'some-other-ext-id',
      url: 'https://jobs.example.org/posting/100?utm_source=newsletter'
    });
    const index = createFakeIndex_(ctx.sandbox, [conflicting]);
    const candidate = baseCandidate_({ external_id: 'ext-100', url: 'https://jobs.example.org/posting/100' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'QUARANTINE');
    assert.equal(result.reasonCode, 'AMBIGUOUS_URL_ID_CONFLICT');
  });

  it('0 matches by external_id, URL hash matches a row with a BLANK external_id (no conflict) -> INSERT (never merge on a weaker signal here)', () => {
    const ctx = createContext_();
    const blankIdRow = jobsRow_({
      id: 'row-blank',
      external_id: '',
      url: 'https://jobs.example.org/posting/100'
    });
    const index = createFakeIndex_(ctx.sandbox, [blankIdRow]);
    const candidate = baseCandidate_({ external_id: 'ext-100', url: 'https://jobs.example.org/posting/100' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'INSERT');
  });

  it('in-run duplicate: L1 match with _inRun true -> DUPLICATE_IN_RUN, no updates/record', () => {
    const ctx = createContext_();
    const inRunRow = jobsRow_({ id: 'row-inrun', external_id: 'ext-100', _inRun: true });
    const index = createFakeIndex_(ctx.sandbox, [inRunRow]);
    const candidate = baseCandidate_();

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'DUPLICATE_IN_RUN');
    assert.equal(result.reasonCode, 'DUPLICATE_IN_RUN');
    assert.equal(result.identityVersion, 'jobdedupe-identity-v1');
    assert.equal(result.updates, undefined);
    assert.equal(result.record, undefined);
  });
});

describe('Phase 4B JobDedupe: L2 (source, canonical URL hash) — only when no external_id', () => {
  it('1 match -> TOUCH', () => {
    const ctx = createContext_();
    const existing = jobsRow_({ id: 'row-url-1', url: 'https://jobs.example.org/posting/200?utm_campaign=x' });
    const index = createFakeIndex_(ctx.sandbox, [existing]);
    const candidate = baseCandidate_({ external_id: '', url: 'https://jobs.example.org/posting/200' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'TOUCH');
    assert.equal(result.existingId, 'row-url-1');
    assert.deepEqual(Object.keys(result.updates), ['last_seen_at']);
  });

  it('1 match that already carries an external_id -> still TOUCH (L2 has no "never merge" restriction, unlike L3)', () => {
    const ctx = createContext_();
    const existing = jobsRow_({ id: 'row-url-2', external_id: 'already-identified', url: 'https://jobs.example.org/posting/201' });
    const index = createFakeIndex_(ctx.sandbox, [existing]);
    const candidate = baseCandidate_({ external_id: '', url: 'https://jobs.example.org/posting/201' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'TOUCH');
    assert.equal(result.existingId, 'row-url-2');
  });

  it('0 matches -> INSERT with blank external_id', () => {
    const ctx = createContext_();
    const index = createFakeIndex_(ctx.sandbox, []);
    const candidate = baseCandidate_({ external_id: '', url: 'https://jobs.example.org/posting/202' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'INSERT');
    assert.equal(result.record.external_id, '');
    assert.equal(result.record.url, candidate.url);
  });

  it('>1 match -> QUARANTINE AMBIGUOUS_MULTI_MATCH', () => {
    const ctx = createContext_();
    const rowA = jobsRow_({ id: 'row-url-A', url: 'https://jobs.example.org/posting/203' });
    const rowB = jobsRow_({ id: 'row-url-B', url: 'https://jobs.example.org/posting/203' });
    const index = createFakeIndex_(ctx.sandbox, [rowA, rowB]);
    const candidate = baseCandidate_({ external_id: '', url: 'https://jobs.example.org/posting/203' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'QUARANTINE');
    assert.equal(result.reasonCode, 'AMBIGUOUS_MULTI_MATCH');
  });

  it('in-run duplicate at L2 -> DUPLICATE_IN_RUN', () => {
    const ctx = createContext_();
    const inRunRow = jobsRow_({ id: 'row-url-inrun', url: 'https://jobs.example.org/posting/204', _inRun: true });
    const index = createFakeIndex_(ctx.sandbox, [inRunRow]);
    const candidate = baseCandidate_({ external_id: '', url: 'https://jobs.example.org/posting/204' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'DUPLICATE_IN_RUN');
    assert.equal(result.reasonCode, 'DUPLICATE_IN_RUN');
  });
});

describe('Phase 4B JobDedupe: L3 (source, content hash) — only when no external_id and no URL', () => {
  it('blank company -> QUARANTINE IDENTITY_INSUFFICIENT', () => {
    const ctx = createContext_();
    const index = createFakeIndex_(ctx.sandbox, []);
    const candidate = baseCandidate_({ external_id: '', url: '', company: '   ' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'QUARANTINE');
    assert.equal(result.reasonCode, 'IDENTITY_INSUFFICIENT');
  });

  it('blank title -> QUARANTINE IDENTITY_INSUFFICIENT', () => {
    const ctx = createContext_();
    const index = createFakeIndex_(ctx.sandbox, []);
    const candidate = baseCandidate_({ external_id: '', url: '', title: '' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'QUARANTINE');
    assert.equal(result.reasonCode, 'IDENTITY_INSUFFICIENT');
  });

  it('1 eligible match (no external_id on the stored row) -> TOUCH', () => {
    const ctx = createContext_();
    const existing = jobsRow_({ id: 'row-content-1', company: 'Acme Corp', title: 'Help Desk Technician', location: 'Pittsburgh, PA' });
    const index = createFakeIndex_(ctx.sandbox, [existing]);
    const candidate = baseCandidate_({ external_id: '', url: '' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'TOUCH');
    assert.equal(result.existingId, 'row-content-1');
  });

  it('content hash matches a row that already has an external_id -> never merge into it -> INSERT instead', () => {
    const ctx = createContext_();
    const identifiedRow = jobsRow_({
      id: 'row-content-identified',
      external_id: 'already-has-an-id',
      company: 'Acme Corp',
      title: 'Help Desk Technician',
      location: 'Pittsburgh, PA'
    });
    const index = createFakeIndex_(ctx.sandbox, [identifiedRow]);
    const candidate = baseCandidate_({ external_id: '', url: '' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'INSERT');
    assert.equal(result.record.external_id, '');
  });

  it('>1 eligible match -> QUARANTINE AMBIGUOUS_MULTI_MATCH', () => {
    const ctx = createContext_();
    const rowA = jobsRow_({ id: 'row-content-A', company: 'Acme Corp', title: 'Help Desk Technician', location: 'Pittsburgh, PA' });
    const rowB = jobsRow_({ id: 'row-content-B', company: 'Acme Corp', title: 'Help Desk Technician', location: 'Pittsburgh, PA' });
    const index = createFakeIndex_(ctx.sandbox, [rowA, rowB]);
    const candidate = baseCandidate_({ external_id: '', url: '' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'QUARANTINE');
    assert.equal(result.reasonCode, 'AMBIGUOUS_MULTI_MATCH');
  });

  it('0 matches -> INSERT', () => {
    const ctx = createContext_();
    const index = createFakeIndex_(ctx.sandbox, []);
    const candidate = baseCandidate_({ external_id: '', url: '' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'INSERT');
    assert.equal(result.record.external_id, '');
  });

  it('in-run duplicate at L3 -> DUPLICATE_IN_RUN', () => {
    const ctx = createContext_();
    const inRunRow = jobsRow_({
      id: 'row-content-inrun',
      company: 'Acme Corp',
      title: 'Help Desk Technician',
      location: 'Pittsburgh, PA',
      _inRun: true
    });
    const index = createFakeIndex_(ctx.sandbox, [inRunRow]);
    const candidate = baseCandidate_({ external_id: '', url: '' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'DUPLICATE_IN_RUN');
  });
});

describe('Phase 4B JobDedupe: TOUCH field-scoping', () => {
  it('TOUCH never sets status, saved_at, notes, or record_version — only last_seen_at', () => {
    const ctx = createContext_();
    const existing = jobsRow_({ id: 'row-scope', external_id: 'ext-100', status: 'Rejected', notes: 'do not touch me', record_version: 3 });
    const index = createFakeIndex_(ctx.sandbox, [existing]);
    const candidate = baseCandidate_();

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'TOUCH');
    // hostify_ rebuilds the vm-realm updates object as a plain host-realm
    // object so deepStrictEqual doesn't fail on cross-realm identity alone
    // (see gas-fakes.js's hostify_ doc comment).
    assert.deepEqual(hostify_(result.updates), { last_seen_at: NOW_ISO });
    assert.equal(Object.prototype.hasOwnProperty.call(result.updates, 'status'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.updates, 'record_version'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.updates, 'saved_at'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.updates, 'notes'), false);
  });
});

describe('Phase 4B JobDedupe: hash stability (leading-apostrophe normalization)', () => {
  it('jobDedupeComputeUrlHash_: apostrophe-prefixed and un-prefixed canonical URLs hash identically', () => {
    const ctx = createContext_();
    const plain = ctx.sandbox.jobDedupeComputeUrlHash_('linkedin', 'https://jobs.example.org/posting/300');
    const prefixed = ctx.sandbox.jobDedupeComputeUrlHash_('linkedin', "'https://jobs.example.org/posting/300");

    assert.equal(plain, prefixed);
    assert.equal(plain.indexOf('jobdedupe-url-v1:'), 0);
  });

  it('jobDedupeComputeUrlHash_: stability survives the full canonicalize-then-hash pipeline', () => {
    const ctx = createContext_();
    const rawUrl = 'https://jobs.example.org/posting/300?utm_source=x';
    const canonicalPlain = ctx.sandbox.jobDedupeCanonicalizeUrl_(rawUrl);
    const canonicalPrefixed = ctx.sandbox.jobDedupeCanonicalizeUrl_("'" + rawUrl);

    const hashPlain = ctx.sandbox.jobDedupeComputeUrlHash_('linkedin', canonicalPlain);
    const hashPrefixed = ctx.sandbox.jobDedupeComputeUrlHash_('linkedin', canonicalPrefixed);

    assert.equal(hashPlain, hashPrefixed);
  });

  it('jobDedupeComputeContentHash_: apostrophe-prefixed and un-prefixed company/title/location hash identically', () => {
    const ctx = createContext_();
    const plain = ctx.sandbox.jobDedupeComputeContentHash_('linkedin', 'Acme Corp', 'Help Desk Technician', 'Pittsburgh, PA');
    const prefixed = ctx.sandbox.jobDedupeComputeContentHash_('linkedin', "'Acme Corp", "'Help Desk Technician", "'Pittsburgh, PA");

    assert.equal(plain, prefixed);
    assert.equal(plain.indexOf('jobdedupe-content-v1:'), 0);
  });

  it('jobDedupeComputeContentHash_: a differing field still produces a different hash (sanity check against a trivially-always-equal implementation)', () => {
    const ctx = createContext_();
    const a = ctx.sandbox.jobDedupeComputeContentHash_('linkedin', 'Acme Corp', 'Help Desk Technician', 'Pittsburgh, PA');
    const b = ctx.sandbox.jobDedupeComputeContentHash_('linkedin', 'Different Corp', 'Help Desk Technician', 'Pittsburgh, PA');

    assert.notEqual(a, b);
  });

  it('an apostrophe-prefixed stored row hashes the same as its un-prefixed live-Sheet equivalent through findByContentHash (integration-shaped check)', () => {
    const ctx = createContext_();
    // Simulates a value Database.gs escaped with a leading `'` before writing
    // to a Sheet (see Database.gs's formula-escaping behavior, and the
    // Phase 4B contract's apostrophe note): the fake index stores it
    // literally, exactly like this project's tests fake, while a live Sheet
    // would have stripped it on read.
    const storedRow = jobsRow_({ id: 'row-apostrophe', company: "'Acme Corp", title: 'Help Desk Technician', location: 'Pittsburgh, PA' });
    const index = createFakeIndex_(ctx.sandbox, [storedRow]);
    const candidate = baseCandidate_({ external_id: '', url: '', company: 'Acme Corp' });

    const result = ctx.sandbox.jobDedupeResolveCandidate_(index, candidate, NOW_ISO);

    assert.equal(result.action, 'TOUCH', 'the apostrophe-prefixed stored company must still resolve to the same content hash as the un-prefixed candidate');
    assert.equal(result.existingId, 'row-apostrophe');
  });
});

describe('Phase 4B JobDedupe: jobDedupeCanonicalizeUrl_ reuse — strips only documented tracking params', () => {
  it('strips known tracking params and preserves identity-bearing ones', () => {
    const ctx = createContext_();
    const canonical = ctx.sandbox.jobDedupeCanonicalizeUrl_(
      'https://jobs.example.org/posting/400?jobId=400&utm_source=newsletter&utm_medium=email'
    );
    assert.equal(canonical, 'https://jobs.example.org/posting/400?jobId=400');
  });

  it('returns "" for blank/non-string input', () => {
    const ctx = createContext_();
    assert.equal(ctx.sandbox.jobDedupeCanonicalizeUrl_(''), '');
    assert.equal(ctx.sandbox.jobDedupeCanonicalizeUrl_(null), '');
    assert.equal(ctx.sandbox.jobDedupeCanonicalizeUrl_(undefined), '');
  });
});
