const path = require("node:path");
const dotenv = require("dotenv");
const { assertSafeHttpUrl } = require("../utils/urlValidation");

// The backend keeps its own .env file next to package.json.
// The repository root .env.example is copied to backend/.env during setup.
dotenv.config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});

function readString(value, fallback, label) {
  const result = (value || fallback || "").trim();

  if (!result) {
    throw new Error(`${label} must not be empty.`);
  }

  return result;
}

const nodeEnv = readString(process.env.NODE_ENV, "development", "NODE_ENV");
const port = Number(process.env.PORT || 4000);
const databaseUrl = process.env.DATABASE_URL;
const webhookSecret = process.env.WEBHOOK_SECRET;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to backend/.env before starting the backend.",
  );
}

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be a valid TCP port number.");
}

if (!webhookSecret || webhookSecret.length < 16) {
  throw new Error(
    "WEBHOOK_SECRET must be set and at least 16 characters long.",
  );
}

const sourceSlug = readString(
  process.env.WEBHOOK_SOURCE_SLUG,
  "postman-sandbox",
  "WEBHOOK_SOURCE_SLUG",
).toLowerCase();

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceSlug)) {
  throw new Error(
    "WEBHOOK_SOURCE_SLUG may only contain lowercase letters, numbers and single hyphens.",
  );
}

const signatureHeader = readString(
  process.env.WEBHOOK_SIGNATURE_HEADER,
  "x-webhook-signature",
  "WEBHOOK_SIGNATURE_HEADER",
).toLowerCase();

if (!/^[a-z0-9-]+$/.test(signatureHeader)) {
  throw new Error(
    "WEBHOOK_SIGNATURE_HEADER must be a valid HTTP header name.",
  );
}

const destinationUrl = readString(
  process.env.DESTINATION_URL,
  `http://localhost:${port}/mock/success`,
  "DESTINATION_URL",
);

assertSafeHttpUrl(destinationUrl, "DESTINATION_URL");

const destinationTimeoutMs = Number(
  process.env.DESTINATION_TIMEOUT_MS || 10000,
);

if (
  !Number.isInteger(destinationTimeoutMs) ||
  destinationTimeoutMs < 1000 ||
  destinationTimeoutMs > 30000
) {
  throw new Error(
    "DESTINATION_TIMEOUT_MS must be an integer between 1000 and 30000.",
  );
}

module.exports = {
  nodeEnv,
  port,
  databaseUrl,
  isDevelopment: nodeEnv === "development",
  webhookSecret,
  source: {
    name: readString(
      process.env.WEBHOOK_SOURCE_NAME,
      "Postman Sandbox",
      "WEBHOOK_SOURCE_NAME",
    ),
    slug: sourceSlug,
    signatureHeader,
    // Only the variable name is stored in PostgreSQL.
    secretEnvVar: "WEBHOOK_SECRET",
  },
  destination: {
    name: readString(
      process.env.DESTINATION_NAME,
      "Local Mock Destination",
      "DESTINATION_NAME",
    ),
    url: destinationUrl,
    timeoutMs: destinationTimeoutMs,
  },
};
