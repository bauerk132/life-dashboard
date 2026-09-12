'use strict';

/**
 * Life Dashboard — Job Filters (Phase 4B)
 *
 * Implements deterministic hard filtering against the user-approved
 * job profile 'phase4-job-profile-v1-2026-09-11'.
 *
 * Evaluates candidate records in a stable, documented order:
 * 1. Hard Exclusions (commission-only, sales, door-to-door, commercial driving/CDL, clearance, medical).
 * 2. Target Role Priorities (Priority 1: IT support/helpdesk, Priority 2: Admin/Ops, Priority 3: Non-sales customer support).
 * 3. Geography & Remote Rules (< 8 miles from Downtown Pittsburgh for onsite/hybrid; PA eligible for remote).
 * 4. Compensation Floor ($19.00/hr or $39,520/yr when stated; unknown is accepted).
 *
 * All functions are private with a trailing underscore (_) to prevent
 * accidental browser exposure.
 */

const JOB_FILTERS_PROFILE_ID_ = 'phase4-job-profile-v1-2026-09-11';
const JOB_FILTERS_VERSION_ = '4B.1';

// Pittsburgh reference point: Downtown Pittsburgh, PA
const PITTSBURGH_DOWNTOWN_LAT_ = 40.4406;
const PITTSBURGH_DOWNTOWN_LON_ = -79.9959;
const MAX_ON_SITE_RADIUS_MILES_ = 8.0;

// Compensation floor
const MIN_HOURLY_RATE_ = 19.0;
const MIN_ANNUAL_SALARY_ = 39520.0; // 19.00 * 2080 hours

/**
 * Hard exclusion patterns. If matched in title or description, the job is rejected immediately.
 */
const EXCLUDED_PATTERNS_ = Object.freeze([
  {
    regex: /\b(commission\s*(?:only|based)|100%\s*commission|door[\s-]to[\s-]door|cold\s*call(?:ing)?|canvass(?:er|ing)?)\b/i,
    reason: 'EXCLUDED_COMMISSION_OR_CANVASSING'
  },
  {
    regex: /\b(commercial\s*driver|cdl[\s-]?a|cdl[\s-]?b|truck\s*driver|delivery\s*driver|route\s*driver|courier)\b/i,
    reason: 'EXCLUDED_COMMERCIAL_DRIVING'
  },
  {
    regex: /\b(active\s*(?:top\s*secret|ts[\s\/]sci|secret)\s*clearance|polygraph\s*required)\b/i,
    reason: 'EXCLUDED_SECURITY_CLEARANCE'
  },
  {
    regex: /\b(physician|registered\s*nurse|\brn\b|nurse\s*practitioner|pharmacist|dental\s*hygienist)\b/i,
    reason: 'EXCLUDED_MEDICAL_LICENSING'
  },
  {
    regex: /\b(account\s*executive|sales\s*representative|sales\s*agent|insurance\s*agent|financial\s*advisor)\b/i,
    reason: 'EXCLUDED_SALES_ROLE'
  }
]);

/**
 * Role matching patterns grouped by priority.
 */
const PRIORITY_1_PATTERNS_ = Object.freeze([
  /\b(?:it|information\s*technology)\s*(?:support|technician|specialist|analyst|associate)\b/i,
  /\b(?:help|service)\s*desk\b/i,
  /\bdesktop\s*support\b/i,
  /\btechnical\s*support\b/i,
  /\b(?:end[\s-]user|user|pc)\s*support\b/i,
  /\btech\s*support\b/i
]);

const PRIORITY_2_PATTERNS_ = Object.freeze([
  /\boffice\s*(?:administrator|coordinator|assistant|manager)\b/i,
  /\badministrative\s*(?:coordinator|assistant|specialist)\b/i,
  /\boperations\s*(?:coordinator|support|assistant|specialist)\b/i,
  /\blogistics\s*(?:coordinator|support|specialist)\b/i
]);

const PRIORITY_3_PATTERNS_ = Object.freeze([
  /\bcustomer\s*(?:support|service|care)\s*(?:representative|specialist|agent|associate)\b/i,
  /\bclient\s*support\s*(?:specialist|representative)\b/i,
  /\bmember\s*support\s*representative\b/i,
  /\bstore\s*support\s*specialist\b/i,
  /\bcustomer\s*success\s*(?:agent|representative)\b/i
]);

/**
 * Calculates great-circle distance in miles between two coordinates using Haversine formula.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in miles
 */
function calculateDistanceMiles_(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Determines target role priority for a job candidate.
 * Returns { priority: number, matched: boolean }
 *
 * @param {string} title
 * @param {string} description
 * @returns {{ priority: number, matched: boolean }}
 */
function matchRolePriority_(title, description) {
  const combined = (title + ' ' + (description || '')).toLowerCase();

  for (let i = 0; i < PRIORITY_1_PATTERNS_.length; i++) {
    if (PRIORITY_1_PATTERNS_[i].test(title) || PRIORITY_1_PATTERNS_[i].test(combined)) {
      return { priority: 1, matched: true };
    }
  }

  for (let j = 0; j < PRIORITY_2_PATTERNS_.length; j++) {
    if (PRIORITY_2_PATTERNS_[j].test(title) || PRIORITY_2_PATTERNS_[j].test(combined)) {
      return { priority: 2, matched: true };
    }
  }

  for (let k = 0; k < PRIORITY_3_PATTERNS_.length; k++) {
    if (PRIORITY_3_PATTERNS_[k].test(title) || PRIORITY_3_PATTERNS_[k].test(combined)) {
      // Rule: Customer support must not be sales/quota carrying
      if (/\b(?:sales|commission|quota|cold\s*call|lead\s*generation)\b/i.test(combined)) {
        return { priority: 3, matched: false, reason: 'EXCLUDED_SALES_IN_CUSTOMER_SUPPORT' };
      }
      return { priority: 3, matched: true };
    }
  }

  return { priority: 0, matched: false };
}

/**
 * Checks geographic eligibility for onsite/hybrid/remote jobs.
 *
 * @param {Object} candidate
 * @returns {{ eligible: boolean, reason: string|null }}
 */
function checkGeographyEligibility_(candidate) {
  const isRemote = Boolean(candidate.remote);
  const loc = (candidate.location || '').toLowerCase();
  const desc = (candidate.description || '').toLowerCase();

  if (isRemote) {
    // If explicitly remote, check that Pennsylvania is not excluded
    const excludesPA = /\b(?:excluding\s+pa|not\s+eligible\s+(?:in|for)\s+pa|excludes\s+pennsylvania)\b/i.test(desc);
    if (excludesPA) {
      return { eligible: false, reason: 'REMOTE_EXCLUDES_PENNSYLVANIA' };
    }
    return { eligible: true, reason: null };
  }

  // On-site or Hybrid: Coordinates check if available
  if (typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number') {
    const dist = calculateDistanceMiles_(
      PITTSBURGH_DOWNTOWN_LAT_,
      PITTSBURGH_DOWNTOWN_LON_,
      candidate.latitude,
      candidate.longitude
    );
    if (dist > MAX_ON_SITE_RADIUS_MILES_) {
      return { eligible: false, reason: 'DISTANCE_EXCEEDS_8_MILES' };
    }
    return { eligible: true, reason: null };
  }

  // Location string text heuristics
  if (loc.indexOf('pittsburgh') !== -1 || loc.indexOf('allegheny') !== -1) {
    return { eligible: true, reason: null };
  }

  // If outside known local boundaries
  if (loc && loc.indexOf('pa') === -1 && loc.indexOf('pennsylvania') === -1) {
    return { eligible: false, reason: 'LOCATION_OUTSIDE_TARGET_AREA' };
  }

  return { eligible: true, reason: null };
}

/**
 * Checks compensation against floor when specified.
 *
 * @param {Object} candidate
 * @returns {{ eligible: boolean, reason: string|null }}
 */
function checkCompensationFloor_(candidate) {
  const currency = (candidate.currency || '').toUpperCase();
  if (currency && currency !== 'USD') {
    return { eligible: false, reason: 'NON_USD_CURRENCY' };
  }

  const min = typeof candidate.salary_min === 'number' ? candidate.salary_min : null;
  const max = typeof candidate.salary_max === 'number' ? candidate.salary_max : null;

  if (min !== null || max !== null) {
    const val = max !== null ? max : min;
    // Heuristic: hourly vs annual
    if (val < 100) {
      if (val < MIN_HOURLY_RATE_) {
        return { eligible: false, reason: 'BELOW_HOURLY_SALARY_FLOOR' };
      }
    } else {
      if (val < MIN_ANNUAL_SALARY_) {
        return { eligible: false, reason: 'BELOW_ANNUAL_SALARY_FLOOR' };
      }
    }
  }

  // Unknown compensation is accepted for review
  return { eligible: true, reason: null };
}

/**
 * Main evaluation function for a normalized job candidate.
 * Pure function.
 *
 * @param {Object} candidate - Normalized candidate from JobSource_JSearch
 * @returns {{
 *   passed: boolean,
 *   primaryReason: string,
 *   secondaryReasons: string[],
 *   priority: number,
 *   profileId: string
 * }}
 */
function jobFiltersEvaluateCandidate_(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return {
      passed: false,
      primaryReason: 'INVALID_CANDIDATE',
      secondaryReasons: [],
      priority: 0,
      profileId: JOB_FILTERS_PROFILE_ID_
    };
  }

  const title = candidate.title || '';
  const desc = candidate.description || '';
  const secondary = [];

  // Step 1: Hard Exclusions
  for (let i = 0; i < EXCLUDED_PATTERNS_.length; i++) {
    const p = EXCLUDED_PATTERNS_[i];
    if (p.regex.test(title) || p.regex.test(desc)) {
      return {
        passed: false,
        primaryReason: p.reason,
        secondaryReasons: secondary,
        priority: 0,
        profileId: JOB_FILTERS_PROFILE_ID_
      };
    }
  }

  // Step 2: Role Priority Match
  const roleMatch = matchRolePriority_(title, desc);
  if (!roleMatch.matched) {
    return {
      passed: false,
      primaryReason: roleMatch.reason || 'ROLE_NOT_IN_PROFILE',
      secondaryReasons: secondary,
      priority: 0,
      profileId: JOB_FILTERS_PROFILE_ID_
    };
  }

  // Step 3: Geography & Work Arrangement
  const geoCheck = checkGeographyEligibility_(candidate);
  if (!geoCheck.eligible) {
    return {
      passed: false,
      primaryReason: geoCheck.reason,
      secondaryReasons: secondary,
      priority: roleMatch.priority,
      profileId: JOB_FILTERS_PROFILE_ID_
    };
  }

  // Step 4: Compensation Floor
  const compCheck = checkCompensationFloor_(candidate);
  if (!compCheck.eligible) {
    return {
      passed: false,
      primaryReason: compCheck.reason,
      secondaryReasons: secondary,
      priority: roleMatch.priority,
      profileId: JOB_FILTERS_PROFILE_ID_
    };
  }

  return {
    passed: true,
    primaryReason: 'PASSED_PROFILE_FILTERS',
    secondaryReasons: secondary,
    priority: roleMatch.priority,
    profileId: JOB_FILTERS_PROFILE_ID_
  };
}
