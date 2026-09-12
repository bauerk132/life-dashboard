'use strict';

/**
 * Applications.gs — Phase 5 Application workflow state machine.
 *
 * Implements candidate application tracking (Draft, Applied, Interview, Offer,
 * Rejected, Withdrawn) with strict transitions, single active application
 * constraint per job_id, atomic synchronization with Jobs.status, and
 * append-only audit logging in ApplicationHistory.
 *
 * Strictly manual workflow tracking: zero automated external actions, zero
 * outbound HTTP/email calls, zero Calendar mutation.
 */

const APPLICATION_STATUSES_ = Object.freeze([
  'Draft', 'Applied', 'Interview', 'Offer', 'Rejected', 'Withdrawn'
]);

const ACTIVE_APPLICATION_STATUSES_ = Object.freeze([
  'Draft', 'Applied', 'Interview', 'Offer'
]);

const TERMINAL_APPLICATION_STATUSES_ = Object.freeze([
  'Rejected', 'Withdrawn'
]);

const APPLICATION_TRANSITIONS_ = Object.freeze({
  'Draft': Object.freeze(['Applied', 'Withdrawn']),
  'Applied': Object.freeze(['Interview', 'Rejected', 'Withdrawn']),
  'Interview': Object.freeze(['Offer', 'Rejected', 'Withdrawn']),
  'Offer': Object.freeze(['Rejected', 'Withdrawn']),
  'Rejected': Object.freeze([]),
  'Withdrawn': Object.freeze([])
});

const APPLICATION_LIMITS_ = Object.freeze({
  CONTACT_NAME_MAX_LENGTH: 150,
  CONTACT_EMAIL_MAX_LENGTH: 254,
  OUTCOME_MAX_LENGTH: 500,
  NOTE_MAX_LENGTH: 2000
});

function getApplicationStatuses_() {
  return APPLICATION_STATUSES_;
}

function getApplicationTransitions_() {
  return APPLICATION_TRANSITIONS_;
}

function isNonBlankAppString_(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function sanitizePlainText_(text, maxLength, fieldName) {
  if (text === null || text === undefined || text === '') return '';
  if (typeof text !== 'string') text = String(text);
  let trimmed = text.trim();
  if (maxLength && trimmed.length > maxLength) {
    throw UserError_(fieldName + ' must be ' + maxLength + ' characters or fewer.', 'INVALID_FIELD');
  }
  if (/^[=+\-@]/.test(trimmed)) {
    trimmed = "'" + trimmed;
  }
  return trimmed;
}

function validateContactEmail_(email) {
  if (email === null || email === undefined || email === '') return '';
  if (typeof email !== 'string') {
    throw UserError_('Invalid contact email.', 'INVALID_FIELD');
  }
  const trimmed = email.trim();
  if (trimmed.length > APPLICATION_LIMITS_.CONTACT_EMAIL_MAX_LENGTH) {
    throw UserError_('Contact email must be 254 characters or fewer.', 'INVALID_FIELD');
  }
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    throw UserError_('A valid email address is required for contact email.', 'INVALID_FIELD');
  }
  return trimmed;
}

function validateIsoTimestamp_(value, fieldName) {
  if (value === null || value === undefined || value === '') return '';
  const isDate = typeof isDateValue_ === 'function'
    ? isDateValue_(value)
    : Object.prototype.toString.call(value) === '[object Date]';
  if (isDate) {
    return value.toISOString();
  }
  if (typeof value !== 'string') {
    throw UserError_(fieldName + ' must be a valid ISO-8601 string.', 'INVALID_FIELD');
  }
  const trimmed = value.trim();
  if (!trimmed) return '';
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw UserError_(fieldName + ' must be a valid ISO-8601 date format.', 'INVALID_FIELD');
  }
  const year = date.getUTCFullYear();
  if (year < 2020 || year > 2050) {
    throw UserError_(fieldName + ' is out of valid range (2020-2050).', 'INVALID_FIELD');
  }
  return date.toISOString();
}

function appendNoteLine_(existingNotes, newNote) {
  const timestamp = new Date().toISOString();
  const cleanNote = sanitizePlainText_(newNote, APPLICATION_LIMITS_.NOTE_MAX_LENGTH, 'Notes');
  const line = '[' + timestamp + '] ' + cleanNote;
  return existingNotes ? existingNotes + '\n' + line : line;
}

function transitionActionName_(fromStatus, toStatus) {
  if (toStatus === 'Applied') return 'submit_application';
  if (toStatus === 'Interview') return 'advance_to_interview';
  if (toStatus === 'Offer') return 'receive_offer';
  if (toStatus === 'Rejected') return 'reject_application';
  if (toStatus === 'Withdrawn') return 'withdraw_application';
  return 'change_status';
}

function findUniqueApplicationById_(ss, applicationId) {
  if (!isNonBlankAppString_(applicationId)) {
    throw UserError_('An application id is required.', 'INVALID_ID');
  }
  const matches = readRows_(ss, 'Applications').filter(function (app) {
    return String(app.id) === String(applicationId);
  });
  if (matches.length === 0) {
    throw UserError_('Application not found.', 'APPLICATION_NOT_FOUND');
  }
  if (matches.length > 1) {
    throw UserError_('Multiple applications share this id. No change was made.', 'INTEGRITY_ERROR');
  }
  return matches[0];
}

function findJobInDb_(ss, jobId) {
  if (typeof findUniqueJobById_ === 'function') {
    return findUniqueJobById_(ss, jobId);
  }
  if (!isNonBlankAppString_(jobId)) {
    throw UserError_('A job id is required.', 'INVALID_ID');
  }
  const matches = readRows_(ss, 'Jobs').filter(function (job) {
    return String(job.id) === String(jobId);
  });
  if (matches.length === 0) throw UserError_('Job not found.', 'NOT_FOUND');
  if (matches.length > 1) {
    throw UserError_('Multiple stored jobs share this id. No change was made.', 'INTEGRITY_ERROR');
  }
  return matches[0];
}

function syncJobStatusFromApplication_(ss, jobId, targetAppStatus, note, currentJobOverride) {
  const currentJob = currentJobOverride || findJobInDb_(ss, jobId);
  let targetJobStatus = null;

  if (targetAppStatus === 'Draft') {
    if (currentJob.status === 'Saved') {
      targetJobStatus = 'Ready to Apply';
    }
  } else if (targetAppStatus === 'Applied') {
    targetJobStatus = 'Applied';
  } else if (targetAppStatus === 'Interview') {
    targetJobStatus = 'Interview';
  } else if (targetAppStatus === 'Offer') {
    targetJobStatus = 'Offer';
  } else if (targetAppStatus === 'Rejected') {
    targetJobStatus = 'Rejected';
  } else if (targetAppStatus === 'Withdrawn') {
    if (['Applied', 'Interview', 'Offer', 'Ready to Apply'].indexOf(currentJob.status) !== -1) {
      targetJobStatus = 'Rejected';
    }
  }

  if (!targetJobStatus || currentJob.status === targetJobStatus) {
    return currentJob;
  }

  const jobUpdates = {
    status: targetJobStatus,
    record_version: typeof nextJobRecordVersion_ === 'function'
      ? nextJobRecordVersion_(currentJob.record_version)
      : (Number(currentJob.record_version || 0) + 1)
  };

  const updatedJob = updateRecordByIdInDb_(ss, 'Jobs', jobId, jobUpdates, function (fresh) {
    if (fresh.status !== currentJob.status) {
      throw UserError_('Job status changed concurrently. Sync aborted.', 'CONFLICT');
    }
  });

  appendRecordInDb_(ss, 'JobHistory', {
    id: typeof generateUUID_ === 'function' ? generateUUID_() : Utilities.getUuid(),
    job_id: jobId,
    action: targetAppStatus === 'Withdrawn' ? 'withdraw_application' : 'sync_application_status',
    from_status: currentJob.status,
    to_status: targetJobStatus,
    note: note || ('Synchronized from application status ' + targetAppStatus),
    created_at: new Date()
  });

  return updatedJob;
}

function updateApplicationMetadata_(ss, currentApp, data) {
  const now = new Date();
  const patch = { updated_at: now };
  let hasChanges = false;

  if (data.applied_at !== undefined && currentApp.status !== 'Draft') {
    patch.applied_at = validateIsoTimestamp_(data.applied_at, 'applied_at');
    hasChanges = true;
  }
  if (data.follow_up_at !== undefined) {
    patch.follow_up_at = validateIsoTimestamp_(data.follow_up_at, 'follow_up_at');
    hasChanges = true;
  }
  if (data.interview_at !== undefined) {
    patch.interview_at = validateIsoTimestamp_(data.interview_at, 'interview_at');
    hasChanges = true;
  }
  if (data.contact_name !== undefined) {
    patch.contact_name = sanitizePlainText_(data.contact_name, APPLICATION_LIMITS_.CONTACT_NAME_MAX_LENGTH, 'Contact name');
    hasChanges = true;
  }
  if (data.contact_email !== undefined) {
    patch.contact_email = validateContactEmail_(data.contact_email);
    hasChanges = true;
  }
  if (data.outcome !== undefined) {
    patch.outcome = sanitizePlainText_(data.outcome, APPLICATION_LIMITS_.OUTCOME_MAX_LENGTH, 'Outcome');
    hasChanges = true;
  }
  if (isNonBlankAppString_(data.notes)) {
    patch.notes = appendNoteLine_(currentApp.notes, data.notes);
    hasChanges = true;
  }

  if (!hasChanges) return currentApp;

  const updated = updateRecordByIdInDb_(ss, 'Applications', currentApp.id, patch);

  appendRecordInDb_(ss, 'ApplicationHistory', {
    id: typeof generateUUID_ === 'function' ? generateUUID_() : Utilities.getUuid(),
    application_id: currentApp.id,
    job_id: currentApp.job_id,
    action: data.notes && !data.contact_name && !data.contact_email ? 'add_note' : 'update_metadata',
    from_status: currentApp.status,
    to_status: currentApp.status,
    note: data.notes ? data.notes.trim() : 'Updated application metadata',
    created_at: now
  });

  return updated;
}

/**
 * Creates a new application record for a job under script lock.
 * Enforces single active application constraint per job_id.
 * Synchronizes linked Jobs status and logs initial history event.
 *
 * @param {string} jobId - Required ID of the existing Job.
 * @param {string} [initialStatus='Draft'] - Initial status: 'Draft' or 'Applied'.
 * @param {Object|string} [applicationData={}] - Optional application fields or note string.
 * @returns {Object} Stored application object conforming to SCHEMA.Applications.
 * @throws {UserError_} If validation fails, active app exists, or lock times out.
 */
function createApplication_(jobId, initialStatus, applicationData) {
  if (!isNonBlankAppString_(jobId)) {
    throw UserError_('A job id is required.', 'INVALID_ID');
  }

  const status = isNonBlankAppString_(initialStatus) ? initialStatus.trim() : 'Draft';
  if (['Draft', 'Applied'].indexOf(status) === -1) {
    throw UserError_('Initial application status must be Draft or Applied.', 'INVALID_STATUS');
  }

  let data = applicationData || {};
  if (typeof data === 'string') {
    data = { notes: data };
  }

  return withLock_(15000, function () {
    const ss = getDb_();

    // Verify required schemas up front
    getVerifiedSheet_(ss, 'Applications');
    getVerifiedSheet_(ss, 'Jobs');
    getVerifiedSheet_(ss, 'JobHistory');
    getVerifiedSheet_(ss, 'ApplicationHistory');

    // 1. Verify Job exists
    const job = findJobInDb_(ss, jobId);

    // 2. Enforce Single Active Application Rule
    const existingApps = readRows_(ss, 'Applications').filter(function (app) {
      return String(app.job_id) === String(jobId);
    });
    const activeApp = existingApps.filter(function (app) {
      return ACTIVE_APPLICATION_STATUSES_.indexOf(app.status) !== -1;
    })[0];

    if (activeApp) {
      throw UserError_(
        'An active application already exists for this job (' + activeApp.id + ' in status ' + activeApp.status + ').',
        'DUPLICATE_ACTIVE_APPLICATION'
      );
    }

    // 3. Validate & Sanitize fields
    const now = new Date();
    const appliedAt = status === 'Applied'
      ? (data.applied_at ? validateIsoTimestamp_(data.applied_at, 'applied_at') : now.toISOString())
      : '';
    const followUpAt = validateIsoTimestamp_(data.follow_up_at, 'follow_up_at');
    const interviewAt = validateIsoTimestamp_(data.interview_at, 'interview_at');
    const contactName = sanitizePlainText_(data.contact_name, APPLICATION_LIMITS_.CONTACT_NAME_MAX_LENGTH, 'Contact name');
    const contactEmail = validateContactEmail_(data.contact_email);
    const outcome = sanitizePlainText_(data.outcome, APPLICATION_LIMITS_.OUTCOME_MAX_LENGTH, 'Outcome');
    const initialNote = data.notes ? sanitizePlainText_(data.notes, APPLICATION_LIMITS_.NOTE_MAX_LENGTH, 'Notes') : '';

    const newAppId = typeof generateUUID_ === 'function' ? generateUUID_() : Utilities.getUuid();

    const appRecord = {
      id: newAppId,
      job_id: jobId,
      status: status,
      applied_at: appliedAt,
      follow_up_at: followUpAt,
      contact_name: contactName,
      contact_email: contactEmail,
      interview_at: interviewAt,
      outcome: outcome,
      notes: initialNote ? '[' + now.toISOString() + '] ' + initialNote : '',
      created_at: now,
      updated_at: now
    };

    // 4. Synchronize with Jobs
    syncJobStatusFromApplication_(ss, jobId, status, initialNote || ('Application created in status ' + status), job);

    // 5. Append to Applications
    const storedApp = appendRecordInDb_(ss, 'Applications', appRecord);

    // 6. Append to ApplicationHistory
    appendRecordInDb_(ss, 'ApplicationHistory', {
      id: typeof generateUUID_ === 'function' ? generateUUID_() : Utilities.getUuid(),
      application_id: newAppId,
      job_id: jobId,
      action: 'create_application',
      from_status: '',
      to_status: status,
      note: initialNote || ('Application created in status ' + status),
      created_at: now
    });

    return storedApp;
  });
}

/**
 * Transitions an application to a new status and optionally updates metadata.
 * Validates transition legality, synchronizes Jobs.status, and appends audit record.
 *
 * @param {string} applicationId - Required ID of the Application.
 * @param {string} targetStatus - Required target status from APPLICATION_STATUSES_.
 * @param {Object|string} [updateData={}] - Optional metadata updates or note string.
 * @returns {Object} Stored application object after update.
 * @throws {UserError_} On invalid transition, missing record, or validation error.
 */
function updateApplicationStatus_(applicationId, targetStatus, updateData) {
  if (!isNonBlankAppString_(applicationId)) {
    throw UserError_('An application id is required.', 'INVALID_ID');
  }
  if (!isNonBlankAppString_(targetStatus) || APPLICATION_STATUSES_.indexOf(targetStatus) === -1) {
    throw UserError_('That application status is not recognized.', 'INVALID_STATUS');
  }

  let data = updateData || {};
  if (typeof data === 'string') {
    data = { notes: data };
  }

  return withLock_(15000, function () {
    const ss = getDb_();

    getVerifiedSheet_(ss, 'Applications');
    getVerifiedSheet_(ss, 'Jobs');
    getVerifiedSheet_(ss, 'JobHistory');
    getVerifiedSheet_(ss, 'ApplicationHistory');

    const currentApp = findUniqueApplicationById_(ss, applicationId);
    const currentStatus = currentApp.status;

    // Idempotent self-transition handling
    if (currentStatus === targetStatus) {
      if (!Object.keys(data).length) {
        return currentApp;
      }
      return updateApplicationMetadata_(ss, currentApp, data);
    }

    // Transition matrix check
    const allowedTargets = APPLICATION_TRANSITIONS_[currentStatus];
    if (!allowedTargets || allowedTargets.indexOf(targetStatus) === -1) {
      throw UserError_(
        'Cannot transition application from ' + currentStatus + ' to ' + targetStatus + '.',
        'INVALID_TRANSITION'
      );
    }

    // Check if targetStatus is active and another active application exists
    if (ACTIVE_APPLICATION_STATUSES_.indexOf(targetStatus) !== -1) {
      const conflicting = readRows_(ss, 'Applications').filter(function (app) {
        return String(app.job_id) === String(currentApp.job_id) &&
               String(app.id) !== String(applicationId) &&
               ACTIVE_APPLICATION_STATUSES_.indexOf(app.status) !== -1;
      })[0];
      if (conflicting) {
        throw UserError_(
          'Cannot transition application to ' + targetStatus + ' because another active application exists for this job (' + conflicting.id + ').',
          'DUPLICATE_ACTIVE_APPLICATION'
        );
      }
    }

    const now = new Date();
    const patch = {
      status: targetStatus,
      updated_at: now
    };

    if (targetStatus === 'Applied' && !currentApp.applied_at) {
      patch.applied_at = data.applied_at ? validateIsoTimestamp_(data.applied_at, 'applied_at') : now.toISOString();
    } else if (data.applied_at && targetStatus !== 'Draft') {
      patch.applied_at = validateIsoTimestamp_(data.applied_at, 'applied_at');
    }

    if (data.follow_up_at !== undefined) {
      patch.follow_up_at = validateIsoTimestamp_(data.follow_up_at, 'follow_up_at');
    }
    if (data.interview_at !== undefined) {
      patch.interview_at = validateIsoTimestamp_(data.interview_at, 'interview_at');
    }
    if (data.contact_name !== undefined) {
      patch.contact_name = sanitizePlainText_(data.contact_name, APPLICATION_LIMITS_.CONTACT_NAME_MAX_LENGTH, 'Contact name');
    }
    if (data.contact_email !== undefined) {
      patch.contact_email = validateContactEmail_(data.contact_email);
    }
    if (data.outcome !== undefined) {
      patch.outcome = sanitizePlainText_(data.outcome, APPLICATION_LIMITS_.OUTCOME_MAX_LENGTH, 'Outcome');
    }
    if (isNonBlankAppString_(data.notes)) {
      patch.notes = appendNoteLine_(currentApp.notes, data.notes);
    }

    // Synchronize linked job status
    syncJobStatusFromApplication_(ss, currentApp.job_id, targetStatus, data.notes || ('Application transitioned to ' + targetStatus));

    // Update Applications
    const updatedApp = updateRecordByIdInDb_(ss, 'Applications', applicationId, patch, function (fresh) {
      if (fresh.status !== currentStatus) {
        throw UserError_('This application changed before the request completed. Refresh and try again.', 'CONFLICT');
      }
    });

    // Append to ApplicationHistory
    appendRecordInDb_(ss, 'ApplicationHistory', {
      id: typeof generateUUID_ === 'function' ? generateUUID_() : Utilities.getUuid(),
      application_id: applicationId,
      job_id: currentApp.job_id,
      action: transitionActionName_(currentStatus, targetStatus),
      from_status: currentStatus,
      to_status: targetStatus,
      note: data.notes ? data.notes.trim() : '',
      created_at: now
    });

    return updatedApp;
  });
}

/**
 * Retrieves a single application record by its unique ID.
 *
 * @param {string} applicationId - Application UUID.
 * @returns {Object} Stored application object.
 * @throws {UserError_} If applicationId is invalid or not found.
 */
function getApplicationById_(applicationId) {
  if (!isNonBlankAppString_(applicationId)) {
    throw UserError_('An application id is required.', 'INVALID_ID');
  }

  const ss = getDb_();
  getVerifiedSheet_(ss, 'Applications');
  return findUniqueApplicationById_(ss, applicationId);
}

/**
 * Retrieves all applications for a job, sorted newest first.
 *
 * @param {string} jobId - Job ID.
 * @returns {Array<Object>} Array of application records.
 * @throws {UserError_} If jobId is invalid.
 */
function getApplicationsByJobId_(jobId) {
  if (!isNonBlankAppString_(jobId)) {
    throw UserError_('A job id is required.', 'INVALID_ID');
  }

  const ss = getDb_();
  getVerifiedSheet_(ss, 'Applications');
  const rows = readRows_(ss, 'Applications').filter(function (app) {
    return String(app.job_id) === String(jobId);
  });

  rows.sort(function (a, b) {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime || String(b.id).localeCompare(String(a.id));
  });

  return rows;
}

/**
 * Retrieves all history audit records for an application, sorted newest first.
 *
 * @param {string} applicationId - Application UUID.
 * @returns {Array<Object>} Array of history records.
 * @throws {UserError_} If applicationId is invalid.
 */
function getApplicationHistory_(applicationId) {
  if (!isNonBlankAppString_(applicationId)) {
    throw UserError_('An application id is required.', 'INVALID_ID');
  }

  const ss = getDb_();
  getVerifiedSheet_(ss, 'ApplicationHistory');
  const rows = readRows_(ss, 'ApplicationHistory').filter(function (entry) {
    return String(entry.application_id) === String(applicationId);
  });

  rows.sort(function (a, b) {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime || String(b.id).localeCompare(String(a.id));
  });

  return rows;
}
