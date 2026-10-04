-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GroupType" ADD VALUE 'GOVERNMENT';
ALTER TYPE "GroupType" ADD VALUE 'EVENT';

-- AlterTable
ALTER TABLE "booking_groups" ADD COLUMN     "address" TEXT,
ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingNotes" TEXT,
ADD COLUMN     "finalInvoiceId" TEXT,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "finalizedById" TEXT,
ADD COLUMN     "registrationNo" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "vrn" TEXT;

-- AlterTable
ALTER TABLE "corporate_customers" ADD COLUMN     "registrationNo" TEXT;

-- AddForeignKey
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

