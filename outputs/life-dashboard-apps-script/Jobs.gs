/**
 * Jobs.gs — Phase 3 stored-job review queue.
 *
 * This file deliberately has no source-adapter, trigger, UrlFetchApp, or AI
 * client. Every public method works only with records already present in the
 * Jobs sheet. Job writes and their JobHistory audit records share one script
 * lock; the browser can request an action but cannot bypass validation.
 */

const JOB_STATUSES_ = Object.freeze([
  'New', 'Reviewed', 'Saved', 'Ready to Apply', 'Applied', 'Interview', 'Offer', 'Rejected'
]);

const JOB_TRANSITIONS_ = Object.freeze({
  'New': Object.freeze(['Reviewed']),
  'Reviewed': Object.freeze(['Saved', 'Rejected']),
  'Saved': Object.freeze(['Ready to Apply', 'Rejected']),
  'Ready to Apply': Object.freeze(['Applied', 'Rejected']),
  'Applied': Object.freeze(['Interview', 'Rejected']),
  'Interview': Object.freeze(['Offer', 'Rejected']),
  'Offer': Object.freeze(['Rejected']),
  // Recovery is intentionally narrow: a rejected record is returned to
  // Reviewed, which makes the next decision explicit rather than skipping
  // ahead in the state machine.
  'Rejected': Object.freeze(['Reviewed'])
});

const JOB_NOTE_MAX_LENGTH_ = 1000;
const JOB_STALE_AFTER_DAYS_ = 14;

function isNonBlankString_(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function safeDisplayText_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback || '';
  return String(value);
}

/**
 * Strictly accepts absolute HTTP(S) URLs with a conventional hostname and an
 * optional numeric port. It deliberately rejects whitespace, credentials,
 * scheme-relative URLs, non-web schemes, and malformed host characters.
 * The validated original string is safe to place in an anchor href only
 * because every value returned by getJobsQueue() passed here first.
 */
function validateSourceUrl_(value) {
  if (!isNonBlankString_(value) || value !== value.trim() || value.length > 2048) {
    throw UserError_('A valid HTTP(S) source URL is required.', 'INVALID_URL');
  }

  const match = /^(https?):\/\/([^\/?#\s]+)(?:[\/?#][^\s]*)?$/i.exec(value);
  if (!match) {
    throw UserError_('A valid HTTP(S) source URL is required.', 'INVALID_URL');
  }

  const authority = match[2];
  if (authority.indexOf('@') !== -1) {
    throw UserError_('A valid HTTP(S) source URL is required.', 'INVALID_URL');
  }

  let host = authority;
  const colon = authority.lastIndexOf(':');
  if (colon !== -1) {
    const port = authority.slice(colon + 1);
    host = authority.slice(0, colon);
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw UserError_('A valid HTTP(S) source URL is required.', 'INVALID_URL');
    }
  }

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host) ||
      host.indexOf('..') !== -1 || host.indexOf('.') === 0) {
    throw UserError_('A valid HTTP(S) source URL is required.', 'INVALID_URL');
  }

  return value;
}

function parseStoredDate_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const date = isDateValue_(value) ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey_(date) {
  return Utilities.formatDate(date, getTimeZone_(), 'yyyy-MM-dd');
}

function optionalFiniteNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRemote_(value) {
  if (value === true) return { value: true, label: 'Remote' };
  if (value === false) return { value: false, label: 'Not remote' };
  if (typeof value !== 'string') return { value: false, label: 'Remote status not supplied' };

  const normalized = value.trim().toLowerCase();
  if (['yes', 'true', 'remote', 'fully remote'].indexOf(normalized) !== -1) {
    return { value: true, label: 'Remote' };
  }
  if (['no', 'false', 'onsite', 'on-site', 'hybrid'].indexOf(normalized) !== -1) {
    return { value: false, label: normalized === 'hybrid' ? 'Hybrid' : 'Not remote' };
  }
  return { value: false, label: 'Remote status not supplied' };
}

function nextJobRecordVersion_(value) {
  if (value === '' || value === null || value === undefined) return 1;
  if ((typeof value === 'number' && Number.isInteger(value) && value >= 0) ||
      (typeof value === 'string' && /^\d+$/.test(value))) {
    return Number(value) + 1;
  }
  throw UserError_('This job has an invalid record version and was not changed.', 'INTEGRITY_ERROR');
}

function findUniqueJobById_(ss, id) {
  if (!isNonBlankString_(id)) {
    throw UserError_('A job id is required.', 'INVALID_ID');
  }
  const matches = readRows_(ss, 'Jobs').filter(function (job) { return job.id === id; });
  if (matches.length === 0) throw UserError_('Job not found.', 'NOT_FOUND');
  if (matches.length > 1) {
    throw UserError_('Multiple stored jobs share this id. No change was made.', 'INTEGRITY_ERROR');
  }
  return matches[0];
}

function queueIssue_(rowNumber, reason) {
  return { rowNumber: rowNumber, reason: reason };
}

/**
 * Returns a browser-safe, normalized job card record or an issue. No raw URL
 * reaches the client unless validateSourceUrl_ accepts it. Optional malformed
 * numeric/date fields become unavailable values, while malformed identity,
 * status, or URL fields quarantine only that row rather than the full queue.
 */
function normalizeQueueJob_(job, rowNumber, duplicateIds, now) {
  if (!isNonBlankString_(job.id)) return { issue: queueIssue_(rowNumber, 'missing job id') };
  if (duplicateIds[job.id]) return { issue: queueIssue_(rowNumber, 'duplicate job id') };
  if (!isNonBlankString_(job.title)) return { issue: queueIssue_(rowNumber, 'missing title') };
  if (JOB_STATUSES_.indexOf(job.status) === -1) return { issue: queueIssue_(rowNumber, 'unknown job status') };

  let sourceUrl;
  try {
    sourceUrl = validateSourceUrl_(job.url);
  } catch (err) {
    return { issue: queueIssue_(rowNumber, 'invalid source URL') };
  }

  const remote = normalizeRemote_(job.remote);
  const posted = parseStoredDate_(job.posted_at);
  const discovered = parseStoredDate_(job.discovered_at);
  const lastSeen = parseStoredDate_(job.last_seen_at);
  const cutoff = new Date(now.getTime() - JOB_STALE_AFTER_DAYS_ * 24 * 60 * 60 * 1000);
  const freshness = !lastSeen ? 'unknown' : (lastSeen.getTime() < cutoff.getTime() ? 'stale' : 'recent');

  return {
    job: {
      id: job.id,
      title: job.title.trim(),
      company: safeDisplayText_(job.company, 'Company not supplied'),
      location: safeDisplayText_(job.location, 'Location not supplied'),
      remote: remote.value,
      remoteLabel: remote.label,
      salaryMin: optionalFiniteNumber_(job.salary_min),
      salaryMax: optionalFiniteNumber_(job.salary_max),
      currency: safeDisplayText_(job.currency, ''),
      postedAt: posted ? posted.toISOString() : null,
      postedDate: posted ? formatDateKey_(posted) : null,
      discoveredAt: discovered ? discovered.toISOString() : null,
      discoveredDate: discovered ? formatDateKey_(discovered) : null,
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      freshness: freshness,
      source: safeDisplayText_(job.source, 'Source not supplied'),
      sourceUrl: sourceUrl,
      externalId: safeDisplayText_(job.external_id, ''),
      overallMatch: optionalFiniteNumber_(job.overall_match),
      recommendation: safeDisplayText_(job.recommendation, ''),
      whyMatches: safeDisplayText_(job.why_matches, ''),
      gaps: safeDisplayText_(job.gaps, ''),
      notes: safeDisplayText_(job.notes, ''),
      status: job.status,
      savedAt: job.saved_at || '',
      recordVersion: optionalFiniteNumber_(job.record_version)
    }
  };
}

/**
 * Browser-callable, read-only queue endpoint. It neither searches job
 * sources nor scores records. A malformed individual row is reported in the
 * quarantined array and omitted from cards; a Jobs-sheet/schema failure makes
 * the queue unavailable without breaking Home or Tasks.
 */
function getJobsQueue() {
  try {
    const ss = getDb_();
    const rows = readRows_(ss, 'Jobs');
    const idCounts = {};
    rows.forEach(function (row) {
      if (isNonBlankString_(row.id)) idCounts[row.id] = (idCounts[row.id] || 0) + 1;
    });
    const duplicateIds = {};
    Object.keys(idCounts).forEach(function (id) {
      if (idCounts[id] > 1) duplicateIds[id] = true;
    });

    const now = new Date();
    const activeJobs = [];
    const rejectedJobs = [];
    const quarantined = [];
    rows.forEach(function (row, index) {
      const normalized = normalizeQueueJob_(row, index + 2, duplicateIds, now);
      if (normalized.issue) {
        quarantined.push(normalized.issue);
      } else if (normalized.job.status === 'Rejected') {
        rejectedJobs.push(normalized.job);
      } else {
        activeJobs.push(normalized.job);
      }
    });

    return {
      status: 'ok',
      today: formatDateKey_(now),
      activeJobs: activeJobs,
      rejectedJobs: rejectedJobs,
      quarantined: quarantined,
      message: ''
    };
  } catch (err) {
    console.error('getJobsQueue failed: ' + (err && err.stack ? err.stack : err));
    return {
      status: 'error',
      today: '',
      activeJobs: [],
      rejectedJobs: [],
      quarantined: [],
      message: 'The stored job queue is unavailable right now.'
    };
  }
}

/**
 * Phase 4B. Inserts one newly discovered Jobs row. Thin, narrow wrapper
 * around appendRecordInDb_, used only by Discovery.gs. Does not acquire its
 * own lock — Discovery.gs's whole run holds one lock for its entire
 * duration (see Discovery.gs), and LockService's reentrancy behavior for a
 * script re-acquiring its own held lock within one execution is not
 * something this project can verify without a live deployment (see
 * updateRecordByIdInDb_'s own doc comment on the same point), so this
 * function must never wrap its own withLock_.
 *
 * `record` must already be a complete Jobs row (status:'New',
 * record_version:1, discovered_at = last_seen_at = the run's nowIso) — that
 * shaping is JobDedupe.gs's INSERT action's responsibility, not this
 * function's. This function only confirms schema membership (via
 * appendRecordInDb_) and writes exactly what it is given.
 */
function insertDiscoveredJob_(ss, record) {
  return appendRecordInDb_(ss, 'Jobs', record);
}

/**
 * Phase 4B. Updates ONLY last_seen_at on an existing Jobs row, identified
 * by id. Used only by Discovery.gs's TOUCH action, under the caller's
 * already-held lock (see insertDiscoveredJob_'s comment on why this
 * function never acquires its own). Never changes status, saved_at, notes,
 * or record_version — those are user-owned fields a discovery run must not
 * touch (contract §4).
 *
 * The precondition is an explicit, testable row-exists guard: it throws
 * NOT_FOUND if the row being touched cannot be read back as itself. In
 * practice updateRecordByIdInDb_ already throws NOT_FOUND before this
 * callback ever runs if no row matches `jobId`, so this mostly documents
 * the invariant rather than catching a new failure mode today — it is the
 * extension point for a future touch-time check (e.g. refusing to touch a
 * row whose identity fields no longer match what the dedupe index expected)
 * without changing this function's signature.
 */
function touchJobLastSeen_(ss, jobId, lastSeenAtIso) {
  if (!isNonBlankString_(jobId)) {
    throw UserError_('A job id is required.', 'INVALID_ID');
  }
  if (!isNonBlankString_(lastSeenAtIso)) {
    throw UserError_('A last_seen_at timestamp is required.', 'INVALID_FIELD');
  }
  return updateRecordByIdInDb_(ss, 'Jobs', jobId, { last_seen_at: lastSeenAtIso }, function (fresh) {
    if (!fresh || !isNonBlankString_(fresh.id)) {
      throw UserError_('Job not found.', 'NOT_FOUND');
    }
  });
}

function buildHistoryRecord_(jobId, action, fromStatus, toStatus, note) {
  return {
    job_id: jobId,
    action: action,
    from_status: fromStatus,
    to_status: toStatus,
    note: note || '',
    created_at: new Date()
  };
}

function transitionActionName_(fromStatus, toStatus) {
  return fromStatus === 'Rejected' && toStatus === 'Reviewed' ? 'recover_job' : 'change_status';
}

/**
 * Browser-callable. Validates a stored-job state change, increments the
 * record version, and appends a concise audit row. The JobHistory sheet is
 * verified before the job row is changed; both writes occur under one script
 * lock. Repeating the already-current status is a safe no-op, so a transport
 * retry cannot create a duplicate history entry.
 */
function setJobStatus(jobId, targetStatus) {
  if (typeof targetStatus !== 'string' || JOB_STATUSES_.indexOf(targetStatus) === -1) {
    throw UserError_('That job status is not recognized.', 'INVALID_STATUS');
  }

  return withLock_(10000, function () {
    const ss = getDb_();
    const current = findUniqueJobById_(ss, jobId);
    // Verify audit storage before changing the job. A missing/mismatched
    // audit sheet therefore cannot produce a job status change without its
    // required companion history record.
    getVerifiedSheet_(ss, 'JobHistory');

    if (current.status === targetStatus) return current;
    const allowed = JOB_TRANSITIONS_[current.status];
    if (!allowed || allowed.indexOf(targetStatus) === -1) {
      throw UserError_('That status change is not allowed for this job.', 'INVALID_TRANSITION');
    }

    const updates = {
      status: targetStatus,
      record_version: nextJobRecordVersion_(current.record_version)
    };
    if (targetStatus === 'Saved' && !current.saved_at) updates.saved_at = new Date();

    const updated = updateRecordByIdInDb_(ss, 'Jobs', jobId, updates, function (fresh) {
      if (fresh.status !== current.status) {
        throw UserError_('This job changed before the request completed. Refresh and try again.', 'CONFLICT');
      }
    });
    appendRecordInDb_(ss, 'JobHistory', buildHistoryRecord_(
      jobId,
      transitionActionName_(current.status, targetStatus),
      current.status,
      targetStatus,
      ''
    ));
    if (typeof syncApplicationFromJobStatus_ === 'function') {
      syncApplicationFromJobStatus_(ss, jobId, targetStatus);
    }
    return updated;
  });
}

/**
 * Browser-callable. Appends a human-entered note to the job's visible notes
 * field and writes a separate immutable history entry. Existing notes are
 * preserved; no update replaces the audit record that explained it.
 */
function addJobNote(jobId, note) {
  if (typeof note !== 'string') throw UserError_('A note is required.', 'INVALID_FIELD');
  const trimmed = note.trim();
  if (!trimmed) throw UserError_('A note is required.', 'INVALID_FIELD');
  if (trimmed.length > JOB_NOTE_MAX_LENGTH_) {
    throw UserError_('Notes must be ' + JOB_NOTE_MAX_LENGTH_ + ' characters or fewer.', 'INVALID_FIELD');
  }

  return withLock_(10000, function () {
    const ss = getDb_();
    const current = findUniqueJobById_(ss, jobId);
    getVerifiedSheet_(ss, 'JobHistory');

    const timestamp = new Date().toISOString();
    const noteLine = '[' + timestamp + '] ' + trimmed;
    const existingNotes = current.notes ? String(current.notes) : '';
    const updated = updateRecordByIdInDb_(ss, 'Jobs', jobId, {
      notes: existingNotes ? existingNotes + '\n' + noteLine : noteLine,
      record_version: nextJobRecordVersion_(current.record_version)
    }, function (fresh) {
      if (fresh.status !== current.status || fresh.record_version !== current.record_version) {
        throw UserError_('This job changed before the request completed. Refresh and try again.', 'CONFLICT');
      }
    });
    appendRecordInDb_(ss, 'JobHistory', buildHistoryRecord_(
      jobId, 'add_note', current.status, current.status, trimmed
    ));
    return updated;
  });
}

/**
 * Browser-callable, read-only audit endpoint. Bad history rows are omitted
 * rather than breaking the requested job's audit panel; their count is
 * returned so the UI can acknowledge incomplete local data honestly.
 */
function getJobHistory(jobId) {
  try {
    const ss = getDb_();
    findUniqueJobById_(ss, jobId);
    const entries = [];
    let quarantinedCount = 0;
    readRows_(ss, 'JobHistory').forEach(function (entry) {
      if (entry.job_id !== jobId) return;
      const created = parseStoredDate_(entry.created_at);
      if (!isNonBlankString_(entry.id) || !isNonBlankString_(entry.action) || !created) {
        quarantinedCount += 1;
        return;
      }
      entries.push({
        id: entry.id,
        action: entry.action,
        fromStatus: safeDisplayText_(entry.from_status, ''),
        toStatus: safeDisplayText_(entry.to_status, ''),
        note: safeDisplayText_(entry.note, ''),
        createdAt: created.toISOString()
      });
    });
    entries.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id); });
    return { status: 'ok', entries: entries, quarantinedCount: quarantinedCount, message: '' };
  } catch (err) {
    console.error('getJobHistory failed: ' + (err && err.stack ? err.stack : err));
    return { status: 'error', entries: [], quarantinedCount: 0, message: 'Job history is unavailable right now.' };
  }
}
