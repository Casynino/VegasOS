-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "purchaseApproverMustDiffer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stock_request_items" ADD COLUMN     "approvedQty" DOUBLE PRECISION,
ADD COLUMN     "expiresOn" DATE,
ADD COLUMN     "inventoryItemId" TEXT,
ADD COLUMN     "lineTotal" INTEGER,
ADD COLUMN     "movementId" TEXT,
ADD COLUMN     "purchasedQty" DOUBLE PRECISION,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "unitPrice" INTEGER;

-- AlterTable
ALTER TABLE "stock_requests" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "correctionNote" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "expenseId" TEXT,
ADD COLUMN     "finalApprovedAt" TIMESTAMP(3),
ADD COLUMN     "finalApprovedById" TEXT,
ADD COLUMN     "noReceiptReason" TEXT,
ADD COLUMN     "purchaseNote" TEXT,
ADD COLUMN     "purchaseNumber" TEXT,
ADD COLUMN     "purchaseTotal" INTEGER,
ADD COLUMN     "purchasedAt" TIMESTAMP(3),
ADD COLUMN     "purchasedById" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "receiptFileId" TEXT,
ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "supplierName" TEXT,
ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';

-- CreateTable
CREATE TABLE "stock_request_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "byId" TEXT,
    "byLabel" TEXT,
    "byRole" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_request_events_requestId_at_idx" ON "stock_request_events"("requestId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_request_items_movementId_key" ON "stock_request_items"("movementId");

-- CreateIndex
CREATE INDEX "stock_request_items_inventoryItemId_idx" ON "stock_request_items"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_requests_purchaseNumber_key" ON "stock_requests"("purchaseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "stock_requests_receiptFileId_key" ON "stock_requests"("receiptFileId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_requests_expenseId_key" ON "stock_requests"("expenseId");

-- CreateIndex
CREATE INDEX "stock_requests_departmentId_idx" ON "stock_requests"("departmentId");

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "inventory_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_purchasedById_fkey" FOREIGN KEY ("purchasedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_finalApprovedById_fkey" FOREIGN KEY ("finalApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_events" ADD CONSTRAINT "stock_request_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "stock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_events" ADD CONSTRAINT "stock_request_events_byId_fkey" FOREIGN KEY ("byId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing requests in the new steps: asked → waiting for review, declined → rejected, received →
-- completed (from before purchases were recorded: no expense or stock is made for them now).
UPDATE "stock_requests" SET "status" = CASE "status" WHEN 'REQUESTED' THEN 'SUBMITTED' WHEN 'DECLINED' THEN 'REJECTED' WHEN 'RECEIVED' THEN 'COMPLETED' ELSE "status" END;
UPDATE "stock_requests" s SET "departmentId" = d."id" FROM "inventory_departments" d WHERE d."code" = s."department" AND s."departmentId" IS NULL;

-- Asking for stock is its own right (kitchen, waiters, reception — for any department); managers review and buy.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_inventory_request', 'inventory.request', 'Ask for stock or supplies for a department (no money, no stock changes)')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'inventory.request'
WHERE r."code" IN ('ADMIN', 'OWNER', 'MANAGER', 'RECEPTIONIST', 'KITCHEN', 'RESTAURANT')
ON CONFLICT DO NOTHING;
