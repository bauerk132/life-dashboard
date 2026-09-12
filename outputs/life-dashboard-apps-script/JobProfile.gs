'use strict';

/**
 * Life Dashboard — Job Discovery Profile (Phase 4B)
 *
 * Defines the frozen matching profile used by JobFilters.gs to decide which
 * discovered jobs are relevant to the user, and the validator that guards
 * its shape before a discovery run is allowed to start.
 *
 * STATUS (Phase 4B foundation import, 2026-09-12): this is a placeholder.
 * The full profile values — title/synonym lists per priority, allowed
 * locations and radius, work-mode preference, compensation floors,
 * exclusion term lists, source query terms, and run limits — are defined
 * against outputs/PHASE_4_JOB_PROFILE.md (profileId
 * phase4-job-profile-v1-2026-09-11) in a follow-up commit. Nothing in this
 * file is wired into the discovery pipeline yet; JobFilters.gs and
 * Discovery.gs do not reference JOB_PROFILE_ until that commit lands.
 */

var JOB_PROFILE_ = Object.freeze({
  profileId: 'phase4-job-profile-v1-2026-09-11',
  configVersion: 0
});

/**
 * Validates the shape of a job profile object. Placeholder — expanded
 * alongside the real JOB_PROFILE_ definition to check title/synonym lists,
 * location/radius fields, compensation floors, exclusion lists, and source
 * query term coverage.
 *
 * @param {Object} profile
 * @returns {boolean} true if valid; throws otherwise.
 */
function jobProfileValidate_(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('jobProfileValidate_: profile must be an object');
  }
  if (typeof profile.profileId !== 'string' || profile.profileId.length === 0) {
    throw new Error('jobProfileValidate_: profileId must be a non-empty string');
  }
  if (typeof profile.configVersion !== 'number' || profile.configVersion < 0) {
    throw new Error('jobProfileValidate_: configVersion must be a non-negative number');
  }
  return true;
}
