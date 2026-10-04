-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "customerPaidAt" TIMESTAMP(3),
ADD COLUMN     "customerPaidToId" TEXT,
ADD COLUMN     "customerPayRef" TEXT,
ADD COLUMN     "paymentProofFileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_paymentProofFileId_key" ON "restaurant_orders"("paymentProofFileId");

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_paymentProofFileId_fkey" FOREIGN KEY ("paymentProofFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

