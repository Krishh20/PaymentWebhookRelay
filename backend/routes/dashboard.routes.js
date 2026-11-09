const express = require("express");
const {
  getOverviewHandler,
  listEventsHandler,
  getEventHandler,
  listDeliveriesHandler,
  getDeliveryHandler,
  listDeadLetterHandler,
} = require("../controllers/dashboard.controller");

const router = express.Router();

// Read-only dashboard APIs. There are intentionally no replay or retry
// endpoints.
router.get("/overview", getOverviewHandler);
router.get("/events", listEventsHandler);
router.get("/events/:eventId", getEventHandler);
router.get("/deliveries", listDeliveriesHandler);
router.get("/deliveries/:deliveryJobId", getDeliveryHandler);
router.get("/dead-letter", listDeadLetterHandler);

module.exports = router;
