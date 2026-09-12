/**
 * Code.gs — Phase 1 web app entry point and browser-facing status check.
 */

function doGet() {
  // No setXFrameOptionsMode() call: Apps Script's default frame
  // protection applies. This is a private, single-user dashboard with no
  // embedding requirement, so ALLOWALL must not be used.
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Life Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// include() must stay public because <?!= include('X'); ?> scriptlets in
// the HTML templates call it from the browser-rendered template context.
// The allowlist keeps it from becoming a generic "read any project file"
// endpoint.
const INCLUDABLE_FILES_ = Object.freeze(['Styles', 'JavaScript']);

function include(filename) {
  if (INCLUDABLE_FILES_.indexOf(filename) === -1) {
    throw new Error('File not includable: ' + filename);
  }
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Browser-callable. Reports whether the database is reachable. Never
 * returns the spreadsheet id or a raw exception message — those are
 * logged server-side only.
 */
function getAppStatus() {
  try {
    const ss = getDb_();
    const name = ss.getName();
    return { status: 'ok', message: 'Connected to spreadsheet: ' + name };
  } catch (err) {
    console.error('getAppStatus failed: ' + (err && err.stack ? err.stack : err));
    if (err && err.name === 'UserError') {
      return { status: 'error', message: err.message };
    }
    return { status: 'error', message: 'The dashboard could not connect to its database.' };
  }
}

// Career-transition threshold: transferable skills can make a role worth
// reviewing even when the candidate is moving into a different industry.
const STRONG_MATCH_THRESHOLD_ = 80;
const APPLICATION_SENT_STATUSES_ = Object.freeze(['Applied', 'Interview', 'Offer']);

/**
 * Browser-callable. Returns today's date (script time zone), every
 * non-archived task, and a small stats block: {openTasks, completedTasks,
 * strongMatchJobs, applicationsSent}. The two job-derived stats are
 * computed read-only from stored Jobs rows — strongMatchJobs counts
 * overall_match >= STRONG_MATCH_THRESHOLD_ excluding Rejected;
 * applicationsSent counts status in Applied/Interview/Offer. (This
 * applicationsSent definition is a judgment call with no Phase 2 UI to
 * confirm it against — flagged for Codex to double-check in the Phase 2
 * handoff.) Phase 2 exposes no Jobs read/write endpoints yet, so if the
 * Jobs sheet is missing or has an unexpected layout, both job stats
 * degrade to null — logged server-side, never thrown — so Home and Tasks
 * can never fail because of it. Throws UserError_ only if Tasks itself
 * (which Phase 1 always creates) cannot be read.
 */
function getDashboardData() {
  try {
    const ss = getDb_();
    const tz = getTimeZone_();
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    const tasks = readRows_(ss, 'Tasks').filter(function (t) { return t.status !== 'Archived'; });
    const openTasks = tasks.filter(function (t) { return t.status === 'Open'; }).length;
    const completedTasks = tasks.filter(function (t) { return t.status === 'Done'; }).length;

    let strongMatchJobs = null;
    let applicationsSent = null;
    try {
      const jobs = readRows_(ss, 'Jobs');
      strongMatchJobs = jobs.filter(function (j) {
        return typeof j.overall_match === 'number' &&
          j.overall_match >= STRONG_MATCH_THRESHOLD_ &&
          j.status !== 'Rejected';
      }).length;
      applicationsSent = jobs.filter(function (j) {
        return APPLICATION_SENT_STATUSES_.indexOf(j.status) !== -1;
      }).length;
    } catch (jobsErr) {
      console.error('getDashboardData: Jobs stats unavailable: ' + (jobsErr && jobsErr.stack ? jobsErr.stack : jobsErr));
      strongMatchJobs = null;
      applicationsSent = null;
    }

    return {
      today: today,
      tasks: tasks,
      stats: {
        openTasks: openTasks,
        completedTasks: completedTasks,
        strongMatchJobs: strongMatchJobs,
        applicationsSent: applicationsSent
      }
    };
  } catch (err) {
    console.error('getDashboardData failed: ' + (err && err.stack ? err.stack : err));
    if (err && err.name === 'UserError') {
      throw err;
    }
    throw UserError_('The dashboard could not load its data.', 'LOAD_FAILED');
  }
}
