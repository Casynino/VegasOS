-- CreateEnum
CREATE TYPE "BillTo" AS ENUM ('GUEST', 'COMPANY', 'SPLIT');

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'VOID';

-- AlterTable
ALTER TABLE "corporate_customers" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "consolidateInvoices" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defaultBillTo" "BillTo" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "defaultCovers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bankSwift" TEXT,
ADD COLUMN     "invoiceTerms" TEXT,
ADD COLUMN     "mobileMoneyAccountName" TEXT,
ADD COLUMN     "mobileMoneyName" TEXT,
ADD COLUMN     "mobileMoneyNumber" TEXT;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "roomNumber" TEXT,
ADD COLUMN     "serviceFrom" DATE,
ADD COLUMN     "serviceTo" DATE;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "paymentTermDays" INTEGER,
ADD COLUMN     "verifyToken" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "billTo" "BillTo" NOT NULL DEFAULT 'GUEST',
ADD COLUMN     "companyBilledAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "companyCovers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "paymentTermDays" INTEGER;

-- CreateIndex
CREATE INDEX "invoice_items_reservationId_idx" ON "invoice_items"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_verifyToken_key" ON "invoices"("verifyToken");

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: stays already linked to a company were treated as company-billed.
UPDATE "reservations" SET "billTo" = 'COMPANY' WHERE "corporateCustomerId" IS NOT NULL;
UPDATE "invoices" SET "verifyToken" = md5(random()::text || "id" || clock_timestamp()::text) WHERE "status" <> 'DRAFT' AND "verifyToken" IS NULL;
