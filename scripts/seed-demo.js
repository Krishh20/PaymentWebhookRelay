const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT_DIR, "backend");

const prisma = require(path.join(BACKEND_DIR, "db", "prisma"));
const {
  ensureConfig,
} = require(path.join(BACKEND_DIR, "services", "configService"));

const DEMO_PREFIX = "evt_demo_seed_";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const NOW = Date.now();

function ago(ms) {
  return new Date(NOW - ms);
}

function inFuture(ms) {
  return new Date(NOW + ms);
}

function successAttempt(receivedAt, offsetMs, responseTimeMs) {
  const requestedAt = new Date(receivedAt.getTime() + offsetMs);

  return {
    requestedAt,
    respondedAt: new Date(requestedAt.getTime() + responseTimeMs),
    httpStatusCode: 200,
    responseTimeMs,
    errorMessage: null,
    outcome: "succeeded",
  };
}

function failedAttempt(
  receivedAt,
  offsetMs,
  {
    httpStatusCode = null,
    responseTimeMs = 20,
    errorMessage,
    outcome = "retryable_failure",
  },
) {
  const requestedAt = new Date(receivedAt.getTime() + offsetMs);

  return {
    requestedAt,
    respondedAt: new Date(requestedAt.getTime() + responseTimeMs),
    httpStatusCode,
    responseTimeMs,
    errorMessage,
    outcome,
  };
}

// Approximates the real retry cadence: 5s base with jitter, capped at 5 minutes.
const RETRY_OFFSETS_MS = [2000, 6000, 14000, 30000, 62000];

function retryHistory(
  receivedAt,
  { httpStatusCode = null, responseTimeMs = 20, errorMessage },
) {
  return RETRY_OFFSETS_MS.map((offsetMs) =>
    failedAttempt(receivedAt, offsetMs, {
      httpStatusCode,
      responseTimeMs,
      errorMessage,
    }),
  );
}

function paymentPayload({
  id,
  type,
  amount,
  currency,
  state,
  extra,
  receivedAt,
}) {
  return {
    id,
    type,
    data: {
      paymentId: `pay_${id.replace(DEMO_PREFIX, "")}`,
      amount,
      currency,
      status: state,
      provider: "postman-sandbox",
      customerEmail: "demo.buyer@example.com",
      createdAt: receivedAt.toISOString(),
      ...extra,
    },
  };
}

const scenarios = [];

function pushDelivered({
  id,
  type = "payment.success",
  amount,
  currency = "USD",
  state = "succeeded",
  extra,
  hoursAgo,
  responseTimeMs,
}) {
  const receivedAt = ago(hoursAgo * HOUR_MS);
  const attempt = successAttempt(receivedAt, 2000, responseTimeMs);

  scenarios.push({
    id: `${DEMO_PREFIX}${id}`,
    type,
    amount,
    currency,
    state,
    extra,
    receivedAt,
    eventStatus: "delivered",
    jobStatus: "succeeded",
    attempts: [attempt],
    job: {
      lastStatusCode: 200,
      lastResponseTimeMs: responseTimeMs,
      lastError: null,
      nextAttemptAt: attempt.respondedAt,
      updatedAt: attempt.respondedAt,
    },
  });
}

function pushRecovered({
  id,
  amount,
  hoursAgo,
  firstFailure,
  responseTimeMs,
}) {
  const receivedAt = ago(hoursAgo * HOUR_MS);
  const first = failedAttempt(receivedAt, 2000, firstFailure);
  const second = successAttempt(receivedAt, 6000, responseTimeMs);

  scenarios.push({
    id: `${DEMO_PREFIX}${id}`,
    type: "payment.success",
    amount,
    currency: "USD",
    state: "succeeded",
    receivedAt,
    eventStatus: "delivered",
    jobStatus: "succeeded",
    attempts: [first, second],
    job: {
      lastStatusCode: 200,
      lastResponseTimeMs: responseTimeMs,
      lastError: null,
      nextAttemptAt: second.respondedAt,
      updatedAt: second.respondedAt,
    },
  });
}

function pushRetrying({
  id,
  amount,
  minutesAgo,
  retryInMinutes,
  firstFailure,
  secondFailure,
}) {
  const receivedAt = ago(minutesAgo * MINUTE_MS);
  const first = failedAttempt(receivedAt, 2000, firstFailure);
  const second = failedAttempt(receivedAt, 6000, secondFailure);

  scenarios.push({
    id: `${DEMO_PREFIX}${id}`,
    type: "payment.success",
    amount,
    currency: "USD",
    state: "succeeded",
    receivedAt,
    eventStatus: "queued",
    jobStatus: "retrying",
    attempts: [first, second],
    job: {
      lastStatusCode: second.httpStatusCode,
      lastResponseTimeMs: second.responseTimeMs,
      lastError: second.errorMessage,
      nextAttemptAt: inFuture(retryInMinutes * MINUTE_MS),
      updatedAt: second.respondedAt,
    },
  });
}

function pushPending({
  id,
  type = "payment.success",
  amount,
  currency = "USD",
  state = "succeeded",
  extra,
  minutesAgo,
  retryInMinutes,
}) {
  const receivedAt = ago(minutesAgo * MINUTE_MS);

  scenarios.push({
    id: `${DEMO_PREFIX}${id}`,
    type,
    amount,
    currency,
    state,
    extra,
    receivedAt,
    eventStatus: "queued",
    jobStatus: "pending",
    attempts: [],
    job: {
      lastStatusCode: null,
      lastResponseTimeMs: null,
      lastError: null,
      nextAttemptAt: inFuture(retryInMinutes * MINUTE_MS),
      updatedAt: receivedAt,
    },
  });
}

function pushDeadLetter({
  id,
  type = "payment.failed",
  amount,
  state = "failed",
  extra,
  hoursAgo,
  buildAttempts,
  lastStatusCode,
  lastResponseTimeMs,
  lastError,
}) {
  const receivedAt = ago(hoursAgo * HOUR_MS);
  const attempts = buildAttempts(receivedAt);
  const last = attempts[attempts.length - 1];

  scenarios.push({
    id: `${DEMO_PREFIX}${id}`,
    type,
    amount,
    currency: "USD",
    state,
    extra,
    receivedAt,
    eventStatus: "dead_letter",
    jobStatus: "dead_letter",
    attempts,
    job: {
      lastStatusCode,
      lastResponseTimeMs,
      lastError,
      nextAttemptAt: last.respondedAt,
      updatedAt: last.respondedAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Delivered events
// ---------------------------------------------------------------------------

pushDelivered({ id: "success_001", amount: 2500, hoursAgo: 2, responseTimeMs: 142 });
pushDelivered({ id: "success_002", amount: 14999, hoursAgo: 5, responseTimeMs: 98 });
pushDelivered({
  id: "refund_001",
  type: "payment.refunded",
  amount: 2500,
  state: "refunded",
  extra: { refundId: "re_demo_001", reason: "customer_request" },
  hoursAgo: 8,
  responseTimeMs: 121,
});
pushDelivered({
  id: "success_003",
  amount: 8950,
  currency: "EUR",
  hoursAgo: 20,
  responseTimeMs: 210,
});
pushDelivered({ id: "success_004", amount: 1200, hoursAgo: 26, responseTimeMs: 76 });
pushDelivered({
  id: "refund_002",
  type: "payment.refunded",
  amount: 4000,
  state: "refunded",
  extra: { refundId: "re_demo_002", reason: "duplicate_charge" },
  hoursAgo: 30,
  responseTimeMs: 165,
});

// ---------------------------------------------------------------------------
// Delivered after a retry
// ---------------------------------------------------------------------------

pushRecovered({
  id: "recovered_001",
  amount: 6500,
  hoursAgo: 3,
  firstFailure: {
    httpStatusCode: 503,
    responseTimeMs: 18,
    errorMessage: "HTTP 503",
  },
  responseTimeMs: 105,
});

pushRecovered({
  id: "recovered_002",
  amount: 3325,
  hoursAgo: 12,
  firstFailure: {
    httpStatusCode: null,
    responseTimeMs: 10000,
    errorMessage: "Request timed out after 10000 ms",
  },
  responseTimeMs: 88,
});

// ---------------------------------------------------------------------------
// Retrying / pending / processing (kept visible for the demo)
// ---------------------------------------------------------------------------

pushRetrying({
  id: "retrying_001",
  amount: 7800,
  minutesAgo: 1,
  retryInMinutes: 15,
  firstFailure: {
    httpStatusCode: 500,
    responseTimeMs: 21,
    errorMessage: "HTTP 500",
  },
  secondFailure: {
    httpStatusCode: 503,
    responseTimeMs: 15,
    errorMessage: "HTTP 503",
  },
});

pushRetrying({
  id: "retrying_002",
  amount: 5675,
  minutesAgo: 3,
  retryInMinutes: 25,
  firstFailure: {
    httpStatusCode: null,
    responseTimeMs: 10000,
    errorMessage: "Request timed out after 10000 ms",
  },
  secondFailure: {
    httpStatusCode: 503,
    responseTimeMs: 19,
    errorMessage: "HTTP 503",
  },
});

pushPending({
  id: "pending_001",
  amount: 1999,
  minutesAgo: 0.5,
  retryInMinutes: 10,
});

pushPending({
  id: "pending_002",
  type: "payment.refunded",
  amount: 1000,
  state: "refunded",
  extra: { refundId: "re_demo_003", reason: "customer_request" },
  minutesAgo: 2,
  retryInMinutes: 20,
});

pushPending({
  id: "pending_003",
  amount: 4500,
  minutesAgo: 4,
  retryInMinutes: 30,
});

// ---------------------------------------------------------------------------
// Status coverage: one visible example for each transient delivery status
// ---------------------------------------------------------------------------

pushPending({
  id: "status_pending_001",
  amount: 6400,
  minutesAgo: 1,
  retryInMinutes: 10,
});

// One 429 response. The destination asked for a retry after the maximum
// supported Retry-After delay (5 minutes), so the job stays "retrying" until
// that time and the processor can pick it up normally afterwards.
{
  const receivedAt = ago(10 * 1000);
  const attempt = failedAttempt(receivedAt, 2000, {
    httpStatusCode: 429,
    responseTimeMs: 17,
    errorMessage: "HTTP 429",
  });

  scenarios.push({
    id: `${DEMO_PREFIX}status_retrying_001`,
    type: "payment.success",
    amount: 7200,
    currency: "USD",
    state: "succeeded",
    receivedAt,
    eventStatus: "queued",
    jobStatus: "retrying",
    attempts: [attempt],
    job: {
      lastStatusCode: 429,
      lastResponseTimeMs: 17,
      lastError: "HTTP 429",
      nextAttemptAt: new Date(
        attempt.respondedAt.getTime() + 5 * MINUTE_MS,
      ),
      updatedAt: attempt.respondedAt,
    },
  });
}

// A claimed job holding a lease. The processor leaves it alone until the lock
// expires (or recovers it on the next startup), so the in-flight state stays
// visible for the demo.
{
  const receivedAt = ago(1 * MINUTE_MS);
  const lockedAt = ago(5 * 1000);

  scenarios.push({
    id: `${DEMO_PREFIX}status_processing_001`,
    type: "payment.success",
    amount: 8600,
    currency: "USD",
    state: "succeeded",
    receivedAt,
    eventStatus: "queued",
    jobStatus: "processing",
    attempts: [],
    job: {
      lockedAt,
      lockExpiresAt: new Date(lockedAt.getTime() + 10 * MINUTE_MS),
      lastStatusCode: null,
      lastResponseTimeMs: null,
      lastError: null,
      nextAttemptAt: receivedAt,
      updatedAt: lockedAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Dead-letter events
// ---------------------------------------------------------------------------

pushDeadLetter({
  id: "dead_permanent_001",
  amount: 4200,
  extra: { failureReason: "endpoint_missing" },
  hoursAgo: 6,
  buildAttempts: (receivedAt) => [
    failedAttempt(receivedAt, 2000, {
      httpStatusCode: 404,
      responseTimeMs: 24,
      errorMessage: "HTTP 404",
      outcome: "permanent_failure",
    }),
  ],
  lastStatusCode: 404,
  lastResponseTimeMs: 24,
  lastError: "HTTP 404",
});

pushDeadLetter({
  id: "dead_exhausted_001",
  amount: 9900,
  extra: { failureReason: "card_declined" },
  hoursAgo: 18,
  buildAttempts: (receivedAt) =>
    retryHistory(receivedAt, {
      httpStatusCode: 500,
      responseTimeMs: 28,
      errorMessage: "HTTP 500",
    }),
  lastStatusCode: 500,
  lastResponseTimeMs: 28,
  lastError: "HTTP 500",
});

pushDeadLetter({
  id: "dead_timeout_001",
  amount: 2750,
  hoursAgo: 26,
  buildAttempts: (receivedAt) =>
    retryHistory(receivedAt, {
      httpStatusCode: null,
      responseTimeMs: 10000,
      errorMessage: "Request timed out after 10000 ms",
    }),
  lastStatusCode: null,
  lastResponseTimeMs: 10000,
  lastError: "Request timed out after 10000 ms",
});

pushDeadLetter({
  id: "dead_422_001",
  amount: 1500,
  extra: { failureReason: "invalid_payload" },
  hoursAgo: 40,
  buildAttempts: (receivedAt) => [
    failedAttempt(receivedAt, 2000, {
      httpStatusCode: 422,
      responseTimeMs: 31,
      errorMessage: "HTTP 422",
      outcome: "permanent_failure",
    }),
  ],
  lastStatusCode: 422,
  lastResponseTimeMs: 31,
  lastError: "HTTP 422",
});

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

async function insertScenario(tx, scenario, { sourceId, destinationId }) {
  const payload = paymentPayload(scenario);

  const event = await tx.event.create({
    data: {
      sourceId,
      externalEventId: scenario.id,
      eventType: scenario.type,
      payload,
      signatureVerified: true,
      status: scenario.eventStatus,
      receivedAt: scenario.receivedAt,
    },
  });

  const job = await tx.deliveryJob.create({
    data: {
      eventId: event.id,
      destinationId,
      status: scenario.jobStatus,
      attemptCount: scenario.attempts.length,
      maxAttempts: 5,
      nextAttemptAt: scenario.job.nextAttemptAt,
      lockedAt: scenario.job.lockedAt ?? null,
      lockExpiresAt: scenario.job.lockExpiresAt ?? null,
      lastStatusCode: scenario.job.lastStatusCode ?? null,
      lastResponseTimeMs: scenario.job.lastResponseTimeMs ?? null,
      lastError: scenario.job.lastError ?? null,
      createdAt: scenario.receivedAt,
      updatedAt: scenario.job.updatedAt,
    },
  });

  if (scenario.attempts.length > 0) {
    await tx.deliveryAttempt.createMany({
      data: scenario.attempts.map((attempt, index) => ({
        deliveryJobId: job.id,
        attemptNumber: index + 1,
        requestedAt: attempt.requestedAt,
        respondedAt: attempt.respondedAt,
        httpStatusCode: attempt.httpStatusCode,
        responseTimeMs: attempt.responseTimeMs,
        errorMessage: attempt.errorMessage,
        outcome: attempt.outcome,
      })),
    });
  }

  return event;
}

async function main() {
  const { source, destination } = await ensureConfig();

  const where = { externalEventId: { startsWith: DEMO_PREFIX } };
  const existing = await prisma.event.findMany({
    where,
    select: { externalEventId: true },
  });
  const existingIds = new Set(
    existing.map((event) => event.externalEventId),
  );
  const missing = scenarios.filter(
    (scenario) => !existingIds.has(scenario.id),
  );

  if (missing.length === 0) {
    console.log("All demo events already exist; nothing to add.");
  } else {
    await prisma.$transaction(
      async (tx) => {
        for (const scenario of missing) {
          await insertScenario(tx, scenario, {
            sourceId: source.id,
            destinationId: destination.id,
          });
        }
      },
      { timeout: 20000 },
    );

    console.log(
      `Added ${missing.length} demo event(s); ` +
        `${existingIds.size} already present.`,
    );
  }

  const [events, jobs, attempts, eventStatusGroups, jobStatusGroups] =
    await Promise.all([
      prisma.event.count({ where }),
      prisma.deliveryJob.count({ where: { event: where } }),
      prisma.deliveryAttempt.count({
        where: { deliveryJob: { event: where } },
      }),
      prisma.event.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      prisma.deliveryJob.groupBy({
        by: ["status"],
        where: { event: where },
        _count: { _all: true },
      }),
    ]);

  const formatGroups = (groups) =>
    groups
      .map((group) => `${group.status}=${group._count._all}`)
      .sort()
      .join(", ");

  console.log("");
  console.log("Demo data ready.");
  console.log(`  events:            ${events}`);
  console.log(`  delivery jobs:     ${jobs}`);
  console.log(`  delivery attempts: ${attempts}`);
  console.log(`  event statuses:    ${formatGroups(eventStatusGroups)}`);
  console.log(`  job statuses:      ${formatGroups(jobStatusGroups)}`);
  console.log(`  prefix:            ${DEMO_PREFIX}`);
  console.log("");
  console.log("Open http://localhost:3000 to view it.");
  console.log("Remove it with: npm run demo:clear");
}

main()
  .catch((error) => {
    console.error("Failed to seed demo data:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
