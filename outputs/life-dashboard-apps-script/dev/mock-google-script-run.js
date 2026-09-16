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
 * (Code.gs / Tasks.gs / Calendar.gs / Jobs.gs / Applications.gs / JobScoring.gs):
 * getAppStatus, getDashboardData, createTask, completeTask, reopenTask, archiveTask,
 * getUpcomingEvents, getJobsQueue, setJobStatus, addJobNote, getJobHistory,
 * getJobScoringState, scorePendingJobs, getScoringBudgetStatus,
 * createApplication, setApplicationStatus, getApplicationById,
 * getApplicationsByJobId, getApplicationHistory, updateApplication.
 *
 * It tracks per-endpoint call counts in `window.__mockCallCounts` so deterministic
 * tests can verify zero-call browsing and duplicate-action suppression.
 *
 * Scenario selection via the page's own query string:
 *   ?tasks=empty
 *   ?jobs=unavailable|empty
 *   ?calendar=ok|empty|unavailable|fail
 *   ?scoring=unscored|current|stale|quarantined
 *   ?budget=normal|near-limit|exceeded|ledger-blocked
 *   ?stoppedReason=RATE_LIMIT|BUDGET_EXCEEDED|AUTH_ERROR|...
 *   ?apps=empty|conflict|duplicate-active|invalid-transition|history-error
 *   ?latency=500
 *   ?fail=createTask,archiveTask:2
 */
(function () {
  'use strict';

  var params = typeof window !== 'undefined' && window.location && window.location.search
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams('');

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
  var scoringMode = params.get('scoring') || '';
  var budgetMode = params.get('budget') || 'normal';
  var stoppedReasonParam = params.get('stoppedReason') || '';
  var appsMode = params.get('apps') || '';

  var TASK_PRIORITIES = ['Low', 'Medium', 'High'];
  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  var JOB_TRANSITIONS = {
    'New': ['Reviewed'],
    'Reviewed': ['Saved', 'Rejected'],
    'Saved': ['Ready to Apply', 'Rejected'],
    'Ready to Apply': ['Applied', 'Rejected'],
    'Applied': ['Interview', 'Rejected'],
    'Interview': ['Offer', 'Rejected'],
    'Offer': ['Rejected'],
    'Rejected': ['Reviewed']
  };

  var APPLICATION_TRANSITIONS = {
    'Draft': ['Applied', 'Withdrawn'],
    'Applied': ['Interview', 'Rejected', 'Withdrawn'],
    'Interview': ['Offered', 'Rejected', 'Withdrawn'],
    'Offered': ['Rejected', 'Withdrawn'],
    'Rejected': [],
    'Withdrawn': []
  };

  var APP_TO_JOB_STATUS = {
    'Draft': null,
    'Applied': 'Applied',
    'Interview': 'Interview',
    'Offered': 'Offer',
    'Rejected': 'Rejected',
    'Withdrawn': 'Reviewed'
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
    return 'demo-task-' + (nextSeq++);
  }

  function demoJobId() { return 'demo-job-' + (nextSeq++); }
  function demoHistoryId() { return 'demo-history-' + (nextSeq++); }
  function demoAppId() { return 'demo-app-' + (nextSeq++); }

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

  var jobs = [];
  var jobHistory = [];
  if (jobsMode !== 'empty') {
    jobs = [
      {
        id: 'demo-job-1', title: 'Reporting Analyst', company: 'Demo Labs', location: 'Remote, US',
        remote: true, remoteLabel: 'Remote', salaryMin: 70000, salaryMax: 90000, currency: 'USD',
        postedAt: isoTimestamp(-2), postedDate: isoDateOnly(-2), discoveredAt: isoTimestamp(0),
        discoveredDate: todayStr(), lastSeenAt: isoTimestamp(0), freshness: 'recent',
        source: 'Demo board', sourceUrl: 'https://jobs.example.org/demo/1', externalId: 'demo-1',
        overallMatch: 94, recommendation: 'Strong match', whyMatches: 'SQL and reporting',
        gaps: 'No stated Tableau experience', notes: '', status: 'New', recordVersion: 0
      },
      {
        id: 'demo-job-2', title: 'Operations Coordinator', company: 'Demo Works', location: 'New York, NY',
        remote: false, remoteLabel: 'Hybrid', salaryMin: 60000, salaryMax: 72000, currency: 'USD',
        postedAt: isoTimestamp(-7), postedDate: isoDateOnly(-7), discoveredAt: isoTimestamp(-3),
        discoveredDate: isoDateOnly(-3), lastSeenAt: isoTimestamp(-1), freshness: 'recent',
        source: 'Demo board', sourceUrl: 'https://jobs.example.org/demo/2', externalId: 'demo-2',
        overallMatch: 88, recommendation: 'Worth reviewing', whyMatches: 'Operations background',
        gaps: '', notes: '[2026-09-11T12:00:00.000Z] Read job description', status: 'Ready to Apply', recordVersion: 2
      },
      {
        id: 'demo-job-3', title: 'Junior Analyst', company: 'Demo Archive', location: 'Boston, MA',
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

  var applications = [];
  var applicationHistory = [];
  if (appsMode !== 'empty') {
    applications = [
      {
        id: 'demo-app-1',
        job_id: 'demo-job-2',
        status: 'Draft',
        applied_at: '',
        follow_up_at: isoDateOnly(2),
        contact_name: 'Jane Doe',
        contact_email: 'jane@demoworks.example',
        interview_at: '',
        outcome: '',
        notes: 'Drafting materials.',
        created_at: isoTimestamp(-2),
        updated_at: isoTimestamp(-2),
        record_version: 0
      }
    ];
    applicationHistory = [
      {
        id: 'demo-app-hist-1',
        applicationId: 'demo-app-1',
        jobId: 'demo-job-2',
        action: 'create_application',
        fromStatus: '',
        toStatus: 'Draft',
        note: 'Drafting materials.',
        createdAt: isoTimestamp(-2)
      }
    ];
  }

  function findApplication(id) {
    for (var i = 0; i < applications.length; i++) {
      if (applications[i].id === id) return applications[i];
    }
    return null;
  }

  var scoringContext = {
    profileVersion: '1.0.0',
    promptVersion: '1.0.0',
    schemaVersion: '1.0.0',
    provider: 'Google Gemini',
    model: 'gemini-2.5-flash'
  };

  var jobScoringData = {
    'demo-job-1': {
      state: 'current',
      score: {
        id: 'score-1',
        overallMatch: 94,
        recommendation: 'Strong match',
        evidence: 'Demonstrated experience in SQL and data extraction.',
        gaps: 'No Tableau experience stated in profile.',
        validatedAt: isoTimestamp(-1)
      }
    },
    'demo-job-2': {
      state: 'stale',
      score: {
        id: 'score-2',
        overallMatch: 88,
        recommendation: 'Worth reviewing',
        evidence: 'Strong operations coordination experience.',
        gaps: 'Location requires New York hybrid attendance.',
        validatedAt: isoTimestamp(-15)
      }
    },
    'demo-job-3': {
      state: 'unscored',
      score: null
    }
  };

  var budgetStatus = {
    monthlyCeilingUsd: 10.00,
    currentSpendUsd: 2.50,
    remainingSpendUsd: 7.50,
    totalCallsThisMonth: 15,
    currency: 'USD'
  };

  if (budgetMode === 'near-limit') {
    budgetStatus.currentSpendUsd = 9.20;
    budgetStatus.remainingSpendUsd = 0.80;
    budgetStatus.totalCallsThisMonth = 46;
  } else if (budgetMode === 'exceeded') {
    budgetStatus.currentSpendUsd = 10.00;
    budgetStatus.remainingSpendUsd = 0.00;
    budgetStatus.totalCallsThisMonth = 50;
  } else if (budgetMode === 'ledger-blocked') {
    budgetStatus.currentSpendUsd = 3.00;
    budgetStatus.remainingSpendUsd = 7.00;
    budgetStatus.totalCallsThisMonth = 15;
  }

  function fail(message, code) {
    var err = new Error(message);
    err.code = code || 'MOCK_ERROR';
    return err;
  }

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
        if (existing.title === title) return existing;
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
    },

    // -----------------------------------------------------------------------
    // Phase 5 Milestone 2: Scoring & Budget
    // -----------------------------------------------------------------------
    getJobScoringState: function (jobId) {
      var job = findJob(jobId);
      if (!job) throw fail('Job not found.', 'INVALID_ID');
      if (scoringMode) {
        var scoreVal = (scoringMode === 'current' || scoringMode === 'stale')
          ? {
              id: 'mock-score-override',
              overallMatch: 92,
              recommendation: 'Targeted match',
              evidence: 'Demonstrated experience in technical delivery.',
              gaps: 'None noted.',
              validatedAt: new Date().toISOString()
            }
          : null;
        return {
          jobId: jobId,
          state: scoringMode,
          score: scoreVal,
          currentContext: scoringContext
        };
      }
      var existing = jobScoringData[jobId];
      if (existing) {
        return {
          jobId: jobId,
          state: existing.state,
          score: existing.score,
          currentContext: scoringContext
        };
      }
      return {
        jobId: jobId,
        state: 'unscored',
        score: null,
        currentContext: scoringContext
      };
    },

    getScoringBudgetStatus: function () {
      return {
        monthlyCeilingUsd: budgetStatus.monthlyCeilingUsd,
        currentSpendUsd: budgetStatus.currentSpendUsd,
        remainingSpendUsd: budgetStatus.remainingSpendUsd,
        totalCallsThisMonth: budgetStatus.totalCallsThisMonth,
        currency: budgetStatus.currency
      };
    },

    scorePendingJobs: function (maxCandidates) {
      void maxCandidates;
      if (stoppedReasonParam) {
        return {
          runId: 'run-' + (nextSeq++),
          attempted: 1,
          scored: 0,
          cached: 0,
          quarantined: 0,
          failed: 1,
          stoppedReason: stoppedReasonParam
        };
      }
      if (budgetMode === 'ledger-blocked') {
        return {
          runId: 'run-' + (nextSeq++),
          attempted: 0,
          scored: 0,
          cached: 0,
          quarantined: 0,
          failed: 0,
          stoppedReason: 'LEDGER_INTEGRITY_BLOCKED'
        };
      }
      if (budgetMode === 'exceeded' || budgetStatus.remainingSpendUsd <= 0) {
        return {
          runId: 'run-' + (nextSeq++),
          attempted: 0,
          scored: 0,
          cached: 0,
          quarantined: 0,
          failed: 0,
          stoppedReason: 'BUDGET_EXCEEDED'
        };
      }

      // Default mock scoring success
      budgetStatus.currentSpendUsd += 0.05;
      budgetStatus.remainingSpendUsd = Math.max(0, budgetStatus.monthlyCeilingUsd - budgetStatus.currentSpendUsd);
      budgetStatus.totalCallsThisMonth += 1;

      // Update demo-job-2 or demo-job-3 to current
      var targetId = jobScoringData['demo-job-2'] && jobScoringData['demo-job-2'].state === 'stale'
        ? 'demo-job-2'
        : (jobs[0] ? jobs[0].id : 'demo-job-1');
      jobScoringData[targetId] = {
        state: 'current',
        score: {
          id: 'score-' + (nextSeq++),
          overallMatch: 95,
          recommendation: 'Strong match',
          evidence: 'High alignment with profile target role.',
          gaps: 'No significant gaps.',
          validatedAt: new Date().toISOString()
        }
      };

      return {
        runId: 'run-' + (nextSeq++),
        attempted: 1,
        scored: 1,
        cached: 0,
        quarantined: 0,
        failed: 0
      };
    },

    // -----------------------------------------------------------------------
    // Phase 5 Milestone 1: Application Tracking
    // -----------------------------------------------------------------------
    getApplicationsByJobId: function (jobId) {
      var job = findJob(jobId);
      if (!job) throw fail('Job not found.', 'INVALID_ID');
      return applications.filter(function (app) { return app.job_id === jobId; });
    },

    getApplicationById: function (applicationId) {
      var app = findApplication(applicationId);
      if (!app) throw fail('Application not found.', 'NOT_FOUND');
      return app;
    },

    createApplication: function (input) {
      if (!input || typeof input !== 'object') throw fail('Invalid request.', 'INVALID_ARGUMENT');
      if (typeof input.job_id !== 'string' || !input.job_id.trim()) throw fail('job_id is required.', 'INVALID_ID');
      var job = findJob(input.job_id);
      if (!job) throw fail('Job not found.', 'INVALID_ID');

      var allowedKeys = [
        'id', 'job_id', 'status', 'applied_at', 'follow_up_at',
        'contact_name', 'contact_email', 'interview_at', 'outcome', 'notes'
      ];
      Object.keys(input).forEach(function (k) {
        if (allowedKeys.indexOf(k) === -1) throw fail('Unknown field: ' + k, 'UNKNOWN_FIELD');
      });

      if (appsMode === 'duplicate-active') {
        throw fail('An active application already exists for this job.', 'ACTIVE_APPLICATION_EXISTS');
      }

      var initialStatus = input.status || 'Draft';
      if (!APPLICATION_TRANSITIONS[initialStatus]) {
        throw fail('Invalid application status: ' + initialStatus, 'INVALID_STATUS');
      }

      // Active status check: Draft, Applied, Interview, Offered are active
      var activeStatuses = ['Draft', 'Applied', 'Interview', 'Offered'];
      var hasActive = applications.some(function (app) {
        return app.job_id === input.job_id && activeStatuses.indexOf(app.status) !== -1;
      });
      if (hasActive && activeStatuses.indexOf(initialStatus) !== -1) {
        throw fail('An active application already exists for this job.', 'ACTIVE_APPLICATION_EXISTS');
      }

      // Check derived job transition if needed
      var derivedJob = APP_TO_JOB_STATUS[initialStatus];
      if (derivedJob && derivedJob !== job.status) {
        if (!JOB_TRANSITIONS[job.status] || JOB_TRANSITIONS[job.status].indexOf(derivedJob) === -1) {
          throw fail('The status change would cause an invalid job transition.', 'INVALID_TRANSITION');
        }
      }

      var appId = input.id || demoAppId();
      var nowIso = new Date().toISOString();
      var newApp = {
        id: appId,
        job_id: input.job_id,
        status: initialStatus,
        applied_at: input.applied_at || (initialStatus === 'Applied' ? todayStr() : ''),
        follow_up_at: input.follow_up_at || '',
        contact_name: input.contact_name || '',
        contact_email: input.contact_email || '',
        interview_at: input.interview_at || '',
        outcome: input.outcome || '',
        notes: input.notes || '',
        created_at: nowIso,
        updated_at: nowIso,
        record_version: 0
      };

      applications.push(newApp);
      applicationHistory.push({
        id: demoHistoryId(),
        applicationId: appId,
        jobId: input.job_id,
        action: 'create_application',
        fromStatus: '',
        toStatus: initialStatus,
        note: input.notes || '',
        createdAt: nowIso
      });

      if (derivedJob && derivedJob !== job.status) {
        var fromJob = job.status;
        job.status = derivedJob;
        job.recordVersion += 1;
        jobHistory.push({
          id: demoHistoryId(),
          jobId: job.id,
          action: 'sync_from_application',
          fromStatus: fromJob,
          toStatus: derivedJob,
          note: 'Synchronized from application status ' + initialStatus,
          createdAt: nowIso
        });
      }

      return newApp;
    },

    setApplicationStatus: function (applicationId, targetStatus, note) {
      if (appsMode === 'conflict') {
        throw fail('This application changed before the request completed. Refresh and try again.', 'CONFLICT');
      }
      var app = findApplication(applicationId);
      if (!app) throw fail('Application not found.', 'NOT_FOUND');
      if (!APPLICATION_TRANSITIONS[targetStatus]) {
        throw fail('Invalid status.', 'INVALID_STATUS');
      }
      if (APPLICATION_TRANSITIONS[app.status].indexOf(targetStatus) === -1) {
        throw fail('That status transition is not allowed.', 'INVALID_TRANSITION');
      }

      // Check linked job transition
      var job = findJob(app.job_id);
      var derivedJob = APP_TO_JOB_STATUS[targetStatus];
      if (job && derivedJob && derivedJob !== job.status) {
        if (!JOB_TRANSITIONS[job.status] || JOB_TRANSITIONS[job.status].indexOf(derivedJob) === -1) {
          throw fail('The status change would cause an invalid job transition.', 'INVALID_TRANSITION');
        }
      }

      if (appsMode === 'invalid-transition') {
        throw fail('Invalid transition.', 'INVALID_TRANSITION');
      }

      var fromStatus = app.status;
      app.status = targetStatus;
      var nowIso = new Date().toISOString();
      app.updated_at = nowIso;
      app.record_version += 1;
      if (targetStatus === 'Applied' && !app.applied_at) {
        app.applied_at = todayStr();
      }

      applicationHistory.push({
        id: demoHistoryId(),
        applicationId: app.id,
        jobId: app.job_id,
        action: 'change_status',
        fromStatus: fromStatus,
        toStatus: targetStatus,
        note: note || '',
        createdAt: nowIso
      });

      if (job && derivedJob && derivedJob !== job.status) {
        var fromJobStatus = job.status;
        job.status = derivedJob;
        job.recordVersion += 1;
        jobHistory.push({
          id: demoHistoryId(),
          jobId: job.id,
          action: 'sync_from_application',
          fromStatus: fromJobStatus,
          toStatus: derivedJob,
          note: note || '',
          createdAt: nowIso
        });
      }

      return app;
    },

    updateApplication: function (applicationId, updates) {
      if (appsMode === 'conflict') {
        throw fail('This application changed before the request completed. Refresh and try again.', 'CONFLICT');
      }
      var app = findApplication(applicationId);
      if (!app) throw fail('Application not found.', 'NOT_FOUND');
      if (!updates || typeof updates !== 'object') throw fail('Invalid updates.', 'INVALID_RECORD');

      if ('status' in updates || 'id' in updates || 'job_id' in updates) {
        throw fail('Cannot update status, id, or job_id via updateApplication.', 'FORBIDDEN_FIELD');
      }

      var allowedKeys = [
        'contact_name', 'contact_email', 'follow_up_at',
        'interview_at', 'notes', 'outcome', 'applied_at'
      ];
      Object.keys(updates).forEach(function (k) {
        if (allowedKeys.indexOf(k) === -1) throw fail('Unknown field: ' + k, 'UNKNOWN_FIELD');
      });

      allowedKeys.forEach(function (k) {
        if (k in updates) app[k] = updates[k];
      });
      app.updated_at = new Date().toISOString();
      return app;
    },

    getApplicationHistory: function (applicationId) {
      if (appsMode === 'history-error') {
        return {
          status: 'error',
          entries: [],
          quarantinedCount: 0,
          message: 'Application history is unavailable right now.'
        };
      }
      var entries = applicationHistory
        .filter(function (e) { return e.applicationId === applicationId; })
        .slice()
        .sort(function (a, b) {
          return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
        });
      return {
        status: 'ok',
        entries: entries,
        quarantinedCount: 0,
        message: ''
      };
    }
  };

  var mockCallCounts = {};
  if (typeof window !== 'undefined') {
    window.__mockCallCounts = mockCallCounts;
  }

  function callMock(fnName, args, onSuccess, onFailure) {
    mockCallCounts[fnName] = (mockCallCounts[fnName] || 0) + 1;

    var transportShouldFail = shouldForceFail(fnName) || (fnName === 'getUpcomingEvents' && calendarMode === 'fail');

    setTimeout(function () {
      if (transportShouldFail) {
        if (typeof onFailure === 'function') {
          onFailure(fail('Mock transport failure for ' + fnName + '.', 'MOCK_TRANSPORT_FAILURE'));
        }
        return;
      }
      try {
        if (!FNS[fnName]) {
          throw fail('Mock function not implemented: ' + fnName, 'NOT_IMPLEMENTED');
        }
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

  if (typeof window !== 'undefined') {
    window.google = window.google || {};
    window.google.script = window.google.script || {};
    window.google.script.run = makeRunner(null, null);
    window.__mockFNS = FNS;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.google = (typeof window !== 'undefined' && window.google) ? window.google : { script: { run: makeRunner(null, null) } };
    globalThis.__mockCallCounts = mockCallCounts;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      FNS: FNS,
      mockCallCounts: mockCallCounts,
      makeRunner: makeRunner
    };
  }
})();
