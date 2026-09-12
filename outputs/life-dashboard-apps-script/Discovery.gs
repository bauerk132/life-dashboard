'use strict';

/**
 * Life Dashboard — Job Discovery Orchestrator (Phase 4B)
 *
 * Coordinates scheduled and manual job discovery:
 * 1. Acquires script lock (withLock_).
 * 2. Fetches candidates via JobSource_JSearch.gs (Free tier, 200/mo cap).
 * 3. Applies deterministic profile filters via JobFilters.gs.
 * 4. Resolves identity and deduplicates via JobDedupe.gs.
 * 5. Safely persists new jobs and updates last_seen_at for rediscovered jobs.
 * 6. Records run audit metadata in the Settings sheet.
 *
 * All source calls and persistence are executed server-side.
 * Normal dashboard and queue browsing make zero network/discovery calls.
 */

const DISCOVERY_VERSION_ = '4B.1';
const DISCOVERY_SETTINGS_KEY_ = 'DISCOVERY_LAST_RUN';
const DISCOVERY_LOCK_TIMEOUT_MS_ = 30000;

/**
 * Unified discovery execution pipeline.
 *
 * @param {string} mode - 'scheduled' | 'manual'
 * @param {Date} [nowDate] - Clock injection for testing
 * @returns {{
 *   ok: boolean,
 *   mode: string,
 *   ranAt: string,
 *   queriesExecuted: number,
 *   rawJobsCount: number,
 *   candidatesFetched: number,
 *   filteredOutCount: number,
 *   insertedCount: number,
 *   updatedCount: number,
 *   quarantinedCount: number,
 *   filterBreakdown: Object,
 *   message: string
 * }}
 */
function discoveryRun_(mode, nowDate) {
  const now = nowDate || new Date();
  const nowIso = now.toISOString();
  const dateKey = Utilities.formatDate(now, JSEARCH_TIME_ZONE_, 'yyyy-MM-dd');

  return withLock_(DISCOVERY_LOCK_TIMEOUT_MS_, function () {
    const ss = getDb_();
    const existingJobs = readRows_(ss, 'Jobs');

    // Build daily queries
    let queries = [];
    try {
      queries = jsearchBuildDailyQueries_(dateKey);
    } catch (e) {
      return {
        ok: false,
        mode: mode,
        ranAt: nowIso,
        queriesExecuted: 0,
        rawJobsCount: 0,
        candidatesFetched: 0,
        filteredOutCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        quarantinedCount: 0,
        filterBreakdown: {},
        message: 'Failed to build daily queries: ' + (e && e.message ? e.message : String(e))
      };
    }

    let queriesExecuted = 0;
    let rawJobsCount = 0;
    let candidatesFetched = 0;
    let filteredOutCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let quarantinedCount = 0;
    const filterBreakdown = {};

    // Keep an in-memory mutable copy of existing rows to handle intra-batch deduplication
    const workingRows = existingJobs.slice();

    for (let qIdx = 0; qIdx < queries.length; qIdx++) {
      const queryObj = queries[qIdx];
      const fetchResult = jsearchFetchPage_(queryObj, { nowDate: now, mode: mode });

      if (!fetchResult.ok && fetchResult.status === 'BUDGET_BLOCKED') {
        // Quota ceiling reached — stop gracefully
        break;
      }

      queriesExecuted += 1;
      rawJobsCount += (fetchResult.meta ? fetchResult.meta.rawJobCount : 0) || 0;
      quarantinedCount += (fetchResult.quarantine ? fetchResult.quarantine.length : 0) || 0;

      const candidates = fetchResult.candidates || [];
      candidatesFetched += candidates.length;

      for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
        const candidate = candidates[cIdx];

        // Step 1: Filter Evaluation
        const filterResult = jobFiltersEvaluateCandidate_(candidate);
        if (!filterResult.passed) {
          filteredOutCount += 1;
          const r = filterResult.primaryReason || 'UNKNOWN_FILTER_REASON';
          filterBreakdown[r] = (filterBreakdown[r] || 0) + 1;
          continue;
        }

        // Step 2: Deduplication & Identity Resolution
        const dedupeResult = jobDedupeResolveCandidate_(workingRows, candidate, now);

        if (dedupeResult.action === 'INSERT') {
          appendRecordInDb_(ss, 'Jobs', dedupeResult.record);
          workingRows.push(dedupeResult.record);
          insertedCount += 1;
        } else if (dedupeResult.action === 'UPDATE') {
          updateRecordByIdInDb_(ss, 'Jobs', dedupeResult.existingId, dedupeResult.updates);
          // Update in-memory record
          for (let r = 0; r < workingRows.length; r++) {
            if (workingRows[r].id === dedupeResult.existingId) {
              workingRows[r].last_seen_at = dedupeResult.updates.last_seen_at;
              workingRows[r].record_version = dedupeResult.updates.record_version;
              break;
            }
          }
          updatedCount += 1;
        }
      }
    }

    const runSummary = {
      ok: true,
      mode: mode,
      ranAt: nowIso,
      queriesExecuted: queriesExecuted,
      rawJobsCount: rawJobsCount,
      candidatesFetched: candidatesFetched,
      filteredOutCount: filteredOutCount,
      insertedCount: insertedCount,
      updatedCount: updatedCount,
      quarantinedCount: quarantinedCount,
      filterBreakdown: filterBreakdown,
      message: 'Discovery run complete. Inserted ' + insertedCount + ', updated ' + updatedCount + '.'
    };

    // Save checkpoint in Settings
    try {
      setSettingInDb_(ss, DISCOVERY_SETTINGS_KEY_, JSON.stringify(runSummary));
    } catch (ignore) {
      // Non-fatal if settings write fails
    }

    return runSummary;
  });
}

/**
 * Public administrative entry point for manual discovery.
 * Callable from editor or admin action.
 *
 * @returns {Object}
 */
function runDiscovery() {
  return discoveryRun_('manual');
}

/**
 * Scheduled trigger entry point (runs daily at 7:00 a.m.).
 */
function runScheduledDiscovery_() {
  return discoveryRun_('scheduled');
}
