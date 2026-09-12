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
  function isBoundedString(v, maxLength) {
    return typeof v === 'string' && v === v.trim() && v.length > 0 && v.length <= maxLength;
  }
  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function validateStringArray(path, value, options) {
    options = options || {};
    const maxItems = options.maxItems || 100;
    const maxLength = options.maxLength || 120;
    if (!Array.isArray(value) || value.length > maxItems || (options.required && value.length === 0)) {
      fail(path + ' must be a bounded' + (options.required ? ' non-empty' : '') + ' string array');
    }
    const seen = {};
    value.forEach(function (item, index) {
      if (!isBoundedString(item, maxLength)) fail(path + '[' + index + '] is invalid');
      const normalized = item.toLowerCase();
      if (options.lowercase && item !== normalized) fail(path + '[' + index + '] must be lowercase');
      if (seen[normalized]) fail(path + ' contains a duplicate term: ' + normalized);
      seen[normalized] = true;
    });
  }
  function validatePriority(name, node) {
    if (!node || typeof node !== 'object') fail('priorities.' + name + ' must be an object');
    validateStringArray('priorities.' + name + '.titleTerms', node.titleTerms, {
      required: true, lowercase: true, maxItems: 50
    });
  }
  function requireInteger(path, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
      fail(path + ' must be an integer from ' + min + ' through ' + max);
    }
  }

  if (!profile || typeof profile !== 'object') {
    fail('profile must be an object');
  }
  if (!isBoundedString(profile.profileId, 100)) {
    fail('profileId must be a trimmed non-empty string of 100 characters or fewer');
  }
  requireInteger('configVersion', profile.configVersion, 1, 1000000);

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
  if (locations.center.lat < -90 || locations.center.lat > 90 ||
      locations.center.lng < -180 || locations.center.lng > 180) {
    fail('locations.center coordinates are outside valid ranges');
  }
  if (!isFiniteNumber(locations.radiusMiles) || locations.radiusMiles <= 0 || locations.radiusMiles > 100) {
    fail('locations.radiusMiles must be greater than 0 and at most 100');
  }
  if (!isBoundedString(locations.remoteRequiresState, 2) ||
      locations.remoteRequiresState !== locations.remoteRequiresState.toUpperCase()) {
    fail('locations.remoteRequiresState must be a two-letter uppercase state code');
  }

  if (!profile.workMode || typeof profile.workMode !== 'object') {
    fail('workMode must be an object');
  }
  ['remotePreferred', 'onsiteAcceptable', 'hybridAcceptable'].forEach(function (key) {
    if (typeof profile.workMode[key] !== 'boolean') fail('workMode.' + key + ' must be boolean');
  });

  var comp = profile.compensation;
  if (!comp || typeof comp !== 'object' ||
      !isFiniteNumber(comp.minHourlyUsd) || comp.minHourlyUsd <= 0 ||
      !isFiniteNumber(comp.minAnnualUsd) || comp.minAnnualUsd <= 0) {
    fail('compensation must define positive numeric minHourlyUsd and minAnnualUsd');
  }

  var excl = profile.exclusionTerms;
  if (!excl || typeof excl !== 'object') fail('exclusionTerms must be an object');
  if (!excl.sales || typeof excl.sales !== 'object') fail('exclusionTerms.sales must be an object');
  validateStringArray('exclusionTerms.sales.titleTerms', excl.sales.titleTerms, { required: true, lowercase: true });
  validateStringArray('exclusionTerms.sales.dutyPhrases', excl.sales.dutyPhrases, { required: true, lowercase: true });
  ['generalManager', 'kitchenManager', 'heavyTravel', 'relocation', 'drivingDuty', 'seniorLeadership'].forEach(
    function (key) {
      validateStringArray('exclusionTerms.' + key, excl[key], { required: true, lowercase: true });
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
  validateStringArray('requiredSkills', profile.requiredSkills, { lowercase: true, maxItems: 50 });
  validateStringArray('optionalSkills', profile.optionalSkills, { lowercase: true, maxItems: 50 });

  if (!Array.isArray(profile.sourceQueryTerms) || profile.sourceQueryTerms.length === 0) {
    fail('sourceQueryTerms must be a non-empty array');
  }
  if (profile.sourceQueryTerms.length > 50) fail('sourceQueryTerms may contain at most 50 entries');
  const queryIds = {};
  profile.sourceQueryTerms.forEach(function (entry, i) {
    if (!entry || typeof entry !== 'object' ||
        !isBoundedString(entry.id, 80) ||
        (entry.priority !== 1 && entry.priority !== 2 && entry.priority !== 3) ||
        typeof entry.remote !== 'boolean' ||
        !isBoundedString(entry.query, 200)) {
      fail('sourceQueryTerms[' + i + '] must be {id, priority, remote, query}');
    }
    if (!/^[a-z0-9-]+$/.test(entry.id)) fail('sourceQueryTerms[' + i + '].id is invalid');
    if (queryIds[entry.id]) fail('sourceQueryTerms contains duplicate id: ' + entry.id);
    queryIds[entry.id] = true;
  });

  requireInteger('pagesPerScheduledRun', profile.pagesPerScheduledRun, 1, 10);
  requireInteger('pagesPerManualRun', profile.pagesPerManualRun, 1, 10);
  requireInteger('retryLimit', profile.retryLimit, 0, 5);
  requireInteger('terminalErrorDisableThreshold', profile.terminalErrorDisableThreshold, 1, 10);
  requireInteger('runtimeBudgetMs', profile.runtimeBudgetMs, 1000, 330000);

  var schedule = profile.schedule;
  if (!schedule || typeof schedule !== 'object' ||
      !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 ||
      !isBoundedString(schedule.timeZone, 100)) {
    fail('schedule must define hour (0-23) and a non-empty timeZone string');
  }

  var adapters = profile.adapters;
  if (!adapters || typeof adapters !== 'object' ||
      !adapters.jsearch || typeof adapters.jsearch !== 'object' ||
      typeof adapters.jsearch.enabled !== 'boolean' ||
      !Array.isArray(adapters.jsearch.publishers)) {
    fail('adapters.jsearch must define a boolean enabled and a string array publishers');
  }
  validateStringArray('adapters.jsearch.publishers', adapters.jsearch.publishers, {
    required: true, lowercase: true, maxItems: 5, maxLength: 40
  });
  if (adapters.jsearch.publishers.length !== 1 || adapters.jsearch.publishers[0] !== 'linkedin') {
    fail('Phase 4 permits only the linkedin publisher');
  }

  return true;
}
