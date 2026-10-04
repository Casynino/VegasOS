-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "arrivalReminderChannel" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "arrivalReminderTemplate" TEXT,
ADD COLUMN     "noShowAutoRelease" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noShowCutoffMinutes" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "reservation_rooms" ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedById" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "lateArrivalNote" TEXT,
ADD COLUMN     "lateArrivalNotedAt" TIMESTAMP(3),
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "payment_corrections" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fromMethodId" TEXT NOT NULL,
    "toMethodId" TEXT NOT NULL,
    "fromReference" TEXT,
    "toReference" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,

    CONSTRAINT "payment_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_corrections_paymentId_idx" ON "payment_corrections"("paymentId");

-- CreateIndex
CREATE INDEX "payment_corrections_businessDate_idx" ON "payment_corrections"("businessDate");

-- AddForeignKey
ALTER TABLE "payment_corrections" ADD CONSTRAINT "payment_corrections_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Old no-shows had already given their room back.
UPDATE "reservation_rooms" SET "releasedAt" = COALESCE("updatedAt", now()) WHERE "status" = 'NO_SHOW';

-- A no-show keeps its room until it is released (then another guest can have it).
ALTER TABLE "reservation_rooms" DROP CONSTRAINT "reservation_rooms_no_overlap";
ALTER TABLE "reservation_rooms"
  ADD CONSTRAINT "reservation_rooms_no_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  ) WHERE ("status" IN ('RESERVED', 'CONFIRMED', 'CHECKED_IN') OR ("status" = 'NO_SHOW' AND "releasedAt" IS NULL));
