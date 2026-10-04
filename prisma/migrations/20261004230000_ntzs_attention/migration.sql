-- AlterTable
ALTER TABLE "mobile_payments" ADD COLUMN     "attentionAt" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "resolvedNote" TEXT;

-- CreateIndex
CREATE INDEX "mobile_payments_attentionAt_resolvedAt_idx" ON "mobile_payments"("attentionAt", "resolvedAt");

