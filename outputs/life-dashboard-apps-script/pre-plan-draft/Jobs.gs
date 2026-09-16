const JOB_STATUSES = ['New', 'Reviewed', 'Saved', 'Ready to Apply', 'Applied', 'Interview', 'Rejected', 'Offer'];

function getJobs_() {
  return getRows_(CONFIG.SHEETS.JOBS)
    .filter(function(job) { return !['Rejected'].includes(job.status); })
    .sort(function(a, b) { return Number(b.overall_match || 0) - Number(a.overall_match || 0); });
}

function setJobStatus(jobId, status) {
  if (JOB_STATUSES.indexOf(status) === -1) throw new Error('Invalid job status.');
  const updates = { status: status };
  if (status === 'Saved') updates.saved_at = new Date();
  updateRecord_(CONFIG.SHEETS.JOBS, jobId, updates);
  return { id: jobId, status: status };
}

/**
 * Input point for a scheduled job collector. It rejects duplicates using external_id
 * (or the source URL) and deliberately does no AI work when the dashboard is opened.
 */
function upsertDiscoveredJobs(postings) {
  if (!Array.isArray(postings)) throw new Error('postings must be an array.');
  const existing = getRows_(CONFIG.SHEETS.JOBS);
  const seen = existing.reduce(function(index, job) {
    index[job.external_id || job.url] = job;
    return index;
  }, {});
  let added = 0;
  const newRecords = [];
  postings.forEach(function(posting) {
    const key = posting.externalId || posting.url;
    if (!key || seen[key]) return;
    newRecords.push({
      id: Utilities.getUuid(), title: posting.title || '', company: posting.company || '',
      location: posting.location || '', remote: posting.remote || '', salary_min: posting.salaryMin || '',
      salary_max: posting.salaryMax || '', posted_at: posting.postedAt || '', source: posting.source || '',
      url: posting.url || '', description: posting.description || '', skills_match: '', experience_match: '',
      location_match: '', salary_match: '', overall_match: '', recommendation: 'Unscored',
      why_matches: '', gaps: '', status: 'New', saved_at: '', notes: '', external_id: key,
      last_seen_at: new Date()
    });
    seen[key] = true;
    added++;
  });
  if (newRecords.length > 0) {
    appendRecords_(CONFIG.SHEETS.JOBS, newRecords);
  }
  return { added: added, duplicatesSkipped: postings.length - added };
}

function getDashboardStats_() {
  const tasks = getTasks_();
  const jobs = getJobs_();
  return {
    openTasks: tasks.filter(function(task) { return task.status !== 'Done'; }).length,
    completedTasks: tasks.filter(function(task) { return task.status === 'Done'; }).length,
    readyJobs: jobs.filter(function(job) { return Number(job.overall_match || 0) >= 80; }).length,
    appliedJobs: jobs.filter(function(job) { return job.status === 'Applied'; }).length
  };
}
