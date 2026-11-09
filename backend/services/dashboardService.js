const prisma = require("../db/prisma");
const HttpError = require("../utils/httpError");
const {
  parsePagination,
  parseOptionalString,
  parseEnumList,
  parseOptionalDate,
  assertDateRange,
  parseUuid,
} = require("../utils/queryParams");

const EVENT_STATUSES = [
  "received",
  "queued",
  "processing",
  "delivered",
  "dead_letter",
];
const DELIVERY_STATUSES = [
  "pending",
  "processing",
  "retrying",
  "succeeded",
  "dead_letter",
];
const ATTEMPT_OUTCOMES = [
  "succeeded",
  "retryable_failure",
  "permanent_failure",
];

const EVENT_STATUS_SET = new Set(EVENT_STATUSES);
const DELIVERY_STATUS_SET = new Set(DELIVERY_STATUSES);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const sourceSelect = {
  id: true,
  name: true,
  slug: true,
  signatureHeader: true,
};

const destinationSelect = {
  id: true,
  name: true,
  url: true,
  timeoutMs: true,
  isActive: true,
};

const eventSummarySelect = {
  id: true,
  externalEventId: true,
  eventType: true,
  status: true,
  receivedAt: true,
};

const deliveryJobSummarySelect = {
  id: true,
  status: true,
  attemptCount: true,
  maxAttempts: true,
  nextAttemptAt: true,
  lastStatusCode: true,
  lastResponseTimeMs: true,
  lastError: true,
  updatedAt: true,
};

const attemptSelect = {
  id: true,
  attemptNumber: true,
  requestedAt: true,
  respondedAt: true,
  httpStatusCode: true,
  responseTimeMs: true,
  errorMessage: true,
  outcome: true,
};

function countByStatus(allowedValues, rows) {
  const counts = Object.fromEntries(
    allowedValues.map((value) => [value, 0]),
  );

  for (const row of rows) {
    counts[row.status] = row._count._all;
  }

  return counts;
}

function countByOutcome(rows) {
  const counts = Object.fromEntries(
    ATTEMPT_OUTCOMES.map((value) => [value, 0]),
  );

  for (const row of rows) {
    counts[row.outcome] = row._count._all;
  }

  return counts;
}

function sumCounts(counts) {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

function paginationMeta(total, limit, offset) {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

function buildEventFilter(query, { useReceivedDates = false } = {}) {
  const filter = {};
  const search = parseOptionalString(query, "search", 255);
  const eventType = parseOptionalString(query, "eventType", 100);

  if (search) {
    filter.externalEventId = { contains: search, mode: "insensitive" };
  }

  if (eventType) {
    filter.eventType = eventType;
  }

  if (useReceivedDates) {
    const receivedFrom = parseOptionalDate(query, "receivedFrom");
    const receivedTo = parseOptionalDate(query, "receivedTo");

    assertDateRange(receivedFrom, receivedTo, "receivedFrom", "receivedTo");

    if (receivedFrom || receivedTo) {
      filter.receivedAt = {
        ...(receivedFrom ? { gte: receivedFrom } : {}),
        ...(receivedTo ? { lte: receivedTo } : {}),
      };
    }
  }

  return filter;
}

async function getOverview() {
  const since = new Date(Date.now() - ONE_DAY_MS);

  const [
    eventGroups,
    jobGroups,
    attemptGroups,
    eventsLast24Hours,
    attemptsLast24Hours,
    activeDestinations,
  ] = await Promise.all([
    prisma.event.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.deliveryJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.deliveryAttempt.groupBy({
      by: ["outcome"],
      _count: { _all: true },
    }),
    prisma.event.count({ where: { receivedAt: { gte: since } } }),
    prisma.deliveryAttempt.count({ where: { requestedAt: { gte: since } } }),
    prisma.destination.count({ where: { isActive: true } }),
  ]);

  const eventsByStatus = countByStatus(EVENT_STATUSES, eventGroups);
  const jobsByStatus = countByStatus(DELIVERY_STATUSES, jobGroups);
  const attemptsByOutcome = countByOutcome(attemptGroups);
  const finishedJobs = jobsByStatus.succeeded + jobsByStatus.dead_letter;

  return {
    events: {
      total: sumCounts(eventsByStatus),
      byStatus: eventsByStatus,
      last24Hours: eventsLast24Hours,
    },
    deliveryJobs: {
      total: sumCounts(jobsByStatus),
      byStatus: jobsByStatus,
      successRate:
        finishedJobs === 0
          ? null
          : Number(
              ((jobsByStatus.succeeded / finishedJobs) * 100).toFixed(2),
            ),
    },
    attempts: {
      total: sumCounts(attemptsByOutcome),
      byOutcome: attemptsByOutcome,
      last24Hours: attemptsLast24Hours,
    },
    destinations: {
      active: activeDestinations,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function listEvents(query) {
  const { limit, offset } = parsePagination(query);
  const statuses = parseEnumList(
    query,
    "status",
    EVENT_STATUS_SET,
    "status",
  );
  const where = buildEventFilter(query, { useReceivedDates: true });

  if (statuses) {
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  const [total, items] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        ...eventSummarySelect,
        signatureVerified: true,
        updatedAt: true,
        source: { select: sourceSelect },
        deliveryJob: { select: deliveryJobSummarySelect },
      },
    }),
  ]);

  return { items, pagination: paginationMeta(total, limit, offset) };
}

async function getEvent(eventId) {
  const id = parseUuid(eventId, "eventId");

  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      ...eventSummarySelect,
      payload: true,
      signatureVerified: true,
      updatedAt: true,
      source: { select: sourceSelect },
      deliveryJob: {
        select: {
          ...deliveryJobSummarySelect,
          lockedAt: true,
          lockExpiresAt: true,
          createdAt: true,
          destination: { select: destinationSelect },
          attempts: {
            orderBy: { attemptNumber: "desc" },
            select: attemptSelect,
          },
        },
      },
    },
  });

  if (!event) {
    throw new HttpError(404, "Event not found.");
  }

  return event;
}

async function listDeliveries(query) {
  const { limit, offset } = parsePagination(query);
  const statuses = parseEnumList(
    query,
    "status",
    DELIVERY_STATUS_SET,
    "status",
  );
  const eventFilter = buildEventFilter(query);
  const updatedFrom = parseOptionalDate(query, "updatedFrom");
  const updatedTo = parseOptionalDate(query, "updatedTo");

  assertDateRange(updatedFrom, updatedTo, "updatedFrom", "updatedTo");

  const where = {};

  if (statuses) {
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  if (Object.keys(eventFilter).length > 0) {
    where.event = eventFilter;
  }

  if (updatedFrom || updatedTo) {
    where.updatedAt = {
      ...(updatedFrom ? { gte: updatedFrom } : {}),
      ...(updatedTo ? { lte: updatedTo } : {}),
    };
  }

  const select = {
    id: true,
    eventId: true,
    status: true,
    attemptCount: true,
    maxAttempts: true,
    nextAttemptAt: true,
    lockedAt: true,
    lockExpiresAt: true,
    lastStatusCode: true,
    lastResponseTimeMs: true,
    lastError: true,
    createdAt: true,
    updatedAt: true,
    event: { select: eventSummarySelect },
    destination: { select: destinationSelect },
  };

  const [total, items] = await Promise.all([
    prisma.deliveryJob.count({ where }),
    prisma.deliveryJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limit,
      select,
    }),
  ]);

  return { items, pagination: paginationMeta(total, limit, offset) };
}

async function getDelivery(deliveryJobId) {
  const id = parseUuid(deliveryJobId, "deliveryJobId");

  const deliveryJob = await prisma.deliveryJob.findUnique({
    where: { id },
    select: {
      id: true,
      eventId: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
      lockedAt: true,
      lockExpiresAt: true,
      lastStatusCode: true,
      lastResponseTimeMs: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      event: {
        select: {
          ...eventSummarySelect,
          payload: true,
          signatureVerified: true,
          updatedAt: true,
          source: { select: sourceSelect },
        },
      },
      destination: { select: destinationSelect },
      attempts: {
        orderBy: { attemptNumber: "desc" },
        select: attemptSelect,
      },
    },
  });

  if (!deliveryJob) {
    throw new HttpError(404, "Delivery job not found.");
  }

  return deliveryJob;
}

async function listDeadLetter(query) {
  const { limit, offset } = parsePagination(query);
  const eventFilter = buildEventFilter(query, { useReceivedDates: true });
  const where = { status: "dead_letter" };

  if (Object.keys(eventFilter).length > 0) {
    where.event = eventFilter;
  }

  const [total, rows] = await Promise.all([
    prisma.deliveryJob.count({ where }),
    prisma.deliveryJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        ...deliveryJobSummarySelect,
        createdAt: true,
        event: { select: eventSummarySelect },
        destination: { select: destinationSelect },
        attempts: {
          orderBy: { attemptNumber: "desc" },
          take: 1,
          select: attemptSelect,
        },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    event: row.event,
    deliveryJob: {
      id: row.id,
      status: row.status,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt,
      lastStatusCode: row.lastStatusCode,
      lastResponseTimeMs: row.lastResponseTimeMs,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    destination: row.destination,
    lastAttempt: row.attempts[0] || null,
  }));

  return { items, pagination: paginationMeta(total, limit, offset) };
}

module.exports = {
  getOverview,
  listEvents,
  getEvent,
  listDeliveries,
  getDelivery,
  listDeadLetter,
};
