-- AlterTable
ALTER TABLE "table_reservations" ADD COLUMN     "partyId" TEXT;

-- CreateIndex
CREATE INDEX "table_reservations_partyId_idx" ON "table_reservations"("partyId");

