const express = require("express");
const healthRoutes = require("./routes/health.routes");
const configRoutes = require("./routes/config.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const webhookRoutes = require("./routes/webhook.routes");
const mockRoutes = require("./routes/mock.routes");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();

app.disable("x-powered-by");

// Webhook routes must be mounted before the JSON parser so that the exact raw
// body is available for HMAC verification.
app.use("/api/webhooks", webhookRoutes);

app.use(express.json({ limit: "1mb" }));

app.use("/api", healthRoutes);
app.use("/api", configRoutes);
app.use("/api", dashboardRoutes);
app.use("/mock", mockRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
