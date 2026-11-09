const express = require("express");
const { receiveWebhook } = require("../controllers/webhook.controller");

const router = express.Router();

// The raw body must reach the controller exactly as it was signed.
router.post(
  "/:sourceSlug",
  express.raw({
    type: ["application/json", "application/*+json"],
    limit: "1mb",
  }),
  receiveWebhook,
);

module.exports = router;
