'use strict';

/**
 * AIProvider_Gemini.gs — Phase 5 Milestone 2: Google Gemini Scoring Client.
 *
 * Server-side only client for the Google Gemini API (gemini-2.5-flash).
 * Pins endpoint to official Google GenAI v1beta, reads GEMINI_API_KEY
 * from Script Properties only, enforces structured JSON output schemas,
 * and classifies provider errors into safe internal error codes.
 *
 * All functions are private with a trailing underscore (_) to prevent
 * accidental exposure to the browser via google.script.run.
 */

const GEMINI_PROVIDER_VERSION_ = '5.1';
const GEMINI_MODEL_ = 'gemini-2.5-flash';
const GEMINI_API_HOST_ = 'generativelanguage.googleapis.com';
const GEMINI_API_PATH_ = '/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_TIMEOUT_SECONDS_ = 30;

/**
 * Structured output JSON schema passed to Gemini generationConfig.
 * Guarantees that the response conforms to the scoring contract.
 */
const GEMINI_SCORING_RESPONSE_SCHEMA_ = Object.freeze({
  type: 'OBJECT',
  properties: {
    skills_match: { type: 'INTEGER', description: 'Skills alignment score from 0 to 100' },
    experience_match: { type: 'INTEGER', description: 'Experience alignment score from 0 to 100' },
    education_match: { type: 'INTEGER', description: 'Education alignment score from 0 to 100' },
    location_match: { type: 'INTEGER', description: 'Location alignment score from 0 to 100' },
    salary_match: { type: 'INTEGER', description: 'Salary alignment score from 0 to 100' },
    overall_match: { type: 'INTEGER', description: 'Overall weighted alignment score from 0 to 100' },
    recommendation: {
      type: 'STRING',
      enum: ['Strong Match', 'Possible Match', 'Not a Match'],
      description: 'Categorical recommendation'
    },
    evidence: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Bounded verbatim quotations or direct facts from the job description supporting the score'
    },
    gaps: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Identified gaps, missing qualifications, or uncertainties'
    }
  },
  required: [
    'skills_match', 'experience_match', 'education_match', 'location_match',
    'salary_match', 'overall_match', 'recommendation', 'evidence', 'gaps'
  ]
});

/**
 * Executes a structured scoring call against Gemini 2.5 Flash.
 *
 * @param {string} promptText - Fully prepared and sanitized prompt.
 * @returns {Object} { parsedOutput, inputTokens, outputTokens, requestIdHash, rawText }
 */
function geminiCallScoringEndpoint_(promptText) {
  if (typeof promptText !== 'string' || promptText.trim().length === 0) {
    throw UserError_('Prompt text must be a non-empty string.', 'INVALID_ARGUMENT');
  }

  const scriptProps = PropertiesService.getScriptProperties();
  const apiKey = scriptProps ? scriptProps.getProperty('GEMINI_API_KEY') : null;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw UserError_('Gemini API key is not configured in Script Properties.', 'MISSING_API_KEY');
  }

  const endpointUrl = 'https://' + GEMINI_API_HOST_ + GEMINI_API_PATH_;
  const requestPayload = {
    contents: [
      {
        parts: [
          { text: promptText }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_SCORING_RESPONSE_SCHEMA_,
      temperature: 0.1,
      maxOutputTokens: 2048
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': apiKey.trim()
    },
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  let response;
  const startedAt = new Date();
  try {
    response = UrlFetchApp.fetch(endpointUrl, options);
  } catch (err) {
    const message = err && err.message ? String(err.message) : 'Unknown network failure';
    if (/timeout/i.test(message)) {
      throw UserError_('Gemini request timed out after ' + GEMINI_TIMEOUT_SECONDS_ + ' seconds.', 'TIMEOUT');
    }
    throw UserError_('Gemini network transport failure: ' + message, 'NETWORK_ERROR');
  }

  const statusCode = response.getResponseCode();
  const bodyText = response.getContentText() || '';

  if (statusCode === 401 || statusCode === 403) {
    throw UserError_('Gemini authentication failed. Check GEMINI_API_KEY.', 'AUTH_ERROR');
  }
  if (statusCode === 429) {
    throw UserError_('Gemini rate limit or quota exceeded.', 'RATE_LIMIT');
  }
  if (statusCode === 400) {
    throw UserError_('Gemini rejected the scoring request as invalid.', 'INVALID_ARGUMENT');
  }
  if (statusCode >= 500 && statusCode < 600) {
    throw UserError_('Gemini service is temporarily unavailable (status ' + statusCode + ').', 'PROVIDER_UNAVAILABLE');
  }
  if (statusCode !== 200) {
    throw UserError_('Gemini request failed with HTTP status ' + statusCode + '.', 'PROVIDER_ERROR');
  }

  let jsonResponse;
  try {
    jsonResponse = JSON.parse(bodyText);
  } catch (parseErr) {
    throw UserError_('Gemini response was not valid JSON.', 'MALFORMED_RESPONSE');
  }

  // Defect R3 fix: usageMetadata is required for budget accounting
  const usage = jsonResponse.usageMetadata;
  if (!usage || typeof usage !== 'object') {
    throw UserError_('Gemini response missing usage metadata.', 'MISSING_USAGE_METADATA');
  }

  const inTokens = usage.promptTokenCount;
  const candTokens = usage.candidatesTokenCount;
  const thoughtsTokens = (typeof usage.thoughtsTokenCount === 'number' && Number.isFinite(usage.thoughtsTokenCount) && usage.thoughtsTokenCount >= 0)
    ? usage.thoughtsTokenCount
    : 0;

  if (typeof inTokens !== 'number' || !Number.isFinite(inTokens) || inTokens < 0 || inTokens % 1 !== 0 ||
      typeof candTokens !== 'number' || !Number.isFinite(candTokens) || candTokens < 0 || candTokens % 1 !== 0) {
    throw UserError_('Gemini usage metadata contains invalid token counts.', 'INVALID_USAGE_DATA');
  }

  const inputTokens = inTokens;
  const outputTokens = candTokens + thoughtsTokens;

  const candidates = jsonResponse.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const err = UserError_('Gemini response contained no candidates.', 'EMPTY_RESPONSE');
    err.inputTokens = inputTokens;
    err.outputTokens = outputTokens;
    throw err;
  }

  const firstCandidate = candidates[0];
  const content = firstCandidate.content;
  if (!content || !Array.isArray(content.parts) || content.parts.length === 0) {
    const err = UserError_('Gemini candidate contained no content parts.', 'EMPTY_RESPONSE');
    err.inputTokens = inputTokens;
    err.outputTokens = outputTokens;
    throw err;
  }

  const rawPartText = content.parts[0].text;
  if (!rawPartText || typeof rawPartText !== 'string') {
    const err = UserError_('Gemini response part contained no text.', 'EMPTY_RESPONSE');
    err.inputTokens = inputTokens;
    err.outputTokens = outputTokens;
    throw err;
  }

  let parsedScore;
  try {
    parsedScore = JSON.parse(rawPartText);
  } catch (scoreJsonErr) {
    const err = UserError_('Gemini output text could not be parsed as scoring JSON.', 'MALFORMED_RESPONSE');
    err.inputTokens = inputTokens;
    err.outputTokens = outputTokens;
    throw err;
  }

  // Generate safe non-secret diagnostic hash
  const hashInput = startedAt.toISOString() + ':' + inputTokens + ':' + outputTokens + ':' + rawPartText.length;
  let requestIdHash = '';
  if (typeof Utilities !== 'undefined' && typeof Utilities.computeDigest === 'function') {
    const rawDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hashInput);
    requestIdHash = rawDigest.map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('').slice(0, 16);
  } else {
    // Node.js test environment fallback
    try {
      const crypto = require('crypto');
      requestIdHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
    } catch (e) {
      requestIdHash = 'req_' + Math.abs(hashInput.split('').reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0)).toString(16);
    }
  }

  return {
    parsedOutput: parsedScore,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    requestIdHash: requestIdHash,
    rawText: rawPartText
  };
}
