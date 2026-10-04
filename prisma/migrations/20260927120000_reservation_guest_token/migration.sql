-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "guestToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reservations_guestToken_key" ON "reservations"("guestToken");

