/*
  Warnings:

  - You are about to drop the column `key` on the `destinations` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "destinations_key_key";

-- AlterTable
ALTER TABLE "delivery_jobs" ADD COLUMN     "lockExpiresAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "destinations" DROP COLUMN "key";

-- CreateIndex
CREATE INDEX "delivery_jobs_status_lockExpiresAt_idx" ON "delivery_jobs"("status", "lockExpiresAt");
