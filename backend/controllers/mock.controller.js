const { sendSuccess, sendError } = require("../utils/apiResponse");

// The timeout mock delays longer than the maximum allowed destination timeout
// (30 seconds), so the processor's AbortSignal always fires first.
const TIMEOUT_HOLD_MS = 35000;
const MAX_TRACKED_INTERMITTENT_KEYS = 1000;

// Tracks how many times the intermittent endpoint has seen each delivery job.
// The first delivery fails; every later attempt succeeds. That makes the
// retry-then-recover path easy to demonstrate.
const intermittentAttempts = new Map();

function readHeader(req, name) {
  const value = req.get(name);
  return typeof value === "string" && value !== "" ? value : null;
}

function readEventId(req) {
  if (req.body && typeof req.body === "object" && typeof req.body.id === "string") {
    return req.body.id;
  }

  return null;
}

function requestContext(req) {
  return {
    eventId: readEventId(req),
    deliveryJobId: readHeader(req, "x-webhook-delivery-job-id"),
    attempt: readHeader(req, "x-webhook-delivery-attempt"),
  };
}

function intermittentKey(req, context) {
  return (
    context.deliveryJobId ||
    context.eventId ||
    req.ip ||
    "anonymous"
  );
}

function nextIntermittentAttempt(key) {
  if (
    intermittentAttempts.size >= MAX_TRACKED_INTERMITTENT_KEYS &&
    !intermittentAttempts.has(key)
  ) {
    // Bound memory in a long-running process. Old keys are not needed.
    const oldestKey = intermittentAttempts.keys().next().value;
    intermittentAttempts.delete(oldestKey);
  }

  const attempt = (intermittentAttempts.get(key) || 0) + 1;
  intermittentAttempts.set(key, attempt);
  return attempt;
}

function resetIntermittentState() {
  intermittentAttempts.clear();
}

// Always succeeds with HTTP 200.
function mockSuccess(req, res) {
  const context = requestContext(req);

  console.log(
    `[mock] success event=${context.eventId ?? "unknown"} attempt=${context.attempt ?? "?"}`,
  );

  return sendSuccess(res, {
    mode: "success",
    received: true,
    ...context,
  });
}

// Always fails with HTTP 500. The processor treats this as a retryable failure
// until the job reaches its maximum attempt count.
function mockFailure(req, res) {
  const context = requestContext(req);

  console.log(
    `[mock] failure event=${context.eventId ?? "unknown"} attempt=${context.attempt ?? "?"}`,
  );

  return sendError(res, 500, "Mock destination failure.", {
    mode: "failure",
    ...context,
  });
}

// Never answers before the client timeout. The connection is eventually closed
// by the client (AbortSignal) or by this handler after the hold period.
function mockTimeout(req, res) {
  const context = requestContext(req);

  console.log(
    `[mock] timeout event=${context.eventId ?? "unknown"} attempt=${context.attempt ?? "?"}`,
  );

  const timer = setTimeout(() => {
    if (!res.writableEnded && !res.destroyed) {
      sendSuccess(res, {
        mode: "timeout",
        received: true,
        delayedMs: TIMEOUT_HOLD_MS,
        ...context,
      });
    }
  }, TIMEOUT_HOLD_MS);

  // The client abort closes the response. Release the timer then.
  res.on("close", () => {
    clearTimeout(timer);
  });

  timer.unref();
}

// Fails the first delivery per job and succeeds on every retry.
function mockIntermittent(req, res) {
  const context = requestContext(req);
  const key = intermittentKey(req, context);
  const attempt = nextIntermittentAttempt(key);

  if (attempt === 1) {
    console.log(
      `[mock] intermittent event=${context.eventId ?? "unknown"} attempt=${attempt} -> 503`,
    );

    return sendError(res, 503, "Mock intermittent failure on first attempt.", {
      mode: "intermittent",
      attempt,
      shouldRetry: true,
      ...context,
    });
  }

  console.log(
    `[mock] intermittent event=${context.eventId ?? "unknown"} attempt=${attempt} -> 200`,
  );

  return sendSuccess(res, {
    mode: "intermittent",
    received: true,
    attempt,
    ...context,
  });
}

module.exports = {
  mockSuccess,
  mockFailure,
  mockTimeout,
  mockIntermittent,
  resetIntermittentState,
};
