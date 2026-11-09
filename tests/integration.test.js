const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureTestDatabase,
  databaseUrlFor,
  TEST_DATABASE_NAME,
} = require("./helpers/testDatabase");

const BACKEND_DIR = path.resolve(__dirname, "../backend");
const backendRequire = createRequire(path.join(BACKEND_DIR, "package.json"));
const dotenv = backendRequire("dotenv");

// The developer .env is used only to discover the PostgreSQL server and its
// credentials. Tests always run against the dedicated test database below.
dotenv.config({ path: path.join(BACKEND_DIR, ".env"), quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not configured. Run `npm run setup:env` and start PostgreSQL first.",
  );
}

const DEVELOPER_DATABASE_URL = process.env.DATABASE_URL;
const TEST_SECRET = "whsec_integration_test_only_2f7c9a1e5b8d4f6a";
const TEST_SOURCE_SLUG = "test-source";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = databaseUrlFor(
  TEST_DATABASE_NAME,
  DEVELOPER_DATABASE_URL,
);
process.env.WEBHOOK_SECRET = TEST_SECRET;
process.env.WEBHOOK_SOURCE_NAME = "Integration Test Source";
process.env.WEBHOOK_SOURCE_SLUG = TEST_SOURCE_SLUG;
process.env.WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";
process.env.DESTINATION_NAME = "Integration Test Destination";
process.env.DESTINATION_URL = "http://localhost:4000/mock/success";
process.env.DESTINATION_TIMEOUT_MS = "1500";

const app = require("../backend/app");
const prisma = require("../backend/db/prisma");
const { ensureConfig } = require("../backend/services/configService");
const {
  resetIntermittentState,
} = require("../backend/controllers/mock.controller");
const {
  claimDueJobs,
  recoverExpiredJobs,
  recoverInterruptedJobs,
  tick,
} = require("../backend/services/deliveryProcessor");
const { deliverJob } = require("../backend/services/deliveryService");

let server;
let baseUrl;
let destination;
let sequence = 0;

async function resetData() {
  await prisma.deliveryAttempt.deleteMany();
  await prisma.deliveryJob.deleteMany();
  await prisma.event.deleteMany();
}

async function setDestination(url, { timeoutMs = 1500, isActive = true } = {}) {
  return prisma.destination.update({
    where: { id: destination.id },
    data: { url, timeoutMs, isActive },
  });
}

function hmac(rawBody) {
  return crypto.createHmac("sha256", TEST_SECRET).update(rawBody).digest("hex");
}

function signedHeaders(rawBody) {
  return {
    "content-type": "application/json",
    "x-webhook-signature": `sha256=${hmac(rawBody)}`,
  };
}

function makePayload(label, { id, type = "payment.success", data } = {}) {
  sequence += 1;
  const externalEventId =
    id || `evt_it_${label}_${sequence}_${crypto.randomUUID()}`;

  const payload = {
    id: externalEventId,
    type,
    data: data ?? { amount: 2500, currency: "USD" },
  };

  return { externalEventId, payload, raw: JSON.stringify(payload) };
}

async function postWebhook(
  rawBody,
  { headers, sourceSlug = TEST_SOURCE_SLUG } = {},
) {
  const response = await fetch(`${baseUrl}/api/webhooks/${sourceSlug}`, {
    method: "POST",
    headers: headers || signedHeaders(rawBody),
    body: rawBody,
  });

  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function createEvent(label, options = {}) {
  const item = makePayload(label, options);
  const result = await postWebhook(item.raw);

  assert.equal(
    result.status,
    202,
    `expected 202 but received ${result.status}: ${JSON.stringify(result.body)}`,
  );

  return { ...item, data: result.body.data };
}

async function makeDue(jobId) {
  await prisma.deliveryJob.update({
    where: { id: jobId },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
}

async function getJob(jobId) {
  return prisma.deliveryJob.findUnique({
    where: { id: jobId },
    include: {
      attempts: { orderBy: { attemptNumber: "asc" } },
      event: true,
    },
  });
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

before(async () => {
  await ensureTestDatabase(DEVELOPER_DATABASE_URL);
  await prisma.$connect();

  await prisma.deliveryAttempt.deleteMany();
  await prisma.deliveryJob.deleteMany();
  await prisma.event.deleteMany();

  const config = await ensureConfig();
  destination = config.destination;

  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await resetData();
  resetIntermittentState();

  await prisma.destination.update({
    where: { id: destination.id },
    data: {
      url: `${baseUrl}/mock/success`,
      timeoutMs: 1500,
      isActive: true,
    },
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  try {
    if (destination) {
      await resetData();
    }
  } finally {
    await prisma.$disconnect();
  }
});

// ---------------------------------------------------------------------------
// Health and internal configuration
// ---------------------------------------------------------------------------

test("GET /api/health reports a connected database", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.database, "connected");
  assert.equal(typeof body.data.uptimeSeconds, "number");
});

test("GET /api/config never exposes the HMAC secret", async () => {
  const { status, body } = await getJson("/api/config");

  assert.equal(status, 200);
  assert.equal(body.data.source.slug, TEST_SOURCE_SLUG);
  assert.equal(body.data.destination.name, "Integration Test Destination");
  assert.equal(body.data.webhook.signatureAlgorithm, "HMAC-SHA256");

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(TEST_SECRET), false);
  assert.equal(serialized.includes("secretEnvVar"), false);
  assert.equal(serialized.includes("WEBHOOK_SECRET"), false);
});

// ---------------------------------------------------------------------------
// Webhook ingestion and validation
// ---------------------------------------------------------------------------

test("accepts a valid signed webhook and stores an event with a pending job", async () => {
  const item = makePayload("valid");
  const { status, body } = await postWebhook(item.raw);

  assert.equal(status, 202);
  assert.equal(body.success, true);
  assert.equal(body.data.duplicate, false);
  assert.equal(body.data.externalEventId, item.externalEventId);
  assert.equal(body.data.eventType, "payment.success");
  assert.equal(body.data.status, "queued");
  assert.equal(body.data.deliveryStatus, "pending");
  assert.ok(body.data.eventId);
  assert.ok(body.data.jobId);

  const event = await prisma.event.findUnique({
    where: { id: body.data.eventId },
    include: { deliveryJob: true },
  });

  assert.ok(event);
  assert.equal(event.externalEventId, item.externalEventId);
  assert.equal(event.eventType, "payment.success");
  assert.equal(event.signatureVerified, true);
  assert.equal(event.status, "queued");
  assert.deepEqual(event.payload, item.payload);

  assert.equal(event.deliveryJob.status, "pending");
  assert.equal(event.deliveryJob.attemptCount, 0);
  assert.equal(event.deliveryJob.maxAttempts, 5);
  assert.equal(event.deliveryJob.lastStatusCode, null);
});

test("returns the existing event for a duplicate webhook", async () => {
  const item = makePayload("duplicate");

  const first = await postWebhook(item.raw);
  const second = await postWebhook(item.raw);

  assert.equal(first.status, 202);
  assert.equal(first.body.data.duplicate, false);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.duplicate, true);
  assert.equal(second.body.data.eventId, first.body.data.eventId);
  assert.equal(second.body.data.jobId, first.body.data.jobId);

  assert.equal(await prisma.event.count(), 1);
  assert.equal(await prisma.deliveryJob.count(), 1);
});

test("rejects an invalid signature without storing an event", async () => {
  const item = makePayload("invalid-signature");

  const { status, body } = await postWebhook(item.raw, {
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": `sha256=${"0".repeat(64)}`,
    },
  });

  assert.equal(status, 401);
  assert.equal(body.success, false);
  assert.match(body.error.message, /signature/i);
  assert.equal(await prisma.event.count(), 0);
});

test("rejects a missing signature", async () => {
  const item = makePayload("missing-signature");

  const { status } = await postWebhook(item.raw, {
    headers: { "content-type": "application/json" },
  });

  assert.equal(status, 401);
  assert.equal(await prisma.event.count(), 0);
});

test("rejects an unknown source", async () => {
  const item = makePayload("unknown-source");

  const { status, body } = await postWebhook(item.raw, {
    sourceSlug: "does-not-exist",
  });

  assert.equal(status, 404);
  assert.match(body.error.message, /source/i);
  assert.equal(await prisma.event.count(), 0);
});

test("rejects an inactive source", async () => {
  const source = await prisma.source.findFirst();
  await prisma.source.update({
    where: { id: source.id },
    data: { isActive: false },
  });

  try {
    const item = makePayload("inactive-source");
    const { status } = await postWebhook(item.raw);

    assert.equal(status, 404);
    assert.equal(await prisma.event.count(), 0);
  } finally {
    await prisma.source.update({
      where: { id: source.id },
      data: { isActive: true },
    });
  }
});

test("binds the signature to the exact raw request bytes", async () => {
  const signed = makePayload("signed-bytes");
  const tampered = makePayload("tampered-bytes");

  const { status } = await postWebhook(tampered.raw, {
    headers: signedHeaders(signed.raw),
  });

  assert.equal(status, 401);
  assert.equal(await prisma.event.count(), 0);
});

test("rejects invalid JSON and invalid payload shapes", async () => {
  const invalidJson = '{"id":"evt_it_bad_json","type":"payment.success"';
  const invalidJsonResult = await postWebhook(invalidJson);
  assert.equal(invalidJsonResult.status, 400);
  assert.match(invalidJsonResult.body.error.message, /valid JSON/i);

  const cases = [
    '{"type":"payment.success"}',
    '{"id":"evt_it_missing_type"}',
    '{"id":"","type":"payment.success"}',
    '{"id":"   ","type":"payment.success"}',
    "[1,2,3]",
    '"just a string"',
  ];

  for (const raw of cases) {
    const result = await postWebhook(raw);
    assert.equal(result.status, 400, `payload should be rejected: ${raw}`);
  }

  assert.equal(await prisma.event.count(), 0);
});

test("rejects a non-JSON content type", async () => {
  const item = makePayload("content-type");

  const { status, body } = await postWebhook(item.raw, {
    headers: {
      "content-type": "text/plain",
      "x-webhook-signature": `sha256=${hmac(item.raw)}`,
    },
  });

  assert.equal(status, 415);
  assert.match(body.error.message, /content-type/i);
  assert.equal(await prisma.event.count(), 0);
});

test("rejects a body larger than the 1 MB limit", async () => {
  const item = makePayload("too-large", {
    data: { blob: "x".repeat(1_100_000) },
  });

  const { status, body } = await postWebhook(item.raw);

  assert.equal(status, 413);
  assert.match(body.error.message, /too large/i);
  assert.equal(await prisma.event.count(), 0);
});

// ---------------------------------------------------------------------------
// Delivery processing
// ---------------------------------------------------------------------------

test("delivers a pending job to the mock success destination", async () => {
  const item = await createEvent("delivery-success");
  await makeDue(item.data.jobId);
  await tick();

  const job = await getJob(item.data.jobId);

  assert.equal(job.status, "succeeded");
  assert.equal(job.attemptCount, 1);
  assert.equal(job.lastStatusCode, 200);
  assert.equal(job.lastError, null);
  assert.equal(job.lockedAt, null);
  assert.equal(job.lockExpiresAt, null);
  assert.equal(job.event.status, "delivered");
  assert.equal(job.attempts.length, 1);
  assert.equal(job.attempts[0].attemptNumber, 1);
  assert.equal(job.attempts[0].outcome, "succeeded");
  assert.equal(job.attempts[0].httpStatusCode, 200);
});

test("retries an intermittent failure and succeeds on the next attempt", async () => {
  const item = await createEvent("delivery-intermittent");
  await setDestination(`${baseUrl}/mock/intermittent`);

  await makeDue(item.data.jobId);
  await tick();

  let job = await getJob(item.data.jobId);
  assert.equal(job.status, "retrying");
  assert.equal(job.attemptCount, 1);
  assert.equal(job.lastStatusCode, 503);
  assert.equal(job.attempts.length, 1);
  assert.equal(job.attempts[0].outcome, "retryable_failure");
  assert.ok(job.nextAttemptAt.getTime() > Date.now());
  assert.equal(job.event.status, "queued");

  await makeDue(item.data.jobId);
  await tick();

  job = await getJob(item.data.jobId);
  assert.equal(job.status, "succeeded");
  assert.equal(job.attemptCount, 2);
  assert.equal(job.attempts.length, 2);
  assert.equal(job.attempts[0].outcome, "retryable_failure");
  assert.equal(job.attempts[1].outcome, "succeeded");
  assert.equal(job.event.status, "delivered");
});

test("dead-letters a job after five retryable failures", async () => {
  const item = await createEvent("delivery-exhausted");
  await setDestination(`${baseUrl}/mock/failure`);

  let job;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await makeDue(item.data.jobId);
    await tick();

    job = await getJob(item.data.jobId);
    assert.equal(job.attemptCount, attempt);
    assert.equal(job.attempts.length, attempt);

    if (attempt < 5) {
      assert.equal(job.status, "retrying");
      assert.ok(job.nextAttemptAt.getTime() > Date.now());
    }
  }

  assert.equal(job.status, "dead_letter");
  assert.equal(job.event.status, "dead_letter");
  assert.equal(job.lastStatusCode, 500);
  assert.equal(job.lastError, "HTTP 500");
  assert.equal(job.attempts.length, 5);
  assert.ok(
    job.attempts.every((attempt) => attempt.outcome === "retryable_failure"),
  );
});

test("dead-letters a permanent 404 response immediately", async () => {
  const item = await createEvent("delivery-permanent");
  await setDestination(`${baseUrl}/mock/missing-route`);

  await makeDue(item.data.jobId);
  await tick();

  const job = await getJob(item.data.jobId);

  assert.equal(job.status, "dead_letter");
  assert.equal(job.attemptCount, 1);
  assert.equal(job.lastStatusCode, 404);
  assert.equal(job.event.status, "dead_letter");
  assert.equal(job.attempts.length, 1);
  assert.equal(job.attempts[0].outcome, "permanent_failure");
});

test("records a timeout as a retryable failure", async () => {
  const item = await createEvent("delivery-timeout");
  await setDestination(`${baseUrl}/mock/timeout`, { timeoutMs: 1000 });

  await makeDue(item.data.jobId);
  await tick();

  const job = await getJob(item.data.jobId);

  assert.equal(job.status, "retrying");
  assert.equal(job.attemptCount, 1);
  assert.equal(job.lastStatusCode, null);
  assert.equal(job.event.status, "queued");
  assert.equal(job.attempts.length, 1);
  assert.equal(job.attempts[0].outcome, "retryable_failure");
  assert.match(job.attempts[0].errorMessage, /timed out after 1000 ms/i);
});

test("dead-letters immediately when the destination is inactive", async () => {
  const item = await createEvent("delivery-inactive");
  await setDestination(`${baseUrl}/mock/success`, { isActive: false });

  await makeDue(item.data.jobId);
  await tick();

  const job = await getJob(item.data.jobId);

  assert.equal(job.status, "dead_letter");
  assert.equal(job.event.status, "dead_letter");
  assert.equal(job.attempts.length, 1);
  assert.equal(job.attempts[0].outcome, "permanent_failure");
  assert.match(job.attempts[0].errorMessage, /inactive/i);
});

test("claims due jobs once and recovers expired or interrupted locks", async () => {
  const item = await createEvent("claiming");
  const jobId = item.data.jobId;
  await makeDue(jobId);

  const claimed = await claimDueJobs(1);
  assert.deepEqual(claimed, [jobId]);

  let job = await prisma.deliveryJob.findUnique({ where: { id: jobId } });
  assert.equal(job.status, "processing");
  assert.ok(job.lockedAt);
  assert.ok(job.lockExpiresAt.getTime() > Date.now());

  assert.deepEqual(await claimDueJobs(1), []);

  await prisma.deliveryJob.update({
    where: { id: jobId },
    data: { lockExpiresAt: new Date(Date.now() - 1000) },
  });

  assert.equal(await recoverExpiredJobs(), 1);
  job = await prisma.deliveryJob.findUnique({ where: { id: jobId } });
  assert.equal(job.status, "retrying");
  assert.equal(job.lockedAt, null);
  assert.equal(job.lockExpiresAt, null);

  await prisma.deliveryJob.update({
    where: { id: jobId },
    data: {
      status: "processing",
      lockedAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 30000),
    },
  });

  assert.equal(await recoverInterruptedJobs(), 1);
  job = await prisma.deliveryJob.findUnique({ where: { id: jobId } });
  assert.equal(job.status, "retrying");
  assert.equal(job.lockedAt, null);
  assert.equal(job.lockExpiresAt, null);
});

test("does not process the same job twice when ticks overlap", async () => {
  const item = await createEvent("overlapping-ticks");
  await makeDue(item.data.jobId);

  await Promise.all([tick(), tick()]);

  const job = await getJob(item.data.jobId);
  assert.equal(job.status, "succeeded");
  assert.equal(job.attemptCount, 1);
  assert.equal(job.attempts.length, 1);
});

test("ignores delivery attempts for jobs that are not processing", async () => {
  const item = await createEvent("not-processing");
  const jobId = item.data.jobId;

  await deliverJob(jobId);

  let job = await getJob(jobId);
  assert.equal(job.status, "pending");
  assert.equal(job.attempts.length, 0);

  await prisma.deliveryJob.update({
    where: { id: jobId },
    data: { status: "succeeded", attemptCount: 1 },
  });

  await deliverJob(jobId);

  job = await getJob(jobId);
  assert.equal(job.attempts.length, 0);
});

// ---------------------------------------------------------------------------
// Dashboard read APIs
// ---------------------------------------------------------------------------

test("lists events with search, status, event-type and pagination filters", async () => {
  const prefix = `evt_it_events_${Date.now()}_`;
  const first = await createEvent("events", { id: `${prefix}a` });
  await createEvent("events", { id: `${prefix}b` });
  const refund = await createEvent("events", {
    id: `${prefix}c`,
    type: "payment.refunded",
  });

  const pageOne = await getJson(
    `/api/events?search=${encodeURIComponent(prefix)}&limit=2&offset=0`,
  );

  assert.equal(pageOne.status, 200);
  assert.equal(pageOne.body.data.pagination.total, 3);
  assert.equal(pageOne.body.data.pagination.limit, 2);
  assert.equal(pageOne.body.data.pagination.offset, 0);
  assert.equal(pageOne.body.data.pagination.hasMore, true);
  assert.equal(pageOne.body.data.items.length, 2);
  assert.equal("payload" in pageOne.body.data.items[0], false);

  const pageTwo = await getJson(
    `/api/events?search=${encodeURIComponent(prefix)}&limit=2&offset=2`,
  );
  assert.equal(pageTwo.body.data.items.length, 1);
  assert.equal(pageTwo.body.data.pagination.hasMore, false);

  const filtered = await getJson(
    `/api/events?search=${encodeURIComponent(prefix)}` +
      `&status=queued&eventType=payment.refunded`,
  );
  assert.equal(filtered.body.data.pagination.total, 1);
  assert.equal(filtered.body.data.items[0].externalEventId, refund.externalEventId);

  const noResults = await getJson(
    `/api/events?search=${encodeURIComponent(prefix)}&status=delivered`,
  );
  assert.equal(noResults.body.data.pagination.total, 0);
  assert.deepEqual(noResults.body.data.items, []);

  const serialized = JSON.stringify(pageOne.body);
  assert.equal(serialized.includes(TEST_SECRET), false);
  assert.equal(serialized.includes("secretEnvVar"), false);
  assert.ok(first.data.eventId);
});

test("returns event detail without exposing secrets", async () => {
  const item = await createEvent("event-detail", {
    data: { amount: 4200, currency: "EUR" },
  });
  const { status, body } = await getJson(`/api/events/${item.data.eventId}`);

  assert.equal(status, 200);
  assert.equal(body.data.externalEventId, item.externalEventId);
  assert.deepEqual(body.data.payload, item.payload);
  assert.equal(body.data.signatureVerified, true);
  assert.equal(body.data.source.name, "Integration Test Source");
  assert.equal(body.data.deliveryJob.status, "pending");
  assert.equal(
    body.data.deliveryJob.destination.name,
    "Integration Test Destination",
  );
  assert.deepEqual(body.data.deliveryJob.attempts, []);

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(TEST_SECRET), false);
  assert.equal(serialized.includes("secretEnvVar"), false);
});

test("validates event detail identifiers", async () => {
  const invalid = await getJson("/api/events/not-a-uuid");
  assert.equal(invalid.status, 400);

  const missing = await getJson(`/api/events/${crypto.randomUUID()}`);
  assert.equal(missing.status, 404);
});

test("lists delivery jobs and returns delivery detail with attempts", async () => {
  const prefix = `evt_it_deliveries_${Date.now()}_`;
  const item = await createEvent("deliveries", { id: `${prefix}a` });
  await setDestination(`${baseUrl}/mock/failure`);

  await makeDue(item.data.jobId);
  await tick();

  const list = await getJson(
    `/api/deliveries?search=${encodeURIComponent(prefix)}&status=retrying`,
  );

  assert.equal(list.status, 200);
  assert.equal(list.body.data.pagination.total, 1);
  assert.equal(list.body.data.items.length, 1);
  assert.equal(list.body.data.items[0].attemptCount, 1);
  assert.equal(list.body.data.items[0].lastStatusCode, 500);
  assert.equal(
    list.body.data.items[0].event.externalEventId,
    item.externalEventId,
  );
  assert.match(
    list.body.data.items[0].destination.url,
    /\/mock\/failure$/,
  );

  const detail = await getJson(`/api/deliveries/${item.data.jobId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.event.payload.id, item.externalEventId);
  assert.equal(detail.body.data.attempts.length, 1);
  assert.equal(detail.body.data.attempts[0].outcome, "retryable_failure");

  const invalid = await getJson("/api/deliveries/not-a-uuid");
  assert.equal(invalid.status, 400);

  const missing = await getJson(`/api/deliveries/${crypto.randomUUID()}`);
  assert.equal(missing.status, 404);
});

test("lists dead-letter jobs with the last attempt", async () => {
  const prefix = `evt_it_dlq_${Date.now()}_`;
  const item = await createEvent("dead-letter", {
    id: `${prefix}a`,
    type: "payment.failed",
  });
  await setDestination(`${baseUrl}/mock/missing-route`);

  await makeDue(item.data.jobId);
  await tick();

  const { status, body } = await getJson(
    `/api/dead-letter?search=${encodeURIComponent(prefix)}`,
  );

  assert.equal(status, 200);
  assert.equal(body.data.pagination.total, 1);
  assert.equal(body.data.items.length, 1);

  const row = body.data.items[0];
  assert.equal(row.event.externalEventId, item.externalEventId);
  assert.equal(row.deliveryJob.status, "dead_letter");
  assert.equal(row.deliveryJob.attemptCount, 1);
  assert.equal(row.lastAttempt.outcome, "permanent_failure");
  assert.equal(row.lastAttempt.httpStatusCode, 404);

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(TEST_SECRET), false);
  assert.equal(serialized.includes("secretEnvVar"), false);
});

test("summarizes events, jobs, attempts and success rate in the overview", async () => {
  await setDestination(`${baseUrl}/mock/success`);
  const delivered = await createEvent("overview-delivered");
  await makeDue(delivered.data.jobId);
  await tick();

  await setDestination(`${baseUrl}/mock/missing-route`);
  const failed = await createEvent("overview-failed");
  await makeDue(failed.data.jobId);
  await tick();

  await createEvent("overview-pending");

  const { status, body } = await getJson("/api/overview");

  assert.equal(status, 200);
  assert.equal(body.data.events.total, 3);
  assert.deepEqual(body.data.events.byStatus, {
    received: 0,
    queued: 1,
    processing: 0,
    delivered: 1,
    dead_letter: 1,
  });
  assert.equal(body.data.events.last24Hours, 3);

  assert.equal(body.data.deliveryJobs.total, 3);
  assert.deepEqual(body.data.deliveryJobs.byStatus, {
    pending: 1,
    processing: 0,
    retrying: 0,
    succeeded: 1,
    dead_letter: 1,
  });
  assert.equal(body.data.deliveryJobs.successRate, 50);

  assert.equal(body.data.attempts.total, 2);
  assert.deepEqual(body.data.attempts.byOutcome, {
    succeeded: 1,
    retryable_failure: 0,
    permanent_failure: 1,
  });
  assert.equal(body.data.attempts.last24Hours, 2);
  assert.equal(body.data.destinations.active, 1);
  assert.equal(Number.isNaN(Date.parse(body.data.generatedAt)), false);
});

test("rejects invalid list query parameters", async () => {
  const invalidQueries = [
    "/api/events?limit=0",
    "/api/events?limit=101",
    "/api/events?limit=abc",
    "/api/events?offset=-1",
    "/api/events?status=not-a-status",
    "/api/deliveries?status=not-a-status",
    "/api/events?receivedFrom=2026-01-02T00:00:00Z&receivedTo=2026-01-01T00:00:00Z",
    "/api/deliveries?updatedFrom=2026-01-02T00:00:00Z&updatedTo=2026-01-01T00:00:00Z",
    "/api/events?receivedFrom=not-a-date",
  ];

  for (const query of invalidQueries) {
    const { status, body } = await getJson(query);
    assert.equal(status, 400, `expected 400 for ${query}`);
    assert.equal(body.success, false);
  }
});

test("returns JSON errors for unknown routes and malformed JSON bodies", async () => {
  const missing = await getJson("/api/does-not-exist");
  assert.equal(missing.status, 404);
  assert.match(missing.body.error.message, /route not found/i);

  const malformed = await fetch(`${baseUrl}/mock/success`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"broken":',
  });
  const malformedBody = await malformed.json();

  assert.equal(malformed.status, 400);
  assert.equal(malformedBody.error.message, "Request body must be valid JSON.");
});
