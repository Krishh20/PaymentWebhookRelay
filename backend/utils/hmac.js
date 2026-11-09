const crypto = require("node:crypto");

function normalizeSignature(signature) {
  if (typeof signature !== "string") {
    return "";
  }

  const trimmed = signature.trim();
  return trimmed.startsWith("sha256=") ? trimmed.slice(7) : trimmed;
}

function computeHmacSha256(secret, rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

// Compares the received signature with the expected HMAC in constant time.
// The raw body must be the exact bytes that were signed.
function verifyWebhookSignature({ secret, rawBody, signature }) {
  const providedHex = normalizeSignature(signature);

  if (!/^[a-f0-9]{64}$/i.test(providedHex)) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest();
  const provided = Buffer.from(providedHex, "hex");

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}

module.exports = {
  computeHmacSha256,
  verifyWebhookSignature,
};
