-- CreateIndex
CREATE INDEX "restaurant_order_payments_collectedById_collectedAt_idx" ON "restaurant_order_payments"("collectedById", "collectedAt");
