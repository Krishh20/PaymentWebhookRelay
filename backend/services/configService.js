const prisma = require("../db/prisma");
const env = require("../config/env");

function sourceData() {
  return {
    name: env.source.name,
    slug: env.source.slug,
    signatureHeader: env.source.signatureHeader,
    secretEnvVar: env.source.secretEnvVar,
    isActive: true,
  };
}

function destinationData() {
  return {
    name: env.destination.name,
    url: env.destination.url,
    timeoutMs: env.destination.timeoutMs,
    isActive: true,
  };
}

// Creates the single source and destination from environment configuration,
// or updates the existing rows. Running this on every startup keeps the
// database in sync without a separate seed command.
async function ensureConfig() {
  return prisma.$transaction(async (tx) => {
    const existingSource = await tx.source.findFirst({
      orderBy: { createdAt: "asc" },
    });

    const source = existingSource
      ? await tx.source.update({
          where: { id: existingSource.id },
          data: sourceData(),
        })
      : await tx.source.create({ data: sourceData() });

    // Only one source is used by this project.
    await tx.source.updateMany({
      where: { id: { not: source.id } },
      data: { isActive: false },
    });

    const existingDestination = await tx.destination.findFirst({
      orderBy: { createdAt: "asc" },
    });

    const destination = existingDestination
      ? await tx.destination.update({
          where: { id: existingDestination.id },
          data: destinationData(),
        })
      : await tx.destination.create({ data: destinationData() });

    // Only one destination is configured for this project.
    await tx.destination.updateMany({
      where: { id: { not: destination.id } },
      data: { isActive: false },
    });

    return { source, destination };
  });
}

// Returns the internal configuration needed by Postman and the dashboard.
// The webhook secret and its environment variable are deliberately omitted.
async function getInternalConfig() {
  const [source, destination] = await Promise.all([
    prisma.source.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.destination.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!source || !destination) {
    const error = new Error(
      "Internal configuration is missing. Restart the backend to recreate it.",
    );
    error.statusCode = 503;
    throw error;
  }

  return {
    source: {
      id: source.id,
      name: source.name,
      slug: source.slug,
      signatureHeader: source.signatureHeader,
      isActive: source.isActive,
    },
    destination: {
      id: destination.id,
      name: destination.name,
      url: destination.url,
      timeoutMs: destination.timeoutMs,
      isActive: destination.isActive,
    },
    webhook: {
      signatureAlgorithm: "HMAC-SHA256",
      signatureHeader: source.signatureHeader,
      signatureFormat: "sha256=<hex>",
    },
  };
}

module.exports = {
  ensureConfig,
  getInternalConfig,
};
