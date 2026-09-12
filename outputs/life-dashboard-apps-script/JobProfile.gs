'use strict';

/**
 * Life Dashboard — Job Discovery Profile (Phase 4B)
 *
 * Defines the frozen matching profile used by JobFilters.gs to decide which
 * discovered jobs are relevant to the user, and the validator that guards
 * its shape before a discovery run is allowed to start.
 *
 * Values below are drawn from the user-approved profile document
 * (profileId phase4-job-profile-v1-2026-09-11, outputs/PHASE_4_JOB_PROFILE.md).
 * No secrets. No résumé text — optionalSkills below are generic confirmed
 * keywords only, never sentences copied from a résumé file.
 *
 * sourceQueryTerms mirrors the JSearch adapter's own frozen query catalog
 * (13 entries: 8 priority-1, 3 priority-2, 2 priority-3) term-for-term, so
 * the two never drift apart silently; tests/phase4b-filters.test.js asserts
 * this equality directly against the adapter's exported catalog.
 */

var JOB_PROFILE_ = Object.freeze({
  profileId: 'phase4-job-profile-v1-2026-09-11',
  configVersion: 1,

  priorities: Object.freeze({
    p1: Object.freeze({
      titleTerms: Object.freeze([
        'it support', 'help desk', 'desktop support', 'technical support',
        'it support specialist', 'it support technician',
        'help desk technician', 'help desk analyst',
        'service desk technician', 'service desk analyst',
        'desktop support technician', 'desktop support specialist', 'desktop support analyst',
        'technical support specialist', 'technical support technician',
        'technical support representative', 'technical support agent',
        'end user support specialist', 'user support technician',
        'pc support technician', 'field support technician'
      ])
    }),
    p2: Object.freeze({
      titleTerms: Object.freeze([
        'office administration', 'office administrator', 'administrative coordinator',
        'administrative assistant', 'office coordinator',
        'operations coordinator', 'operations support specialist', 'operations assistant',
        'logistics coordinator', 'logistics support specialist'
      ])
    }),
    p3: Object.freeze({
      titleTerms: Object.freeze([
        'customer support', 'customer success',
        'customer support representative', 'customer support specialist',
        'customer service representative', 'customer service specialist',
        'customer care representative', 'customer success agent',
        'customer success representative', 'client support specialist',
        'member support representative', 'store support specialist'
      ])
    })
  }),

  locations: Object.freeze({
    center: Object.freeze({ lat: 40.4406, lng: -79.9959 }), // Downtown Pittsburgh, PA (public reference point)
    radiusMiles: 8,
    remoteRequiresState: 'PA'
  }),

  workMode: Object.freeze({
    remotePreferred: true,
    onsiteAcceptable: true,
    hybridAcceptable: true
  }),

  compensation: Object.freeze({
    minHourlyUsd: 19,
    minAnnualUsd: 38000
  }),

  exclusionTerms: Object.freeze({
    sales: Object.freeze({
      titleTerms: Object.freeze([
        'sales', 'inside sales', 'outside sales', 'retail sales', 'commission sales',
        'account executive', 'business development', 'lead generation',
        'telemarketing', 'canvassing', 'quota-carrying'
      ]),
      dutyPhrases: Object.freeze([
        'upsell', 'upselling', 'renewal quota', 'revenue quota',
        'account expansion', 'book of business', 'commission-based'
      ])
    }),
    generalManager: Object.freeze(['general manager']),
    kitchenManager: Object.freeze(['kitchen manager']),
    heavyTravel: Object.freeze([
      'heavy travel', 'frequent travel', 'extensive travel', 'significant travel',
      'up to 50% travel', 'up to 75% travel', 'travel up to 50%', 'travel up to 75%'
    ]),
    relocation: Object.freeze([
      'must relocate', 'requires relocation', 'relocation required',
      'relocation is required', 'willing to relocate is required'
    ]),
    drivingDuty: Object.freeze([
      'delivery driver', 'route driver', 'courier', 'chauffeur', 'commercial driver',
      'cdl required', 'cdl-a', 'cdl-b',
      'driving is an essential', 'driving as an essential', 'essential driving duty',
      'regular driving duties', 'field driving'
    ]),
    // Only director / VP / executive / head-of-function terms — bare "Manager"
    // is deliberately excluded (profile: manager titles are not globally
    // excluded; only General Manager and Kitchen Manager are, above).
    seniorLeadership: Object.freeze([
      'director', 'vice president', 'vp', 'executive',
      'chief', 'c-level', 'cxo', 'head of'
    ])
  }),

  experienceFloorYears: null,
  experienceCeilingYears: null,

  requiredSkills: Object.freeze([]),

  // Generic confirmed keywords only — no résumé sentences.
  optionalSkills: Object.freeze([
    'help desk', 'ticketing systems', 'technical support', 'customer support',
    'office administration', 'operations coordination', 'logistics coordination',
    'windows support', 'remote support tools'
  ]),

  sourceQueryTerms: Object.freeze([
    Object.freeze({ id: 'p1-helpdesk-pgh', priority: 1, remote: false, query: 'help desk technician in Pittsburgh, PA' }),
    Object.freeze({ id: 'p1-itsupport-pgh', priority: 1, remote: false, query: 'IT support specialist in Pittsburgh, PA' }),
    Object.freeze({ id: 'p1-desktop-pgh', priority: 1, remote: false, query: 'desktop support technician in Pittsburgh, PA' }),
    Object.freeze({ id: 'p1-techsupport-pgh', priority: 1, remote: false, query: 'technical support specialist in Pittsburgh, PA' }),
    Object.freeze({ id: 'p1-servicedesk-pgh', priority: 1, remote: false, query: 'service desk analyst in Pittsburgh, PA' }),
    Object.freeze({ id: 'p1-helpdesk-remote', priority: 1, remote: true, query: 'remote help desk technician' }),
    Object.freeze({ id: 'p1-itsupport-remote', priority: 1, remote: true, query: 'remote IT support specialist' }),
    Object.freeze({ id: 'p1-techsupport-remote', priority: 1, remote: true, query: 'remote technical support specialist' }),
    Object.freeze({ id: 'p2-officeadmin-pgh', priority: 2, remote: false, query: 'office administrator in Pittsburgh, PA' }),
    Object.freeze({ id: 'p2-opscoord-pgh', priority: 2, remote: false, query: 'operations coordinator in Pittsburgh, PA' }),
    Object.freeze({ id: 'p2-logistics-pgh', priority: 2, remote: false, query: 'logistics coordinator in Pittsburgh, PA' }),
    Object.freeze({ id: 'p3-custsupport-pgh', priority: 3, remote: false, query: 'customer support specialist in Pittsburgh, PA' }),
    Object.freeze({ id: 'p3-custsupport-remote', priority: 3, remote: true, query: 'remote customer support representative' })
  ]),

  pagesPerScheduledRun: 5,
  pagesPerManualRun: 3,
  retryLimit: 2,
  terminalErrorDisableThreshold: 2,
  runtimeBudgetMs: 270000,

  schedule: Object.freeze({ hour: 7, timeZone: 'America/New_York' }),

  adapters: Object.freeze({
    jsearch: Object.freeze({ enabled: true, publishers: Object.freeze(['linkedin']) })
  })
});

/**
 * Validates the shape of a job profile object before a discovery run is
 * allowed to start. Throws a descriptive Error on any structural problem;
 * returns true when the profile is well-formed.
 *
 * @param {Object} profile
 * @returns {boolean} true if valid; throws otherwise.
 */
function jobProfileValidate_(profile) {
  function fail(msg) {
    throw new Error('jobProfileValidate_: ' + msg);
  }
  function isNonEmptyString(v) {
    return typeof v === 'string' && v.length > 0;
  }
  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function isStringArray(v) {
    return Array.isArray(v) && v.every(function (item) { return typeof item === 'string'; });
  }
  function validatePriority(name, node) {
    if (!node || typeof node !== 'object') fail('priorities.' + name + ' must be an object');
    if (!isStringArray(node.titleTerms) || node.titleTerms.length === 0) {
      fail('priorities.' + name + '.titleTerms must be a non-empty array of strings');
    }
  }

  if (!profile || typeof profile !== 'object') {
    fail('profile must be an object');
  }
  if (!isNonEmptyString(profile.profileId)) {
    fail('profileId must be a non-empty string');
  }
  if (typeof profile.configVersion !== 'number' || profile.configVersion < 0) {
    fail('configVersion must be a non-negative number');
  }

  if (!profile.priorities || typeof profile.priorities !== 'object') {
    fail('priorities must be an object with p1/p2/p3 entries');
  }
  validatePriority('p1', profile.priorities.p1);
  validatePriority('p2', profile.priorities.p2);
  validatePriority('p3', profile.priorities.p3);

  var locations = profile.locations;
  if (!locations || typeof locations !== 'object') fail('locations must be an object');
  if (!locations.center || typeof locations.center !== 'object' ||
      !isFiniteNumber(locations.center.lat) || !isFiniteNumber(locations.center.lng)) {
    fail('locations.center must be an object with finite lat/lng numbers');
  }
  if (!isFiniteNumber(locations.radiusMiles) || locations.radiusMiles <= 0) {
    fail('locations.radiusMiles must be a positive number');
  }
  if (!isNonEmptyString(locations.remoteRequiresState)) {
    fail('locations.remoteRequiresState must be a non-empty string');
  }

  if (!profile.workMode || typeof profile.workMode !== 'object') {
    fail('workMode must be an object');
  }

  var comp = profile.compensation;
  if (!comp || typeof comp !== 'object' ||
      !isFiniteNumber(comp.minHourlyUsd) || comp.minHourlyUsd <= 0 ||
      !isFiniteNumber(comp.minAnnualUsd) || comp.minAnnualUsd <= 0) {
    fail('compensation must define positive numeric minHourlyUsd and minAnnualUsd');
  }

  var excl = profile.exclusionTerms;
  if (!excl || typeof excl !== 'object') fail('exclusionTerms must be an object');
  if (!excl.sales || typeof excl.sales !== 'object' ||
      !isStringArray(excl.sales.titleTerms) || !isStringArray(excl.sales.dutyPhrases)) {
    fail('exclusionTerms.sales must have titleTerms and dutyPhrases string arrays');
  }
  ['generalManager', 'kitchenManager', 'heavyTravel', 'relocation', 'drivingDuty', 'seniorLeadership'].forEach(
    function (key) {
      if (!isStringArray(excl[key])) {
        fail('exclusionTerms.' + key + ' must be a string array');
      }
    }
  );
  if (excl.seniorLeadership.some(function (term) { return term.trim().toLowerCase() === 'manager'; })) {
    fail('exclusionTerms.seniorLeadership must not contain bare "manager"');
  }

  if (profile.experienceFloorYears !== null && !isFiniteNumber(profile.experienceFloorYears)) {
    fail('experienceFloorYears must be null or a finite number');
  }
  if (profile.experienceCeilingYears !== null && !isFiniteNumber(profile.experienceCeilingYears)) {
    fail('experienceCeilingYears must be null or a finite number');
  }
  if (!isStringArray(profile.requiredSkills)) fail('requiredSkills must be a string array');
  if (!isStringArray(profile.optionalSkills)) fail('optionalSkills must be a string array');

  if (!Array.isArray(profile.sourceQueryTerms) || profile.sourceQueryTerms.length === 0) {
    fail('sourceQueryTerms must be a non-empty array');
  }
  profile.sourceQueryTerms.forEach(function (entry, i) {
    if (!entry || typeof entry !== 'object' ||
        !isNonEmptyString(entry.id) ||
        (entry.priority !== 1 && entry.priority !== 2 && entry.priority !== 3) ||
        typeof entry.remote !== 'boolean' ||
        !isNonEmptyString(entry.query)) {
      fail('sourceQueryTerms[' + i + '] must be {id, priority, remote, query}');
    }
  });

  ['pagesPerScheduledRun', 'pagesPerManualRun', 'retryLimit',
    'terminalErrorDisableThreshold', 'runtimeBudgetMs'].forEach(function (key) {
    if (!isFiniteNumber(profile[key]) || profile[key] < 0) {
      fail(key + ' must be a non-negative number');
    }
  });

  var schedule = profile.schedule;
  if (!schedule || typeof schedule !== 'object' ||
      !isFiniteNumber(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 ||
      !isNonEmptyString(schedule.timeZone)) {
    fail('schedule must define hour (0-23) and a non-empty timeZone string');
  }

  var adapters = profile.adapters;
  if (!adapters || typeof adapters !== 'object' ||
      !adapters.jsearch || typeof adapters.jsearch !== 'object' ||
      typeof adapters.jsearch.enabled !== 'boolean' ||
      !isStringArray(adapters.jsearch.publishers)) {
    fail('adapters.jsearch must define a boolean enabled and a string array publishers');
  }

  return true;
}
