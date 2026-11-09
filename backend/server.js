const app = require("./app");
const env = require("./config/env");
const prisma = require("./db/prisma");
const { ensureConfig } = require("./services/configService");
const {
  startProcessor,
  stopProcessor,
} = require("./services/deliveryProcessor");

let server;

async function start() {
  // Fail fast when PostgreSQL is unreachable instead of starting a broken API.
  await prisma.$connect();

  // Create or refresh the internal source and destination from .env.
  const { source, destination } = await ensureConfig();

  server = app.listen(env.port, () => {
    console.log(`[backend] listening on http://localhost:${env.port}`);
    console.log(`[backend] environment: ${env.nodeEnv}`);
    console.log(`[backend] source ready: ${source.slug} (${source.id})`);
    console.log(
      `[backend] destination ready: ${destination.name} (${destination.id})`,
    );

    startProcessor().catch((error) => {
      console.error(
        "[backend] failed to start delivery processor:",
        error.message,
      );
    });
  });
}

async function shutdown(signal) {
  console.log(`[backend] ${signal} received, shutting down...`);

  await stopProcessor();

  if (!server) {
    await prisma.$disconnect();
    process.exit(0);
  }

  server.close(async (error) => {
    await prisma.$disconnect();

    if (error) {
      console.error("[backend] error while closing the server:", error);
      process.exit(1);
    }

    process.exit(0);
  });

  // Do not hang forever if a connection refuses to close.
  setTimeout(() => {
    console.error("[backend] shutdown timed out");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch(async (error) => {
  console.error("[backend] failed to start:", error.message);
  await prisma.$disconnect();
  process.exit(1);
});
