/**
 * Applications.gs — Phase 5 Milestone 1: Application Tracking Workflow.
 *
 * Provides deterministic job application lifecycle tracking, audit history,
 * single active application invariant enforcement, and bidirectional status
 * synchronization with Jobs.gs and JobHistory.
 *
 * Bounded, offline, and secure: zero external network calls (UrlFetchApp strictly
 * prohibited), zero AI token consumption, and formula injection defense applied
 * on all user text inputs via escapeSheetFormula_.
 */

const APPLICATION_STATUSES_ = Object.freeze([
  'Draft', 'Applied', 'Interview', 'Offered', 'Rejected', 'Withdrawn'
]);

const ACTIVE_APPLICATION_STATUSES_ = Object.freeze([
  'Draft', 'Applied', 'Interview', 'Offered'
]);

const TERMINAL_APPLICATION_STATUSES_ = Object.freeze([
  'Rejected', 'Withdrawn'
]);

const APPLICATION_TRANSITIONS_ = Object.freeze({
  'Draft': Object.freeze(['Applied', 'Withdrawn']),
  'Applied': Object.freeze(['Interview', 'Rejected', 'Withdrawn']),
  'Interview': Object.freeze(['Offered', 'Rejected', 'Withdrawn']),
  'Offered': Object.freeze(['Rejected', 'Withdrawn']),
  'Rejected': Object.freeze([]),
  'Withdrawn': Object.freeze([])
});

const APP_TO_JOB_STATUS_ = Object.freeze({
  'Draft': null,
  'Applied': 'Applied',
  'Interview': 'Interview',
  'Offered': 'Offer',
  'Rejected': 'Rejected',
  'Withdrawn': 'Reviewed'
});

const APPLICATION_CONTACT_NAME_MAX_LENGTH_ = 200;
const APPLICATION_CONTACT_EMAIL_MAX_LENGTH_ = 254;
const APPLICATION_NOTE_MAX_LENGTH_ = 1000;
const APPLICATION_OUTCOME_MAX_LENGTH_ = 500;
const APPLICATION_EMAIL_REGEX_ = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function validateApplicationContactName_(name) {
  if (name === undefined || name === null || name === '') return '';
  if (typeof name !== 'string') {
    throw UserError_('Contact name must be a string.', 'INVALID_FIELD');
  }
  const trimmed = name.trim();
  if (trimmed === '') return '';
  if (trimmed.length > APPLICATION_CONTACT_NAME_MAX_LENGTH_) {
    throw UserError_('Contact name must be ' + APPLICATION_CONTACT_NAME_MAX_LENGTH_ + ' characters or fewer.', 'INVALID_FIELD');
  }
  return escapeSheetFormula_(trimmed);
}

function validateApplicationEmail_(email) {
  if (email === undefined || email === null || email === '') return '';
  if (typeof email !== 'string') {
    throw UserError_('Contact email must be a string.', 'INVALID_FIELD');
  }
  const trimmed = email.trim();
  if (trimmed === '') return '';
  if (trimmed.length > APPLICATION_CONTACT_EMAIL_MAX_LENGTH_) {
    throw UserError_('Contact email must be ' + APPLICATION_CONTACT_EMAIL_MAX_LENGTH_ + ' characters or fewer.', 'INVALID_FIELD');
  }
  if (!APPLICATION_EMAIL_REGEX_.test(trimmed)) {
    throw UserError_('Invalid contact email format.', 'INVALID_FIELD');
  }
  return escapeSheetFormula_(trimmed);
}

function validateApplicationNotes_(notes) {
  if (notes === undefined || notes === null || notes === '') return '';
  if (typeof notes !== 'string') {
    throw UserError_('Notes must be a string.', 'INVALID_FIELD');
  }
  const trimmed = notes.trim();
  if (trimmed === '') return '';
  if (trimmed.length > APPLICATION_NOTE_MAX_LENGTH_) {
    throw UserError_('Notes must be ' + APPLICATION_NOTE_MAX_LENGTH_ + ' characters or fewer.', 'INVALID_FIELD');
  }
  return escapeSheetFormula_(trimmed);
}

function validateApplicationOutcome_(outcome) {
  if (outcome === undefined || outcome === null || outcome === '') return '';
  if (typeof outcome !== 'string') {
    throw UserError_('Outcome must be a string.', 'INVALID_FIELD');
  }
  const trimmed = outcome.trim();
  if (trimmed === '') return '';
  if (trimmed.length > APPLICATION_OUTCOME_MAX_LENGTH_) {
    throw UserError_('Outcome must be ' + APPLICATION_OUTCOME_MAX_LENGTH_ + ' characters or fewer.', 'INVALID_FIELD');
  }
  return escapeSheetFormula_(trimmed);
}

function validateHistoryNote_(note) {
  if (note === undefined || note === null || note === '') return '';
  if (typeof note !== 'string') {
    throw UserError_('Note must be a string.', 'INVALID_FIELD');
  }
  const trimmed = note.trim();
  if (trimmed === '') return '';
  if (trimmed.length > APPLICATION_NOTE_MAX_LENGTH_) {
    throw UserError_('Note must be ' + APPLICATION_NOTE_MAX_LENGTH_ + ' characters or fewer.', 'INVALID_FIELD');
  }
  return escapeSheetFormula_(trimmed);
}

function validateApplicationDate_(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return '';
  if (isDateValue_(value)) {
    if (isNaN(value.getTime())) {
      throw UserError_(fieldLabel + ' must be a valid date.', 'INVALID_FIELD');
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return '';
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw UserError_(fieldLabel + ' must be a valid date.', 'INVALID_FIELD');
    }
    return parsed;
  }
  throw UserError_(fieldLabel + ' must be a date string or Date object.', 'INVALID_FIELD');
}

function findUniqueApplicationById_(ss, id) {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw UserError_('An application id is required.', 'INVALID_ID');
  }
  const appId = id.trim();
  const matches = readRows_(ss, 'Applications').filter(function (app) {
    return app.id === appId;
  });
  if (matches.length === 0) {
    throw UserError_('Application not found.', 'NOT_FOUND');
  }
  if (matches.length > 1) {
    throw UserError_('Multiple stored applications share this id. No change was made.', 'INTEGRITY_ERROR');
  }
  return matches[0];
}

function findApplicationByIdOrNull_(ss, id) {
  if (!id || typeof id !== 'string' || id.trim() === '') return null;
  const appId = id.trim();
  const matches = readRows_(ss, 'Applications').filter(function (app) {
    return app.id === appId;
  });
  return matches.length > 0 ? matches[0] : null;
}

function getActiveApplicationForJob_(ss, jobId) {
  const apps = readRows_(ss, 'Applications').filter(function (app) {
    return app.job_id === jobId;
  });
  for (let i = 0; i < apps.length; i++) {
    if (ACTIVE_APPLICATION_STATUSES_.indexOf(apps[i].status) !== -1) {
      return apps[i];
    }
  }
  return null;
}

function getApplicationsForJob_(ss, jobId) {
  return readRows_(ss, 'Applications').filter(function (app) {
    return app.job_id === jobId;
  });
}

function parseApplicationStoredDate_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const date = isDateValue_(value) ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Synchronizes linked Job when Application status changes.
 * Direct database write under the caller's held script lock — does not call setJobStatus.
 */
function syncJobFromApplicationStatus_(ss, job, targetAppStatus, sanitizedNote) {
  const targetJobStatus = APP_TO_JOB_STATUS_[targetAppStatus];
  if (!targetJobStatus || job.status === targetJobStatus) {
    return;
  }

  const jobUpdates = {
    status: targetJobStatus,
    record_version: nextJobRecordVersion_(job.record_version)
  };

  updateRecordByIdInDb_(ss, 'Jobs', job.id, jobUpdates);

  appendRecordInDb_(ss, 'JobHistory', {
    job_id: job.id,
    action: 'application_sync',
    from_status: job.status,
    to_status: targetJobStatus,
    note: sanitizedNote || ('Status synced from application ' + targetAppStatus),
    created_at: new Date()
  });
}

/**
 * Reverse sync invoked defensively by setJobStatus in Jobs.gs.
 * Updates active application matching jobId and appends audit row in ApplicationHistory.
 */
function syncApplicationFromJobStatus_(ss, jobId, targetJobStatus) {
  const activeApp = getActiveApplicationForJob_(ss, jobId);
  if (!activeApp) return;

  let targetAppStatus = null;
  if (targetJobStatus === 'Applied') {
    targetAppStatus = 'Applied';
  } else if (targetJobStatus === 'Interview') {
    targetAppStatus = 'Interview';
  } else if (targetJobStatus === 'Offer') {
    targetAppStatus = 'Offered';
  } else if (targetJobStatus === 'Rejected') {
    targetAppStatus = 'Rejected';
  }

  if (!targetAppStatus || activeApp.status === targetAppStatus) {
    return;
  }

  const allowed = APPLICATION_TRANSITIONS_[activeApp.status];
  if (!allowed || allowed.indexOf(targetAppStatus) === -1) {
    return;
  }

  const appUpdates = {
    status: targetAppStatus,
    updated_at: new Date()
  };
  if (targetAppStatus === 'Applied' && !activeApp.applied_at) {
    appUpdates.applied_at = new Date();
  }

  updateRecordByIdInDb_(ss, 'Applications', activeApp.id, appUpdates);

  appendRecordInDb_(ss, 'ApplicationHistory', {
    application_id: activeApp.id,
    job_id: jobId,
    action: 'sync_from_job',
    from_status: activeApp.status,
    to_status: targetAppStatus,
    note: 'Status synced from job ' + targetJobStatus,
    created_at: new Date()
  });
}

/**
 * Browser-callable. Creates a new application record for a job.
 * Enforces single active application invariant and synchronizes with Jobs.gs when starting as Applied.
 */
function createApplication(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw UserError_('Invalid application payload.', 'INVALID_RECORD');
  }

  const allowedFields = [
    'id', 'job_id', 'status', 'applied_at', 'follow_up_at',
    'contact_name', 'contact_email', 'interview_at', 'outcome', 'notes'
  ];
  const unknown = Object.keys(input).filter(function (k) {
    return allowedFields.indexOf(k) === -1;
  });
  if (unknown.length > 0) {
    throw UserError_('Unknown field(s): ' + unknown.join(', '), 'UNKNOWN_FIELD');
  }

  if (!input.job_id || typeof input.job_id !== 'string' || input.job_id.trim() === '') {
    throw UserError_('A job id is required.', 'INVALID_ID');
  }
  const jobId = input.job_id.trim();

  return withLock_(10000, function () {
    const ss = getDb_();
    const job = findUniqueJobById_(ss, jobId);

    if (input.id !== undefined && input.id !== null && input.id !== '') {
      if (typeof input.id !== 'string' || input.id.trim() === '') {
        throw UserError_('Application ID must be a non-blank string.', 'INVALID_ID');
      }
      const appId = input.id.trim();
      const existingById = findApplicationByIdOrNull_(ss, appId);
      if (existingById) {
        const requestedStatus = input.status ? input.status.trim() : 'Draft';
        if (existingById.job_id === jobId && existingById.status === requestedStatus) {
          return existingById;
        }
        throw UserError_('A record with this id already exists.', 'DUPLICATE_ID');
      }
    }

    const activeApp = getActiveApplicationForJob_(ss, jobId);
    if (activeApp) {
      throw UserError_('An active application already exists for this job.', 'ACTIVE_APPLICATION_EXISTS');
    }

    const initialStatus = input.status ? input.status.trim() : 'Draft';
    if (['Draft', 'Applied'].indexOf(initialStatus) === -1) {
      throw UserError_('Initial application status must be Draft or Applied.', 'INVALID_STATUS');
    }

    if (initialStatus === 'Applied') {
      if (job.status !== 'Ready to Apply' && job.status !== 'Applied') {
        throw UserError_('Job cannot transition to Applied from ' + job.status + '.', 'INVALID_TRANSITION');
      }
    }

    const record = {
      id: (input.id && typeof input.id === 'string' && input.id.trim()) ? input.id.trim() : generateUUID_(),
      job_id: jobId,
      status: initialStatus,
      applied_at: initialStatus === 'Applied'
        ? (input.applied_at ? validateApplicationDate_(input.applied_at, 'Applied date') : new Date())
        : (input.applied_at ? validateApplicationDate_(input.applied_at, 'Applied date') : ''),
      follow_up_at: validateApplicationDate_(input.follow_up_at, 'Follow-up date'),
      contact_name: validateApplicationContactName_(input.contact_name),
      contact_email: validateApplicationEmail_(input.contact_email),
      interview_at: validateApplicationDate_(input.interview_at, 'Interview date'),
      outcome: validateApplicationOutcome_(input.outcome),
      notes: validateApplicationNotes_(input.notes)
    };

    const stored = appendRecordInDb_(ss, 'Applications', record);

    appendRecordInDb_(ss, 'ApplicationHistory', {
      application_id: stored.id,
      job_id: jobId,
      action: 'create_application',
      from_status: '',
      to_status: initialStatus,
      note: stored.notes || '',
      created_at: new Date()
    });

    if (initialStatus === 'Applied' && job.status !== 'Applied') {
      updateRecordByIdInDb_(ss, 'Jobs', jobId, {
        status: 'Applied',
        record_version: nextJobRecordVersion_(job.record_version)
      });
      appendRecordInDb_(ss, 'JobHistory', {
        job_id: jobId,
        action: 'application_sync',
        from_status: job.status,
        to_status: 'Applied',
        note: 'Status synced from application Applied',
        created_at: new Date()
      });
    }

    return stored;
  });
}

/**
 * Browser-callable. Advances an application's lifecycle status according to the state machine.
 * Synchronizes status with Jobs.gs and appends audit trail to ApplicationHistory and JobHistory.
 */
function setApplicationStatus(applicationId, targetStatus, note) {
  if (!applicationId || typeof applicationId !== 'string' || applicationId.trim() === '') {
    throw UserError_('A valid application id is required.', 'INVALID_ID');
  }
  const appId = applicationId.trim();

  if (typeof targetStatus !== 'string' || APPLICATION_STATUSES_.indexOf(targetStatus) === -1) {
    throw UserError_('That application status is not recognized.', 'INVALID_STATUS');
  }

  const sanitizedNote = validateHistoryNote_(note);

  return withLock_(10000, function () {
    const ss = getDb_();
    const current = findUniqueApplicationById_(ss, appId);

    getVerifiedSheet_(ss, 'ApplicationHistory');

    if (current.status === targetStatus) return current;

    const allowed = APPLICATION_TRANSITIONS_[current.status];
    if (!allowed || allowed.indexOf(targetStatus) === -1) {
      throw UserError_('Cannot transition application from ' + current.status + ' to ' + targetStatus + '.', 'INVALID_TRANSITION');
    }

    const job = findUniqueJobById_(ss, current.job_id);
    getVerifiedSheet_(ss, 'JobHistory');

    if (targetStatus === 'Applied') {
      if (job.status !== 'Ready to Apply' && job.status !== 'Applied') {
        throw UserError_('Job cannot transition to Applied from ' + job.status + '.', 'INVALID_TRANSITION');
      }
    }

    const appUpdates = {
      status: targetStatus,
      updated_at: new Date()
    };
    if (targetStatus === 'Applied' && !current.applied_at) {
      appUpdates.applied_at = new Date();
    }

    const updatedApp = updateRecordByIdInDb_(ss, 'Applications', appId, appUpdates);

    appendRecordInDb_(ss, 'ApplicationHistory', {
      application_id: appId,
      job_id: current.job_id,
      action: 'change_status',
      from_status: current.status,
      to_status: targetStatus,
      note: sanitizedNote,
      created_at: new Date()
    });

    syncJobFromApplicationStatus_(ss, job, targetStatus, sanitizedNote);

    return updatedApp;
  });
}

/**
 * Browser-callable. Fetches an application by its unique ID.
 */
function getApplicationById(applicationId) {
  if (!applicationId || typeof applicationId !== 'string' || applicationId.trim() === '') {
    throw UserError_('A valid application id is required.', 'INVALID_ID');
  }
  const ss = getDb_();
  return findUniqueApplicationById_(ss, applicationId.trim());
}

/**
 * Browser-callable. Fetches all applications associated with a specific job ID.
 */
function getApplicationsByJobId(jobId) {
  if (!jobId || typeof jobId !== 'string' || jobId.trim() === '') {
    throw UserError_('A job id is required.', 'INVALID_ID');
  }
  const ss = getDb_();
  findUniqueJobById_(ss, jobId.trim());
  return getApplicationsForJob_(ss, jobId.trim());
}

/**
 * Browser-callable. Returns the complete audit history for an application, sorted descending.
 */
function getApplicationHistory(applicationId) {
  try {
    if (!applicationId || typeof applicationId !== 'string' || applicationId.trim() === '') {
      throw UserError_('A valid application id is required.', 'INVALID_ID');
    }
    const ss = getDb_();
    findUniqueApplicationById_(ss, applicationId.trim());
    const entries = [];
    let quarantinedCount = 0;
    readRows_(ss, 'ApplicationHistory').forEach(function (entry) {
      if (entry.application_id !== applicationId.trim()) return;
      const created = parseApplicationStoredDate_(entry.created_at);
      if (!isNonBlankString_(entry.id) || !isNonBlankString_(entry.action) || !created) {
        quarantinedCount += 1;
        return;
      }
      entries.push({
        id: entry.id,
        applicationId: entry.application_id,
        jobId: entry.job_id,
        action: entry.action,
        fromStatus: safeDisplayText_(entry.from_status, ''),
        toStatus: safeDisplayText_(entry.to_status, ''),
        note: safeDisplayText_(entry.note, ''),
        createdAt: created.toISOString()
      });
    });
    entries.sort(function (a, b) {
      return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    });
    return {
      status: 'ok',
      entries: entries,
      quarantinedCount: quarantinedCount,
      message: ''
    };
  } catch (err) {
    console.error('getApplicationHistory failed: ' + (err && err.stack ? err.stack : err));
    return {
      status: 'error',
      entries: [],
      quarantinedCount: 0,
      message: 'Application history is unavailable right now.'
    };
  }
}

/**
 * Browser-callable. Updates mutable application details (contacts, dates, notes, outcome).
 * Direct status modification is forbidden (use setApplicationStatus).
 */
function updateApplication(applicationId, updates) {
  if (!applicationId || typeof applicationId !== 'string' || applicationId.trim() === '') {
    throw UserError_('A valid application id is required.', 'INVALID_ID');
  }
  const appId = applicationId.trim();

  if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
    throw UserError_('Invalid update payload.', 'INVALID_RECORD');
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    throw UserError_('Direct status modification is forbidden. Use setApplicationStatus instead.', 'FORBIDDEN_FIELD');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'id')) {
    throw UserError_('Cannot modify application ID.', 'FORBIDDEN_FIELD');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'job_id')) {
    throw UserError_('Cannot modify application job ID.', 'FORBIDDEN_FIELD');
  }

  const allowedFields = [
    'contact_name', 'contact_email', 'follow_up_at', 'interview_at',
    'notes', 'outcome', 'applied_at'
  ];
  const unknown = Object.keys(updates).filter(function (k) {
    return allowedFields.indexOf(k) === -1;
  });
  if (unknown.length > 0) {
    throw UserError_('Unknown or unmodifiable field(s): ' + unknown.join(', '), 'UNKNOWN_FIELD');
  }

  return withLock_(10000, function () {
    const ss = getDb_();
    const current = findUniqueApplicationById_(ss, appId);

    const toWrite = {
      updated_at: new Date()
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'contact_name')) {
      toWrite.contact_name = validateApplicationContactName_(updates.contact_name);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'contact_email')) {
      toWrite.contact_email = validateApplicationEmail_(updates.contact_email);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'notes')) {
      toWrite.notes = validateApplicationNotes_(updates.notes);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'outcome')) {
      toWrite.outcome = validateApplicationOutcome_(updates.outcome);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'follow_up_at')) {
      toWrite.follow_up_at = validateApplicationDate_(updates.follow_up_at, 'Follow-up date');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'interview_at')) {
      toWrite.interview_at = validateApplicationDate_(updates.interview_at, 'Interview date');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'applied_at')) {
      toWrite.applied_at = validateApplicationDate_(updates.applied_at, 'Applied date');
    }

    const updated = updateRecordByIdInDb_(ss, 'Applications', appId, toWrite);

    appendRecordInDb_(ss, 'ApplicationHistory', {
      application_id: appId,
      job_id: current.job_id,
      action: 'update_application',
      from_status: current.status,
      to_status: current.status,
      note: 'Application details updated',
      created_at: new Date()
    });

    return updated;
  });
}
