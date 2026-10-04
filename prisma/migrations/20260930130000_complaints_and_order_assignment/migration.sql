-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'COMPLAINT';

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "assignedToId" TEXT;

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "resolution" TEXT;

-- CreateIndex
CREATE INDEX "service_requests_orderId_idx" ON "service_requests"("orderId");

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

