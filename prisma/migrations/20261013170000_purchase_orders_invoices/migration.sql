-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "financeAuthorizationLimit" INTEGER;

-- AlterTable
ALTER TABLE "stock_documents" ADD COLUMN     "refId" TEXT;

-- AlterTable
ALTER TABLE "stock_request_items" ADD COLUMN     "orderedQty" DOUBLE PRECISION,
ADD COLUMN     "orderedUnitPrice" INTEGER,
ADD COLUMN     "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_requests" ADD COLUMN     "authorizationNote" TEXT,
ADD COLUMN     "authorizedAt" TIMESTAMP(3),
ADD COLUMN     "authorizedById" TEXT,
ADD COLUMN     "chosenQuoteId" TEXT,
ADD COLUMN     "expectedDeliveryOn" DATE,
ADD COLUMN     "orderNote" TEXT,
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "orderTotal" INTEGER,
ADD COLUMN     "orderedAt" TIMESTAMP(3),
ADD COLUMN     "orderedById" TEXT;

-- CreateTable
CREATE TABLE "stock_quotes" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "contact" TEXT,
    "total" INTEGER NOT NULL,
    "validUntil" DATE,
    "deliveryDays" INTEGER,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_quote_lines" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "stock_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_deliveries" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "stock_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_delivery_lines" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "rejectedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "problem" TEXT,
    "note" TEXT,
    "expiresOn" DATE,
    "movementId" TEXT,

    CONSTRAINT "stock_delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "amount" INTEGER NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifyNote" TEXT,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paidById" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientKey" TEXT,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_quotes_requestId_idx" ON "stock_quotes"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_quote_lines_quoteId_itemId_key" ON "stock_quote_lines"("quoteId", "itemId");

-- CreateIndex
CREATE INDEX "stock_deliveries_requestId_receivedAt_idx" ON "stock_deliveries"("requestId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_delivery_lines_movementId_key" ON "stock_delivery_lines"("movementId");

-- CreateIndex
CREATE INDEX "stock_delivery_lines_deliveryId_idx" ON "stock_delivery_lines"("deliveryId");

-- CreateIndex
CREATE INDEX "supplier_invoices_status_idx" ON "supplier_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_requestId_number_key" ON "supplier_invoices"("requestId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_expenseId_key" ON "supplier_payments"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_clientKey_key" ON "supplier_payments"("clientKey");

-- CreateIndex
CREATE INDEX "supplier_payments_invoiceId_idx" ON "supplier_payments"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_requests_chosenQuoteId_key" ON "stock_requests"("chosenQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_requests_orderNumber_key" ON "stock_requests"("orderNumber");

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_chosenQuoteId_fkey" FOREIGN KEY ("chosenQuoteId") REFERENCES "stock_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quotes" ADD CONSTRAINT "stock_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "stock_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quotes" ADD CONSTRAINT "stock_quotes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quotes" ADD CONSTRAINT "stock_quotes_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quote_lines" ADD CONSTRAINT "stock_quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "stock_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quote_lines" ADD CONSTRAINT "stock_quote_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "stock_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_deliveries" ADD CONSTRAINT "stock_deliveries_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "stock_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_deliveries" ADD CONSTRAINT "stock_deliveries_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_delivery_lines" ADD CONSTRAINT "stock_delivery_lines_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "stock_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_delivery_lines" ADD CONSTRAINT "stock_delivery_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "stock_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_delivery_lines" ADD CONSTRAINT "stock_delivery_lines_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "stock_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ordering, deliveries, invoices and supplier payments (hand-written): what the database itself refuses.
ALTER TABLE "stock_quotes" ADD CONSTRAINT "stock_quotes_total_ok" CHECK ("total" >= 0);
ALTER TABLE "stock_quote_lines" ADD CONSTRAINT "stock_quote_lines_ok" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "stock_delivery_lines" ADD CONSTRAINT "stock_delivery_lines_ok" CHECK ("quantity" >= 0 AND "rejectedQty" >= 0 AND ("quantity" > 0 OR "rejectedQty" > 0));
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_received_ok" CHECK ("receivedQty" >= 0);
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_order_ok" CHECK ("orderTotal" IS NULL OR "orderTotal" >= 0);
ALTER TABLE "hotel_settings" ADD CONSTRAINT "hotel_settings_finance_limit_ok" CHECK ("financeAuthorizationLimit" IS NULL OR "financeAuthorizationLimit" >= 0);
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_amounts_ok" CHECK ("amount" > 0 AND "paidAmount" >= 0 AND "paidAmount" <= "amount");
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_status_ok" CHECK ("status" IN ('RECEIVED', 'VERIFIED', 'DISPUTED', 'PART_PAID', 'PAID', 'CANCELLED'));
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_ok" CHECK ("amount" > 0);
