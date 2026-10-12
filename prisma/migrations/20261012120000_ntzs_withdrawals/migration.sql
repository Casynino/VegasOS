-- Withdrawals: money the Boss takes out of the hotel's nTZS balance, to a phone or a bank account.
-- One row per request: priced by nTZS, confirmed by the person, then nTZS's own answer. Only a withdrawal
-- nTZS confirmed is written to the books (a ledger entry out of the nTZS account + the fee as an expense).

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('QUOTED', 'CANCELLED', 'SUBMITTING', 'UNKNOWN', 'PROCESSING', 'AWAITING_APPROVAL', 'IN_REVIEW', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'NTZS',
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'QUOTED',
    "amount" INTEGER NOT NULL,
    "feeTzs" INTEGER,
    "feeConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "debitedTzs" INTEGER,
    "receivedTzs" INTEGER,
    "destinationKind" TEXT NOT NULL,
    "phone" TEXT,
    "bankCode" TEXT,
    "accountNumber" TEXT,
    "recipientName" TEXT,
    "payoutRail" TEXT,
    "quoteId" TEXT,
    "quoteExpiresAt" TIMESTAMP(3),
    "availableTzs" INTEGER,
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "providerId" TEXT,
    "providerStatus" TEXT,
    "payoutStatus" TEXT,
    "payoutReference" TEXT,
    "payoutReceipt" TEXT,
    "providerMessage" TEXT,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "toAccountId" TEXT,
    "note" TEXT,
    "clientKey" TEXT,
    "requestedById" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "ledgerEntryId" TEXT,
    "feeExpenseId" TEXT,
    "attentionAt" TIMESTAMP(3),
    "attentionNote" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciledById" TEXT,
    "reconciledNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_number_key" ON "withdrawals"("number");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_providerId_key" ON "withdrawals"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_clientKey_key" ON "withdrawals"("clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_ledgerEntryId_key" ON "withdrawals"("ledgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_feeExpenseId_key" ON "withdrawals"("feeExpenseId");

-- CreateIndex
CREATE INDEX "withdrawals_status_createdAt_idx" ON "withdrawals"("status", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawals_submittedAt_idx" ON "withdrawals"("submittedAt");

-- CreateIndex
CREATE INDEX "withdrawals_businessDate_idx" ON "withdrawals"("businessDate");

-- CreateIndex
CREATE INDEX "withdrawals_requestedById_createdAt_idx" ON "withdrawals"("requestedById", "createdAt");

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Who may withdraw: the Boss (OWNER) and the Admin only. Nobody else gets these, and no other role is touched.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_withdrawals_manage', 'withdrawals.manage', 'Withdraw funds: take money out of the hotel''s nTZS balance (Boss and Admin)'),
  ('perm_withdrawals_reconcile', 'withdrawals.reconcile', 'Withdraw funds: settle by hand a withdrawal nTZS could not confirm')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('withdrawals.manage', 'withdrawals.reconcile')
WHERE r."code" IN ('ADMIN', 'OWNER')
ON CONFLICT DO NOTHING;
