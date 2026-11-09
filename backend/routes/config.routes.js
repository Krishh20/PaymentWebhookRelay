const express = require("express");
const { getConfig } = require("../controllers/config.controller");

const router = express.Router();

router.get("/config", getConfig);

module.exports = router;
