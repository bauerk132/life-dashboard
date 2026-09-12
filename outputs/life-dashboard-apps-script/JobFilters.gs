'use strict';

/**
 * Phase 4B deterministic hard filters.
 *
 * This file never searches the web and never scores a candidate. It applies
 * the approved profile in a stable exclusion order and returns auditable
 * reason codes. A title-track miss is reviewable, not a hard exclusion.
 */

const JOB_FILTERS_PROFILE_ID_ = 'phase4-job-profile-v1-2026-09-11';
const JOB_FILTERS_VERSION_ = 'jobfilters-v2';

function jobFiltersText_(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return text.charAt(0) === '\'' ? text.slice(1) : text;
}

function jobFiltersNormalize_(value) {
  return jobFiltersText_(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jobFiltersContainsTerm_(normalizedText, term) {
  const normalizedTerm = jobFiltersNormalize_(term);
  if (!normalizedText || !normalizedTerm) return false;
  return (' ' + normalizedText + ' ').indexOf(' ' + normalizedTerm + ' ') !== -1;
}

function jobFiltersContainsAny_(normalizedText, terms) {
  return terms.some(function (term) {
    return jobFiltersContainsTerm_(normalizedText, term);
  });
}

function jobFiltersUniquePush_(list, value) {
  if (list.indexOf(value) === -1) list.push(value);
}

function jobFiltersRemoteValue_(rawRemote) {
  if (rawRemote && typeof rawRemote === 'object' && typeof rawRemote.value === 'boolean') {
    return rawRemote.value;
  }
  return normalizeRemote_(rawRemote).value;
}

function jobFiltersDistanceMiles_(lat1, lng1, lat2, lng2) {
  const earthRadiusMiles = 3958.8;
  const toRadians = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRadians;
  const dLng = (lng2 - lng1) * toRadians;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRadians) * Math.cos(lat2 * toRadians) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function jobFiltersMatchTrack_(title, profile) {
  const order = ['p1', 'p2', 'p3'];
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    if (jobFiltersContainsAny_(title, profile.priorities[key].titleTerms)) return key;
  }
  return null;
}

function jobFiltersFailure_(reason, flags, track, profile) {
  return {
    passed: false,
    primaryReason: reason,
    secondaryReasons: flags.slice(),
    reviewFlags: flags.slice(),
    matchedTrack: track,
    profileVersion: profile.profileId,
    filterVersion: JOB_FILTERS_VERSION_
  };
}

function jobFiltersSuccess_(flags, track, profile) {
  return {
    passed: true,
    primaryReason: null,
    secondaryReasons: flags.slice(),
    reviewFlags: flags.slice(),
    matchedTrack: track,
    profileVersion: profile.profileId,
    filterVersion: JOB_FILTERS_VERSION_
  };
}

function jobFiltersEmploymentDecision_(candidate, combinedText, flags) {
  const rawTypes = Array.isArray(candidate.employment_types) ? candidate.employment_types : [];
  const types = rawTypes.map(function (value) {
    return jobFiltersNormalize_(value).replace(/ /g, '_').toUpperCase();
  }).filter(Boolean);

  if (types.length === 0) {
    jobFiltersUniquePush_(flags, 'EMPLOYMENT_TYPE_UNSTATED');
    return null;
  }

  const conversion = jobFiltersContainsAny_(combinedText, [
    'contract to hire', 'contract-to-hire', 'temp to perm',
    'temporary to permanent', 'conversion to full time'
  ]);
  const allowed = types.some(function (type) {
    return type === 'FULLTIME' || type === 'FULL_TIME' || type === 'CONTRACT_TO_HIRE';
  }) || conversion;
  if (allowed) return null;

  const disallowed = types.some(function (type) {
    return [
      'PARTTIME', 'PART_TIME', 'TEMP', 'TEMPORARY', 'SEASONAL',
      'INTERN', 'INTERNSHIP', 'VOLUNTEER', 'CONTRACT', 'CONTRACTOR'
    ].indexOf(type) !== -1;
  });
  return disallowed ? 'EXCLUDED_EMPLOYMENT_TYPE' : null;
}

function jobFiltersRemoteRestriction_(candidate, description, profile, flags) {
  const requiredState = profile.locations.remoteRequiresState.toLowerCase();
  const requiredName = requiredState === 'pa' ? 'pennsylvania' : requiredState;
  const country = jobFiltersNormalize_(candidate.country);
  if (country && ['us', 'usa', 'united states', 'united states of america'].indexOf(country) === -1) {
    return 'EXCLUDED_REMOTE_JURISDICTION';
  }

  const text = jobFiltersText_(description).toLowerCase();
  const stateToken = new RegExp('\\b(?:' + requiredState + '|' + requiredName + ')\\b', 'i');
  const explicitlyExcluded = new RegExp(
    '(?:excluding|except|not eligible in|cannot reside in|not available in)\\s+(?:the state of\\s+)?(?:' +
      requiredState + '|' + requiredName + ')\\b|\\b(?:' + requiredState + '|' + requiredName +
      ')\\b\\s+(?:residents?\\s+)?(?:are\\s+)?(?:not eligible|excluded)',
    'i'
  );
  if (explicitlyExcluded.test(text)) return 'EXCLUDED_REMOTE_JURISDICTION';

  const restriction = /(?:must reside|must live|eligible states?|available only in|authorized in(?: the following)? states?|residents? of)\b([^.;\n]{0,180})/i.exec(text);
  if (restriction) {
    const clause = restriction[0];
    if (stateToken.test(clause) || /\b(?:united states|usa|nationwide)\b/i.test(clause)) return null;
    return 'EXCLUDED_REMOTE_JURISDICTION';
  }

  jobFiltersUniquePush_(flags, 'REMOTE_JURISDICTION_UNSTATED');
  return null;
}

function jobFiltersGeographyDecision_(candidate, description, profile, flags) {
  if (jobFiltersRemoteValue_(candidate.remote)) {
    return jobFiltersRemoteRestriction_(candidate, description, profile, flags);
  }

  const lat = candidate.latitude;
  const lng = candidate.longitude;
  if (typeof lat !== 'number' || !isFinite(lat) || typeof lng !== 'number' || !isFinite(lng)) {
    jobFiltersUniquePush_(flags, 'MISSING_COORDINATES');
    return null;
  }
  const distance = jobFiltersDistanceMiles_(
    profile.locations.center.lat,
    profile.locations.center.lng,
    lat,
    lng
  );
  // The approved boundary is strictly less than eight miles.
  return distance >= profile.locations.radiusMiles ? 'EXCLUDED_OUTSIDE_RADIUS' : null;
}

function jobFiltersCompensationDecision_(candidate, profile, flags) {
  const min = typeof candidate.salary_min === 'number' && isFinite(candidate.salary_min)
    ? candidate.salary_min : null;
  const max = typeof candidate.salary_max === 'number' && isFinite(candidate.salary_max)
    ? candidate.salary_max : null;
  if (min === null && max === null) return null;

  if (candidate.salary_source !== 'provider') {
    jobFiltersUniquePush_(flags, 'COMPENSATION_ESTIMATE_REVIEW');
    return null;
  }
  if (jobFiltersText_(candidate.currency).toUpperCase() !== 'USD') {
    jobFiltersUniquePush_(flags, 'COMPENSATION_UNIT_UNCLEAR');
    return null;
  }

  const period = jobFiltersText_(candidate.salary_period).toUpperCase();
  let floor;
  if (period === 'HOUR' || period === 'HOURLY') {
    floor = profile.compensation.minHourlyUsd;
  } else if (period === 'YEAR' || period === 'ANNUAL' || period === 'YEARLY') {
    floor = profile.compensation.minAnnualUsd;
  } else {
    jobFiltersUniquePush_(flags, 'COMPENSATION_UNIT_UNCLEAR');
    return null;
  }

  const lower = min !== null ? min : max;
  const upper = max !== null ? max : min;
  if (upper < floor) return 'EXCLUDED_COMPENSATION';
  if (lower < floor && upper >= floor) {
    jobFiltersUniquePush_(flags, 'COMPENSATION_RANGE_STRADDLES_MINIMUM');
  }
  return null;
}

/**
 * Applies the frozen Phase 4 profile to one normalized source candidate.
 *
 * Exclusion order:
 * senior leadership, sales, general manager, kitchen manager, driving,
 * heavy travel, relocation, employment type, geography, compensation.
 */
function filterJobCandidate_(candidate, profile) {
  const activeProfile = profile || JOB_PROFILE_;
  jobProfileValidate_(activeProfile);
  const flags = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return jobFiltersFailure_('INVALID_CANDIDATE', flags, null, activeProfile);
  }

  const title = jobFiltersNormalize_(candidate.title);
  const description = jobFiltersNormalize_(candidate.description);
  const combined = (title + ' ' + description).trim();
  if (!title) return jobFiltersFailure_('INVALID_CANDIDATE', flags, null, activeProfile);

  const exclusions = activeProfile.exclusionTerms;
  if (jobFiltersContainsAny_(title, exclusions.seniorLeadership)) {
    return jobFiltersFailure_('EXCLUDED_SENIOR_LEADERSHIP', flags, null, activeProfile);
  }
  if (jobFiltersContainsAny_(title, exclusions.sales.titleTerms) ||
      jobFiltersContainsAny_(description, exclusions.sales.dutyPhrases)) {
    return jobFiltersFailure_('EXCLUDED_SALES', flags, null, activeProfile);
  }
  if (jobFiltersContainsAny_(title, exclusions.generalManager)) {
    return jobFiltersFailure_('EXCLUDED_GENERAL_MANAGER', flags, null, activeProfile);
  }
  if (jobFiltersContainsAny_(title, exclusions.kitchenManager)) {
    return jobFiltersFailure_('EXCLUDED_KITCHEN_MANAGER', flags, null, activeProfile);
  }
  if (jobFiltersContainsAny_(combined, exclusions.drivingDuty)) {
    return jobFiltersFailure_('EXCLUDED_DRIVING', flags, null, activeProfile);
  }
  if (jobFiltersContainsAny_(combined, exclusions.heavyTravel)) {
    return jobFiltersFailure_('EXCLUDED_HEAVY_TRAVEL', flags, null, activeProfile);
  }
  if (jobFiltersContainsAny_(combined, exclusions.relocation)) {
    return jobFiltersFailure_('EXCLUDED_RELOCATION', flags, null, activeProfile);
  }

  let reason = jobFiltersEmploymentDecision_(candidate, combined, flags);
  if (reason) return jobFiltersFailure_(reason, flags, null, activeProfile);

  reason = jobFiltersGeographyDecision_(candidate, description, activeProfile, flags);
  if (reason) return jobFiltersFailure_(reason, flags, null, activeProfile);

  reason = jobFiltersCompensationDecision_(candidate, activeProfile, flags);
  if (reason) return jobFiltersFailure_(reason, flags, null, activeProfile);

  const track = jobFiltersMatchTrack_(title, activeProfile);
  if (!track) jobFiltersUniquePush_(flags, 'NO_MATCHED_TRACK');
  return jobFiltersSuccess_(flags, track, activeProfile);
}
