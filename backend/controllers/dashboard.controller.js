const {
  getOverview,
  listEvents,
  getEvent,
  listDeliveries,
  getDelivery,
  listDeadLetter,
} = require("../services/dashboardService");
const { sendSuccess } = require("../utils/apiResponse");

async function getOverviewHandler(req, res) {
  return sendSuccess(res, await getOverview());
}

async function listEventsHandler(req, res) {
  return sendSuccess(res, await listEvents(req.query));
}

async function getEventHandler(req, res) {
  return sendSuccess(res, await getEvent(req.params.eventId));
}

async function listDeliveriesHandler(req, res) {
  return sendSuccess(res, await listDeliveries(req.query));
}

async function getDeliveryHandler(req, res) {
  return sendSuccess(res, await getDelivery(req.params.deliveryJobId));
}

async function listDeadLetterHandler(req, res) {
  return sendSuccess(res, await listDeadLetter(req.query));
}

module.exports = {
  getOverviewHandler,
  listEventsHandler,
  getEventHandler,
  listDeliveriesHandler,
  getDeliveryHandler,
  listDeadLetterHandler,
};
