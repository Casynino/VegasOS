-- Daily guest & room lists (reception prints them): the printed copies, and the housekeeping rule for occupied rooms.

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "occupiedRoomService" TEXT NOT NULL DEFAULT 'DAILY';

-- CreateTable
CREATE TABLE "daily_lists" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "copyNo" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL,

    CONSTRAINT "daily_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_lists_businessDate_idx" ON "daily_lists"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_lists_kind_businessDate_copyNo_key" ON "daily_lists"("kind", "businessDate", "copyNo");
