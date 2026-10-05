-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "creditedAt" TIMESTAMP(3),
ADD COLUMN     "creditedToId" TEXT;

-- CreateIndex
CREATE INDEX "payments_creditedToId_creditedAt_idx" ON "payments"("creditedToId", "creditedAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_creditedToId_fkey" FOREIGN KEY ("creditedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

