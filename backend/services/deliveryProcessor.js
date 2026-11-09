const prisma = require("../db/prisma");
const { deliverJob } = require("./deliveryService");

// Processor settings for this single-process learning project.
const PROCESSOR_INTERVAL_MS = 2000;
const PROCESSOR_BATCH_SIZE = 5;
const PROCESSOR_LOCK_MS = 30000;

let timer = null;
let isRunning = false;

// A crashed process can leave jobs in "processing". Expired locks are safe to
// recover because no other processor is holding them.
async function recoverExpiredJobs() {
  const result = await prisma.deliveryJob.updateMany({
    where: {
      status: "processing",
      lockExpiresAt: { lt: new Date() },
    },
    data: {
      status: "retrying",
      lockedAt: null,
      lockExpiresAt: null,
      nextAttemptAt: new Date(),
    },
  });

  if (result.count > 0) {
    console.log(`[processor] recovered ${result.count} expired job(s)`);
  }

  return result.count;
}

// Called once at startup. This project has exactly one processor, so any
// "processing" row belongs to a previous, interrupted run. Resetting it
// immediately avoids waiting for the lock to expire.
async function recoverInterruptedJobs() {
  const result = await prisma.deliveryJob.updateMany({
    where: { status: "processing" },
    data: {
      status: "retrying",
      lockedAt: null,
      lockExpiresAt: null,
      nextAttemptAt: new Date(),
    },
  });

  if (result.count > 0) {
    console.log(`[processor] recovered ${result.count} interrupted job(s)`);
  }

  return result.count;
}

// Claims due jobs atomically. FOR UPDATE SKIP LOCKED is the only raw SQL in
// the application; parameters are still fully parameterized. The surrounding
// transaction commits as soon as this function returns, before HTTP delivery.
async function claimDueJobs(limit = PROCESSOR_BATCH_SIZE) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      WITH due AS (
        SELECT id
        FROM delivery_jobs
        WHERE status IN ('pending'::delivery_status, 'retrying'::delivery_status)
          AND "nextAttemptAt" <= NOW()
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE delivery_jobs AS job
      SET status = 'processing'::delivery_status,
          "lockedAt" = NOW(),
          "lockExpiresAt" = NOW() + (${PROCESSOR_LOCK_MS}::int * INTERVAL '1 millisecond'),
          "updatedAt" = NOW()
      FROM due
      WHERE job.id = due.id
      RETURNING job.id;
    `;

    return rows.map((row) => row.id);
  });
}

async function tick() {
  // Prevent overlapping processor executions inside this process.
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    await recoverExpiredJobs();
    const jobIds = await claimDueJobs();

    for (const jobId of jobIds) {
      try {
        await deliverJob(jobId);
      } catch (error) {
        // The job stays processing and will be recovered once its lock expires.
        console.error(`[processor] job ${jobId} failed:`, error.message);
      }
    }
  } catch (error) {
    console.error("[processor] tick failed:", error.message);
  } finally {
    isRunning = false;
  }
}

async function startProcessor() {
  if (timer) {
    return;
  }

  await recoverInterruptedJobs();

  timer = setInterval(() => {
    void tick();
  }, PROCESSOR_INTERVAL_MS);

  console.log(
    `[processor] started (interval ${PROCESSOR_INTERVAL_MS} ms, batch ${PROCESSOR_BATCH_SIZE})`,
  );

  // Process due work immediately instead of waiting for the first interval.
  void tick();
}

async function stopProcessor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // Give an in-flight tick a short chance to finish.
  const deadline = Date.now() + 5000;
  while (isRunning && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log("[processor] stopped");
}

module.exports = {
  PROCESSOR_INTERVAL_MS,
  PROCESSOR_BATCH_SIZE,
  PROCESSOR_LOCK_MS,
  claimDueJobs,
  recoverExpiredJobs,
  recoverInterruptedJobs,
  tick,
  startProcessor,
  stopProcessor,
};
