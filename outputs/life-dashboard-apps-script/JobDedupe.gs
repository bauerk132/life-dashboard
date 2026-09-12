'use strict';

/**
 * Life Dashboard — Job Deduplication and Identity Resolution (Phase 4B)
 *
 * Implements the deterministic identity hierarchy from the Phase 4B frozen
 * contract (§5):
 *   L1 (source, external_id)          — strongest signal
 *   L2 (source, canonical URL hash)   — used only when no external_id
 *   L3 (source, content hash)         — used only when no external_id AND no URL
 *   In-run repeat                     — a fresh L1/L2/L3 match already
 *                                        touched/inserted earlier in this run
 *
 * `jobDedupeResolveCandidate_` is pure and read-only with respect to the
 * `index` object it is given: it never mutates `index` and never calls a
 * write method on it (it has none). The caller (Discovery.gs, Primary-owned)
 * is responsible for actually inserting/touching the Jobs sheet and for
 * updating its own index afterward.
 *
 * `jobDedupeComputeUrlHash_` and `jobDedupeComputeContentHash_` are FROZEN
 * names/arities: Primary calls these exact two functions, the same way, to
 * build the `index` object's lookup tables from stored Jobs rows read back
 * off the sheet. Do not rename, reorder args, or add optional params.
 *
 * All top-level functions in this file end in `_` (private / not
 * browser-callable), per the project's static allowlist check.
 */

const JOBDEDUPE_IDENTITY_VERSION_ = 'jobdedupe-identity-v1';
const JOBDEDUPE_URL_VERSION_ = 'jobdedupe-url-v1';
const JOBDEDUPE_CONTENT_VERSION_ = 'jobdedupe-content-v1';

// Documented tracking parameters stripped by jobDedupeCanonicalizeUrl_.
// Identity-relevant parameters (e.g. a job/posting id in the query string)
// are deliberately NOT in this list and are preserved.
const JOBDEDUPE_TRACKING_PARAMS_ = Object.freeze([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'refid', 'trackingid', 'trk', 'originalsubdomain', 'fbclid', 'gclid'
]);

/**
 * Strips known tracking parameters from a URL while preserving
 * identity-bearing parameters. Does not lowercase or otherwise rewrite the
 * URL beyond removing tracking params and a trailing slash on the path.
 *
 * @param {string} url
 * @returns {string} Canonical URL
 */
function jobDedupeCanonicalizeUrl_(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  const qIdx = trimmed.indexOf('?');
  if (qIdx === -1) {
    return trimmed.replace(/\/+$/, '');
  }

  const base = trimmed.substring(0, qIdx).replace(/\/+$/, '');
  const queryString = trimmed.substring(qIdx + 1);
  const hashIdx = queryString.indexOf('#');
  const queryOnly = hashIdx !== -1 ? queryString.substring(0, hashIdx) : queryString;

  const pairs = queryOnly.split('&').filter(Boolean);
  const kept = [];

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const eqIdx = pair.indexOf('=');
    const key = (eqIdx !== -1 ? pair.substring(0, eqIdx) : pair).toLowerCase();
    if (JOBDEDUPE_TRACKING_PARAMS_.indexOf(key) === -1) {
      kept.push(pair);
    }
  }

  kept.sort();
  return kept.length > 0 ? base + '?' + kept.join('&') : base;
}

/**
 * Strips exactly one leading `'` (apostrophe) from `value`, if present.
 *
 * Why: Database.gs writes a literal leading `'` onto any Sheet value that
 * would otherwise be parsed as a formula (values starting with = + - @, or
 * a tab/CR). A live Google Sheet treats that `'` purely as a text marker
 * and strips it on read; the in-memory test fake stores it literally. Since
 * Jobs has no separate hash column, L3 recomputes its hash from the stored
 * title/company/location/source columns at query time — if this strip were
 * missing, the same real row would hash differently depending on whether it
 * was read from the fake or from a live sheet, and rediscovery would
 * silently fail to dedupe. This normalizer lives inside the two hash
 * functions below (not as a separately-called helper) so every caller —
 * Builder B's own dedupe logic AND Primary's index-builder — inherits it
 * automatically just by calling jobDedupeComputeUrlHash_/
 * jobDedupeComputeContentHash_ normally.
 *
 * @param {*} value
 * @returns {string}
 */
function jobDedupeStripLeadingApostrophe_(value) {
  const text = (value === null || value === undefined) ? '' : String(value);
  return text.charAt(0) === '\'' ? text.slice(1) : text;
}

/**
 * Normalizes one content-hash input field: strips a leading apostrophe,
 * lowercases, and drops everything but letters/digits. This makes L3
 * resilient to whitespace/punctuation/case differences between two
 * scrapes of the same posting while staying a simple, versioned,
 * deterministic transform (bump JOBDEDUPE_CONTENT_VERSION_ if this ever
 * changes).
 *
 * @param {*} value
 * @returns {string}
 */
function jobDedupeNormalizeContentField_(value) {
  const stripped = jobDedupeStripLeadingApostrophe_(value);
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Hex SHA-256 digest of `text` using Utilities.computeDigest.
 *
 * @param {string} text
 * @returns {string} Hex-encoded digest
 */
function jobDedupeSha256Hex_(text) {
  const rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  let hex = '';
  for (let i = 0; i < rawBytes.length; i++) {
    const byteVal = (rawBytes[i] + 256) % 256;
    const hexVal = byteVal.toString(16);
    hex += hexVal.length === 1 ? '0' + hexVal : hexVal;
  }
  return hex;
}

/**
 * FROZEN name/arity. Returns a JOBDEDUPE_URL_VERSION_-namespaced hash of
 * (source + canonicalUrl). Callers (Builder B's own dedupe logic, and
 * Primary's index-builder) must pass a URL that has already been through
 * jobDedupeCanonicalizeUrl_ — this function does not canonicalize, it only
 * strips a leading apostrophe (see jobDedupeStripLeadingApostrophe_) and
 * hashes. `source` is not apostrophe-stripped: it is always exactly
 * 'linkedin' or 'indeed' (Jobs schema §4), never a Sheet-escaped value.
 *
 * @param {string} source
 * @param {string} canonicalUrl
 * @returns {string}
 */
function jobDedupeComputeUrlHash_(source, canonicalUrl) {
  const src = (source === null || source === undefined) ? '' : String(source);
  const url = jobDedupeStripLeadingApostrophe_(canonicalUrl);
  return JOBDEDUPE_URL_VERSION_ + ':' + jobDedupeSha256Hex_(src + '|' + url);
}

/**
 * FROZEN name/arity. Returns a JOBDEDUPE_CONTENT_VERSION_-namespaced hash
 * of the normalized (source|company|title|location) tuple, with the
 * one-leading-apostrophe strip (plus lowercasing and alphanumeric-only
 * normalization — see jobDedupeNormalizeContentField_) applied to
 * company/title/location before hashing. `source` is not normalized: see
 * jobDedupeComputeUrlHash_ above for why.
 *
 * @param {string} source
 * @param {string} company
 * @param {string} title
 * @param {string} location
 * @returns {string}
 */
function jobDedupeComputeContentHash_(source, company, title, location) {
  const src = (source === null || source === undefined) ? '' : String(source);
  const normCompany = jobDedupeNormalizeContentField_(company);
  const normTitle = jobDedupeNormalizeContentField_(title);
  const normLocation = jobDedupeNormalizeContentField_(location);
  const digest = jobDedupeSha256Hex_(src + '|' + normCompany + '|' + normTitle + '|' + normLocation);
  return JOBDEDUPE_CONTENT_VERSION_ + ':' + digest;
}

/**
 * Converts a candidate's raw, pre-normalization `remote` value (boolean,
 * a free-text string, or missing — see Phase 4B contract §1) into the
 * boolean actually stored in the Jobs sheet's `remote` column, using the
 * same normalizer JobFilters uses for filtering (Jobs.gs, read-only
 * reference; frozen behavior documented in contract §1). Nothing else in
 * the discovery pipeline rewrites the candidate before it reaches
 * dedupe's INSERT path, so this is the one place raw `remote` gets turned
 * into the clean boolean the rest of the app (Phase 3 queue, etc.)
 * expects on a Jobs row.
 *
 * @param {*} rawRemote
 * @returns {boolean}
 */
function jobDedupeNormalizeRemoteForStorage_(rawRemote) {
  return normalizeRemote_(rawRemote).value;
}

function jobDedupeOrBlank_(value) {
  return (value === undefined || value === null) ? '' : value;
}

/**
 * Builds the QUARANTINE / DUPLICATE_IN_RUN result shape.
 *
 * @param {string} reasonCode
 * @returns {Object}
 */
function jobDedupeQuarantine_(reasonCode) {
  return {
    action: 'QUARANTINE',
    reasonCode: reasonCode,
    identityVersion: JOBDEDUPE_IDENTITY_VERSION_
  };
}

/**
 * Decides TOUCH vs DUPLICATE_IN_RUN for a single resolved identity match.
 * A match with `_inRun: true` was itself inserted/touched earlier in the
 * CURRENT run; per contract §5 item 4, that is DUPLICATE_IN_RUN (logged,
 * no write), checked BEFORE deciding TOUCH.
 *
 * @param {Object} matchedRow
 * @param {string} nowIso
 * @returns {Object}
 */
function jobDedupeTouchOrDuplicate_(matchedRow, nowIso) {
  if (matchedRow._inRun === true) {
    return {
      action: 'DUPLICATE_IN_RUN',
      reasonCode: 'DUPLICATE_IN_RUN',
      identityVersion: JOBDEDUPE_IDENTITY_VERSION_
    };
  }
  return {
    action: 'TOUCH',
    existingId: matchedRow.id,
    // TOUCH writes ONLY last_seen_at — never status, saved_at, notes, or
    // record_version, and never JobHistory. See contract §5.
    updates: { last_seen_at: nowIso },
    identityVersion: JOBDEDUPE_IDENTITY_VERSION_
  };
}

/**
 * Builds the INSERT result shape: a full new Jobs row per the frozen
 * schema (contract §4), status 'New', record_version 1, discovered_at ==
 * last_seen_at == nowIso. `id` is deliberately omitted — Database.gs's
 * appendRecordInDb_ auto-generates it for an absent/blank primary key on
 * the 'id'-keyed Jobs sheet, which is the existing, established
 * convention this codebase already uses (see Database.gs); JobDedupe.gs
 * does not need its own UUID generation.
 *
 * @param {Object} candidate
 * @param {string} source
 * @param {string} externalId
 * @param {string} nowIso
 * @returns {Object}
 */
function jobDedupeInsert_(candidate, source, externalId, nowIso) {
  const record = {
    external_id: externalId,
    source: source,
    url: (candidate && candidate.url) || '',
    title: (candidate && candidate.title) || '',
    company: (candidate && candidate.company) || '',
    location: (candidate && candidate.location) || '',
    remote: jobDedupeNormalizeRemoteForStorage_(candidate && candidate.remote),
    salary_min: jobDedupeOrBlank_(candidate && candidate.salary_min),
    salary_max: jobDedupeOrBlank_(candidate && candidate.salary_max),
    currency: (candidate && candidate.currency) || '',
    posted_at: (candidate && candidate.posted_at) || '',
    discovered_at: nowIso,
    last_seen_at: nowIso,
    description: (candidate && candidate.description) || '',
    skills_match: '',
    experience_match: '',
    location_match: '',
    salary_match: '',
    overall_match: '',
    recommendation: '',
    why_matches: '',
    gaps: '',
    status: 'New',
    saved_at: '',
    notes: '',
    record_version: 1
  };
  return {
    action: 'INSERT',
    record: record,
    identityVersion: JOBDEDUPE_IDENTITY_VERSION_
  };
}

/**
 * L1: (source, external_id). Only called when candidate has a non-empty
 * external_id.
 *
 * - 1 match  -> TOUCH (or DUPLICATE_IN_RUN if that match is _inRun)
 * - >1 match -> QUARANTINE AMBIGUOUS_MULTI_MATCH
 * - 0 match, but a row reachable by this candidate's canonical URL hash
 *   carries a DIFFERENT non-empty external_id -> QUARANTINE
 *   AMBIGUOUS_URL_ID_CONFLICT (a genuine identity conflict — do not guess
 *   and overwrite a real row)
 * - 0 match, no conflict -> INSERT
 *
 * @param {Object} index
 * @param {Object} candidate
 * @param {string} source
 * @param {string} externalId
 * @param {string} canonicalUrl
 * @param {string} nowIso
 * @returns {Object}
 */
function jobDedupeResolveByExternalId_(index, candidate, source, externalId, canonicalUrl, nowIso) {
  const matches = index.findByExternalId(source, externalId);

  if (matches.length > 1) {
    return jobDedupeQuarantine_('AMBIGUOUS_MULTI_MATCH');
  }
  if (matches.length === 1) {
    return jobDedupeTouchOrDuplicate_(matches[0], nowIso);
  }

  if (canonicalUrl) {
    const urlHash = jobDedupeComputeUrlHash_(source, canonicalUrl);
    const urlMatches = index.findByUrlHash(source, urlHash);
    const hasConflict = urlMatches.some(function (row) {
      return !!row.external_id && String(row.external_id) !== externalId;
    });
    if (hasConflict) {
      return jobDedupeQuarantine_('AMBIGUOUS_URL_ID_CONFLICT');
    }
  }

  return jobDedupeInsert_(candidate, source, externalId, nowIso);
}

/**
 * L2: (source, canonical URL hash). Only called when candidate has no
 * external_id but does have a usable URL.
 *
 * - 1 match  -> TOUCH (or DUPLICATE_IN_RUN if that match is _inRun)
 * - >1 match -> QUARANTINE AMBIGUOUS_MULTI_MATCH
 * - 0 match  -> INSERT
 *
 * Unlike L3, L2 has no "never merge into a row with an external_id"
 * restriction — an exact canonical-URL match is a strong enough signal to
 * TOUCH any matching row regardless of that row's own external_id.
 *
 * @param {Object} index
 * @param {Object} candidate
 * @param {string} source
 * @param {string} canonicalUrl
 * @param {string} nowIso
 * @returns {Object}
 */
function jobDedupeResolveByUrlHash_(index, candidate, source, canonicalUrl, nowIso) {
  const urlHash = jobDedupeComputeUrlHash_(source, canonicalUrl);
  const matches = index.findByUrlHash(source, urlHash);

  if (matches.length > 1) {
    return jobDedupeQuarantine_('AMBIGUOUS_MULTI_MATCH');
  }
  if (matches.length === 1) {
    return jobDedupeTouchOrDuplicate_(matches[0], nowIso);
  }

  return jobDedupeInsert_(candidate, source, '', nowIso);
}

/**
 * L3: (source, content hash of company/title/location). Only called when
 * candidate has neither an external_id nor a usable URL.
 *
 * - blank company or blank title -> QUARANTINE IDENTITY_INSUFFICIENT
 *   (location may be blank — the candidate contract allows "").
 * - Rows that already carry a non-empty external_id are excluded from
 *   matching entirely ("never merge into a row that has an external_id");
 *   the TOUCH/QUARANTINE/INSERT decision below only ever considers the
 *   remaining (external_id-less) matches.
 * - 1 eligible match  -> TOUCH (or DUPLICATE_IN_RUN if that match is _inRun)
 * - >1 eligible match -> QUARANTINE AMBIGUOUS_MULTI_MATCH
 * - 0 eligible match  -> INSERT (this also covers "every content-hash
 *   match already has an external_id" — content hash is too weak a signal
 *   to merge into an externally-identified row, so treat it as unmatched
 *   and insert a distinct row rather than quarantining)
 *
 * @param {Object} index
 * @param {Object} candidate
 * @param {string} source
 * @param {string} nowIso
 * @returns {Object}
 */
function jobDedupeResolveByContentHash_(index, candidate, source, nowIso) {
  const company = (candidate && candidate.company) ? String(candidate.company) : '';
  const title = (candidate && candidate.title) ? String(candidate.title) : '';
  const location = (candidate && candidate.location) ? String(candidate.location) : '';

  if (!company.trim() || !title.trim()) {
    return jobDedupeQuarantine_('IDENTITY_INSUFFICIENT');
  }

  const contentHash = jobDedupeComputeContentHash_(source, company, title, location);
  const matches = index.findByContentHash(source, contentHash);
  const eligible = matches.filter(function (row) { return !row.external_id; });

  if (eligible.length > 1) {
    return jobDedupeQuarantine_('AMBIGUOUS_MULTI_MATCH');
  }
  if (eligible.length === 1) {
    return jobDedupeTouchOrDuplicate_(eligible[0], nowIso);
  }

  return jobDedupeInsert_(candidate, source, '', nowIso);
}

/**
 * Resolves one candidate's identity against `index` and decides what
 * Discovery.gs should do with it. Pure / read-only with respect to
 * `index` — never mutates it, never calls a write method on it (it has
 * none). See the frozen contract (Phase 4B §5) for the full identity
 * hierarchy this implements: L1 external_id -> L2 canonical URL hash ->
 * L3 content hash, each level used only when the candidate lacks the
 * identity data the level(s) above it need — not as a cascade retried
 * after a higher level returns zero matches.
 *
 * @param {{
 *   findByExternalId: function(string, string): Array<Object>,
 *   findByUrlHash: function(string, string): Array<Object>,
 *   findByContentHash: function(string, string): Array<Object>
 * }} index
 * @param {Object} candidate
 * @param {string} nowIso
 * @returns {{
 *   action: 'INSERT'|'TOUCH'|'QUARANTINE'|'DUPLICATE_IN_RUN',
 *   record: (Object|undefined),
 *   existingId: (string|undefined),
 *   updates: (Object|undefined),
 *   reasonCode: (string|undefined),
 *   identityVersion: string
 * }}
 */
function jobDedupeResolveCandidate_(index, candidate, nowIso) {
  const source = (candidate && candidate.source) ? String(candidate.source) : '';
  const externalId = (candidate && candidate.external_id) ? String(candidate.external_id) : '';
  const canonicalUrl = candidate ? jobDedupeCanonicalizeUrl_(candidate.url) : '';

  if (externalId) {
    return jobDedupeResolveByExternalId_(index, candidate, source, externalId, canonicalUrl, nowIso);
  }
  if (canonicalUrl) {
    return jobDedupeResolveByUrlHash_(index, candidate, source, canonicalUrl, nowIso);
  }
  return jobDedupeResolveByContentHash_(index, candidate, source, nowIso);
}
