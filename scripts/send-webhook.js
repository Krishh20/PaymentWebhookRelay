const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT_DIR, "backend");
const backendRequire = createRequire(path.join(BACKEND_DIR, "package.json"));

const dotenv = backendRequire("dotenv");
dotenv.config({ path: path.join(BACKEND_DIR, ".env"), quiet: true });

const BASE_URL = process.env.RELAY_URL || "http://localhost:4000";
const SECRET = process.env.WEBHOOK_SECRET;
const DEFAULT_SOURCE_SLUG =
  process.env.WEBHOOK_SOURCE_SLUG || "postman-sandbox";

if (!SECRET) {
  console.error(
    "WEBHOOK_SECRET is not set. Create backend/.env with `npm run setup:env` first.",
  );
  process.exit(1);
}

async function main() {
  const [
    id = `evt_demo_live_${Date.now()}`,
    type = "payment.success",
    amount = "2500",
    sourceSlug = DEFAULT_SOURCE_SLUG,
  ] = process.argv.slice(2);

  const payload = {
    id,
    type,
    data: {
      paymentId: `pay_${id}`,
      amount: Number(amount),
      currency: "USD",
      status: type === "payment.refunded" ? "refunded" : "succeeded",
      provider: "postman-sandbox",
      customerEmail: "demo.buyer@example.com",
      createdAt: new Date().toISOString(),
    },
  };

  // The signature must be computed over the exact bytes that are sent.
  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(rawBody)
    .digest("hex");

  const response = await fetch(
    `${BASE_URL}/api/webhooks/${encodeURIComponent(sourceSlug)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": `sha256=${signature}`,
      },
      body: rawBody,
    },
  );

  const body = await response.json().catch(() => null);

  console.log(`POST /api/webhooks/${sourceSlug} -> HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Failed to send webhook:", error);
  process.exitCode = 1;
});
