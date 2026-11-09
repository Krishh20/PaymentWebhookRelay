const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

const BACKEND_DIR = path.resolve(__dirname, "../../backend");
const backendRequire = createRequire(path.join(BACKEND_DIR, "package.json"));
const { PrismaClient } = backendRequire("@prisma/client");

const TEST_DATABASE_NAME = "payment_relay_test";

function databaseUrlFor(name, baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

// Creates the dedicated test database when missing, then applies every Prisma
// migration to it. The developer database (payment_relay) is never touched.
async function ensureTestDatabase(baseUrl) {
  const testUrl = databaseUrlFor(TEST_DATABASE_NAME, baseUrl);
  const adminUrl = databaseUrlFor("postgres", baseUrl);
  const admin = new PrismaClient({ datasourceUrl: adminUrl });

  try {
    const rows = await admin.$queryRawUnsafe(
      `SELECT 1 AS found FROM pg_database WHERE datname = '${TEST_DATABASE_NAME}'`,
    );

    if (rows.length === 0) {
      await admin.$executeRawUnsafe(
        `CREATE DATABASE "${TEST_DATABASE_NAME}"`,
      );
    }
  } finally {
    await admin.$disconnect();
  }

  const prismaCli = backendRequire.resolve("prisma/build/index.js");

  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: testUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(
      `Failed to migrate the test database "${TEST_DATABASE_NAME}".\n` +
        `${output}\n${error.message}`,
    );
  }

  return testUrl;
}

module.exports = {
  ensureTestDatabase,
  databaseUrlFor,
  TEST_DATABASE_NAME,
};
