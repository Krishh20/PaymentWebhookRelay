const prisma = require("../db/prisma");
const HttpError = require("../utils/httpError");

const MAX_DELIVERY_ATTEMPTS = 5;

async function findEventWithJob(sourceId, externalEventId) {
  return prisma.event.findUnique({
    where: {
      sourceId_externalEventId: {
        sourceId,
        externalEventId,
      },
    },
    include: {
      deliveryJob: true,
    },
  });
}

async function getActiveDestination() {
  const destination = await prisma.destination.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (!destination) {
    throw new HttpError(503, "Delivery destination is not configured.");
  }

  return destination;
}

// The event and its delivery job must be committed together. If either insert
// fails, Prisma rolls the whole transaction back, so there can never be a
// stored event without a job.
async function createEventWithJob({
  sourceId,
  destinationId,
  externalEventId,
  eventType,
  payload,
}) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        sourceId,
        externalEventId,
        eventType,
        payload,
        signatureVerified: true,
        status: "queued",
      },
    });

    const job = await tx.deliveryJob.create({
      data: {
        eventId: event.id,
        destinationId,
        status: "pending",
        attemptCount: 0,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        nextAttemptAt: new Date(),
      },
    });

    return { event, job };
  });
}

module.exports = {
  MAX_DELIVERY_ATTEMPTS,
  findEventWithJob,
  getActiveDestination,
  createEventWithJob,
};
