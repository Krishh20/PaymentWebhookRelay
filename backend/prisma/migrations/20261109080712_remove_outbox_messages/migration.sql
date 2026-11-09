/*
  Warnings:

  - You are about to drop the `outbox_messages` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "outbox_messages" DROP CONSTRAINT "outbox_messages_deliveryJobId_fkey";

-- DropForeignKey
ALTER TABLE "outbox_messages" DROP CONSTRAINT "outbox_messages_eventId_fkey";

-- DropTable
DROP TABLE "outbox_messages";

-- DropEnum
DROP TYPE "outbox_status";
