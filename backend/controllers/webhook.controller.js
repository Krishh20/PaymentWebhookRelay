const HttpError = require("../utils/httpError");
const { processWebhook } = require("../services/webhookService");
const { sendSuccess } = require("../utils/apiResponse");

async function receiveWebhook(req, res) {
  // express.raw only attaches a Buffer when the content type is JSON.
  if (!Buffer.isBuffer(req.body)) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }

  const { event, job, duplicate } = await processWebhook({
    sourceSlug: req.params.sourceSlug,
    rawBody: req.body,
    headers: req.headers,
  });

  return sendSuccess(
    res,
    {
      eventId: event.id,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      status: event.status,
      jobId: job ? job.id : null,
      deliveryStatus: job ? job.status : null,
      duplicate,
      receivedAt: event.receivedAt,
    },
    duplicate ? 200 : 202,
  );
}

module.exports = {
  receiveWebhook,
};
