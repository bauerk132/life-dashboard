/**
 * dev/mock-google-script-run.js
 *
 * DEV-ONLY in-memory fake of `google.script.run`, loaded exclusively by
 * dev/preview-server.js for local UI development and Browser-pane
 * verification (plan step B5) in a plain browser with no Apps Script
 * runtime behind it. This file is NEVER pushed to Apps Script:
 * .claspignore is a whitelist (everything ignored, then explicit
 * "!name" un-ignores) and dev/ is never one of the un-ignored entries,
 * so it stays out of any push regardless of this comment.
 *
 * It reproduces the same public function surface as the real server
 * (Code.gs / Tasks.gs / Calendar.gs / Jobs.gs): getAppStatus,
 * getDashboardData, createTask, completeTask, reopenTask, archiveTask,
 * getUpcomingEvents, getJobsQueue, setJobStatus, addJobNote, getJobHistory.
 * It intentionally does NOT re-implement every validation rule the real
 * server enforces byte-for-byte — it exists to drive the client's own
 * rendering and state logic for a human looking at a browser, not to
 * replace tests/phase2.test.js (which runs the real Database.gs/Tasks.gs/
 * Calendar.gs code against gas-fakes.js and is the actual correctness
 * check).
 *
 * Scenario selection via the page's own query string:
 *   ?tasks=empty
 *       start with zero demo tasks (default: three demo tasks, a mix of
 *       Open/Done so both action-button sets are exercised)
 *   ?jobs=unavailable|empty
 *       getDashboardData's job stats come back null, same as a real
 *       missing/mismatched Jobs sheet (default: fixed demo numbers)
 *   ?calendar=ok|empty|unavailable|fail
 *       ok (default): a few upcoming demo events
 *       empty: status 'ok', zero events -- the "nothing in the next 7
 *         days" empty state
 *       unavailable: status 'unavailable' -- a SERVER-REPORTED failure
 *         (e.g. permission or disabled-service problem), delivered
 *         through the normal success handler, exactly like the real
 *         getUpcomingEvents()'s try/catch design
 *       fail: a TRANSPORT failure -- getUpcomingEvents itself fails, so
 *         google.script.run's withFailureHandler fires instead of
 *         withSuccessHandler. This is deliberately a different failure
 *         shape than 'unavailable' so B5 can verify the client handles
 *         both independently.
 *   ?latency=500
 *       artificial delay in ms before every call resolves (success or
 *       failure), for exercising loading states and double-submit races
 *   ?fail=createTask,archiveTask
 *   ?fail=createTask:2
 *       make the named function(s) fail their first N calls (default
 *       N=1) via withFailureHandler, then behave normally after that --
 *       lets a manual pass exercise "action fails, retry with the same
 *       request succeeds" without restarting the server or losing state.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);

  var latencyMs = Number(params.get('latency')) || 0;

  var failCounts = {}; // fnName -> remaining calls to force-fail
  (params.get('fail') || '').split(',').forEach(function (entry) {
    entry = entry.trim();
    if (!entry) return;
    var parts = entry.split(':');
    var name = parts[0];
    var n = parts[1] ? Number(parts[1]) : 1;
    if (name) failCounts[name] = n;
  });

  function shouldForceFail(fnName) {
    if (failCounts[fnName] > 0) {
      failCounts[fnName] -= 1;
      return true;
    }
    return false;
  }

  var calendarMode = params.get('calendar') || 'ok';
  var tasksMode = params.get('tasks') || '';
  var jobsMode = params.get('jobs') || '';

  var TASK_PRIORITIES = ['Low', 'Medium', 'High'];
  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  var JOB_TRANSITIONS = {
    'New': ['Reviewed'],
    'Reviewed': ['Saved', 'Rejected'],
    'Saved': ['Ready to Apply', 'Rejected'],
    'Ready to Apply': ['Applied', 'Rejected'],
    'Applied': ['Interview'],
    'Interview': ['Offer'],
    'Offer': [],
    'Rejected': ['Reviewed']
  };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function isoDateOnly(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function isoTimestamp(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  }

  var nextSeq = 1;
  function demoId() {
    // Fixed-looking but distinct ids for the mock's own bookkeeping only --
    // never parsed as a real UUID, only compared by reference/equality, so
    // they don't need to satisfy UUID_PATTERN the way client-submitted ids
    // do below in createTask().
    return 'demo-task-' + (nextSeq++);
  }

  function demoJobId() { return 'demo-job-' + (nextSeq++); }
  function demoHistoryId() { return 'demo-history-' + (nextSeq++); }

  var tasks = [];
  if (tasksMode !== 'empty') {
    tasks = [
      { id: demoId(), title: 'Follow up on application', due_date: isoDateOnly(-1), priority: 'High', status: 'Open' },
      { id: demoId(), title: 'Update resume', due_date: isoDateOnly(3), priority: 'Medium', status: 'Open' },
      { id: demoId(), title: 'Prep for interview', due_date: '', priority: 'Low', status: 'Done' }
    ];
  }

  function findTask(id) {
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) return tasks[i];
    }
    return null;
  }

  // These records exist only in this dev-only in-memory adapter. Production
  // setup never imports this file and never seeds a Jobs sheet.
  var jobs = [];
  var jobHistory = [];
  if (jobsMode !== 'empty') {
    jobs = [
      {
        id: demoJobId(), title: 'Reporting Analyst', company: 'Demo Labs', location: 'Remote, US',
        remote: true, remoteLabel: 'Remote', salaryMin: 70000, salaryMax: 90000, currency: 'USD',
        postedAt: isoTimestamp(-2), postedDate: isoDateOnly(-2), discoveredAt: isoTimestamp(0),
        discoveredDate: todayStr(), lastSeenAt: isoTimestamp(0), freshness: 'recent',
        source: 'Demo board', sourceUrl: 'https://jobs.example.org/demo/1', externalId: 'demo-1',
        overallMatch: 94, recommendation: 'Strong match', whyMatches: 'SQL and reporting',
        gaps: 'No stated Tableau experience', notes: '', status: 'New', recordVersion: 0
      },
      {
        id: demoJobId(), title: 'Operations Coordinator', company: 'Demo Works', location: 'New York, NY',
        remote: false, remoteLabel: 'Hybrid', salaryMin: 60000, salaryMax: 72000, currency: 'USD',
        postedAt: isoTimestamp(-7), postedDate: isoDateOnly(-7), discoveredAt: isoTimestamp(-3),
        discoveredDate: isoDateOnly(-3), lastSeenAt: isoTimestamp(-1), freshness: 'recent',
        source: 'Demo board', sourceUrl: 'https://jobs.example.org/demo/2', externalId: 'demo-2',
        overallMatch: 88, recommendation: 'Worth reviewing', whyMatches: 'Operations background',
        gaps: '', notes: '[2026-09-11T12:00:00.000Z] Read job description', status: 'Saved', recordVersion: 2
      },
      {
        id: demoJobId(), title: 'Junior Analyst', company: 'Demo Archive', location: 'Boston, MA',
        remote: false, remoteLabel: 'Not remote', salaryMin: null, salaryMax: null, currency: '',
        postedAt: isoTimestamp(-30), postedDate: isoDateOnly(-30), discoveredAt: isoTimestamp(-20),
        discoveredDate: isoDateOnly(-20), lastSeenAt: isoTimestamp(-16), freshness: 'stale',
        source: 'Demo board', sourceUrl: 'https://jobs.example.org/demo/3', externalId: 'demo-3',
        overallMatch: 76, recommendation: '', whyMatches: '', gaps: 'Location preference',
        notes: '', status: 'Rejected', recordVersion: 4
      }
    ];
  }

  function findJob(id) {
    for (var i = 0; i < jobs.length; i++) if (jobs[i].id === id) return jobs[i];
    return null;
  }

  function fail(message, code) {
    var err = new Error(message);
    err.code = code || 'MOCK_ERROR';
    return err;
  }

  // Mirrors Tasks.gs's transitionTask_: idempotent no-op if already at the
  // target status, otherwise validate the from-status before writing.
  function transition(id, allowedFrom, target, patch) {
    var task = findTask(id);
    if (!task) throw fail('That task no longer exists.', 'NOT_FOUND');
    if (task.status === target) return task;
    if (allowedFrom.indexOf(task.status) === -1) {
      throw fail('This task is "' + task.status + '" and cannot make that change.', 'INVALID_TRANSITION');
    }
    Object.keys(patch).forEach(function (k) { task[k] = patch[k]; });
    return task;
  }

  var FNS = {
    getAppStatus: function () {
      return { status: 'ok', message: 'Connected to the database.' };
    },

    getDashboardData: function () {
      var openTasks = tasks.filter(function (t) { return t.status === 'Open'; }).length;
      var completedTasks = tasks.filter(function (t) { return t.status === 'Done'; }).length;
      var visibleTasks = tasks.filter(function (t) { return t.status !== 'Archived'; });
      return {
        today: todayStr(),
        tasks: visibleTasks,
        stats: {
          openTasks: openTasks,
          completedTasks: completedTasks,
          strongMatchJobs: jobsMode === 'unavailable' ? null : 2,
          applicationsSent: jobsMode === 'unavailable' ? null : 5
        }
      };
    },

    getJobsQueue: function () {
      if (jobsMode === 'unavailable') {
        return { status: 'error', today: '', activeJobs: [], rejectedJobs: [], quarantined: [], message: 'The stored job queue is unavailable right now.' };
      }
      return {
        status: 'ok', today: todayStr(),
        activeJobs: jobs.filter(function (job) { return job.status !== 'Rejected'; }),
        rejectedJobs: jobs.filter(function (job) { return job.status === 'Rejected'; }),
        quarantined: [], message: ''
      };
    },

    setJobStatus: function (id, target) {
      var job = findJob(id);
      if (!job) throw fail('Job not found.', 'NOT_FOUND');
      if (!Object.prototype.hasOwnProperty.call(JOB_TRANSITIONS, target)) throw fail('That job status is not recognized.', 'INVALID_STATUS');
      if (job.status === target) return job;
      if (JOB_TRANSITIONS[job.status].indexOf(target) === -1) throw fail('That status change is not allowed for this job.', 'INVALID_TRANSITION');
      var from = job.status;
      job.status = target;
      job.recordVersion += 1;
      if (target === 'Saved' && !job.savedAt) job.savedAt = new Date().toISOString();
      jobHistory.push({
        id: demoHistoryId(), jobId: id, action: from === 'Rejected' ? 'recover_job' : 'change_status',
        fromStatus: from, toStatus: target, note: '', createdAt: new Date().toISOString()
      });
      return job;
    },

    addJobNote: function (id, note) {
      var job = findJob(id);
      var trimmed = typeof note === 'string' ? note.trim() : '';
      if (!job) throw fail('Job not found.', 'NOT_FOUND');
      if (!trimmed || trimmed.length > 1000) throw fail('A valid note is required.', 'INVALID_FIELD');
      var line = '[' + new Date().toISOString() + '] ' + trimmed;
      job.notes = job.notes ? job.notes + '\n' + line : line;
      job.recordVersion += 1;
      jobHistory.push({
        id: demoHistoryId(), jobId: id, action: 'add_note', fromStatus: job.status,
        toStatus: job.status, note: trimmed, createdAt: new Date().toISOString()
      });
      return job;
    },

    getJobHistory: function (id) {
      if (!findJob(id)) return { status: 'error', entries: [], quarantinedCount: 0, message: 'Job history is unavailable right now.' };
      return {
        status: 'ok',
        entries: jobHistory.filter(function (entry) { return entry.jobId === id; }).slice().sort(function (a, b) {
          return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
        }),
        quarantinedCount: 0,
        message: ''
      };
    },

    createTask: function (input) {
      if (!input || typeof input !== 'object') throw fail('Invalid request.', 'INVALID_FIELD');
      if (typeof input.id !== 'string' || !UUID_PATTERN.test(input.id)) throw fail('Invalid request.', 'INVALID_FIELD');
      var title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title || title.length > 200) throw fail('Enter a title up to 200 characters.', 'INVALID_FIELD');
      if (TASK_PRIORITIES.indexOf(input.priority) === -1) throw fail('Choose a valid priority.', 'INVALID_FIELD');
      var dueDate = '';
      if (input.dueDate) {
        if (!DATE_ONLY_PATTERN.test(input.dueDate)) throw fail('Enter a valid due date.', 'INVALID_FIELD');
        dueDate = input.dueDate;
      }
      var existing = findTask(input.id);
      if (existing) {
        if (existing.title === title) return existing; // safe same-id/same-title retry
        throw fail('A different task already uses this id.', 'DUPLICATE_ID');
      }
      var task = { id: input.id, title: title, due_date: dueDate, priority: input.priority, status: 'Open' };
      tasks.push(task);
      return task;
    },

    completeTask: function (id) { return transition(id, ['Open'], 'Done', { status: 'Done' }); },
    reopenTask: function (id) { return transition(id, ['Done'], 'Open', { status: 'Open' }); },
    archiveTask: function (id) { return transition(id, ['Open', 'Done'], 'Archived', { status: 'Archived' }); },

    getUpcomingEvents: function () {
      if (calendarMode === 'unavailable') {
        return { status: 'unavailable', events: [], message: 'Calendar is not available right now.' };
      }
      if (calendarMode === 'empty') {
        return { status: 'ok', events: [], message: '' };
      }
      var now = new Date();
      var events = [
        {
          title: 'Team sync',
          start: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
          end: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
          allDay: false
        },
        {
          title: 'Portfolio review',
          start: new Date(now.getTime() + 26 * 60 * 60 * 1000).toISOString(),
          end: new Date(now.getTime() + 27 * 60 * 60 * 1000).toISOString(),
          allDay: false
        },
        {
          title: 'Networking event',
          start: isoDateOnly(4) + 'T00:00:00.000Z',
          end: isoDateOnly(5) + 'T00:00:00.000Z',
          allDay: true
        }
      ];
      return { status: 'ok', events: events, message: '' };
    }
  };

  function callMock(fnName, args, onSuccess, onFailure) {
    // 'calendar=fail' is a transport-level failure for this one function,
    // independent of the general ?fail= mechanism (which targets any
    // named function including getUpcomingEvents itself).
    var transportShouldFail = shouldForceFail(fnName) || (fnName === 'getUpcomingEvents' && calendarMode === 'fail');

    window.setTimeout(function () {
      if (transportShouldFail) {
        if (typeof onFailure === 'function') {
          onFailure(fail('Mock transport failure for ' + fnName + '.', 'MOCK_TRANSPORT_FAILURE'));
        }
        return;
      }
      try {
        var result = FNS[fnName].apply(null, args);
        if (typeof onSuccess === 'function') onSuccess(result);
      } catch (err) {
        if (typeof onFailure === 'function') onFailure(err);
      }
    }, latencyMs);
  }

  function makeRunner(onSuccess, onFailure) {
    var runner = {};
    Object.keys(FNS).forEach(function (fnName) {
      runner[fnName] = function () {
        var args = Array.prototype.slice.call(arguments);
        callMock(fnName, args, onSuccess, onFailure);
        return runner;
      };
    });
    runner.withSuccessHandler = function (fn) { return makeRunner(fn, onFailure); };
    runner.withFailureHandler = function (fn) { return makeRunner(onSuccess, fn); };
    return runner;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);
})();
