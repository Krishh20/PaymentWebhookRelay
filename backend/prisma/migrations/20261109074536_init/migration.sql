-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('received', 'queued', 'processing', 'delivered', 'dead_letter');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'processing', 'retrying', 'succeeded', 'dead_letter');

-- CreateEnum
CREATE TYPE "attempt_outcome" AS ENUM ('succeeded', 'retryable_failure', 'permanent_failure');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('pending', 'published', 'failed');

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "signatureHeader" TEXT NOT NULL DEFAULT 'x-webhook-signature',
    "secretEnvVar" TEXT NOT NULL DEFAULT 'WEBHOOK_SECRET',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "event_status" NOT NULL DEFAULT 'received',
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destinations" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'primary',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_jobs" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lastStatusCode" INTEGER,
    "lastResponseTimeMs" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "deliveryJobId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(3),
    "httpStatusCode" INTEGER,
    "responseTimeMs" INTEGER,
    "errorMessage" TEXT,
    "outcome" "attempt_outcome" NOT NULL,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "deliveryJobId" UUID NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'delivery.job.created',
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_name_key" ON "sources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sources_slug_key" ON "sources"("slug");

-- CreateIndex
CREATE INDEX "events_receivedAt_idx" ON "events"("receivedAt");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "events_eventType_idx" ON "events"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "events_sourceId_externalEventId_key" ON "events"("sourceId", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "destinations_key_key" ON "destinations"("key");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_jobs_eventId_key" ON "delivery_jobs"("eventId");

-- CreateIndex
CREATE INDEX "delivery_jobs_status_nextAttemptAt_idx" ON "delivery_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "delivery_jobs_status_updatedAt_idx" ON "delivery_jobs"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "delivery_jobs_destinationId_idx" ON "delivery_jobs"("destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_deliveryJobId_attemptNumber_key" ON "delivery_attempts"("deliveryJobId", "attemptNumber");

-- CreateIndex
CREATE INDEX "outbox_messages_status_availableAt_idx" ON "outbox_messages"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_messages_eventId_idx" ON "outbox_messages"("eventId");

-- CreateIndex
CREATE INDEX "outbox_messages_deliveryJobId_idx" ON "outbox_messages"("deliveryJobId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_deliveryJobId_fkey" FOREIGN KEY ("deliveryJobId") REFERENCES "delivery_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_deliveryJobId_fkey" FOREIGN KEY ("deliveryJobId") REFERENCES "delivery_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
