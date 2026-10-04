-- CreateEnum
CREATE TYPE "ReservationKind" AS ENUM ('STAY', 'MEETING');

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "kind" "ReservationKind" NOT NULL DEFAULT 'STAY';

-- CreateIndex
CREATE INDEX "reservations_kind_arrivalDate_idx" ON "reservations"("kind", "arrivalDate");

