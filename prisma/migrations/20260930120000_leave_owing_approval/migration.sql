-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "leaveOwingAt" TIMESTAMP(3),
ADD COLUMN     "leaveOwingById" TEXT,
ADD COLUMN     "leaveOwingReason" TEXT,
ADD COLUMN     "leaveOwingUpTo" INTEGER;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_leaveOwingById_fkey" FOREIGN KEY ("leaveOwingById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

