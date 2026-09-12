/** Life Dashboard web-app entry point. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Life Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Allows Index.html to include CSS and browser JavaScript files. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Returns everything required for the first dashboard view. */
function getDashboardData() {
  return {
    today: Utilities.formatDate(new Date(), getTimeZone_(), 'EEEE, MMMM d'),
    tasks: getTasks_(),
    jobs: getJobs_(),
    events: getUpcomingEvents_(),
    stats: getDashboardStats_()
  };
}

/** One-time setup: creates the database tabs and headers in the configured Sheet. */
function setupLifeDashboard() {
  ensureSchema_();
  return 'Life Dashboard sheets are ready.';
}

/** Optional helper for evaluating the interface before connecting a job source. */
function seedDemoData() {
  ensureSchema_();
  seedDemoData_();
  return 'Demo tasks and jobs were added.';
}
