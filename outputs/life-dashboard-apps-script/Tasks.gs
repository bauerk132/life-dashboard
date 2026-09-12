/**
 * Tasks.gs — Phase 2 public task endpoints.
 *
 * Every function here is browser-callable (google.script.run). Storage,
 * locking, and record-shape validation are all handled by Database.gs's
 * appendRecord_ / updateRecordById_ / readRows_; this file owns only the
 * task-specific business rules: field validation, status-transition
 * rules, and the create-idempotency contract.
 */

const TASK_PRIORITIES_ = Object.freeze(['Low', 'Medium', 'High']);
const TASK_TITLE_MAX_LENGTH_ = 200;
const TASK_UUID_PATTERN_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN_ = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarDate_(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Parses a yyyy-MM-dd string into a real Date (local midnight, script
 * time zone) suitable for storage in a DATE_ONLY_FIELDS_ column. Throws
 * UserError_ (INVALID_FIELD) if the string is not exactly that shape or
 * is not a real calendar date (e.g. 2024-02-30).
 */
function parseDateOnly_(value, fieldLabel) {
  const match = DATE_ONLY_PATTERN_.exec(value);
  if (!match) {
    throw UserError_(fieldLabel + ' must be in yyyy-MM-dd format.', 'INVALID_FIELD');
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!isValidCalendarDate_(y, m, d)) {
    throw UserError_(fieldLabel + ' is not a real date.', 'INVALID_FIELD');
  }
  return new Date(y, m - 1, d);
}

function findTaskById_(ss, id) {
  return readRows_(ss, 'Tasks').filter(function (r) { return r.id === id; })[0] || null;
}

/**
 * Creates a task. `id` must be a UUID supplied by the client, not
 * server-generated, so the client can safely retry the exact same
 * request after an ambiguous transport failure: retrying with the same
 * id and the same (trimmed) title returns the already-created task
 * unchanged, with no duplicate row. The same id with a different title
 * is treated as a genuine conflict and rejected — silently accepting it
 * could overwrite a task the caller meant to keep distinct.
 */
function createTask(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw UserError_('Invalid task.', 'INVALID_RECORD');
  }

  const id = input.id;
  if (typeof id !== 'string' || !TASK_UUID_PATTERN_.test(id)) {
    throw UserError_('A valid task id is required.', 'INVALID_ID');
  }

  if (typeof input.title !== 'string') {
    throw UserError_('A title is required.', 'INVALID_FIELD');
  }
  const title = input.title.trim();
  if (title.length === 0) {
    throw UserError_('A title is required.', 'INVALID_FIELD');
  }
  if (title.length > TASK_TITLE_MAX_LENGTH_) {
    throw UserError_('Title must be ' + TASK_TITLE_MAX_LENGTH_ + ' characters or fewer.', 'INVALID_FIELD');
  }

  if (TASK_PRIORITIES_.indexOf(input.priority) === -1) {
    throw UserError_('Priority must be one of: ' + TASK_PRIORITIES_.join(', ') + '.', 'INVALID_FIELD');
  }

  let dueDate = '';
  if (input.dueDate !== undefined && input.dueDate !== null && input.dueDate !== '') {
    if (typeof input.dueDate !== 'string') {
      throw UserError_('Due date must be a yyyy-MM-dd string.', 'INVALID_FIELD');
    }
    dueDate = parseDateOnly_(input.dueDate, 'Due date');
  }

  try {
    return appendRecord_('Tasks', {
      id: id,
      title: title,
      due_date: dueDate,
      priority: input.priority,
      status: 'Open'
    });
  } catch (err) {
    if (err && err.code === 'DUPLICATE_ID') {
      const existing = findTaskById_(getDb_(), id);
      if (existing && existing.title === title) {
        // Safe retry: same id, same title — return what already exists
        // instead of writing (or erroring) a second time.
        return existing;
      }
      throw UserError_('A different task already uses this id.', 'DUPLICATE_ID');
    }
    throw err;
  }
}

/**
 * Runs one status transition for task `id` under a single lock
 * acquisition. If the task is already in `targetStatus`, this is a
 * no-op that returns the task unchanged — a client retry after an
 * ambiguous network failure is always safe, never a second error. If the
 * task is in some other status not listed in `allowedFromStatuses`, the
 * transition is rejected and nothing is written.
 */
function transitionTask_(id, allowedFromStatuses, targetStatus, patch) {
  if (typeof id !== 'string' || id === '') {
    throw UserError_('A task id is required.', 'INVALID_ID');
  }

  const current = findTaskById_(getDb_(), id);
  if (!current) {
    throw UserError_('Task not found.', 'NOT_FOUND');
  }
  if (current.status === targetStatus) {
    return current;
  }

  return updateRecordById_('Tasks', id, patch, function (row) {
    if (allowedFromStatuses.indexOf(row.status) === -1) {
      throw UserError_(
        'This task is "' + row.status + '" and cannot make that change.',
        'INVALID_TRANSITION'
      );
    }
  });
}

/** Marks an Open task Done, recording completed_at. */
function completeTask(id) {
  return transitionTask_(id, ['Open'], 'Done', { status: 'Done', completed_at: new Date() });
}

/** Reopens a Done task back to Open, clearing completed_at. */
function reopenTask(id) {
  return transitionTask_(id, ['Done'], 'Open', { status: 'Open', completed_at: '' });
}

/** Archives a task from either Open or Done. */
function archiveTask(id) {
  return transitionTask_(id, ['Open', 'Done'], 'Archived', { status: 'Archived' });
}
