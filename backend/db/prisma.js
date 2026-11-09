const { PrismaClient } = require("@prisma/client");
const env = require("../config/env");

// A single Prisma client is shared by the whole backend process.
// Prisma's automatic error logging is disabled because expected errors (for
// example duplicate-webhook races) are handled in the service layer, and
// unexpected errors are logged by the Express error handler.
const prisma = new PrismaClient({
  log: env.isDevelopment ? ["warn"] : [],
});

module.exports = prisma;
