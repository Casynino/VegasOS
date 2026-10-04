-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('COMPANY', 'FAMILY', 'ORGANIZATION', 'OTHER');

-- CreateEnum
CREATE TYPE "GroupBilling" AS ENUM ('COMBINED', 'SEPARATE');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "BillTo" ADD VALUE 'GROUP';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "booking_groups" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GroupType" NOT NULL DEFAULT 'OTHER',
    "corporateCustomerId" TEXT,
    "contactGuestId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "billing" "GroupBilling" NOT NULL DEFAULT 'COMBINED',
    "paymentTermDays" INTEGER,
    "notes" TEXT,
    "status" "GroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "arrivalDate" DATE NOT NULL,
    "departureDate" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_groups_reference_key" ON "booking_groups"("reference");

-- CreateIndex
CREATE INDEX "booking_groups_arrivalDate_idx" ON "booking_groups"("arrivalDate");

-- CreateIndex
CREATE INDEX "booking_groups_name_idx" ON "booking_groups"("name");

-- CreateIndex
CREATE INDEX "booking_groups_corporateCustomerId_idx" ON "booking_groups"("corporateCustomerId");

-- CreateIndex
CREATE INDEX "invoices_groupId_idx" ON "invoices"("groupId");

-- CreateIndex
CREATE INDEX "reservations_groupId_idx" ON "reservations"("groupId");

-- AddForeignKey
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_corporateCustomerId_fkey" FOREIGN KEY ("corporateCustomerId") REFERENCES "corporate_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_contactGuestId_fkey" FOREIGN KEY ("contactGuestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "booking_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_groups" ADD CONSTRAINT "booking_groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "booking_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "booking_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

