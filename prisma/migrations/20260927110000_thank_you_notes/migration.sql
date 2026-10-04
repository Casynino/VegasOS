-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "thankYouMessage" TEXT,
ADD COLUMN     "thankYouPromoText" TEXT,
ADD COLUMN     "thankYouPromoTitle" TEXT,
ADD COLUMN     "thankYouRebookText" TEXT,
ADD COLUMN     "thankYouSignoff" TEXT;

-- CreateTable
CREATE TABLE "thank_you_notes" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thank_you_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "thank_you_notes_token_key" ON "thank_you_notes"("token");

-- CreateIndex
CREATE UNIQUE INDEX "thank_you_notes_reservationId_version_key" ON "thank_you_notes"("reservationId", "version");

-- AddForeignKey
ALTER TABLE "thank_you_notes" ADD CONSTRAINT "thank_you_notes_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thank_you_notes" ADD CONSTRAINT "thank_you_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

