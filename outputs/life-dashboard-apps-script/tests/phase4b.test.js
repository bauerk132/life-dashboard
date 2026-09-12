'use strict';

/**
 * Phase 4B Test Suite — Filters, Deduplication, and Discovery Orchestration
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { loadAppsScriptContext_ } = require('./gas-fakes.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'jsearch');
const PHASE4B_FILES = [
  'Database.gs',
  'Code.gs',
  'Jobs.gs',
  'JobSource_JSearch.gs',
  'JobFilters.gs',
  'JobDedupe.gs',
  'Discovery.gs'
];

function readFixture(filename) {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
}

function createContext(overrides) {
  overrides = overrides || {};
  const scriptProps = Object.assign({
    DATABASE_SHEET_ID: 'FAKE_SHEET_ID',
    JSEARCH_RAPIDAPI_KEY: 'FAKE_JSEARCH_KEY_FOR_TESTS_ONLY'
  }, overrides.scriptProperties || {});

  const ctx = loadAppsScriptContext_({
    files: PHASE4B_FILES,
    scriptProperties: scriptProps,
    urlFetch: overrides.urlFetch || { responses: [] }
  });

  // Initialize DB schema in fake environment
  ctx.sandbox.initializeDatabase();

  return ctx.sandbox;
}

describe('Phase 4B — JobFilters.gs Deterministic Filtering', () => {
  let env;

  beforeEach(() => {
    env = createContext();
  });

  it('rejects commission-only, door-to-door, and canvassing roles', () => {
    const candidates = [
      { title: 'IT Support Specialist', description: '100% commission only based role' },
      { title: 'Door-to-door Sales Tech', description: 'Help desk setup in neighborhoods' },
      { title: 'Help Desk Canvasser', description: 'Cold calling and canvassing' }
    ];

    candidates.forEach((cand) => {
      const res = env.jobFiltersEvaluateCandidate_(cand);
      assert.equal(res.passed, false);
      assert.equal(res.primaryReason, 'EXCLUDED_COMMISSION_OR_CANVASSING');
    });
  });

  it('rejects commercial driving / CDL roles', () => {
    const cand = { title: 'Delivery Driver - CDL A', description: 'Deliver IT hardware' };
    const res = env.jobFiltersEvaluateCandidate_(cand);
    assert.equal(res.passed, false);
    assert.equal(res.primaryReason, 'EXCLUDED_COMMERCIAL_DRIVING');
  });

  it('rejects active security clearance roles', () => {
    const cand = { title: 'Help Desk Analyst', description: 'Active Top Secret clearance required' };
    const res = env.jobFiltersEvaluateCandidate_(cand);
    assert.equal(res.passed, false);
    assert.equal(res.primaryReason, 'EXCLUDED_SECURITY_CLEARANCE');
  });

  it('rejects medical licensing roles', () => {
    const cand = { title: 'Registered Nurse', description: 'Hospital support' };
    const res = env.jobFiltersEvaluateCandidate_(cand);
    assert.equal(res.passed, false);
    assert.equal(res.primaryReason, 'EXCLUDED_MEDICAL_LICENSING');
  });

  it('identifies Priority 1 target roles (IT support track)', () => {
    const cand = {
      title: 'Help Desk Technician',
      description: 'Troubleshoot Windows, Active Directory, printers',
      location: 'Pittsburgh, PA',
      remote: false
    };
    const res = env.jobFiltersEvaluateCandidate_(cand);
    assert.equal(res.passed, true);
    assert.equal(res.priority, 1);
    assert.equal(res.primaryReason, 'PASSED_PROFILE_FILTERS');
  });

  it('identifies Priority 2 target roles (coordination/administration track)', () => {
    const cand = {
      title: 'Operations Coordinator',
      description: 'Coordinate office inventory and logistics schedules',
      location: 'Pittsburgh, PA',
      remote: false
    };
    const res = env.jobFiltersEvaluateCandidate_(cand);
    assert.equal(res.passed, true);
    assert.equal(res.priority, 2);
  });

  it('identifies Priority 3 non-sales customer support, but rejects sales-oriented support', () => {
    const cleanCand = {
      title: 'Customer Support Representative',
      description: 'Answer customer questions regarding account settings',
      location: 'Pittsburgh, PA',
      remote: false
    };
    const cleanRes = env.jobFiltersEvaluateCandidate_(cleanCand);
    assert.equal(cleanRes.passed, true);
    assert.equal(cleanRes.priority, 3);

    const salesCand = {
      title: 'Customer Support Representative',
      description: 'Support customers and meet quarterly quota via cold call sales leads',
      location: 'Pittsburgh, PA',
      remote: false
    };
    const salesRes = env.jobFiltersEvaluateCandidate_(salesCand);
    assert.equal(salesRes.passed, false);
    assert.ok(salesRes.primaryReason.startsWith('EXCLUDED_'));
  });

  it('enforces geography: accepts distance <= 8 miles, rejects > 8 miles', () => {
    // 2 miles east of downtown Pittsburgh
    const nearCand = {
      title: 'Help Desk Specialist',
      location: 'Oakland, Pittsburgh, PA',
      latitude: 40.444,
      longitude: -79.953,
      remote: false
    };
    assert.equal(env.jobFiltersEvaluateCandidate_(nearCand).passed, true);

    // Cranberry Twp (~20 miles north of downtown Pittsburgh)
    const farCand = {
      title: 'Help Desk Specialist',
      location: 'Cranberry Twp, PA',
      latitude: 40.684,
      longitude: -80.106,
      remote: false
    };
    const farRes = env.jobFiltersEvaluateCandidate_(farCand);
    assert.equal(farRes.passed, false);
    assert.equal(farRes.primaryReason, 'DISTANCE_EXCEEDS_8_MILES');
  });

  it('handles remote eligibility and rejects remote explicitly excluding Pennsylvania', () => {
    const goodRemote = {
      title: 'Remote IT Support Analyst',
      description: 'Open to US applicants',
      remote: true
    };
    assert.equal(env.jobFiltersEvaluateCandidate_(goodRemote).passed, true);

    const badRemote = {
      title: 'Remote IT Support Analyst',
      description: 'Work from anywhere excluding PA and NY',
      remote: true
    };
    const badRes = env.jobFiltersEvaluateCandidate_(badRemote);
    assert.equal(badRes.passed, false);
    assert.equal(badRes.primaryReason, 'REMOTE_EXCLUDES_PENNSYLVANIA');
  });

  it('enforces compensation floor: passes >= $19/hr, rejects < $19/hr, allows unknown', () => {
    const goodHourly = {
      title: 'Desktop Support Tech',
      location: 'Pittsburgh, PA',
      salary_min: 22.0,
      salary_max: 25.0,
      currency: 'USD'
    };
    assert.equal(env.jobFiltersEvaluateCandidate_(goodHourly).passed, true);

    const lowHourly = {
      title: 'Desktop Support Tech',
      location: 'Pittsburgh, PA',
      salary_max: 16.0,
      currency: 'USD'
    };
    const lowRes = env.jobFiltersEvaluateCandidate_(lowHourly);
    assert.equal(lowRes.passed, false);
    assert.equal(lowRes.primaryReason, 'BELOW_HOURLY_SALARY_FLOOR');

    const unknownSalary = {
      title: 'Desktop Support Tech',
      location: 'Pittsburgh, PA'
    };
    assert.equal(env.jobFiltersEvaluateCandidate_(unknownSalary).passed, true);
  });
});

describe('Phase 4B — JobDedupe.gs Identity Resolution', () => {
  let env;

  beforeEach(() => {
    env = createContext();
  });

  it('canonicalizes tracking parameters from URLs consistently', () => {
    const raw = 'https://www.linkedin.com/jobs/view/12345/?utm_source=feed&refId=abc&trackingId=xyz&trk=public_jobs';
    const canonical = env.jobDedupeCanonicalizeUrl_(raw);
    assert.equal(canonical, 'https://www.linkedin.com/jobs/view/12345');
  });

  it('matches existing job by Level 1: (source, external_id)', () => {
    const existing = [
      { id: 'job-1', source: 'linkedin', external_id: 'ext-999', record_version: 1 }
    ];
    const candidate = {
      source: 'linkedin',
      external_id: 'ext-999',
      title: 'Help Desk',
      company: 'Acme',
      url: 'https://example.com/job'
    };

    const res = env.jobDedupeResolveCandidate_(existing, candidate);
    assert.equal(res.action, 'UPDATE');
    assert.equal(res.existingId, 'job-1');
    assert.equal(res.identityKey, 'EXTERNAL_ID');
    assert.equal(res.updates.record_version, 2);
  });

  it('matches existing job by Level 2: (source, canonical_url_hash)', () => {
    const existingUrl = 'https://www.linkedin.com/jobs/view/12345';
    const existing = [
      { id: 'job-2', source: 'linkedin', external_id: 'other-id', url: existingUrl, record_version: 3 }
    ];
    const candidate = {
      source: 'linkedin',
      external_id: 'new-ext-id',
      url: existingUrl + '?utm_source=newsletter&ref=feed'
    };

    const res = env.jobDedupeResolveCandidate_(existing, candidate);
    assert.equal(res.action, 'UPDATE');
    assert.equal(res.existingId, 'job-2');
    assert.equal(res.identityKey, 'CANONICAL_URL');
    assert.equal(res.updates.record_version, 4);
  });

  it('prepares a full INSERT record when no identity matches exist', () => {
    const existing = [];
    const candidate = {
      source: 'linkedin',
      external_id: 'ext-unique',
      title: 'Technical Support Technician',
      company: 'Duquesne Light',
      location: 'Pittsburgh, PA',
      url: 'https://www.linkedin.com/jobs/view/98765',
      remote: false,
      salary_min: 24,
      currency: 'USD'
    };

    const res = env.jobDedupeResolveCandidate_(existing, candidate);
    assert.equal(res.action, 'INSERT');
    assert.equal(res.identityKey, 'NEW');
    assert.ok(res.record.id);
    assert.equal(res.record.status, 'New');
    assert.equal(res.record.record_version, 1);
    assert.equal(res.record.salary_min, 24);
  });
});

describe('Phase 4B — Discovery Orchestration Pipeline', () => {
  it('runs discovery pipeline end-to-end and deduplicates on repeated execution', () => {
    const mixedJson = readFixture('ok-linkedin-mixed.json');

    // Provide responses for the daily queries
    const responses = [];
    for (let i = 0; i < 10; i++) {
      responses.push({
        code: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Requests-Remaining': '180'
        },
        body: mixedJson
      });
    }

    const env = createContext({
      urlFetch: { responses: responses }
    });

    const day1 = new Date('2026-09-13T10:00:00.000Z');
    const day2 = new Date('2026-09-14T10:00:00.000Z');

    // Run 1: Initial discovery on Day 1
    const run1 = env.discoveryRun_('scheduled', day1);
    assert.equal(run1.ok, true);
    assert.ok(run1.insertedCount >= 1, 'expected at least 1 inserted job');

    // Verify stored in DB
    const ss = env.getDb_();
    const rowsAfterRun1 = env.readRows_(ss, 'Jobs');
    assert.ok(rowsAfterRun1.length >= 1);

    // User updates a status and note on job 1
    const firstJobId = rowsAfterRun1[0].id;
    env.setJobStatus(firstJobId, 'Reviewed', 1);
    env.addJobNote(firstJobId, 'Spoke with hiring manager at job fair');

    // Run 2: Repeated discovery on Day 2 with same responses
    const run2 = env.discoveryRun_('scheduled', day2);
    assert.equal(run2.ok, true);
    // Repeated run must create ZERO new rows
    assert.equal(run2.insertedCount, 0);
    assert.ok(run2.updatedCount >= 1);

    // Verify that user workflow fields were strictly preserved
    const rowsAfterRun2 = env.readRows_(ss, 'Jobs');
    assert.equal(rowsAfterRun2.length, rowsAfterRun1.length);

    const updatedFirstJob = rowsAfterRun2.find((r) => r.id === firstJobId);
    assert.equal(updatedFirstJob.status, 'Reviewed');
    assert.ok(updatedFirstJob.notes.includes('Spoke with hiring manager at job fair'));
    assert.ok(updatedFirstJob.record_version > 1);
  });
});
