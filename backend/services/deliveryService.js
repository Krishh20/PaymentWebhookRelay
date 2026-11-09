const prisma = require("../db/prisma");
const { assertSafeHttpUrl } = require("../utils/urlValidation");
const {
  classifyStatus,
  classifyError,
  computeBackoffDelay,
  getErrorCode,
  parseRetryAfter,
} = require("./retryPolicy");

const MAX_ERROR_LENGTH = 1000;
const USER_AGENT = "payment-webhook-relay/1.0";

function truncate(value, maxLength = MAX_ERROR_LENGTH) {
  if (!value) {
    return null;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function permanentError(message) {
  const error = new Error(message);
  error.permanent = true;
  return error;
}

function headerValue(value) {
  // Event IDs and types come from JSON, so they may contain control
  // characters that are illegal in HTTP headers. Replace them instead of
  // letting fetch reject the whole delivery.
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 512);
}

function deliveryHeaders(job, attemptNumber) {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": USER_AGENT,
    // Delivery metadata helps the receiving endpoint correlate a delivery with
    // the stored event. No secret or signature is ever sent.
    "x-webhook-event-id": headerValue(job.event.externalEventId),
    "x-webhook-event-type": headerValue(job.event.eventType),
    "x-webhook-delivery-job-id": job.id,
    "x-webhook-delivery-attempt": String(attemptNumber),
  };
}

// The response body is not used, but the connection must be released before
// the next request can reuse it.
async function discardResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // A body that is already closed needs no further cleanup.
  }
}

function describeFetchError(error, timeoutMs) {
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return `Request timed out after ${timeoutMs} ms`;
  }

  const causeCode = getErrorCode(error);

  if (causeCode) {
    return `${error.message} (${causeCode})`;
  }

  return error.message;
}

function attemptRecord(job, attemptNumber, details) {
  return {
    deliveryJobId: job.id,
    attemptNumber,
    requestedAt: details.requestedAt,
    respondedAt: details.respondedAt,
    httpStatusCode: details.statusCode ?? null,
    responseTimeMs: details.responseTimeMs,
    errorMessage: truncate(details.errorMessage),
    outcome: details.outcome,
  };
}

async function markSuccess(job, details) {
  const attemptNumber = job.attemptCount + 1;

  await prisma.$transaction([
    prisma.deliveryAttempt.create({
      data: attemptRecord(job, attemptNumber, {
        ...details,
        outcome: "succeeded",
        errorMessage: null,
      }),
    }),
    prisma.deliveryJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        attemptCount: attemptNumber,
        lastStatusCode: details.statusCode,
        lastResponseTimeMs: details.responseTimeMs,
        lastError: null,
        lockedAt: null,
        lockExpiresAt: null,
      },
    }),
    prisma.event.update({
      where: { id: job.eventId },
      data: { status: "delivered" },
    }),
  ]);

  return { attemptNumber };
}

async function markFailure(job, details) {
  const attemptNumber = job.attemptCount + 1;
  const permanent = details.outcome === "permanent_failure";
  const deadLettered = permanent || attemptNumber >= job.maxAttempts;
  const retryDelayMs = deadLettered
    ? null
    : computeBackoffDelay(attemptNumber, {
        retryAfterMs: details.retryAfterMs,
      });

  const operations = [
    prisma.deliveryAttempt.create({
      data: attemptRecord(job, attemptNumber, details),
    }),
    prisma.deliveryJob.update({
      where: { id: job.id },
      data: {
        status: deadLettered ? "dead_letter" : "retrying",
        attemptCount: attemptNumber,
        lastStatusCode: details.statusCode ?? null,
        lastResponseTimeMs: details.responseTimeMs,
        lastError: truncate(details.errorMessage),
        lockedAt: null,
        lockExpiresAt: null,
        nextAttemptAt: deadLettered
          ? job.nextAttemptAt
          : new Date(Date.now() + retryDelayMs),
      },
    }),
  ];

  if (deadLettered) {
    operations.push(
      prisma.event.update({
        where: { id: job.eventId },
        data: { status: "dead_letter" },
      }),
    );
  }

  await prisma.$transaction(operations);

  return { attemptNumber, deadLettered, permanent, retryDelayMs };
}

function logFailure(job, result, reason) {
  const outcome = result.permanent
    ? "permanent failure"
    : result.deadLettered
      ? "max attempts reached"
      : `retrying in ${result.retryDelayMs} ms`;

  console.log(
    `[delivery] job ${job.id} attempt ${result.attemptNumber} failed ` +
      `(${reason}) -> ${result.deadLettered ? "dead_letter" : "retrying"} ` +
      `[${outcome}]`,
  );
}

// Sends the stored event payload to the configured destination and records the
// outcome. The processor already committed the claim, so this function never
// holds a database transaction open during network I/O.
async function deliverJob(jobId) {
  const job = await prisma.deliveryJob.findUnique({
    where: { id: jobId },
    include: {
      event: true,
      destination: true,
    },
  });

  // A recovered or deleted job should not be delivered.
  if (!job || job.status !== "processing") {
    return;
  }

  const attemptNumber = job.attemptCount + 1;
  const requestedAt = new Date();
  const startedAt = Date.now();
  let statusCode = null;
  let responseTimeMs = null;

  try {
    if (!job.destination.isActive) {
      throw permanentError("Destination is inactive.");
    }

    try {
      assertSafeHttpUrl(job.destination.url, "Destination URL");
    } catch (error) {
      error.permanent = true;
      throw error;
    }

    let body;

    try {
      body = JSON.stringify(job.event.payload);
    } catch (error) {
      error.permanent = true;
      throw error;
    }

    const response = await fetch(job.destination.url, {
      method: "POST",
      headers: deliveryHeaders(job, attemptNumber),
      body,
      // A redirect is treated as a failed delivery instead of being followed.
      redirect: "manual",
      signal: AbortSignal.timeout(job.destination.timeoutMs),
    });

    const respondedAt = new Date();
    responseTimeMs = Date.now() - startedAt;
    statusCode = response.status;

    const retryAfterMs = parseRetryAfter(
      response.headers.get("retry-after"),
    );

    await discardResponseBody(response);

    const outcome = classifyStatus(statusCode);

    if (outcome === "succeeded") {
      await markSuccess(job, {
        requestedAt,
        respondedAt,
        statusCode,
        responseTimeMs,
      });

      console.log(
        `[delivery] job ${job.id} attempt ${attemptNumber} succeeded ` +
          `(HTTP ${statusCode}, ${responseTimeMs} ms)`,
      );
      return;
    }

    const result = await markFailure(job, {
      requestedAt,
      respondedAt,
      statusCode,
      responseTimeMs,
      errorMessage: `HTTP ${statusCode}`,
      outcome,
      retryAfterMs,
    });

    logFailure(job, result, `HTTP ${statusCode}`);
  } catch (error) {
    const respondedAt = new Date();
    responseTimeMs = Date.now() - startedAt;

    const outcome = classifyError(error);
    const errorMessage = describeFetchError(
      error,
      job.destination.timeoutMs,
    );

    const result = await markFailure(job, {
      requestedAt,
      respondedAt,
      statusCode,
      responseTimeMs,
      errorMessage,
      outcome,
    });

    logFailure(job, result, errorMessage);
  }
}

module.exports = {
  deliverJob,
};
