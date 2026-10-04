-- CreateTable
CREATE TABLE "waiter_cash_handovers" (
    "id" TEXT NOT NULL,
    "waiterId" TEXT NOT NULL,
    "shiftId" TEXT,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "status" TEXT NOT NULL DEFAULT 'TO_COUNTER',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,
    "handedOverAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "paymentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiter_cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waiter_cash_handovers_paymentId_key" ON "waiter_cash_handovers"("paymentId");

-- CreateIndex
CREATE INDEX "waiter_cash_handovers_waiterId_status_idx" ON "waiter_cash_handovers"("waiterId", "status");

-- CreateIndex
CREATE INDEX "waiter_cash_handovers_orderId_idx" ON "waiter_cash_handovers"("orderId");

-- CreateIndex
CREATE INDEX "waiter_cash_handovers_status_businessDate_idx" ON "waiter_cash_handovers"("status", "businessDate");

-- AddForeignKey
ALTER TABLE "waiter_cash_handovers" ADD CONSTRAINT "waiter_cash_handovers_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_cash_handovers" ADD CONSTRAINT "waiter_cash_handovers_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "actual_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_cash_handovers" ADD CONSTRAINT "waiter_cash_handovers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_cash_handovers" ADD CONSTRAINT "waiter_cash_handovers_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_cash_handovers" ADD CONSTRAINT "waiter_cash_handovers_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "restaurant_order_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One cash hand-over still open (to the Counter) per order at a time.
CREATE UNIQUE INDEX "waiter_cash_handovers_one_open_per_order" ON "waiter_cash_handovers"("orderId") WHERE "status" = 'TO_COUNTER';
