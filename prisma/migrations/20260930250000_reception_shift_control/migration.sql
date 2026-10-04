-- AlterTable
ALTER TABLE "actual_shifts" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedById" TEXT;

-- CreateIndex
CREATE INDEX "actual_shifts_userId_startedAt_idx" ON "actual_shifts"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "expenses_createdById_createdAt_idx" ON "expenses"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "payments_recordedById_createdAt_idx" ON "payments"("recordedById", "createdAt");

-- CreateIndex
CREATE INDEX "revenue_transactions_recordedById_createdAt_idx" ON "revenue_transactions"("recordedById", "createdAt");

-- AddForeignKey
ALTER TABLE "actual_shifts" ADD CONSTRAINT "actual_shifts_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Shifts already closed: closed by the person who worked them.
UPDATE "actual_shifts" SET "closedById" = "userId" WHERE "endedAt" IS NOT NULL AND "closedById" IS NULL;
