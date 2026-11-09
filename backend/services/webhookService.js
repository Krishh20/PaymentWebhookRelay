const HttpError = require("../utils/httpError");
const { verifyWebhookSignature } = require("../utils/hmac");
const {
  createEventWithJob,
  findEventWithJob,
  getActiveDestination,
} = require("./eventService");
const prisma = require("../db/prisma");

async function getActiveSource(sourceSlug) {
  const source = await prisma.source.findUnique({
    where: { slug: sourceSlug },
  });

  if (!source || !source.isActive) {
    throw new HttpError(404, "Webhook source not found.");
  }

  return source;
}

function readRequiredString(value, fieldName, maxLength) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `Payload field "${fieldName}" is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new HttpError(
      400,
      `Payload field "${fieldName}" must be at most ${maxLength} characters.`,
    );
  }

  return trimmed;
}

function parseEventPayload(rawBody) {
  let payload;

  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const externalEventId = readRequiredString(payload.id, "id", 255);
  const eventType = readRequiredString(payload.type, "type", 100);

  return { payload, externalEventId, eventType };
}

function readSignatureHeader(headers, headerName) {
  const value = headers[headerName.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function processWebhook({ sourceSlug, rawBody, headers }) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new HttpError(400, "Request body is required.");
  }

  const source = await getActiveSource(sourceSlug);
  const secret = process.env[source.secretEnvVar];

  if (!secret) {
    // Never log the secret or the signature.
    console.error(
      `[webhook] missing secret environment variable: ${source.secretEnvVar}`,
    );
    throw new HttpError(500, "Webhook verification is not configured.");
  }

  const signature = readSignatureHeader(headers, source.signatureHeader);

  if (!verifyWebhookSignature({ secret, rawBody, signature })) {
    throw new HttpError(401, "Invalid webhook signature.");
  }

  const { payload, externalEventId, eventType } = parseEventPayload(rawBody);
  const existing = await findEventWithJob(source.id, externalEventId);

  if (existing) {
    return {
      event: existing,
      job: existing.deliveryJob,
      duplicate: true,
    };
  }

  const destination = await getActiveDestination();

  try {
    const { event, job } = await createEventWithJob({
      sourceId: source.id,
      destinationId: destination.id,
      externalEventId,
      eventType,
      payload,
    });

    return { event, job, duplicate: false };
  } catch (error) {
    // Two requests for the same event can race. The unique event constraint
    // decides the winner; the loser returns the already committed event+job.
    if (error.code === "P2002") {
      const duplicate = await findEventWithJob(source.id, externalEventId);

      if (duplicate) {
        return {
          event: duplicate,
          job: duplicate.deliveryJob,
          duplicate: true,
        };
      }
    }

    throw error;
  }
}

module.exports = {
  processWebhook,
};
