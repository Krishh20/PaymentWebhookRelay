// Retry policy for outbound deliveries.
//
// Delay = exponential backoff with equal jitter:
//   raw     = BASE_DELAY_MS * 2^(attemptNumber - 1)
//   jitter  = raw / 2 + random(0, raw / 2)
// The jittered delay is at least half of the exponential value, so retries do
// not stampede a recovering destination. Retry-After is honored when it asks
// for a longer wait. Everything is capped at MAX_DELAY_MS.

const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 5 * 60 * 1000;

// Status codes that are safe to retry even though they are 4xx.
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
]);

// Network-level failures that may resolve on their own.
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const PERMANENT_ERROR_CODES = new Set([
  "ERR_INVALID_URL",
  "ERR_INVALID_ARG_TYPE",
]);

function getErrorCode(error) {
  return (
    error.code ||
    error.cause?.code ||
    error.cause?.errors?.[0]?.code ||
    null
  );
}

// 2xx succeeds. 5xx, 408, 425 and 429 are retried. Every other status is a
// permanent failure (for example a misconfigured destination returning 404).
function classifyStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) {
    return "succeeded";
  }

  if (statusCode >= 500 || RETRYABLE_STATUS_CODES.has(statusCode)) {
    return "retryable_failure";
  }

  return "permanent_failure";
}

function classifyError(error) {
  if (error.permanent === true) {
    return "permanent_failure";
  }

  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return "retryable_failure";
  }

  const code = getErrorCode(error);

  if (code && PERMANENT_ERROR_CODES.has(code)) {
    return "permanent_failure";
  }

  // Fetch wraps most transient network problems in a TypeError with a cause
  // code. Unknown errors are retried; the max-attempt limit still bounds them.
  return "retryable_failure";
}

function parseRetryAfter(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_DELAY_MS);
  }

  const date = Date.parse(value);

  if (!Number.isNaN(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_DELAY_MS);
  }

  return null;
}

function computeBackoffDelay(attemptNumber, { retryAfterMs = null } = {}) {
  const exponent = Math.max(0, attemptNumber - 1);
  const rawDelay = Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
  const jitteredDelay = rawDelay / 2 + Math.random() * (rawDelay / 2);
  const delay = Math.max(jitteredDelay, retryAfterMs || 0);

  return Math.round(Math.min(delay, MAX_DELAY_MS));
}

module.exports = {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  classifyStatus,
  classifyError,
  computeBackoffDelay,
  getErrorCode,
  parseRetryAfter,
};
