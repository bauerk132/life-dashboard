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
 *
 * Residual-correction pass (Phase 5 Milestone 2, 2026-09-13): splits the
 * single call into a prepare/dispatch pair so the caller can insert budget
 * reservation between a proven-safe pre-dispatch check (countTokens) and
 * the only network call that can actually spend money (generateContent).
 * See CLAUDE_RESIDUAL_CORRECTION_REVIEW_RETURN.md sections 6-7.
 */

const GEMINI_PROVIDER_VERSION_ = '5.2';
const GEMINI_MODEL_ = 'gemini-2.5-flash';
const GEMINI_API_HOST_ = 'generativelanguage.googleapis.com';
const GEMINI_API_PATH_ = '/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_COUNT_TOKENS_PATH_ = '/v1beta/models/gemini-2.5-flash:countTokens';
const GEMINI_TIMEOUT_SECONDS_ = 30;

// Hard input/output bounds. GEMINI_MAX_INPUT_TOKENS_ and
// GEMINI_MAX_OUTPUT_TOKENS_ also define the conservative worst-case charge
// used whenever actual usage cannot be trusted (see geminiAttachConservativeTokens_
// and JobScoring.gs's SCORING_RESERVATION_COST_USD_, which is derived from
// these same two constants so the reservation is always >= any conservative
// or bounded-actual charge).
const GEMINI_MAX_INPUT_TOKENS_ = 4096;
const GEMINI_INPUT_COUNT_MARGIN_TOKENS_ = 512;
const GEMINI_MAX_OUTPUT_TOKENS_ = 2048;

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
 * Builds the UrlFetchApp options object shared by every Gemini call
 * (countTokens and generateContent alike).
 */
function geminiBuildOptions_(apiKey, payload) {
  return {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
}

/**
 * The single UrlFetchApp.fetch( call site in this file (required by
 * static check S1). Both geminiPrepareScoringRequest_ (countTokens) and
 * geminiDispatchScoringRequest_ (generateContent) route through here.
 *
 * On a transport-level failure (thrown by UrlFetchApp itself, as opposed
 * to a non-200 HTTP response) this throws a plain Error tagged with
 * `.transportCode` ('TIMEOUT' or 'NETWORK_ERROR') for the caller to
 * translate into a context-appropriate UserError_ code. The underlying
 * provider err.message is inspected only for that classification and is
 * never copied into a thrown error's message (Section 6: no raw provider
 * text in errors).
 */
function geminiFetch_(endpointUrl, options) {
  try {
    return UrlFetchApp.fetch(endpointUrl, options);
  } catch (err) {
    const message = err && err.message ? String(err.message) : '';
    const transportError = new Error('Gemini transport failure.');
    transportError.transportCode = /timeout/i.test(message) ? 'TIMEOUT' : 'NETWORK_ERROR';
    throw transportError;
  }
}

/**
 * Attaches the conservative worst-case token charge to an error that was
 * thrown before actual usage could be trusted (transport failure, non-200
 * status, malformed body, missing/invalid usage metadata). This is the
 * same charge used for SCORING_RESERVATION_COST_USD_, so a reconcile using
 * these tokens can never exceed the reservation already made for this
 * attempt (Section 7: "a reservation cannot undo a charge already
 * dispatched").
 */
function geminiAttachConservativeTokens_(err) {
  err.inputTokens = GEMINI_MAX_INPUT_TOKENS_;
  err.outputTokens = GEMINI_MAX_OUTPUT_TOKENS_;
  return err;
}

/**
 * Attaches actually-charged token counts to an error thrown after usage
 * metadata was validated (post-usage-bound-check failures: empty response,
 * incomplete response, inner parse failure, usage-bound overrun itself).
 */
function geminiAttachActualTokens_(err, inputTokens, outputTokens) {
  err.inputTokens = inputTokens;
  err.outputTokens = outputTokens;
  return err;
}

/**
 * Computes a safe, non-secret diagnostic hash for a completed request.
 */
function geminiComputeRequestIdHash_(startedAt, inputTokens, outputTokens, rawTextLength) {
  const hashInput = startedAt.toISOString() + ':' + inputTokens + ':' + outputTokens + ':' + rawTextLength;
  if (typeof Utilities !== 'undefined' && typeof Utilities.computeDigest === 'function') {
    const rawDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hashInput);
    return rawDigest.map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('').slice(0, 16);
  }
  try {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
  } catch (e) {
    return 'req_' + Math.abs(hashInput.split('').reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0)).toString(16);
  }
}

/**
 * Builds the generateContent request payload for a scoring prompt.
 */
function geminiBuildScoringPayload_(promptText) {
  return {
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
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS_
    }
  };
}

/**
 * Step 1 of the corrected two-step scoring call (Section 7).
 *
 * Validates the prompt and API key, counts tokens via the countTokens
 * endpoint, and refuses oversized prompts — all before any money-spending
 * generateContent call is made and before the caller reserves any budget.
 * Any failure here is a "no ledger row" outcome (Section 6): the caller
 * must not reserve or reconcile anything for these error codes.
 *
 * @param {string} promptText - Fully prepared and sanitized prompt.
 * @returns {Object} { endpointUrl, options, countedTokens } — opaque to
 *   the caller; pass straight to geminiDispatchScoringRequest_.
 */
function geminiPrepareScoringRequest_(promptText) {
  if (typeof promptText !== 'string' || promptText.trim().length === 0) {
    throw UserError_('Prompt text must be a non-empty string.', 'INVALID_ARGUMENT');
  }

  const scriptProps = PropertiesService.getScriptProperties();
  const apiKey = scriptProps ? scriptProps.getProperty('GEMINI_API_KEY') : null;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw UserError_('Gemini API key is not configured in Script Properties.', 'MISSING_API_KEY');
  }
  const trimmedKey = apiKey.trim();

  const requestPayload = geminiBuildScoringPayload_(promptText);

  const countTokensUrl = 'https://' + GEMINI_API_HOST_ + GEMINI_COUNT_TOKENS_PATH_;
  const countTokensBody = {
    generateContentRequest: {
      model: 'models/' + GEMINI_MODEL_,
      contents: requestPayload.contents,
      generationConfig: requestPayload.generationConfig
    }
  };

  let countedTokens;
  try {
    const response = geminiFetch_(countTokensUrl, geminiBuildOptions_(trimmedKey, countTokensBody));
    if (response.getResponseCode() !== 200) {
      throw new Error('countTokens non-200 status');
    }
    const parsedBody = JSON.parse(response.getContentText() || '');
    if (typeof parsedBody.totalTokens !== 'number' || !Number.isInteger(parsedBody.totalTokens) || parsedBody.totalTokens < 0) {
      throw new Error('countTokens malformed body');
    }
    countedTokens = parsedBody.totalTokens;
  } catch (e) {
    // Any failure mode (transport, non-200, malformed body, non-integer
    // totalTokens) collapses to one code: at this point no reservation has
    // been made and none is created for this outcome, so the distinction
    // between causes has no ledger consequence (Section 6/7).
    throw UserError_('Gemini token count is unavailable.', 'TOKEN_COUNT_UNAVAILABLE');
  }

  if (countedTokens > GEMINI_MAX_INPUT_TOKENS_ - GEMINI_INPUT_COUNT_MARGIN_TOKENS_) {
    throw UserError_('Prompt exceeds the maximum allowed input size for scoring.', 'INPUT_TOO_LARGE');
  }

  const endpointUrl = 'https://' + GEMINI_API_HOST_ + GEMINI_API_PATH_;
  const options = geminiBuildOptions_(trimmedKey, requestPayload);

  return { endpointUrl: endpointUrl, options: options, countedTokens: countedTokens };
}

/**
 * Step 2 of the corrected two-step scoring call (Section 7). The only
 * function in this file that can spend money — call only after budget has
 * been reserved for this attempt.
 *
 * @param {Object} prepared - Result of geminiPrepareScoringRequest_ (or an
 *   equivalent {endpointUrl, options} object; see geminiCallScoringEndpoint_).
 * @returns {Object} { parsedOutput, inputTokens, outputTokens, requestIdHash, rawText }
 */
function geminiDispatchScoringRequest_(prepared) {
  const startedAt = new Date();
  let response;
  try {
    response = geminiFetch_(prepared.endpointUrl, prepared.options);
  } catch (err) {
    const code = (err && err.transportCode === 'TIMEOUT') ? 'TIMEOUT' : 'NETWORK_ERROR';
    const message = (code === 'TIMEOUT')
      ? 'Gemini request timed out after ' + GEMINI_TIMEOUT_SECONDS_ + ' seconds.'
      : 'Gemini network transport failure.';
    throw geminiAttachConservativeTokens_(UserError_(message, code));
  }

  const statusCode = response.getResponseCode();
  const bodyText = response.getContentText() || '';

  if (statusCode === 401 || statusCode === 403) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini authentication failed. Check GEMINI_API_KEY.', 'AUTH_ERROR'));
  }
  if (statusCode === 429) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini rate limit or quota exceeded.', 'RATE_LIMIT'));
  }
  if (statusCode === 400) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini rejected the scoring request as invalid.', 'INVALID_ARGUMENT'));
  }
  if (statusCode >= 500 && statusCode < 600) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini service is temporarily unavailable (status ' + statusCode + ').', 'PROVIDER_UNAVAILABLE'));
  }
  if (statusCode !== 200) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini request failed with HTTP status ' + statusCode + '.', 'PROVIDER_ERROR'));
  }

  let jsonResponse;
  try {
    jsonResponse = JSON.parse(bodyText);
  } catch (parseErr) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini response was not valid JSON.', 'MALFORMED_RESPONSE'));
  }

  const usage = jsonResponse.usageMetadata;
  if (!usage || typeof usage !== 'object') {
    throw geminiAttachConservativeTokens_(UserError_('Gemini response missing usage metadata.', 'MISSING_USAGE_METADATA'));
  }

  const isValidCount = function (v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
  };

  const promptTokenCount = usage.promptTokenCount;
  const totalTokenCount = usage.totalTokenCount;
  if (!isValidCount(promptTokenCount) || !isValidCount(totalTokenCount)) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini usage metadata is missing required token counts.', 'INVALID_USAGE_DATA'));
  }

  let candidatesTokenCount = 0;
  if (usage.candidatesTokenCount !== undefined) {
    if (!isValidCount(usage.candidatesTokenCount)) {
      throw geminiAttachConservativeTokens_(UserError_('Gemini usage metadata contains invalid token counts.', 'INVALID_USAGE_DATA'));
    }
    candidatesTokenCount = usage.candidatesTokenCount;
  }

  let thoughtsTokenCount = 0;
  if (usage.thoughtsTokenCount !== undefined) {
    if (!isValidCount(usage.thoughtsTokenCount)) {
      throw geminiAttachConservativeTokens_(UserError_('Gemini usage metadata contains invalid token counts.', 'INVALID_USAGE_DATA'));
    }
    thoughtsTokenCount = usage.thoughtsTokenCount;
  }

  if (totalTokenCount < promptTokenCount + candidatesTokenCount + thoughtsTokenCount) {
    throw geminiAttachConservativeTokens_(UserError_('Gemini usage metadata is internally inconsistent.', 'INVALID_USAGE_DATA'));
  }

  // Charged input = prompt; charged output = total - prompt (Section 7).
  // Using total - prompt rather than candidates + thoughts captures any
  // additional billed overhead beyond those two named fields.
  const chargedInputTokens = promptTokenCount;
  const chargedOutputTokens = totalTokenCount - promptTokenCount;

  if (chargedInputTokens > GEMINI_MAX_INPUT_TOKENS_ || chargedOutputTokens > GEMINI_MAX_OUTPUT_TOKENS_) {
    const boundErr = UserError_('Gemini usage exceeded the configured per-call bound.', 'USAGE_BOUND_EXCEEDED');
    throw geminiAttachActualTokens_(boundErr, chargedInputTokens, chargedOutputTokens);
  }

  const candidates = jsonResponse.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw geminiAttachActualTokens_(UserError_('Gemini response contained no candidates.', 'EMPTY_RESPONSE'), chargedInputTokens, chargedOutputTokens);
  }

  const firstCandidate = candidates[0];
  if (firstCandidate.finishReason !== undefined && firstCandidate.finishReason !== null && firstCandidate.finishReason !== 'STOP') {
    throw geminiAttachActualTokens_(UserError_('Gemini generation did not complete normally.', 'INCOMPLETE_RESPONSE'), chargedInputTokens, chargedOutputTokens);
  }

  const content = firstCandidate.content;
  if (!content || !Array.isArray(content.parts) || content.parts.length === 0) {
    throw geminiAttachActualTokens_(UserError_('Gemini candidate contained no content parts.', 'EMPTY_RESPONSE'), chargedInputTokens, chargedOutputTokens);
  }

  const rawPartText = content.parts[0].text;
  if (!rawPartText || typeof rawPartText !== 'string') {
    throw geminiAttachActualTokens_(UserError_('Gemini response part contained no text.', 'EMPTY_RESPONSE'), chargedInputTokens, chargedOutputTokens);
  }

  let parsedScore;
  try {
    parsedScore = JSON.parse(rawPartText);
  } catch (scoreJsonErr) {
    throw geminiAttachActualTokens_(UserError_('Gemini output text could not be parsed as scoring JSON.', 'MALFORMED_RESPONSE'), chargedInputTokens, chargedOutputTokens);
  }

  const requestIdHash = geminiComputeRequestIdHash_(startedAt, chargedInputTokens, chargedOutputTokens, rawPartText.length);

  return {
    parsedOutput: parsedScore,
    inputTokens: chargedInputTokens,
    outputTokens: chargedOutputTokens,
    requestIdHash: requestIdHash,
    rawText: rawPartText
  };
}

/**
 * Legacy single-call entry point, retained only as a thin compatibility
 * shim over geminiDispatchScoringRequest_ for direct unit testing of
 * response classification in isolation (no countTokens call, no budget
 * reservation). NOT used by the production scoring path — see
 * scoreSingleJobInDb_ in JobScoring.gs, which calls
 * geminiPrepareScoringRequest_ then geminiDispatchScoringRequest_
 * directly so budget can be reserved between the two.
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

  const requestPayload = geminiBuildScoringPayload_(promptText);
  const endpointUrl = 'https://' + GEMINI_API_HOST_ + GEMINI_API_PATH_;
  const options = geminiBuildOptions_(apiKey.trim(), requestPayload);

  return geminiDispatchScoringRequest_({ endpointUrl: endpointUrl, options: options });
}
