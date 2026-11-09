const prisma = require("../db/prisma");
const { sendSuccess, sendError } = require("../utils/apiResponse");

async function getHealth(req, res) {
  try {
    // A real query proves that the application can reach PostgreSQL.
    await prisma.$queryRaw`SELECT 1`;

    return sendSuccess(res, {
      status: "ok",
      database: "connected",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] database check failed:", error.message);
    return sendError(res, 503, "Database connection failed");
  }
}

module.exports = {
  getHealth,
};
