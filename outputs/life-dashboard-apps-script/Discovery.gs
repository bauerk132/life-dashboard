'use strict';

/**
 * Life Dashboard — Job Discovery Orchestrator (Phase 4B)
 *
 * Coordinates scheduled and manual job discovery:
 * 1. Validates JOB_PROFILE_ and acquires script lock (whole-run lock).
 * 2. In scheduled mode, verifies the caller event against project clock triggers.
 * 3. Checks source enabled state from Settings (DISCOVERY_SOURCE_STATE).
 * 4. Resolves or creates a DiscoveryRuns tracking row for (source, mode, date_key).
 * 5. Fetches candidates via JobSource_JSearch.gs (Free tier, 200/mo cap).
 * 6. Applies deterministic profile filters via JobFilters.gs.
 * 7. Resolves identity and deduplicates via JobDedupe.gs (L1/L2/L3 hierarchy).
 * 8. Safely persists new jobs and updates last_seen_at for rediscovered jobs.
 * 9. Maintains append-only audit log in DiscoveryLog.
 * 10. Persists checkpoints and updates run status and Settings audit.
 *
 * All source calls and persistence are executed server-side.
 * Normal dashboard and queue browsing make zero network/discovery calls.
 */

const DISCOVERY_VERSION_ = '4B.1';
const DISCOVERY_FILTER_VERSION_ = 'jobfilters-v2';
const DISCOVERY_IDENTITY_VERSION_ = 'jobdedupe-identity-v1';
const DISCOVERY_LOCK_TIMEOUT_MS_ = 30000;
const DISCOVERY_SETTINGS_KEY_ = 'DISCOVERY_LAST_RUN';
const DISCOVERY_SOURCE_STATE_KEY_ = 'DISCOVERY_SOURCE_STATE';
const DISCOVERY_SOURCE_NAME_ = 'linkedin';
const DISCOVERY_PROVIDER_NAME_ = 'jsearch';

/**
 * Public administrative entry point for manual discovery.
 * Callable from editor or admin action.
 *
 * @param {Object} [options] - Optional options object with optional maxPages
 * @returns {Object} Browser-safe summary
 */
function runDiscovery(options) {
  let maxPages = null;
  if (options !== undefined && options !== null) {
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw UserError_('Options must be an object.', 'INVALID_ARGUMENT');
    }
    const keys = Object.keys(options);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== 'maxPages' && keys[i] !== 'nowDate') {
        throw UserError_('Unknown option: ' + keys[i], 'INVALID_ARGUMENT');
      }
    }
    if (options.maxPages !== undefined && options.maxPages !== null) {
      const mp = options.maxPages;
      if (!Number.isInteger(mp) || mp < 1 || mp > JOB_PROFILE_.pagesPerManualRun) {
        throw UserError_('maxPages must be an integer from 1 through ' + JOB_PROFILE_.pagesPerManualRun, 'INVALID_ARGUMENT');
      }
      maxPages = mp;
    }
  }
  return discoveryRunPipeline_('manual', {
    maxPages: maxPages,
    nowDate: options && options.nowDate
  });
}

/**
 * Scheduled trigger entry point (runs daily at 7:00 a.m. America/New_York).
 * Validates trigger identity before executing any discovery pipeline action.
 *
 * @param {Object} event - Apps Script trigger event containing triggerUid
 * @returns {Object} Browser-safe summary
 */
function runScheduledDiscovery(event) {
  return discoveryRunPipeline_('scheduled', {
    triggerEvent: event
  });
}

/**
 * Installs the daily 7:00 a.m. America/New_York discovery trigger idempotently.
 * Removes duplicate triggers for runScheduledDiscovery if any exist.
 * Tested against fake only in Phase 4B; not called against live Apps Script.
 *
 * @returns {Object} Status summary
 */
function installDiscoveryTrigger() {
  jobProfileValidate_(JOB_PROFILE_);
  const handlerName = 'runScheduledDiscovery';
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === handlerName;
  });
  let installedCount = 0;
  let removedDuplicates = 0;

  if (triggers.length === 0) {
    ScriptApp.newTrigger(handlerName)
      .timeBased()
      .everyDays(1)
      .atHour(JOB_PROFILE_.schedule.hour)
      .inTimezone(JOB_PROFILE_.schedule.timeZone)
      .create();
    installedCount = 1;
  } else {
    for (let i = 1; i < triggers.length; i++) {
      ScriptApp.deleteTrigger(triggers[i]);
      removedDuplicates += 1;
    }
    installedCount = 1;
  }

  return {
    status: 'ok',
    handler: handlerName,
    installedCount: installedCount,
    removedDuplicates: removedDuplicates,
    scheduleHour: JOB_PROFILE_.schedule.hour,
    timeZone: JOB_PROFILE_.schedule.timeZone
  };
}

/**
 * Deletes all project triggers for runScheduledDiscovery.
 * Preserves unrelated triggers.
 *
 * @returns {Object} Status summary with removedCount
 */
function removeDiscoveryTrigger() {
  const handlerName = 'runScheduledDiscovery';
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === handlerName;
  });
  let removedCount = 0;
  triggers.forEach(function (t) {
    ScriptApp.deleteTrigger(t);
    removedCount += 1;
  });
  return {
    status: 'ok',
    handler: handlerName,
    removedCount: removedCount
  };
}

/**
 * Clears the disabled/error state for the JSearch discovery source in Settings.
 * Preserves quota history, API key, and job records.
 *
 * @returns {Object} Status summary
 */
function resetDiscoverySource() {
  return withLock_(DISCOVERY_LOCK_TIMEOUT_MS_, function () {
    const ss = getDb_();
    const resetState = {
      enabled: true,
      consecutiveTerminalErrors: 0,
      disabledAt: null,
      reason: null,
      updatedAt: new Date().toISOString()
    };
    discoverySaveSourceStateInDb_(ss, resetState);
    return {
      status: 'ok',
      source: DISCOVERY_SOURCE_NAME_,
      enabled: true,
      consecutiveTerminalErrors: 0
    };
  });
}

/**
 * Generates an opaque run identifier for DiscoveryRuns.
 *
 * @returns {string}
 */
function discoveryGenerateRunId_() {
  return 'run_' + Utilities.getUuid();
}

/**
 * Escapes formula-like text in a job record before Sheet writes.
 *
 * @param {Object} record
 * @returns {Object} Clean record
 */
function discoveryEscapeRecord_(record) {
  const escaped = Object.assign({}, record);
  const textFields = [
    'title', 'company', 'location', 'external_id', 'url',
    'description', 'currency', 'posted_at', 'notes',
    'why_matches', 'gaps', 'recommendation'
  ];
  textFields.forEach(function (field) {
    if (escaped[field] !== undefined && escaped[field] !== null && typeof escaped[field] === 'string') {
      escaped[field] = escapeSheetFormula_(escaped[field]);
    }
  });
  return escaped;
}

/**
 * Loads the source disable/error state from Settings.
 *
 * @param {Spreadsheet} ss
 * @returns {{ enabled: boolean, consecutiveTerminalErrors: number, disabledAt: (string|null), reason: (string|null) }}
 */
function discoveryLoadSourceStateInDb_(ss) {
  const settings = readRows_(ss, 'Settings');
  const matches = settings.filter(function (r) {
    return r.key === DISCOVERY_SOURCE_STATE_KEY_;
  });
  if (matches.length > 1) {
    throw UserError_('Multiple records share key ' + DISCOVERY_SOURCE_STATE_KEY_, 'INTEGRITY_ERROR');
  }
  if (matches.length === 1 && matches[0].value) {
    try {
      const parsed = JSON.parse(matches[0].value);
      if (parsed && typeof parsed === 'object') {
        return {
          enabled: parsed.enabled !== false,
          consecutiveTerminalErrors: typeof parsed.consecutiveTerminalErrors === 'number' ? parsed.consecutiveTerminalErrors : 0,
          disabledAt: parsed.disabledAt || null,
          reason: parsed.reason || null
        };
      }
    } catch (ignore) {
      // Return safe default on parse error
    }
  }
  return {
    enabled: true,
    consecutiveTerminalErrors: 0,
    disabledAt: null,
    reason: null
  };
}

/**
 * Saves the source disable/error state to Settings.
 *
 * @param {Spreadsheet} ss
 * @param {Object} state
 */
function discoverySaveSourceStateInDb_(ss, state) {
  const jsonStr = JSON.stringify(state);
  const settings = readRows_(ss, 'Settings');
  const matches = settings.filter(function (r) {
    return r.key === DISCOVERY_SOURCE_STATE_KEY_;
  });
  if (matches.length > 1) {
    throw UserError_('Multiple records share key ' + DISCOVERY_SOURCE_STATE_KEY_, 'INTEGRITY_ERROR');
  }
  if (matches.length === 1) {
    updateRecordByKeyInDb_(ss, 'Settings', 'key', DISCOVERY_SOURCE_STATE_KEY_, {
      value: jsonStr
    });
  } else {
    appendRecordInDb_(ss, 'Settings', {
      key: DISCOVERY_SOURCE_STATE_KEY_,
      value: jsonStr
    });
  }
}

/**
 * Saves the safe last-run summary to Settings (DISCOVERY_LAST_RUN).
 *
 * @param {Spreadsheet} ss
 * @param {Object} summary
 */
function discoverySaveLastRunInDb_(ss, summary) {
  const jsonStr = JSON.stringify(summary);
  const settings = readRows_(ss, 'Settings');
  const matches = settings.filter(function (r) {
    return r.key === DISCOVERY_SETTINGS_KEY_;
  });
  if (matches.length > 1) {
    throw UserError_('Multiple records share key ' + DISCOVERY_SETTINGS_KEY_, 'INTEGRITY_ERROR');
  }
  if (matches.length === 1) {
    updateRecordByKeyInDb_(ss, 'Settings', 'key', DISCOVERY_SETTINGS_KEY_, {
      value: jsonStr
    });
  } else {
    appendRecordInDb_(ss, 'Settings', {
      key: DISCOVERY_SETTINGS_KEY_,
      value: jsonStr
    });
  }
}

/**
 * Builds an in-memory lookup index from existing Jobs sheet rows.
 * Implements the three methods required by JobDedupe.gs:
 * - findByExternalId(source, externalId)
 * - findByUrlHash(source, urlHash)
 * - findByContentHash(source, contentHash)
 * Plus mutable in-run helpers (addRow, touchRow) to prevent duplicate rows.
 *
 * @param {Array<Object>} existingJobs
 * @returns {Object}
 */
function discoveryBuildIndex_(existingJobs) {
  const byExternalId = {};
  const byUrlHash = {};
  const byContentHash = {};
  const allRows = [];

  function registerRow(row) {
    allRows.push(row);
    const src = row.source || '';
    if (row.external_id) {
      const extKey = src + ':' + String(row.external_id);
      if (!byExternalId[extKey]) byExternalId[extKey] = [];
      byExternalId[extKey].push(row);
    }
    if (row.url) {
      const canonUrl = jobDedupeCanonicalizeUrl_(row.url);
      if (canonUrl) {
        const urlHash = jobDedupeComputeUrlHash_(src, canonUrl);
        if (!byUrlHash[urlHash]) byUrlHash[urlHash] = [];
        byUrlHash[urlHash].push(row);
      }
    }
    if (row.company || row.title) {
      const contentHash = jobDedupeComputeContentHash_(src, row.company, row.title, row.location);
      if (!byContentHash[contentHash]) byContentHash[contentHash] = [];
      byContentHash[contentHash].push(row);
    }
  }

  existingJobs.forEach(registerRow);

  return {
    rows: allRows,
    findByExternalId: function (source, externalId) {
      if (!externalId) return [];
      const key = source + ':' + String(externalId);
      return (byExternalId[key] || []).slice();
    },
    findByUrlHash: function (source, urlHash) {
      if (!urlHash) return [];
      const list = byUrlHash[urlHash] || [];
      return list.filter(function (r) { return r.source === source; });
    },
    findByContentHash: function (source, contentHash) {
      if (!contentHash) return [];
      const list = byContentHash[contentHash] || [];
      return list.filter(function (r) { return r.source === source; });
    },
    addRow: function (newRow) {
      registerRow(newRow);
    },
    touchRow: function (jobId, lastSeenAtIso) {
      allRows.forEach(function (r) {
        if (r.id === jobId) {
          r.last_seen_at = lastSeenAtIso;
          r._inRun = true;
        }
      });
    }
  };
}

/**
 * Appends one decision row to the DiscoveryLog sheet.
 *
 * @param {Spreadsheet} ss
 * @param {string} runId
 * @param {string} loggedAtIso
 * @param {Object} entry
 */
function discoveryLogCandidate_(ss, runId, loggedAtIso, entry) {
  const source = entry.source || DISCOVERY_SOURCE_NAME_;
  let urlHash = '';
  if (entry.url) {
    const canonical = jobDedupeCanonicalizeUrl_(entry.url);
    if (canonical) {
      urlHash = jobDedupeComputeUrlHash_(source, canonical);
    }
  }
  let contentHash = '';
  if (entry.content_hash) {
    contentHash = escapeSheetFormula_(entry.content_hash);
  }

  appendRecordInDb_(ss, 'DiscoveryLog', {
    id: generateUUID_(),
    run_id: runId,
    logged_at: loggedAtIso,
    source: source,
    external_id: escapeSheetFormula_(entry.external_id || ''),
    url_hash: urlHash,
    content_hash: contentHash,
    decision: entry.decision,
    reason_code: entry.reason_code || '',
    secondary_reasons: entry.secondary_reasons || '',
    profile_version: entry.profile_version || JOB_PROFILE_.profileId,
    job_id: entry.job_id || ''
  });
}

/**
 * Updates the DiscoveryRuns row with current checkpoint and counters.
 *
 * @param {Spreadsheet} ss
 * @param {string} runId
 * @param {number} queryIndex
 * @param {Object} attempts
 * @param {Object} counters
 */
function discoveryPersistCheckpointInDb_(ss, runId, queryIndex, attempts, counters) {
  const patch = {
    checkpoint_json: JSON.stringify({ queryIndex: queryIndex, attempts: attempts }),
    pages_attempted: counters.pages_attempted,
    raw_count: counters.raw_count,
    accepted_count: counters.accepted_count,
    filtered_count: counters.filtered_count,
    duplicate_count: counters.duplicate_count,
    updated_count: counters.updated_count,
    quarantined_count: counters.quarantined_count,
    error_count: counters.error_count
  };
  updateRecordByKeyInDb_(ss, 'DiscoveryRuns', 'run_id', runId, patch);
}

/**
 * Unified discovery pipeline execution.
 *
 * @param {string} mode - 'scheduled' | 'manual'
 * @param {Object} [options] - { maxPages, triggerEvent, nowDate }
 * @returns {Object} Safe run summary
 */
function discoveryRunPipeline_(mode, options) {
  options = options || {};

  // 1. Validate profile before any lock or source action
  jobProfileValidate_(JOB_PROFILE_);

  // 2. Whole-run script lock
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(DISCOVERY_LOCK_TIMEOUT_MS_);
  if (!acquired) {
    return {
      ok: false,
      status: 'SKIPPED_OVERLAP',
      mode: mode,
      message: 'Discovery run skipped: database lock is busy.'
    };
  }

  try {
    const ss = getDb_();
    const now = options.nowDate || new Date();
    const nowIso = now.toISOString();
    const dateKey = Utilities.formatDate(now, JSEARCH_TIME_ZONE_, 'yyyy-MM-dd');

    // 3. Trigger identity guard for scheduled mode
    if (mode === 'scheduled') {
      const event = options.triggerEvent;
      const triggerUid = (event && typeof event === 'object' && typeof event.triggerUid === 'string')
        ? event.triggerUid.trim()
        : '';
      let authorized = false;

      if (triggerUid) {
        const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
          const isClock = (typeof t.getTriggerSource === 'function')
            ? (t.getTriggerSource() === 'CLOCK' || (ScriptApp.TriggerSource && t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK))
            : true;
          return t.getHandlerFunction() === 'runScheduledDiscovery' &&
                 t.getUniqueId() === triggerUid &&
                 isClock;
        });
        if (triggers.length === 1) {
          authorized = true;
        }
      }

      if (!authorized) {
        const refusedRunId = discoveryGenerateRunId_();
        try {
          appendRecordInDb_(ss, 'DiscoveryRuns', {
            run_id: refusedRunId,
            source: DISCOVERY_SOURCE_NAME_,
            provider: DISCOVERY_PROVIDER_NAME_,
            mode: 'scheduled',
            date_key: dateKey,
            started_at: nowIso,
            finished_at: nowIso,
            status: 'REFUSED_NOT_TRIGGER',
            error_code: 'INVALID_TRIGGER_IDENTITY',
            checkpoint_json: JSON.stringify({ queryIndex: 0, attempts: {} }),
            pages_attempted: 0,
            raw_count: 0,
            accepted_count: 0,
            filtered_count: 0,
            duplicate_count: 0,
            updated_count: 0,
            quarantined_count: 0,
            error_count: 0,
            profile_version: JOB_PROFILE_.profileId,
            config_version: JOB_PROFILE_.configVersion,
            adapter_version: JSEARCH_ADAPTER_VERSION_,
            filter_version: DISCOVERY_FILTER_VERSION_,
            identity_version: DISCOVERY_IDENTITY_VERSION_
          });
        } catch (ignore) {
          // Non-fatal if logging fails
        }
        return {
          ok: false,
          status: 'REFUSED_NOT_TRIGGER',
          mode: 'scheduled',
          message: 'Scheduled discovery refused: trigger identity invalid or unauthorized.'
        };
      }
    }

    // 4. Source state check (Settings sheet)
    const sourceState = discoveryLoadSourceStateInDb_(ss);
    if (!sourceState.enabled) {
      const disabledRunId = discoveryGenerateRunId_();
      try {
        appendRecordInDb_(ss, 'DiscoveryRuns', {
          run_id: disabledRunId,
          source: DISCOVERY_SOURCE_NAME_,
          provider: DISCOVERY_PROVIDER_NAME_,
          mode: mode,
          date_key: dateKey,
          started_at: nowIso,
          finished_at: nowIso,
          status: 'SOURCE_DISABLED',
          error_code: sourceState.reason || 'SOURCE_DISABLED',
          checkpoint_json: JSON.stringify({ queryIndex: 0, attempts: {} }),
          pages_attempted: 0,
          raw_count: 0,
          accepted_count: 0,
          filtered_count: 0,
          duplicate_count: 0,
          updated_count: 0,
          quarantined_count: 0,
          error_count: 0,
          profile_version: JOB_PROFILE_.profileId,
          config_version: JOB_PROFILE_.configVersion,
          adapter_version: JSEARCH_ADAPTER_VERSION_,
          filter_version: DISCOVERY_FILTER_VERSION_,
          identity_version: DISCOVERY_IDENTITY_VERSION_
        });
      } catch (ignore) {
        // Non-fatal if logging fails
      }
      return {
        ok: false,
        status: 'SOURCE_DISABLED',
        mode: mode,
        message: 'Discovery source is disabled due to repeated terminal errors. Call resetDiscoverySource() to re-enable.'
      };
    }

    // 5. Open or resume DiscoveryRuns row
    const allRuns = readRows_(ss, 'DiscoveryRuns');
    const resumableRuns = allRuns.filter(function (r) {
      return r.source === DISCOVERY_SOURCE_NAME_ &&
             r.mode === mode &&
             r.date_key === dateKey &&
             (r.status === 'IN_PROGRESS' || r.status === 'PARTIAL');
    });

    if (resumableRuns.length > 1) {
      throw UserError_('Multiple resumable runs found for ' + dateKey + ' in mode ' + mode, 'INTEGRITY_ERROR');
    }

    let runId;
    let queryIndex = 0;
    let attempts = {};
    const counters = {
      pages_attempted: 0,
      raw_count: 0,
      accepted_count: 0,
      filtered_count: 0,
      duplicate_count: 0,
      updated_count: 0,
      quarantined_count: 0,
      error_count: 0
    };

    if (resumableRuns.length === 1) {
      const existingRun = resumableRuns[0];
      runId = existingRun.run_id;
      if (existingRun.checkpoint_json) {
        try {
          const parsed = JSON.parse(existingRun.checkpoint_json);
          if (parsed && typeof parsed === 'object') {
            queryIndex = typeof parsed.queryIndex === 'number' ? parsed.queryIndex : 0;
            attempts = (parsed.attempts && typeof parsed.attempts === 'object') ? parsed.attempts : {};
          }
        } catch (ignore) {
          queryIndex = 0;
          attempts = {};
        }
      }
      counters.pages_attempted = Number(existingRun.pages_attempted) || 0;
      counters.raw_count = Number(existingRun.raw_count) || 0;
      counters.accepted_count = Number(existingRun.accepted_count) || 0;
      counters.filtered_count = Number(existingRun.filtered_count) || 0;
      counters.duplicate_count = Number(existingRun.duplicate_count) || 0;
      counters.updated_count = Number(existingRun.updated_count) || 0;
      counters.quarantined_count = Number(existingRun.quarantined_count) || 0;
      counters.error_count = Number(existingRun.error_count) || 0;

      updateRecordByKeyInDb_(ss, 'DiscoveryRuns', 'run_id', runId, {
        status: 'IN_PROGRESS'
      });
    } else {
      runId = discoveryGenerateRunId_();
      appendRecordInDb_(ss, 'DiscoveryRuns', {
        run_id: runId,
        source: DISCOVERY_SOURCE_NAME_,
        provider: DISCOVERY_PROVIDER_NAME_,
        mode: mode,
        date_key: dateKey,
        started_at: nowIso,
        finished_at: '',
        status: 'IN_PROGRESS',
        error_code: '',
        checkpoint_json: JSON.stringify({ queryIndex: 0, attempts: {} }),
        pages_attempted: 0,
        raw_count: 0,
        accepted_count: 0,
        filtered_count: 0,
        duplicate_count: 0,
        updated_count: 0,
        quarantined_count: 0,
        error_count: 0,
        profile_version: JOB_PROFILE_.profileId,
        config_version: JOB_PROFILE_.configVersion,
        adapter_version: JSEARCH_ADAPTER_VERSION_,
        filter_version: DISCOVERY_FILTER_VERSION_,
        identity_version: DISCOVERY_IDENTITY_VERSION_
      });
    }

    // 6. Page limit and query preparation
    const configLimit = mode === 'scheduled'
      ? JOB_PROFILE_.pagesPerScheduledRun
      : JOB_PROFILE_.pagesPerManualRun;
    const maxPages = (mode === 'manual' && options.maxPages)
      ? Math.min(options.maxPages, configLimit)
      : configLimit;

    const queries = jsearchBuildDailyQueries_(dateKey);
    const existingJobs = readRows_(ss, 'Jobs');
    const index = discoveryBuildIndex_(existingJobs);

    const startMs = now.getTime();
    const budgetMs = JOB_PROFILE_.runtimeBudgetMs || 270000;
    let pagesExecutedThisRun = 0;
    let terminalStatus = null;
    let terminalErrorCode = null;

    // 7. Discovery Execution Loop
    while (queryIndex < queries.length && pagesExecutedThisRun < maxPages) {
      const elapsed = (new Date()).getTime() - startMs;
      if (elapsed >= budgetMs) {
        terminalStatus = 'PARTIAL';
        terminalErrorCode = 'RUNTIME_BUDGET_EXHAUSTED';
        break;
      }

      const queryEntry = queries[queryIndex];
      counters.pages_attempted += 1;
      pagesExecutedThisRun += 1;

      const fetchResult = jsearchFetchPage_(queryEntry, {
        mode: mode,
        nowDate: new Date(),
        enabledPublishers: JOB_PROFILE_.adapters.jsearch.publishers
      });

      if (fetchResult.status === 'BUDGET_BLOCKED') {
        terminalStatus = 'BUDGET_BLOCKED';
        terminalErrorCode = 'BUDGET_BLOCKED';
        break;
      }

      if (fetchResult.status === 'RATE_LIMITED') {
        terminalStatus = 'PARTIAL';
        terminalErrorCode = 'RATE_LIMITED';
        break;
      }

      if (fetchResult.retryable === true) {
        attempts[queryEntry.id] = (attempts[queryEntry.id] || 0) + 1;
        if (attempts[queryEntry.id] < JOB_PROFILE_.retryLimit) {
          terminalStatus = 'PARTIAL';
          terminalErrorCode = fetchResult.status;
          break;
        } else {
          // Retry limit reached for this query
          discoveryLogCandidate_(ss, runId, nowIso, {
            source: DISCOVERY_SOURCE_NAME_,
            decision: 'error',
            reason_code: fetchResult.status
          });
          counters.error_count += 1;
          queryIndex += 1;
          attempts[queryEntry.id] = 0;
          discoveryPersistCheckpointInDb_(ss, runId, queryIndex, attempts, counters);
          continue;
        }
      }

      if (fetchResult.disableSource === true) {
        sourceState.consecutiveTerminalErrors += 1;
        counters.error_count += 1;
        if (sourceState.consecutiveTerminalErrors >= JOB_PROFILE_.terminalErrorDisableThreshold) {
          sourceState.enabled = false;
          sourceState.disabledAt = nowIso;
          sourceState.reason = fetchResult.status;
        }
        discoverySaveSourceStateInDb_(ss, sourceState);
        terminalStatus = 'FAILED';
        terminalErrorCode = fetchResult.status;
        break;
      }

      if (fetchResult.ok === false) {
        // Non-retryable error (BAD_CONTENT_TYPE, OVERSIZED, MALFORMED, etc.)
        discoveryLogCandidate_(ss, runId, nowIso, {
          source: DISCOVERY_SOURCE_NAME_,
          decision: 'error',
          reason_code: fetchResult.status
        });
        counters.error_count += 1;
        queryIndex += 1;
        attempts[queryEntry.id] = 0;
        discoveryPersistCheckpointInDb_(ss, runId, queryIndex, attempts, counters);
        continue;
      }

      // Successful fetch (OK or EMPTY)
      if (sourceState.consecutiveTerminalErrors > 0) {
        sourceState.consecutiveTerminalErrors = 0;
        discoverySaveSourceStateInDb_(ss, sourceState);
      }

      // Process adapter-quarantined items
      if (Array.isArray(fetchResult.quarantined)) {
        fetchResult.quarantined.forEach(function (qItem) {
          counters.quarantined_count += 1;
          discoveryLogCandidate_(ss, runId, nowIso, {
            source: DISCOVERY_SOURCE_NAME_,
            external_id: qItem.external_id || '',
            decision: 'quarantine',
            reason_code: qItem.reason || 'ADAPTER_QUARANTINE'
          });
        });
      }

      // Process candidates
      const candidates = fetchResult.candidates || [];
      for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
        const candidate = candidates[cIdx];
        counters.raw_count += 1;

        // Step A: Hard Filters
        const filterResult = filterJobCandidate_(candidate, JOB_PROFILE_);
        if (!filterResult.passed) {
          counters.filtered_count += 1;
          discoveryLogCandidate_(ss, runId, nowIso, {
            source: candidate.source,
            external_id: candidate.external_id,
            url: candidate.url,
            content_hash: candidate.content_hash,
            decision: 'filtered',
            reason_code: filterResult.primaryReason,
            secondary_reasons: (filterResult.secondaryReasons || []).join(','),
            profile_version: filterResult.profileVersion
          });
          continue;
        }

        // Step B: Deduplication & Identity Resolution
        const dedupeResult = jobDedupeResolveCandidate_(index, candidate, nowIso);
        if (dedupeResult.action === 'INSERT') {
          const recordToInsert = discoveryEscapeRecord_(dedupeResult.record);
          const stored = insertDiscoveredJob_(ss, recordToInsert);
          const finalRecord = Object.assign({}, recordToInsert, { id: stored.id, _inRun: true });
          index.addRow(finalRecord);
          counters.accepted_count += 1;
          discoveryLogCandidate_(ss, runId, nowIso, {
            source: candidate.source,
            external_id: candidate.external_id,
            url: candidate.url,
            content_hash: candidate.content_hash,
            decision: 'accepted',
            reason_code: 'PASSED_PROFILE',
            profile_version: filterResult.profileVersion,
            job_id: stored.id
          });
        } else if (dedupeResult.action === 'TOUCH') {
          touchJobLastSeen_(ss, dedupeResult.existingId, nowIso);
          index.touchRow(dedupeResult.existingId, nowIso);
          counters.updated_count += 1;
          discoveryLogCandidate_(ss, runId, nowIso, {
            source: candidate.source,
            external_id: candidate.external_id,
            url: candidate.url,
            content_hash: candidate.content_hash,
            decision: 'updated',
            reason_code: 'IDENTITY_TOUCH',
            profile_version: filterResult.profileVersion,
            job_id: dedupeResult.existingId
          });
        } else if (dedupeResult.action === 'DUPLICATE_IN_RUN') {
          counters.duplicate_count += 1;
          discoveryLogCandidate_(ss, runId, nowIso, {
            source: candidate.source,
            external_id: candidate.external_id,
            url: candidate.url,
            content_hash: candidate.content_hash,
            decision: 'duplicate',
            reason_code: 'DUPLICATE_IN_RUN',
            profile_version: filterResult.profileVersion
          });
        } else if (dedupeResult.action === 'QUARANTINE') {
          counters.quarantined_count += 1;
          discoveryLogCandidate_(ss, runId, nowIso, {
            source: candidate.source,
            external_id: candidate.external_id,
            url: candidate.url,
            content_hash: candidate.content_hash,
            decision: 'quarantine',
            reason_code: dedupeResult.reasonCode,
            profile_version: filterResult.profileVersion
          });
        }
      }

      // Completed page advance
      queryIndex += 1;
      attempts[queryEntry.id] = 0;
      discoveryPersistCheckpointInDb_(ss, runId, queryIndex, attempts, counters);
    }

    // 8. Finalize run status
    let finalStatus = 'COMPLETED';
    if (terminalStatus) {
      finalStatus = terminalStatus;
    } else if (queryIndex < queries.length) {
      finalStatus = 'PARTIAL';
    }

    const finishedAtIso = (new Date()).toISOString();
    updateRecordByKeyInDb_(ss, 'DiscoveryRuns', 'run_id', runId, {
      status: finalStatus,
      finished_at: finishedAtIso,
      error_code: terminalErrorCode || '',
      checkpoint_json: JSON.stringify({ queryIndex: queryIndex, attempts: attempts }),
      pages_attempted: counters.pages_attempted,
      raw_count: counters.raw_count,
      accepted_count: counters.accepted_count,
      filtered_count: counters.filtered_count,
      duplicate_count: counters.duplicate_count,
      updated_count: counters.updated_count,
      quarantined_count: counters.quarantined_count,
      error_count: counters.error_count
    });

    const runSummary = {
      ok: finalStatus === 'COMPLETED' || finalStatus === 'PARTIAL',
      status: finalStatus,
      mode: mode,
      dateKey: dateKey,
      startedAt: nowIso,
      finishedAt: finishedAtIso,
      pagesAttempted: counters.pages_attempted,
      rawCount: counters.raw_count,
      acceptedCount: counters.accepted_count,
      filteredCount: counters.filtered_count,
      duplicateCount: counters.duplicate_count,
      updatedCount: counters.updated_count,
      quarantinedCount: counters.quarantined_count,
      errorCount: counters.error_count,
      message: 'Discovery ' + mode + ' run finished with status ' + finalStatus + '.'
    };

    discoverySaveLastRunInDb_(ss, runSummary);
    return runSummary;
  } finally {
    lock.releaseLock();
  }
}
