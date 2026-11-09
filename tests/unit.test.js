const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyStatus,
  classifyError,
  computeBackoffDelay,
  getErrorCode,
  parseRetryAfter,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
} = require("../backend/services/retryPolicy");
const {
  computeHmacSha256,
  verifyWebhookSignature,
} = require("../backend/utils/hmac");

test("classifies HTTP status codes for retry decisions", () => {
  for (const status of [200, 201, 204, 299]) {
    assert.equal(classifyStatus(status), "succeeded");
  }

  for (const status of [300, 301, 400, 401, 404, 422]) {
    assert.equal(classifyStatus(status), "permanent_failure");
  }

  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(classifyStatus(status), "retryable_failure");
  }
});

test("classifies network and configuration errors", () => {
  const timeout = new Error("timed out");
  timeout.name = "TimeoutError";
  assert.equal(classifyError(timeout), "retryable_failure");

  const aborted = new Error("aborted");
  aborted.name = "AbortError";
  assert.equal(classifyError(aborted), "retryable_failure");

  const permanent = new Error("inactive destination");
  permanent.permanent = true;
  assert.equal(classifyError(permanent), "permanent_failure");

  const refused = new TypeError("fetch failed");
  refused.cause = { code: "ECONNREFUSED" };
  assert.equal(classifyError(refused), "retryable_failure");
  assert.equal(getErrorCode(refused), "ECONNREFUSED");

  const invalidUrl = new TypeError("fetch failed");
  invalidUrl.cause = { code: "ERR_INVALID_URL" };
  assert.equal(classifyError(invalidUrl), "permanent_failure");
});

test("parses Retry-After seconds, dates and invalid values", () => {
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter("0.5"), 500);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter("999999"), MAX_DELAY_MS);
  assert.equal(parseRetryAfter("not-a-date"), null);
  assert.equal(parseRetryAfter(""), null);
  assert.equal(parseRetryAfter(undefined), null);

  const future = new Date(Date.now() + 3000).toUTCString();
  const parsed = parseRetryAfter(future);
  assert.ok(parsed >= 0 && parsed <= 3000);
});

test("computes exponential backoff with jitter bounds", () => {
  for (let run = 0; run < 100; run += 1) {
    const first = computeBackoffDelay(1);
    assert.equal(Number.isInteger(first), true);
    assert.ok(first >= BASE_DELAY_MS / 2 && first <= BASE_DELAY_MS);

    const second = computeBackoffDelay(2);
    assert.ok(second >= BASE_DELAY_MS && second <= BASE_DELAY_MS * 2);

    const capped = computeBackoffDelay(20);
    assert.ok(capped >= MAX_DELAY_MS / 2 && capped <= MAX_DELAY_MS);
  }
});

test("honors a longer Retry-After delay", () => {
  for (let run = 0; run < 50; run += 1) {
    const delay = computeBackoffDelay(1, { retryAfterMs: 60000 });
    assert.ok(delay >= 60000);
    assert.ok(delay <= MAX_DELAY_MS);
  }
});

test("verifies HMAC-SHA256 signatures in constant time", () => {
  const secret = "whsec_unit_test_only_1234567890";
  const body = Buffer.from('{"id":"evt_unit_1","type":"payment.success"}');
  const signature = computeHmacSha256(secret, body);

  assert.equal(
    verifyWebhookSignature({
      secret,
      rawBody: body,
      signature: `sha256=${signature}`,
    }),
    true,
  );
  assert.equal(
    verifyWebhookSignature({
      secret,
      rawBody: body,
      signature: signature.toUpperCase(),
    }),
    true,
  );
  assert.equal(
    verifyWebhookSignature({
      secret,
      rawBody: Buffer.from("different body"),
      signature,
    }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({
      secret,
      rawBody: body,
      signature: `sha256=${"0".repeat(64)}`,
    }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({
      secret,
      rawBody: body,
      signature: "sha256=not-hex",
    }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({ secret, rawBody: body, signature: undefined }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({
      secret: "wrong-secret",
      rawBody: body,
      signature: `sha256=${signature}`,
    }),
    false,
  );
});
