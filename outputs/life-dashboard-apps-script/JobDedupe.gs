'use strict';

/**
 * Life Dashboard — Job Deduplication (Phase 4B)
 *
 * Implements deterministic deduplication and upsert identity resolution:
 * 1. (source, external_id)
 * 2. (source, canonical_url_hash)
 * 3. Content hash fallback (normalized title + company + location)
 *
 * Requirements:
 * - Pure functions where possible; uses Utilities.computeDigest for SHA-256 hashes.
 * - Repeated identical runs create ZERO new Jobs rows.
 * - Rediscovery updates only last_seen_at and increments record_version.
 * - Preserves user workflow fields: status, notes, saved_at, and JobHistory.
 *
 * All functions are private with a trailing underscore (_) to prevent
 * accidental browser exposure.
 */

const JOB_DEDUPE_VERSION_ = '4B.1';

/**
 * Strips known tracking parameters from a URL while preserving identity-bearing parameters.
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

  const trackingParams = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'ref', 'refid', 'trackingid', 'trk', 'originalsubdomain', 'fbclid', 'gclid'
  ];

  const pairs = queryOnly.split('&').filter(Boolean);
  const kept = [];

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const eqIdx = pair.indexOf('=');
    const key = (eqIdx !== -1 ? pair.substring(0, eqIdx) : pair).toLowerCase();
    if (trackingParams.indexOf(key) === -1) {
      kept.push(pair);
    }
  }

  kept.sort();
  return kept.length > 0 ? base + '?' + kept.join('&') : base;
}

/**
 * Computes a hex SHA-256 hash of a string using Utilities.computeDigest.
 *
 * @param {string} text
 * @returns {string} Hex SHA-256 string
 */
function jobDedupeComputeHash_(text) {
  if (!text || typeof text !== 'string') return '';
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
 * Computes the content hash fallback from normalized title, company, and location.
 *
 * @param {string} title
 * @param {string} company
 * @param {string} location
 * @returns {string}
 */
function jobDedupeComputeContentHash_(title, company, location) {
  const normTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normCompany = (company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normLoc = (location || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return jobDedupeComputeHash_(normTitle + '|' + normCompany + '|' + normLoc);
}

/**
 * Resolves a normalized candidate against an array of existing Jobs rows.
 * Pure logic function.
 *
 * @param {Array<Object>} existingRows - Existing Jobs sheet records
 * @param {Object} candidate - Normalized candidate from JobSource_JSearch
 * @param {Date} [nowDate] - Injected timestamp
 * @returns {{
 *   action: 'INSERT'|'UPDATE'|'SKIP',
 *   existingId: string|null,
 *   record: Object|null,
 *   updates: Object|null,
 *   identityKey: string
 * }}
 */
function jobDedupeResolveCandidate_(existingRows, candidate, nowDate) {
  if (!candidate || typeof candidate !== 'object') {
    return { action: 'SKIP', existingId: null, record: null, updates: null, identityKey: 'NONE' };
  }

  const now = nowDate || new Date();
  const nowIso = now.toISOString();

  const source = candidate.source || '';
  const externalId = candidate.external_id || '';
  const canonicalUrl = jobDedupeCanonicalizeUrl_(candidate.url);
  const urlHash = canonicalUrl ? jobDedupeComputeHash_(canonicalUrl) : '';
  const contentHash = jobDedupeComputeContentHash_(candidate.title, candidate.company, candidate.location);

  let matchedRow = null;
  let identityType = 'NONE';

  // Level 1: (source, external_id)
  if (source && externalId) {
    for (let i = 0; i < existingRows.length; i++) {
      const row = existingRows[i];
      if (row.source === source && String(row.external_id) === String(externalId)) {
        matchedRow = row;
        identityType = 'EXTERNAL_ID';
        break;
      }
    }
  }

  // Level 2: (source, canonical_url_hash)
  if (!matchedRow && source && urlHash) {
    for (let j = 0; j < existingRows.length; j++) {
      const row = existingRows[j];
      if (row.source === source && row.url) {
        const rowCanonical = jobDedupeCanonicalizeUrl_(row.url);
        if (rowCanonical && jobDedupeComputeHash_(rowCanonical) === urlHash) {
          matchedRow = row;
          identityType = 'CANONICAL_URL';
          break;
        }
      }
    }
  }

  // Level 3: Content hash fallback
  if (!matchedRow && contentHash) {
    for (let k = 0; k < existingRows.length; k++) {
      const row = existingRows[k];
      const rowContentHash = jobDedupeComputeContentHash_(row.title, row.company, row.location);
      if (rowContentHash === contentHash && row.source === source) {
        matchedRow = row;
        identityType = 'CONTENT_HASH';
        break;
      }
    }
  }

  // If match found: Rediscovery Update
  if (matchedRow) {
    const nextVersion = (Number(matchedRow.record_version) || 1) + 1;
    return {
      action: 'UPDATE',
      existingId: matchedRow.id,
      identityKey: identityType,
      record: null,
      updates: {
        last_seen_at: nowIso,
        record_version: nextVersion
      }
    };
  }

  // If no match: Prepare Insert Record matching SCHEMA.Jobs exactly
  const newId = generateUUID_();
  const newRecord = {
    id: newId,
    external_id: externalId,
    source: source,
    url: candidate.url || '',
    title: candidate.title || '',
    company: candidate.company || '',
    location: candidate.location || '',
    remote: candidate.remote ? 'true' : (candidate.remote === false ? 'false' : ''),
    salary_min: candidate.salary_min !== undefined && candidate.salary_min !== null ? candidate.salary_min : '',
    salary_max: candidate.salary_max !== undefined && candidate.salary_max !== null ? candidate.salary_max : '',
    currency: candidate.currency || '',
    posted_at: candidate.posted_at || '',
    discovered_at: nowIso,
    last_seen_at: nowIso,
    description: candidate.description || '',
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
    existingId: null,
    identityKey: 'NEW',
    record: newRecord,
    updates: null
  };
}
