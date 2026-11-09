// Hosts that must never be used as a delivery destination. This is a small,
// pragmatic SSRF guard for a local learning project, not a complete network
// egress policy.
const BLOCKED_HOSTNAMES = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "100.100.100.200",
  "[fd00:ec2::254]",
]);

function assertSafeHttpUrl(rawUrl, label = "URL") {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} must not contain embedded credentials.`);
  }

  if (!url.hostname) {
    throw new Error(`${label} must include a hostname.`);
  }

  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error(`${label} points to a blocked host.`);
  }

  return url;
}

module.exports = {
  assertSafeHttpUrl,
};
