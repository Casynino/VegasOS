-- CreateEnum
CREATE TYPE "CashHandoverStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'RETURNED', 'REJECTED');

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "cashHandoverFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "cash_handovers" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "CashHandoverStatus" NOT NULL DEFAULT 'SUBMITTED',
    "department" "ShiftDepartment" NOT NULL,
    "submittedById" TEXT NOT NULL,
    "shiftId" TEXT,
    "accountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "collected" INTEGER NOT NULL,
    "collectedCount" INTEGER NOT NULL,
    "refunds" INTEGER NOT NULL,
    "expected" INTEGER NOT NULL,
    "declared" INTEGER NOT NULL,
    "declaredNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received" INTEGER,
    "difference" INTEGER,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "toAccountId" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_handover_events" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "note" TEXT,
    "amount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_handover_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_handovers_number_key" ON "cash_handovers"("number");

-- CreateIndex
CREATE UNIQUE INDEX "cash_handovers_ledgerEntryId_key" ON "cash_handovers"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "cash_handovers_status_submittedAt_idx" ON "cash_handovers"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "cash_handovers_submittedById_periodEnd_idx" ON "cash_handovers"("submittedById", "periodEnd");

-- CreateIndex
CREATE INDEX "cash_handovers_businessDate_idx" ON "cash_handovers"("businessDate");

-- CreateIndex
CREATE INDEX "cash_handover_events_handoverId_createdAt_idx" ON "cash_handover_events"("handoverId", "createdAt");

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "actual_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handover_events" ADD CONSTRAINT "cash_handover_events_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "cash_handovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handover_events" ADD CONSTRAINT "cash_handover_events_byId_fkey" FOREIGN KEY ("byId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cash handover rules the database itself keeps (hand-written):
-- amounts are never negative, a received handover says who received it and how much, and one person never has two
-- live handovers that start at the same moment (a rejected one gives its cash back, so it does not count).
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_amounts_ok"
  CHECK ("collected" >= 0 AND "collectedCount" >= 0 AND "refunds" >= 0 AND "expected" >= 0 AND "declared" >= 0 AND ("received" IS NULL OR "received" >= 0));
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_period_ok" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_accepted_ok"
  CHECK ("status" <> 'ACCEPTED' OR ("received" IS NOT NULL AND "difference" IS NOT NULL AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL));
CREATE UNIQUE INDEX "cash_handovers_one_per_start" ON "cash_handovers"("submittedById", "periodStart") WHERE "status" <> 'REJECTED';

-- The control begins now: nobody is asked to hand over cash recorded before this moment.
UPDATE "hotel_settings" SET "cashHandoverFrom" = (now() AT TIME ZONE 'UTC') WHERE "cashHandoverFrom" IS NULL;
