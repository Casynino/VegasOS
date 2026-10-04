-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "shift_reports" ADD COLUMN     "sendSkipped" BOOLEAN NOT NULL DEFAULT false;

