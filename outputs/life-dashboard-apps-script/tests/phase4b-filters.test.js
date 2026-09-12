'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes.js');

const FILES = [
  'Database.gs', 'Jobs.gs', 'JobProfile.gs', 'JobFilters.gs', 'JobSource_JSearch.gs'
];

function context_() {
  return loadAppsScriptContext_({ files: FILES });
}

function candidate_(overrides) {
  return Object.assign({
    source: 'linkedin',
    external_id: 'filter-1',
    url: 'https://www.linkedin.com/jobs/view/filter-1',
    title: 'Help Desk Technician',
    company: 'Example Employer',
    location: 'Pittsburgh, PA',
    remote: { value: false, label: 'Not remote' },
    salary_min: 40000,
    salary_max: 50000,
    salary_period: 'YEAR',
    currency: 'USD',
    salary_source: 'provider',
    posted_at: '2026-09-11T12:00:00.000Z',
    employment_types: ['FULLTIME'],
    latitude: 40.4406,
    longitude: -79.9959,
    country: 'US',
    description: 'Provide technical support to internal users.'
  }, overrides || {});
}

function clone_(value) {
  return JSON.parse(JSON.stringify(value));
}

function result_(ctx, candidate, profile) {
  return hostify_(ctx.sandbox.filterJobCandidate_(candidate, profile));
}

describe('Phase 4B profile contract', () => {
  it('validates the approved profile and exactly mirrors the frozen JSearch catalog', () => {
    const ctx = context_();
    assert.equal(ctx.sandbox.jobProfileValidate_(ctx.sandbox.JOB_PROFILE_), true);
    assert.deepEqual(
      hostify_(ctx.sandbox.JOB_PROFILE_.sourceQueryTerms),
      ctx.testExports.JSEARCH_QUERY_CATALOG_
    );
    assert.equal(ctx.sandbox.JOB_PROFILE_.compensation.minHourlyUsd, 19);
    assert.equal(ctx.sandbox.JOB_PROFILE_.compensation.minAnnualUsd, 38000);
    assert.deepEqual(hostify_(ctx.sandbox.JOB_PROFILE_.adapters.jsearch.publishers), ['linkedin']);
  });

  it('rejects duplicate/blank terms, invalid run limits, and non-LinkedIn publishers', () => {
    const ctx = context_();
    const duplicate = clone_(ctx.sandbox.JOB_PROFILE_);
    duplicate.priorities.p1.titleTerms.push(duplicate.priorities.p1.titleTerms[0]);
    assert.throws(() => ctx.sandbox.jobProfileValidate_(duplicate), /duplicate term/);

    const blank = clone_(ctx.sandbox.JOB_PROFILE_);
    blank.optionalSkills.push('  ');
    assert.throws(() => ctx.sandbox.jobProfileValidate_(blank), /optionalSkills/);

    const fractional = clone_(ctx.sandbox.JOB_PROFILE_);
    fractional.pagesPerManualRun = 1.5;
    assert.throws(() => ctx.sandbox.jobProfileValidate_(fractional), /integer/);

    const publisher = clone_(ctx.sandbox.JOB_PROFILE_);
    publisher.adapters.jsearch.publishers.push('indeed');
    assert.throws(() => ctx.sandbox.jobProfileValidate_(publisher), /only the linkedin publisher/);
  });
});

describe('Phase 4B stable hard-exclusion order', () => {
  it('applies every exclusion category with the approved reason code', () => {
    const ctx = context_();
    const cases = [
      [{ title: 'IT Support Director', description: 'sales quotas and relocation required' }, 'EXCLUDED_SENIOR_LEADERSHIP'],
      [{ title: 'IT Support Sales Specialist', description: 'General manager' }, 'EXCLUDED_SALES'],
      [{ title: 'General Manager', description: 'Technical support' }, 'EXCLUDED_GENERAL_MANAGER'],
      [{ title: 'Kitchen Manager', description: 'Technical support' }, 'EXCLUDED_KITCHEN_MANAGER'],
      [{ description: 'Regular driving duties are required.' }, 'EXCLUDED_DRIVING'],
      [{ description: 'This role requires frequent travel.' }, 'EXCLUDED_HEAVY_TRAVEL'],
      [{ description: 'Relocation required before the start date.' }, 'EXCLUDED_RELOCATION'],
      [{ employment_types: ['PARTTIME'] }, 'EXCLUDED_EMPLOYMENT_TYPE'],
      [{ latitude: 41, longitude: -80 }, 'EXCLUDED_OUTSIDE_RADIUS'],
      [{ salary_min: 30000, salary_max: 37000 }, 'EXCLUDED_COMPENSATION']
    ];
    cases.forEach(function (entry) {
      const actual = result_(ctx, candidate_(entry[0]));
      assert.equal(actual.passed, false);
      assert.equal(actual.primaryReason, entry[1]);
      assert.equal(actual.filterVersion, 'jobfilters-v2');
    });
  });

  it('does not add unapproved clearance or medical exclusions and does not exclude bare manager', () => {
    const ctx = context_();
    const actual = result_(ctx, candidate_({
      title: 'Technical Support Manager',
      description: 'Supports a medical office. A security clearance is helpful.'
    }));
    assert.equal(actual.passed, true);
    assert.equal(actual.matchedTrack, 'p1');
  });
});

describe('Phase 4B target role and employment decisions', () => {
  it('matches p1, p2, and p3 from title only', () => {
    const ctx = context_();
    assert.equal(result_(ctx, candidate_()).matchedTrack, 'p1');
    assert.equal(result_(ctx, candidate_({ title: 'Operations Coordinator' })).matchedTrack, 'p2');
    assert.equal(result_(ctx, candidate_({ title: 'Customer Success Agent' })).matchedTrack, 'p3');

    const descriptionOnly = result_(ctx, candidate_({
      title: 'Workplace Associate',
      description: 'Performs help desk and technical support.'
    }));
    assert.equal(descriptionOnly.passed, true);
    assert.equal(descriptionOnly.matchedTrack, null);
    assert.ok(descriptionOnly.reviewFlags.includes('NO_MATCHED_TRACK'));
  });

  it('includes contract-to-hire and flags unknown employment without excluding it', () => {
    const ctx = context_();
    const cth = result_(ctx, candidate_({
      employment_types: ['CONTRACTOR'],
      description: 'This is a contract-to-hire help desk position.'
    }));
    assert.equal(cth.passed, true);

    const unknown = result_(ctx, candidate_({ employment_types: [] }));
    assert.equal(unknown.passed, true);
    assert.ok(unknown.reviewFlags.includes('EMPLOYMENT_TYPE_UNSTATED'));
  });
});

describe('Phase 4B geography and remote-jurisdiction decisions', () => {
  it('uses a strict less-than radius boundary and flags missing coordinates', () => {
    const ctx = context_();
    const edgeProfile = clone_(ctx.sandbox.JOB_PROFILE_);
    const edgeLat = 40.5406;
    edgeProfile.locations.radiusMiles = ctx.sandbox.jobFiltersDistanceMiles_(40.4406, -79.9959, edgeLat, -79.9959);
    const edge = result_(ctx, candidate_({ latitude: edgeLat, longitude: -79.9959 }), edgeProfile);
    assert.equal(edge.primaryReason, 'EXCLUDED_OUTSIDE_RADIUS');

    const missing = result_(ctx, candidate_({ latitude: null, longitude: null }));
    assert.equal(missing.passed, true);
    assert.ok(missing.reviewFlags.includes('MISSING_COORDINATES'));
  });

  it('permits remote jobs unless the listing affirmatively excludes Pennsylvania', () => {
    const ctx = context_();
    const unstated = result_(ctx, candidate_({
      remote: { value: true, label: 'Remote' },
      latitude: null,
      longitude: null,
      description: 'Remote role with flexible location.'
    }));
    assert.equal(unstated.passed, true);
    assert.ok(unstated.reviewFlags.includes('REMOTE_JURISDICTION_UNSTATED'));

    const allowed = result_(ctx, candidate_({
      remote: true,
      description: 'Applicants must reside in PA, OH, or WV.'
    }));
    assert.equal(allowed.passed, true);
    assert.ok(!allowed.reviewFlags.includes('REMOTE_JURISDICTION_UNSTATED'));

    const excluded = result_(ctx, candidate_({
      remote: true,
      description: 'This position is not available in Pennsylvania.'
    }));
    assert.equal(excluded.primaryReason, 'EXCLUDED_REMOTE_JURISDICTION');
  });
});

describe('Phase 4B compensation decisions', () => {
  it('excludes only source-provided ranges wholly below the approved floor', () => {
    const ctx = context_();
    const hourly = result_(ctx, candidate_({
      salary_min: 18, salary_max: 18.99, salary_period: 'HOUR'
    }));
    assert.equal(hourly.primaryReason, 'EXCLUDED_COMPENSATION');

    const annual = result_(ctx, candidate_({ salary_min: 37000, salary_max: 37999 }));
    assert.equal(annual.primaryReason, 'EXCLUDED_COMPENSATION');

    const straddles = result_(ctx, candidate_({ salary_min: 35000, salary_max: 45000 }));
    assert.equal(straddles.passed, true);
    assert.ok(straddles.reviewFlags.includes('COMPENSATION_RANGE_STRADDLES_MINIMUM'));
  });

  it('includes unlisted or estimated compensation and flags estimates for review', () => {
    const ctx = context_();
    const unlisted = result_(ctx, candidate_({ salary_min: null, salary_max: null, salary_source: '' }));
    assert.equal(unlisted.passed, true);

    const estimated = result_(ctx, candidate_({
      salary_min: 10, salary_max: 12, salary_source: 'estimate'
    }));
    assert.equal(estimated.passed, true);
    assert.ok(estimated.reviewFlags.includes('COMPENSATION_ESTIMATE_REVIEW'));
  });
});
