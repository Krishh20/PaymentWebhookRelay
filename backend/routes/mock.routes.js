const express = require("express");
const {
  mockSuccess,
  mockFailure,
  mockTimeout,
  mockIntermittent,
} = require("../controllers/mock.controller");

const router = express.Router();

// Local stand-in destinations used while developing the relay. Mounted at
// /mock so DESTINATION_URL can point at the same Express process.
router.post("/success", mockSuccess);
router.post("/failure", mockFailure);
router.post("/timeout", mockTimeout);
router.post("/intermittent", mockIntermittent);

module.exports = router;
