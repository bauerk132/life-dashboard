'use strict';

/**
 * Life Dashboard — JSearch / RapidAPI Source Adapter (Phase 4A)
 *
 * Implements the external job discovery source adapter for JSearch by
 * OpenWeb Ninja via RapidAPI. Enforces strict schema validation, Free-tier
 * budget tracking (200 req/mo hard cap), candidate normalization,
 * deterministic query catalog rotation, and zero key/PII leakage.
 *
 * All top-level constants are prefixed with JSEARCH_.
 * All functions are private with a trailing underscore (_) to prevent
 * accidental exposure to the browser via google.script.run.
 */

const JSEARCH_ADAPTER_VERSION_ = '4A.1';
const JSEARCH_NORMALIZER_VERSION_ = 'jsearch-normalize-v1';
const JSEARCH_HOST_ = 'jsearch.p.rapidapi.com';
const JSEARCH_PATH_ = '/search-v2';

const JSEARCH_PLAN_MONTHLY_LIMIT_ = 200;
const JSEARCH_SCHEDULED_DAILY_CAP_ = 5;
const JSEARCH_MANUAL_DAILY_CAP_ = 3;
const JSEARCH_PERIOD_RESERVE_ = 20;

const JSEARCH_TIME_ZONE_ = 'America/New_York';
const JSEARCH_MAX_BODY_CHARS_ = 2000000;
const JSEARCH_MAX_JOBS_PER_PAGE_ = 100;
const JSEARCH_MAX_DESCRIPTION_CHARS_ = 20000;
const JSEARCH_TIMEOUT_SECONDS_ = 30;

const JSEARCH_DEFAULT_ENABLED_PUBLISHERS_ = Object.freeze(['linkedin']);

/**
 * Frozen catalog of 13 approved queries across 3 priority tracks.
 * Strictly free of candidate resume text, personal identifiers, or addresses.
 */
const JSEARCH_QUERY_CATALOG_ = Object.freeze([
  // Priority 1 — IT support track (always >= 3 slots per day)
  { id: 'p1-helpdesk-pgh',       priority: 1, remote: false, query: 'help desk technician in Pittsburgh, PA' },
  { id: 'p1-itsupport-pgh',      priority: 1, remote: false, query: 'IT support specialist in Pittsburgh, PA' },
  { id: 'p1-desktop-pgh',        priority: 1, remote: false, query: 'desktop support technician in Pittsburgh, PA' },
  { id: 'p1-techsupport-pgh',    priority: 1, remote: false, query: 'technical support specialist in Pittsburgh, PA' },
  { id: 'p1-servicedesk-pgh',    priority: 1, remote: false, query: 'service desk analyst in Pittsburgh, PA' },
  { id: 'p1-helpdesk-remote',    priority: 1, remote: true,  query: 'remote help desk technician' },
  { id: 'p1-itsupport-remote',   priority: 1, remote: true,  query: 'remote IT support specialist' },
  { id: 'p1-techsupport-remote', priority: 1, remote: true,  query: 'remote technical support specialist' },
  // Priority 2 — coordination/administration track
  { id: 'p2-officeadmin-pgh',    priority: 2, remote: false, query: 'office administrator in Pittsburgh, PA' },
  { id: 'p2-opscoord-pgh',       priority: 2, remote: false, query: 'operations coordinator in Pittsburgh, PA' },
  { id: 'p2-logistics-pgh',      priority: 2, remote: false, query: 'logistics coordinator in Pittsburgh, PA' },
  // Priority 3 — non-sales customer support track
  { id: 'p3-custsupport-pgh',    priority: 3, remote: false, query: 'customer support specialist in Pittsburgh, PA' },
  { id: 'p3-custsupport-remote', priority: 3, remote: true,  query: 'remote customer support representative' }
]);

/**
 * Builds a deterministic query list for one America/New_York calendar day.
 * Pure function.
 *
 * @param {string} dateKey - 'YYYY-MM-DD'
 * @returns {Array<Object>} List of up to 5 frozen catalog query objects.
 */
function jsearchBuildDailyQueries_(dateKey) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw UserError_('Invalid dateKey format: expected YYYY-MM-DD', 'INVALID_DATE_KEY');
  }
  const parsedMs = Date.parse(dateKey + 'T00:00:00Z');
  if (isNaN(parsedMs)) {
    throw UserError_('Invalid dateKey values: ' + dateKey, 'INVALID_DATE_KEY');
  }

  const dayIndex = Math.floor(parsedMs / 86400000);
  const p1 = JSEARCH_QUERY_CATALOG_.filter(function (q) { return q.priority === 1; });
  const p2 = JSEARCH_QUERY_CATALOG_.filter(function (q) { return q.priority === 2; });
  const p3 = JSEARCH_QUERY_CATALOG_.filter(function (q) { return q.priority === 3; });

  const p1Start = ((dayIndex % p1.length) + p1.length) % p1.length;
  const p1Selected = [
    p1[p1Start],
    p1[(p1Start + 1) % p1.length],
    p1[(p1Start + 2) % p1.length]
  ];

  const p2Index = ((dayIndex % p2.length) + p2.length) % p2.length;
  const p2Selected = p2[p2Index];

  const p3Index = ((dayIndex % p3.length) + p3.length) % p3.length;
  const p3Selected = p3[p3Index];

  const combined = p1Selected.concat([p2Selected, p3Selected]).slice(0, JSEARCH_SCHEDULED_DAILY_CAP_);
  return combined.map(function (q) {
    return Object.freeze(Object.assign({}, q));
  });
}

/**
 * Validates that a query entry originates from the frozen catalog.
 * Throws UserError_('...', 'UNKNOWN_QUERY') if unknown or modified.
 *
 * @param {Object} queryEntry
 * @returns {Object} Matching catalog entry
 */
function jsearchValidateQueryEntry_(queryEntry) {
  if (!queryEntry || typeof queryEntry !== 'object' || typeof queryEntry.id !== 'string') {
    throw UserError_('Invalid query entry provided', 'UNKNOWN_QUERY');
  }
  const match = JSEARCH_QUERY_CATALOG_.find(function (q) { return q.id === queryEntry.id; });
  if (!match || match.query !== queryEntry.query) {
    throw UserError_('Unknown or modified query entry', 'UNKNOWN_QUERY');
  }
  return match;
}

/**
 * Default quota state structure.
 */
function jsearchCreateDefaultQuotaState_(dayKey, periodKey) {
  return {
    version: 1,
    dayKey: dayKey,
    dayCountScheduled: 0,
    dayCountManual: 0,
    periodKey: periodKey,
    periodCount: 0,
    lastRemaining: null,
    lastLimit: null,
    lastResetAt: null,
    blockedUntil: null,
    lastObservedDelta: null,
    updatedAt: null
  };
}

/**
 * Loads, validates, and rolls over quota state from Script Properties.
 *
 * @param {Date} nowDate
 * @returns {{ state: Object, stateRecovered: boolean }}
 */
function jsearchLoadQuotaState_(nowDate) {
  const dayKey = Utilities.formatDate(nowDate, JSEARCH_TIME_ZONE_, 'yyyy-MM-dd');
  const calPeriodKey = 'cal:' + Utilities.formatDate(nowDate, JSEARCH_TIME_ZONE_, 'yyyy-MM');
  let state = null;
  let stateRecovered = false;

  const raw = PropertiesService.getScriptProperties().getProperty('JSEARCH_QUOTA_STATE');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.version === 1) {
        state = parsed;
      } else {
        stateRecovered = true;
      }
    } catch (err) {
      stateRecovered = true;
    }
  } else {
    stateRecovered = true;
  }

  if (!state) {
    state = jsearchCreateDefaultQuotaState_(dayKey, calPeriodKey);
  }

  // Daily roll-over
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.dayCountScheduled = 0;
    state.dayCountManual = 0;
  }

  // Period roll-over
  if (state.lastResetAt) {
    const resetDate = new Date(state.lastResetAt);
    if (!isNaN(resetDate.getTime()) && nowDate.getTime() >= resetDate.getTime()) {
      state.periodCount = 0;
      state.lastRemaining = null;
      state.lastResetAt = null;
      state.periodKey = calPeriodKey;
      state.blockedUntil = null;
    }
  } else {
    if (state.periodKey !== calPeriodKey) {
      state.periodKey = calPeriodKey;
      state.periodCount = 0;
      state.lastRemaining = null;
      state.blockedUntil = null;
    }
  }

  return { state: state, stateRecovered: stateRecovered };
}

/**
 * Proactively checks whether a request can be made under current quota limits.
 *
 * @param {Object} state
 * @param {string} mode - 'scheduled' | 'manual'
 * @param {Date} nowDate
 * @returns {boolean} true if allowed, false if budget blocked
 */
function jsearchCheckQuotaBudget_(state, mode, nowDate) {
  const nowTime = nowDate.getTime();
  if (state.blockedUntil) {
    const blockedTime = new Date(state.blockedUntil).getTime();
    if (!isNaN(blockedTime) && nowTime < blockedTime) {
      return false;
    }
  }
  if (state.lastRemaining !== null && state.lastRemaining <= 0) {
    return false;
  }
  if (mode === 'scheduled') {
    if (state.dayCountScheduled >= JSEARCH_SCHEDULED_DAILY_CAP_) {
      return false;
    }
    if (state.periodCount >= (JSEARCH_PLAN_MONTHLY_LIMIT_ - JSEARCH_PERIOD_RESERVE_)) {
      return false;
    }
    if (state.lastRemaining !== null && state.lastRemaining <= JSEARCH_PERIOD_RESERVE_) {
      return false;
    }
  } else {
    if (state.dayCountManual >= JSEARCH_MANUAL_DAILY_CAP_) {
      return false;
    }
  }
  if (state.periodCount >= JSEARCH_PLAN_MONTHLY_LIMIT_) {
    return false;
  }
  return true;
}

/**
 * Reserves one request unit and persists quota state to Script Properties.
 *
 * @param {Object} state
 * @param {string} mode
 * @param {Date} nowDate
 */
function jsearchReserveQuota_(state, mode, nowDate) {
  if (mode === 'scheduled') {
    state.dayCountScheduled = (state.dayCountScheduled || 0) + 1;
  } else {
    state.dayCountManual = (state.dayCountManual || 0) + 1;
  }
  state.periodCount = (state.periodCount || 0) + 1;
  state.updatedAt = nowDate.toISOString();
  PropertiesService.getScriptProperties().setProperty('JSEARCH_QUOTA_STATE', JSON.stringify(state));
}

/**
 * Constructs the query URL with fixed parameter order and URL encoding.
 *
 * @param {Object} queryEntry
 * @returns {string} URL string
 */
function jsearchBuildQueryUrl_(queryEntry) {
  const params = [
    'query=' + encodeURIComponent(queryEntry.query),
    'num_pages=' + encodeURIComponent('1'),
    'date_posted=' + encodeURIComponent('3days'),
    'country=' + encodeURIComponent('us'),
    'language=' + encodeURIComponent('en')
  ];
  if (queryEntry.remote === true) {
    params.push('work_from_home=' + encodeURIComponent('true'));
  }
  return 'https://' + JSEARCH_HOST_ + JSEARCH_PATH_ + '?' + params.join('&');
}

/**
 * Executes exactly one HTTPS GET request using UrlFetchApp.
 * Single authorized outbound network call site across the entire codebase.
 *
 * @param {string} url
 * @param {string} apiKey
 * @returns {HTTPResponse}
 */
function jsearchSendRequest_(url, apiKey) {
  return UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': JSEARCH_HOST_
    },
    muteHttpExceptions: true,
    followRedirects: false,
    validateHttpsCertificates: true,
    timeoutSeconds: JSEARCH_TIMEOUT_SECONDS_
  });
}

/**
 * Plain-text cleaner for untrusted job text.
 * Strips script/style, HTML tags, control chars; decodes entities with &amp; last.
 * Preserves formula prefix characters (=, +, -, @) verbatim for Phase 4B persistence.
 *
 * @param {*} value
 * @param {number} [maxChars]
 * @param {boolean} [appendTruncated]
 * @returns {string}
 */
function jsearchCleanText_(value, maxChars, appendTruncated) {
  if (typeof value !== 'string') return '';
  let s = value;

  // Strip script and style contents
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Convert break/block tags to newlines
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<\/div>/gi, '\n');

  // Strip all remaining HTML tags
  s = s.replace(/<[^>]+>/g, '');

  // Entity decoding with &amp; strictly last to prevent double-unescaping attacks
  s = s.replace(/&lt;/gi, '<');
  s = s.replace(/&gt;/gi, '>');
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/&#39;/gi, "'");
  s = s.replace(/&apos;/gi, "'");
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&#(\d+);/g, function (match, dec) {
    const code = parseInt(dec, 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, function (match, hex) {
    const code = parseInt(hex, 16);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  s = s.replace(/&amp;/gi, '&');

  // Remove control characters except \n and \t; convert \t to space
  s = s.replace(/\t/g, ' ');
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

  // Collapse spaces and excessive newlines
  s = s.replace(/[^\S\n]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.trim();

  if (maxChars && maxChars > 0 && s.length > maxChars) {
    if (appendTruncated) {
      s = s.slice(0, maxChars) + ' …[truncated]';
    } else {
      s = s.slice(0, maxChars);
    }
  }

  return s;
}

/**
 * Validates and canonicalizes candidate URLs against validateSourceUrl_.
 *
 * @param {string} rawUrl
 * @returns {string|null} Canonical URL or null if invalid
 */
function jsearchCanonicalizeUrlCandidate_(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  let u = rawUrl.trim();
  if (!/^https?:\/\//i.test(u)) return null;

  // Strip fragment
  u = u.split('#')[0];

  const qIndex = u.indexOf('?');
  let base = qIndex === -1 ? u : u.slice(0, qIndex);
  const queryString = qIndex === -1 ? '' : u.slice(qIndex + 1);

  // Lowercase scheme and host only
  const match = base.match(/^(https?:\/\/)([^/?#]+)(.*)$/i);
  if (!match) return null;
  base = match[1].toLowerCase() + match[2].toLowerCase() + match[3];

  let cleanQuery = '';
  if (queryString) {
    const parts = queryString.split('&');
    const kept = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      const eq = p.indexOf('=');
      const key = eq === -1 ? p : p.slice(0, eq);
      if (!/^utm_/i.test(key)) {
        kept.push(p);
      }
    }
    if (kept.length > 0) {
      cleanQuery = '?' + kept.join('&');
    }
  }

  const finalUrl = base + cleanQuery;
  if (finalUrl.length > 2048) return null;

  try {
    validateSourceUrl_(finalUrl);
    return finalUrl;
  } catch (err) {
    return null;
  }
}

/**
 * Selects the first valid URL from apply link, matching apply options, or google link.
 *
 * @param {Object} job
 * @param {string} source - 'linkedin' | 'indeed'
 * @returns {string|null}
 */
function jsearchSelectCanonicalUrl_(job, source) {
  // 1. job_apply_link
  if (job.job_apply_link) {
    const c1 = jsearchCanonicalizeUrlCandidate_(job.job_apply_link);
    if (c1) return c1;
  }

  // 2. First matching apply_option for candidate's source
  if (Array.isArray(job.apply_options)) {
    for (let i = 0; i < job.apply_options.length; i++) {
      const opt = job.apply_options[i];
      if (opt && typeof opt === 'object' && opt.apply_link) {
        const pub = (opt.publisher || '').trim().toLowerCase();
        let optSource = '';
        if (pub.indexOf('linkedin') !== -1) optSource = 'linkedin';
        else if (pub.indexOf('indeed') !== -1) optSource = 'indeed';
        if (optSource === source) {
          const c2 = jsearchCanonicalizeUrlCandidate_(opt.apply_link);
          if (c2) return c2;
        }
      }
    }
  }

  // 3. job_google_link
  if (job.job_google_link) {
    const c3 = jsearchCanonicalizeUrlCandidate_(job.job_google_link);
    if (c3) return c3;
  }

  return null;
}

/**
 * Computes deterministic SHA-256 canonical content hash.
 *
 * @param {string} source
 * @param {string} title
 * @param {string} company
 * @param {string} location
 * @param {string} description
 * @returns {string}
 */
function jsearchComputeContentHash_(source, title, company, location, description) {
  const canonical = [
    source,
    (title || '').toLowerCase(),
    (company || '').toLowerCase(),
    (location || '').toLowerCase(),
    description || ''
  ].join('\u241F');

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    canonical,
    Utilities.Charset.UTF_8
  );

  const hex = digest.map(function (b) {
    const v = b < 0 ? b + 256 : b;
    return v.toString(16).padStart(2, '0');
  }).join('');

  return 'jsearch-content-v1:' + hex;
}

/**
 * Evaluates and normalizes raw job records returned by JSearch.
 *
 * @param {Array<*>} rawJobs
 * @param {Array<string>} enabledPublishers
 * @param {Date} nowDate
 * @returns {{ candidates: Array<Object>, quarantined: Array<Object>, droppedByPublisher: Object }}
 */
function jsearchNormalizeJobs_(rawJobs, enabledPublishers, nowDate) {
  const candidates = [];
  const quarantined = [];
  const droppedByPublisher = { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 };

  for (let idx = 0; idx < rawJobs.length; idx++) {
    const job = rawJobs[idx];

    // Rule 1: Plain Object Check
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      quarantined.push({ index: idx, reason: 'NOT_AN_OBJECT' });
      continue;
    }

    // Rule 2: Publisher Mapping
    const rawPub = typeof job.job_publisher === 'string' ? job.job_publisher.trim() : '';
    const lowerPub = rawPub.toLowerCase();
    let source = '';
    if (lowerPub.indexOf('linkedin') !== -1) {
      source = 'linkedin';
    } else if (lowerPub.indexOf('indeed') !== -1) {
      source = 'indeed';
    } else {
      if (lowerPub.indexOf('glassdoor') !== -1) {
        droppedByPublisher.glassdoor += 1;
      } else if (lowerPub.indexOf('ziprecruiter') !== -1) {
        droppedByPublisher.ziprecruiter += 1;
      } else {
        droppedByPublisher.other += 1;
      }
      continue;
    }

    if (enabledPublishers.indexOf(source) === -1) {
      if (source === 'indeed') {
        droppedByPublisher.indeed += 1;
      } else {
        droppedByPublisher.other += 1;
      }
      continue;
    }

    // Rule 3: Job ID Check
    if (typeof job.job_id !== 'string') {
      quarantined.push({ index: idx, reason: 'MISSING_EXTERNAL_ID' });
      continue;
    }
    const externalId = job.job_id.trim();
    if (!externalId) {
      quarantined.push({ index: idx, reason: 'MISSING_EXTERNAL_ID' });
      continue;
    }
    if (externalId.length > 256 || /[\x00-\x1f\x7f]/.test(externalId)) {
      quarantined.push({ index: idx, reason: 'INVALID_EXTERNAL_ID' });
      continue;
    }

    // Rule 4: Job Title Check
    if (typeof job.job_title !== 'string') {
      quarantined.push({ index: idx, reason: 'MISSING_TITLE' });
      continue;
    }
    const cleanedTitle = jsearchCleanText_(job.job_title, 300, false);
    if (!cleanedTitle) {
      quarantined.push({ index: idx, reason: 'MISSING_TITLE' });
      continue;
    }

    // Rule 5: Employer Name Check
    if (typeof job.employer_name !== 'string') {
      quarantined.push({ index: idx, reason: 'MISSING_COMPANY' });
      continue;
    }
    const cleanedCompany = jsearchCleanText_(job.employer_name, 200, false);
    if (!cleanedCompany) {
      quarantined.push({ index: idx, reason: 'MISSING_COMPANY' });
      continue;
    }

    // Rule 6: URL Selection & Canonicalization
    const canonicalUrl = jsearchSelectCanonicalUrl_(job, source);
    if (!canonicalUrl) {
      quarantined.push({ index: idx, reason: 'MISSING_VALID_URL' });
      continue;
    }

    // Rule 7: Salary Check
    let salaryMin = null;
    let salaryMax = null;
    let salaryPeriod = '';
    let hasInvalidSalary = false;

    if (job.job_min_salary !== undefined && job.job_min_salary !== null && job.job_min_salary !== '') {
      if (typeof job.job_min_salary !== 'number' || !isFinite(job.job_min_salary) || job.job_min_salary <= 0 || job.job_min_salary >= 10000000) {
        hasInvalidSalary = true;
      } else {
        salaryMin = job.job_min_salary;
      }
    }

    if (job.job_max_salary !== undefined && job.job_max_salary !== null && job.job_max_salary !== '') {
      if (typeof job.job_max_salary !== 'number' || !isFinite(job.job_max_salary) || job.job_max_salary <= 0 || job.job_max_salary >= 10000000) {
        hasInvalidSalary = true;
      } else {
        salaryMax = job.job_max_salary;
      }
    }

    if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
      hasInvalidSalary = true;
    }

    if (job.job_salary_period !== undefined && job.job_salary_period !== null && job.job_salary_period !== '') {
      if (typeof job.job_salary_period === 'string' && ['HOUR', 'YEAR', 'MONTH', 'WEEK'].indexOf(job.job_salary_period) !== -1) {
        salaryPeriod = job.job_salary_period;
      } else {
        hasInvalidSalary = true;
      }
    }

    if (hasInvalidSalary) {
      quarantined.push({ index: idx, reason: 'INVALID_SALARY' });
      continue;
    }

    // Rule 8: Posted Date Check
    let postedAt = '';
    if (job.job_posted_at_datetime_utc !== undefined && job.job_posted_at_datetime_utc !== null && job.job_posted_at_datetime_utc !== '') {
      if (typeof job.job_posted_at_datetime_utc !== 'string') {
        quarantined.push({ index: idx, reason: 'INVALID_POSTED_AT' });
        continue;
      }
      const dt = new Date(job.job_posted_at_datetime_utc);
      const minDate = new Date('2000-01-01T00:00:00.000Z');
      const maxDate = new Date(nowDate.getTime() + 2 * 24 * 60 * 60 * 1000);
      if (isNaN(dt.getTime()) || dt < minDate || dt > maxDate) {
        quarantined.push({ index: idx, reason: 'INVALID_POSTED_AT' });
        continue;
      }
      postedAt = dt.toISOString();
    }

    // Rule 9: Coordinates & Location Normalization
    let latitude = null;
    let longitude = null;
    if (typeof job.job_latitude === 'number' && isFinite(job.job_latitude) && job.job_latitude >= -90 && job.job_latitude <= 90) {
      latitude = job.job_latitude;
    }
    if (typeof job.job_longitude === 'number' && isFinite(job.job_longitude) && job.job_longitude >= -180 && job.job_longitude <= 180) {
      longitude = job.job_longitude;
    }

    // Location construction
    const city = jsearchCleanText_(job.job_city || '', 64, false);
    const state = jsearchCleanText_(job.job_state || '', 64, false);
    let location = '';
    if (city && state) {
      location = city + ', ' + state;
    } else if (city) {
      location = city;
    } else if (state) {
      location = state;
    } else if (job.job_is_remote === true) {
      location = 'Remote';
    }

    // Remote normalization via Jobs.gs
    const remote = normalizeRemote_(typeof job.job_is_remote === 'boolean' ? job.job_is_remote : '');

    // Currency
    let currency = '';
    if (typeof job.job_salary_currency === 'string' && /^[A-Z]{3}$/i.test(job.job_salary_currency.trim())) {
      currency = job.job_salary_currency.trim().toUpperCase();
    }

    // Salary source
    const salarySource = (salaryMin !== null || salaryMax !== null) ? 'provider' : '';

    // Employment types
    let employmentTypes = [];
    if (Array.isArray(job.job_employment_types)) {
      employmentTypes = job.job_employment_types
        .filter(function (t) { return typeof t === 'string' && t.trim() !== ''; })
        .map(function (t) { return t.trim().toUpperCase(); });
    } else if (typeof job.job_employment_type === 'string' && job.job_employment_type.trim() !== '') {
      employmentTypes = [job.job_employment_type.trim().toUpperCase()];
    }

    // Country
    const country = typeof job.job_country === 'string' ? job.job_country.trim() : '';

    // Publisher raw
    const publisherRaw = rawPub.slice(0, 64);

    // Description cleaning (20k chars limit + truncation marker)
    const description = jsearchCleanText_(job.job_description, JSEARCH_MAX_DESCRIPTION_CHARS_, true);

    // Canonical content hash
    const contentHash = jsearchComputeContentHash_(source, cleanedTitle, cleanedCompany, location, description);

    candidates.push({
      normalizerVersion: JSEARCH_NORMALIZER_VERSION_,
      route: 'jsearch',
      source: source,
      external_id: externalId,
      url: canonicalUrl,
      title: cleanedTitle,
      company: cleanedCompany,
      location: location,
      remote: remote,
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_period: salaryPeriod,
      currency: currency,
      salary_source: salarySource,
      posted_at: postedAt,
      employment_types: employmentTypes,
      latitude: latitude,
      longitude: longitude,
      country: country,
      publisher_raw: publisherRaw,
      description: description,
      content_hash: contentHash
    });
  }

  return {
    candidates: candidates,
    quarantined: quarantined,
    droppedByPublisher: droppedByPublisher
  };
}

/**
 * Extracts case-insensitive header value from an HTTP response.
 *
 * @param {Object} headers - Response headers
 * @param {string} name - Header name in lowercase
 * @returns {string|null}
 */
function jsearchGetHeaderCaseInsensitive_(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const target = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === target) {
      return headers[keys[i]];
    }
  }
  return null;
}

/**
 * Realm-safe date resolver. Checks for getTime method rather than instanceof Date
 * to safely accept host-realm Date objects passed across vm context boundaries.
 *
 * @param {*} dateValue
 * @returns {Date}
 */
function jsearchResolveNowDate_(dateValue) {
  if (dateValue && typeof dateValue.getTime === 'function' && !isNaN(dateValue.getTime())) {
    return dateValue;
  }
  return new Date();
}

/**
 * Executes one billed request to JSearch with full lifecycle management:
 * Check -> Reserve -> Transmit -> Record -> Classify -> Normalize.
 *
 * Caller MUST hold the script lock via withLock_.
 *
 * @param {Object} queryEntry - Query object from JSEARCH_QUERY_CATALOG_
 * @param {Object} options - { mode: 'scheduled' | 'manual', nowDate: Date, enabledPublishers?: string[] }
 * @returns {Object} JSearchResult envelope
 */
function jsearchFetchPage_(queryEntry, options) {
  options = options || {};
  const nowDate = jsearchResolveNowDate_(options.nowDate);
  const mode = options.mode === 'manual' ? 'manual' : 'scheduled';
  const enabledPublishers = Array.isArray(options.enabledPublishers)
    ? options.enabledPublishers
    : JSEARCH_DEFAULT_ENABLED_PUBLISHERS_;

  // Validate queryEntry against catalog
  const validatedQuery = jsearchValidateQueryEntry_(queryEntry);

  // 1. Script Property API Key verification
  const apiKey = PropertiesService.getScriptProperties().getProperty('JSEARCH_RAPIDAPI_KEY');
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'NOT_CONFIGURED',
      retryable: false,
      disableSource: false,
      httpStatus: null,
      providerRequestId: '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: false,
        remainingBefore: null,
        remainingAfter: null,
        observedDelta: null,
        limitHeader: null,
        resetSecondsHeader: null,
        periodCount: 0,
        dayCount: 0,
        blockedUntil: null
      },
      message: 'JSearch API key is missing or not configured in Script Properties.'
    };
  }

  // 2. Load quota state and check budget
  const quotaLoad = jsearchLoadQuotaState_(nowDate);
  const quotaState = quotaLoad.state;
  const remainingBefore = quotaState.lastRemaining;

  if (!jsearchCheckQuotaBudget_(quotaState, mode, nowDate)) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'BUDGET_BLOCKED',
      retryable: false,
      disableSource: false,
      httpStatus: null,
      providerRequestId: '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: false,
        remainingBefore: remainingBefore,
        remainingAfter: remainingBefore,
        observedDelta: null,
        limitHeader: quotaState.lastLimit,
        resetSecondsHeader: null,
        periodCount: quotaState.periodCount,
        dayCount: mode === 'scheduled' ? quotaState.dayCountScheduled : quotaState.dayCountManual,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'Request blocked by JSearch quota guard budget limits.'
    };
  }

  // 3. Reserve quota unit before transmit
  jsearchReserveQuota_(quotaState, mode, nowDate);
  const currentDayCount = mode === 'scheduled' ? quotaState.dayCountScheduled : quotaState.dayCountManual;

  // 4. Transmit request
  const requestUrl = jsearchBuildQueryUrl_(validatedQuery);
  let response = null;

  try {
    response = jsearchSendRequest_(requestUrl, apiKey);
  } catch (err) {
    const errMsg = err && err.message ? String(err.message) : String(err);
    const isTimeout = /timeout|timed out/i.test(errMsg);
    const errStatus = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
    const errMessage = isTimeout ? 'Request to JSearch timed out.' : 'Network error communicating with JSearch.';

    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: errStatus,
      retryable: true,
      disableSource: false,
      httpStatus: null,
      providerRequestId: '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingBefore,
        observedDelta: null,
        limitHeader: quotaState.lastLimit,
        resetSecondsHeader: null,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: errMessage
    };
  }

  // 5. Parse response headers and update quota state
  const httpStatus = response.getResponseCode();
  const rawHeaders = response.getHeaders() || {};

  const remainingStr = jsearchGetHeaderCaseInsensitive_(rawHeaders, 'x-ratelimit-requests-remaining');
  const limitStr = jsearchGetHeaderCaseInsensitive_(rawHeaders, 'x-ratelimit-requests-limit');
  const resetStr = jsearchGetHeaderCaseInsensitive_(rawHeaders, 'x-ratelimit-requests-reset');
  const proxyHeader = jsearchGetHeaderCaseInsensitive_(rawHeaders, 'x-rapidapi-proxy-response');

  const remainingAfter = (remainingStr !== null && !isNaN(parseInt(remainingStr, 10)))
    ? parseInt(remainingStr, 10)
    : null;
  const limitHeader = (limitStr !== null && !isNaN(parseInt(limitStr, 10)))
    ? parseInt(limitStr, 10)
    : null;
  const resetSecondsHeader = (resetStr !== null && !isNaN(parseFloat(resetStr)) && parseFloat(resetStr) >= 0)
    ? parseFloat(resetStr)
    : null;

  const observedDelta = (remainingBefore !== null && remainingAfter !== null)
    ? (remainingBefore - remainingAfter)
    : null;

  if (remainingAfter !== null) {
    quotaState.lastRemaining = remainingAfter;
  }
  if (limitHeader !== null) {
    quotaState.lastLimit = limitHeader;
  }
  if (resetSecondsHeader !== null) {
    quotaState.lastResetAt = new Date(nowDate.getTime() + resetSecondsHeader * 1000).toISOString();
    quotaState.periodKey = 'hdr:' + Utilities.formatDate(new Date(quotaState.lastResetAt), JSEARCH_TIME_ZONE_, 'yyyy-MM-dd');
  }
  if (observedDelta !== null) {
    quotaState.lastObservedDelta = observedDelta;
  }

  // 6. Classification Matrix (§9.4 rows 5 - 20)
  let status = 'OK';
  let ok = true;
  let retryable = false;
  let disableSource = false;
  let message = '';

  if (httpStatus === 401 || httpStatus === 403) {
    status = 'AUTH_FAILED';
    ok = false;
    retryable = false;
    disableSource = true;
    message = 'JSearch authentication failed; check RapidAPI key configuration.';
  } else if (httpStatus === 404) {
    if (proxyHeader && String(proxyHeader).toLowerCase() === 'true') {
      status = 'NOT_SUBSCRIBED_OR_RETIRED';
      ok = false;
      retryable = false;
      disableSource = true;
      message = 'JSearch API endpoint retired or account not subscribed on RapidAPI.';
    } else {
      status = 'NOT_FOUND';
      ok = false;
      retryable = false;
      disableSource = true;
      message = 'JSearch endpoint returned 404 Not Found.';
    }
  } else if (httpStatus === 429) {
    if (remainingAfter === null || remainingAfter <= 0) {
      status = 'QUOTA_EXHAUSTED';
      ok = false;
      retryable = false;
      disableSource = false;
      message = 'JSearch monthly quota exhausted.';
      quotaState.blockedUntil = quotaState.lastResetAt || new Date(nowDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
    } else {
      status = 'RATE_LIMITED';
      ok = false;
      retryable = true;
      disableSource = false;
      message = 'JSearch rate limited; short-term cooldown applied.';
      quotaState.blockedUntil = new Date(nowDate.getTime() + 60 * 60 * 1000).toISOString();
    }
  } else if (httpStatus >= 500 && httpStatus <= 599) {
    status = 'UPSTREAM_ERROR';
    ok = false;
    retryable = true;
    disableSource = false;
    message = 'JSearch provider returned upstream server error.';
  } else if (httpStatus !== 200) {
    status = 'UNEXPECTED_STATUS';
    ok = false;
    retryable = false;
    disableSource = false;
    message = 'Unexpected HTTP status returned by JSearch.';
  }

  // Persist updated quota state after header processing
  quotaState.updatedAt = nowDate.toISOString();
  PropertiesService.getScriptProperties().setProperty('JSEARCH_QUOTA_STATE', JSON.stringify(quotaState));

  if (!ok) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: status,
      retryable: retryable,
      disableSource: disableSource,
      httpStatus: httpStatus,
      providerRequestId: '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: message
    };
  }

  // Content-Type verification
  const contentType = jsearchGetHeaderCaseInsensitive_(rawHeaders, 'content-type') || '';
  if (!/^application\/json/i.test(contentType.trim())) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'BAD_CONTENT_TYPE',
      retryable: false,
      disableSource: false,
      httpStatus: httpStatus,
      providerRequestId: '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'JSearch returned unexpected non-JSON Content-Type.'
    };
  }

  // Response body size check
  const bodyText = response.getContentText() || '';
  if (bodyText.length > JSEARCH_MAX_BODY_CHARS_) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'OVERSIZED',
      retryable: false,
      disableSource: false,
      httpStatus: httpStatus,
      providerRequestId: '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'JSearch response body exceeded maximum permitted length.'
    };
  }

  // JSON parsing
  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch (err) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'MALFORMED',
      retryable: false,
      disableSource: false,
      httpStatus: httpStatus,
      providerRequestId: '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'JSearch response body contained invalid JSON.'
    };
  }

  // Provider status check
  if (!bodyJson || typeof bodyJson !== 'object' || Array.isArray(bodyJson) || bodyJson.status !== 'OK') {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'PROVIDER_ERROR',
      retryable: false,
      disableSource: false,
      httpStatus: httpStatus,
      providerRequestId: (bodyJson && typeof bodyJson.request_id === 'string') ? bodyJson.request_id.slice(0, 128) : '',
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'JSearch provider returned status error.'
    };
  }

  const providerRequestId = typeof bodyJson.request_id === 'string' ? bodyJson.request_id.slice(0, 128) : '';

  // Data envelope check (reject legacy /search array format)
  if (!bodyJson.data || typeof bodyJson.data !== 'object' || Array.isArray(bodyJson.data) || !Array.isArray(bodyJson.data.jobs)) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'MALFORMED',
      retryable: false,
      disableSource: false,
      httpStatus: httpStatus,
      providerRequestId: providerRequestId,
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: '',
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'JSearch response data envelope is malformed.'
    };
  }

  const jobsList = bodyJson.data.jobs;
  const cursor = (typeof bodyJson.data.cursor === 'string') ? bodyJson.data.cursor.slice(0, 512) : '';

  // Jobs length checks
  if (jobsList.length > JSEARCH_MAX_JOBS_PER_PAGE_) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: false,
      status: 'OVERSIZED',
      retryable: false,
      disableSource: false,
      httpStatus: httpStatus,
      providerRequestId: providerRequestId,
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: cursor,
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'JSearch returned job count exceeding page limit.'
    };
  }

  if (jobsList.length === 0) {
    return {
      adapterVersion: JSEARCH_ADAPTER_VERSION_,
      route: 'jsearch',
      queryId: validatedQuery.id,
      mode: mode,
      ok: true,
      status: 'EMPTY',
      retryable: false,
      disableSource: false,
      httpStatus: httpStatus,
      providerRequestId: providerRequestId,
      candidates: [],
      quarantined: [],
      droppedByPublisher: { glassdoor: 0, ziprecruiter: 0, other: 0, indeed: 0 },
      cursor: cursor,
      quota: {
        reserved: true,
        remainingBefore: remainingBefore,
        remainingAfter: remainingAfter,
        observedDelta: observedDelta,
        limitHeader: limitHeader,
        resetSecondsHeader: resetSecondsHeader,
        periodCount: quotaState.periodCount,
        dayCount: currentDayCount,
        blockedUntil: quotaState.blockedUntil
      },
      message: 'JSearch returned an empty job list.'
    };
  }

  // Row 20: Normalize candidate jobs
  const normalized = jsearchNormalizeJobs_(jobsList, enabledPublishers, nowDate);

  return {
    adapterVersion: JSEARCH_ADAPTER_VERSION_,
    route: 'jsearch',
    queryId: validatedQuery.id,
    mode: mode,
    ok: true,
    status: 'OK',
    retryable: false,
    disableSource: false,
    httpStatus: httpStatus,
    providerRequestId: providerRequestId,
    candidates: normalized.candidates,
    quarantined: normalized.quarantined,
    droppedByPublisher: normalized.droppedByPublisher,
    cursor: cursor,
    quota: {
      reserved: true,
      remainingBefore: remainingBefore,
      remainingAfter: remainingAfter,
      observedDelta: observedDelta,
      limitHeader: limitHeader,
      resetSecondsHeader: resetSecondsHeader,
      periodCount: quotaState.periodCount,
      dayCount: currentDayCount,
      blockedUntil: quotaState.blockedUntil
    },
    message: ''
  };
}

/**
 * Returns a sanitized snapshot of the current quota tracking state.
 * Contains no secrets or sensitive data.
 *
 * @param {Date} [nowDate]
 * @returns {Object} Quota snapshot object
 */
function jsearchGetQuotaSnapshot_(nowDate) {
  const effectiveDate = jsearchResolveNowDate_(nowDate);
  const quotaLoad = jsearchLoadQuotaState_(effectiveDate);
  const state = quotaLoad.state;

  return {
    version: state.version,
    dayKey: state.dayKey,
    dayCountScheduled: state.dayCountScheduled,
    dayCountManual: state.dayCountManual,
    periodKey: state.periodKey,
    periodCount: state.periodCount,
    lastRemaining: state.lastRemaining,
    lastLimit: state.lastLimit,
    lastResetAt: state.lastResetAt,
    blockedUntil: state.blockedUntil,
    lastObservedDelta: state.lastObservedDelta,
    updatedAt: state.updatedAt,
    stateRecovered: quotaLoad.stateRecovered
  };
}
