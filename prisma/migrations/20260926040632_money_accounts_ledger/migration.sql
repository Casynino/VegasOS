-- CreateEnum
CREATE TYPE "MoneyAccountKind" AS ENUM ('CASH', 'BANK', 'MOBILE_MONEY', 'CARD', 'PETTY_CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerEntryKind" AS ENUM ('TRANSFER', 'OWNER_CONTRIBUTION', 'OWNER_WITHDRAWAL', 'OTHER_INCOME', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CashCountStatus" AS ENUM ('OPEN', 'ACCEPTED');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "money_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MoneyAccountKind" NOT NULL,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "LedgerEntryKind" NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED',
    "amount" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "toAccountId" TEXT,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,
    "attachmentFileId" TEXT,
    "cashCountId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_counts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected" INTEGER NOT NULL,
    "counted" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "note" TEXT,
    "status" "CashCountStatus" NOT NULL DEFAULT 'OPEN',
    "countedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "cash_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "money_accounts_code_key" ON "money_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_number_key" ON "ledger_entries"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_attachmentFileId_key" ON "ledger_entries"("attachmentFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_cashCountId_key" ON "ledger_entries"("cashCountId");

-- CreateIndex
CREATE INDEX "ledger_entries_businessDate_idx" ON "ledger_entries"("businessDate");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_businessDate_idx" ON "ledger_entries"("accountId", "businessDate");

-- CreateIndex
CREATE INDEX "cash_counts_accountId_businessDate_idx" ON "cash_counts"("accountId", "businessDate");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_attachmentFileId_fkey" FOREIGN KEY ("attachmentFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: the hotel's money accounts, and which payment method pays into which account.
INSERT INTO "money_accounts" ("id", "code", "name", "kind", "sortOrder") VALUES
  ('acct_cash', 'CASH_DRAWER', 'Cash drawer (reception)', 'CASH', 1),
  ('acct_bank', 'BANK', 'Bank account', 'BANK', 2),
  ('acct_mobile', 'MOBILE_MONEY', 'Mobile money (Lipa)', 'MOBILE_MONEY', 3),
  ('acct_card', 'CARD', 'Card terminal', 'CARD', 4),
  ('acct_petty', 'PETTY_CASH', 'Petty cash', 'PETTY_CASH', 5),
  ('acct_other', 'OTHER', 'Other', 'OTHER', 6)
ON CONFLICT ("code") DO NOTHING;
UPDATE "payment_methods" SET "accountId" = 'acct_cash' WHERE "code" = 'CASH';
UPDATE "payment_methods" SET "accountId" = 'acct_bank' WHERE "code" = 'BANK';
UPDATE "payment_methods" SET "accountId" = 'acct_mobile' WHERE "code" = 'MOBILE_MONEY';
UPDATE "payment_methods" SET "accountId" = 'acct_card' WHERE "code" = 'CARD';
UPDATE "payment_methods" SET "accountId" = 'acct_other' WHERE "code" = 'OTHER';
