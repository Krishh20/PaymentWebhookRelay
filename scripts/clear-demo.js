const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT_DIR, "backend");

const prisma = require(path.join(BACKEND_DIR, "db", "prisma"));

const DEMO_PREFIX = "evt_demo_seed_";

async function main() {
  const result = await prisma.event.deleteMany({
    where: { externalEventId: { startsWith: DEMO_PREFIX } },
  });

  console.log(
    `Removed ${result.count} demo event(s) and their delivery jobs/attempts.`,
  );
}

main()
  .catch((error) => {
    console.error("Failed to clear demo data:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
