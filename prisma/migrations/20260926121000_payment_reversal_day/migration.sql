-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "reversalBusinessDate" DATE;

-- CreateIndex
CREATE INDEX "payments_reversalBusinessDate_idx" ON "payments"("reversalBusinessDate");


UPDATE "payments" SET "reversalBusinessDate" = ((("reversedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Dar_es_Salaam') - INTERVAL '4 hours')::date
WHERE "status" = 'REVERSED' AND "reversedAt" IS NOT NULL;
