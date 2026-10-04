-- CreateEnum
CREATE TYPE "RestaurantLocationKind" AS ENUM ('TABLE', 'COUNTER', 'MAIN');

-- CreateEnum
CREATE TYPE "DiningArea" AS ENUM ('INSIDE', 'OUTSIDE');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PENDING_CONFIRMATION', 'PARTIALLY_PAID', 'PAID', 'REFUNDED');

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "orderPaymentConfirm" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "restaurant_order_items" ADD COLUMN     "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "addedById" TEXT,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "paidAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "revenue_transactions" ADD COLUMN     "orderPaymentId" TEXT;

-- CreateTable
CREATE TABLE "restaurant_order_payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "reference" TEXT,
    "collectedById" TEXT,
    "collectedByRole" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedByRole" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reverseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_locations" (
    "id" TEXT NOT NULL,
    "kind" "RestaurantLocationKind" NOT NULL,
    "area" "DiningArea",
    "number" INTEGER,
    "name" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "qrActive" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "regeneratedAt" TIMESTAMP(3),
    "qrById" TEXT,
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_order_payments_orderId_idx" ON "restaurant_order_payments"("orderId");

-- CreateIndex
CREATE INDEX "restaurant_order_payments_status_confirmedAt_idx" ON "restaurant_order_payments"("status", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_locations_qrToken_key" ON "restaurant_locations"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_locations_kind_area_number_key" ON "restaurant_locations"("kind", "area", "number");

-- CreateIndex
CREATE INDEX "restaurant_orders_locationId_status_idx" ON "restaurant_orders"("locationId", "status");

-- CreateIndex
CREATE INDEX "restaurant_orders_paymentStatus_idx" ON "restaurant_orders"("paymentStatus");

-- AddForeignKey
ALTER TABLE "revenue_transactions" ADD CONSTRAINT "revenue_transactions_orderPaymentId_fkey" FOREIGN KEY ("orderPaymentId") REFERENCES "restaurant_order_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "restaurant_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "restaurant_order_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_payments" ADD CONSTRAINT "restaurant_order_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_payments" ADD CONSTRAINT "restaurant_order_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_payments" ADD CONSTRAINT "restaurant_order_payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_payments" ADD CONSTRAINT "restaurant_order_payments_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_payments" ADD CONSTRAINT "restaurant_order_payments_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_payments" ADD CONSTRAINT "restaurant_order_payments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_qrById_fkey" FOREIGN KEY ("qrById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── Data: permissions (one restaurant, reconciled roles) ─────────────
-- Waiters run the whole restaurant (prepare any order, serve, take payments); the Mpishi prepares
-- food and drinks; reception watches every order and records / confirms payments but never
-- prepares or serves.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_restaurant_serve', 'restaurant.serve', 'Restaurant portal as a waiter: take ready orders out, mark them delivered, add items to orders'),
  ('perm_restaurant_payments_confirm', 'restaurant.payments.confirm', 'Confirm restaurant payments collected by waiters')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'restaurant.serve'
WHERE r."code" IN ('RESTAURANT', 'MANAGER', 'OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'restaurant.payments.confirm'
WHERE r."code" IN ('RECEPTIONIST', 'MANAGER', 'OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'kitchen.orders'
WHERE r."code" = 'RESTAURANT'
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'bar.orders'
WHERE r."code" = 'KITCHEN'
ON CONFLICT DO NOTHING;

UPDATE "permissions" SET "description" = 'Restaurant portal: see every order, take orders, text customers' WHERE "code" = 'restaurant.orders';
UPDATE "permissions" SET "description" = 'Restaurant portal as the Mpishi: accept, prepare and mark any order ready (food and drinks)' WHERE "code" = 'kitchen.orders';
UPDATE "permissions" SET "description" = 'Restaurant portal: accept, prepare and mark drinks ready' WHERE "code" = 'bar.orders';
UPDATE "roles" SET "description" = 'Restaurant: runs the restaurant — accepts and prepares orders, takes them out, adds items, prints bills, takes payments, texts customers.' WHERE "code" = 'RESTAURANT';
UPDATE "roles" SET "description" = 'Restaurant: prepares food and drinks — accept, prepare, mark ready; can take orders.' WHERE "code" = 'KITCHEN';

-- ───────────── Data: the restaurant's places, each with its own QR ─────────────
-- Table 1–6 inside, Table 1–6 outside (same numbers, different areas), the outside counter
-- (not a table) and the main restaurant QR. Tokens are random (24 hex characters).
INSERT INTO "restaurant_locations" ("id", "kind", "area", "number", "name", "qrToken", "sortOrder", "updatedAt")
SELECT 'loc_in_' || n, 'TABLE', 'INSIDE', n, 'Table ' || n || ' — Inside', substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), n, CURRENT_TIMESTAMP
FROM generate_series(1, 6) AS n
ON CONFLICT DO NOTHING;
INSERT INTO "restaurant_locations" ("id", "kind", "area", "number", "name", "qrToken", "sortOrder", "updatedAt")
SELECT 'loc_out_' || n, 'TABLE', 'OUTSIDE', n, 'Table ' || n || ' — Outside', substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), 100 + n, CURRENT_TIMESTAMP
FROM generate_series(1, 6) AS n
ON CONFLICT DO NOTHING;
INSERT INTO "restaurant_locations" ("id", "kind", "area", "number", "name", "qrToken", "sortOrder", "updatedAt") VALUES
  ('loc_counter_out', 'COUNTER', 'OUTSIDE', NULL, 'Counter — Outside', substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), 200, CURRENT_TIMESTAMP),
  ('loc_main', 'MAIN', NULL, NULL, 'Restaurant', substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), 300, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ───────────── Data: payments already taken become payment records ─────────────
UPDATE "restaurant_order_items" i SET "addedAt" = o."createdAt", "addedById" = o."createdById"
FROM "restaurant_orders" o WHERE o."id" = i."orderId";

INSERT INTO "restaurant_order_payments" ("id", "orderId", "amount", "fee", "accountId", "paymentMethodId", "reference", "collectedById", "collectedAt", "confirmedById", "confirmedAt", "status", "reversedAt", "reverseReason", "createdAt")
SELECT 'rop_' || o."id", o."id", o."total", o."serviceFee", o."accountId", s."paymentMethodId", o."paymentReference",
  s."recordedById", COALESCE(o."paidAt", s."occurredAt"), s."recordedById", COALESCE(o."paidAt", s."occurredAt"),
  CASE WHEN o."status" = 'CANCELLED' THEN 'REVERSED' ELSE 'POSTED' END,
  CASE WHEN o."status" = 'CANCELLED' THEN o."cancelledAt" END,
  CASE WHEN o."status" = 'CANCELLED' THEN o."cancelReason" END,
  COALESCE(o."paidAt", s."occurredAt")
FROM "restaurant_orders" o
JOIN LATERAL (
  SELECT rt."paymentMethodId", rt."recordedById", rt."occurredAt" FROM "revenue_transactions" rt
  WHERE rt."restaurantOrderId" = o."id" ORDER BY rt."createdAt" LIMIT 1
) s ON TRUE
WHERE o."settlement" = 'PAY_NOW' AND o."accountId" IS NOT NULL;

UPDATE "revenue_transactions" rt SET "orderPaymentId" = 'rop_' || rt."restaurantOrderId"
WHERE rt."restaurantOrderId" IS NOT NULL AND EXISTS (SELECT 1 FROM "restaurant_order_payments" p WHERE p."id" = 'rop_' || rt."restaurantOrderId");
UPDATE "restaurant_order_items" i SET "paymentId" = 'rop_' || i."orderId"
WHERE EXISTS (SELECT 1 FROM "restaurant_order_payments" p WHERE p."id" = 'rop_' || i."orderId" AND p."status" = 'POSTED');
UPDATE "restaurant_orders" SET "paidAmount" = "total", "paymentStatus" = 'PAID' WHERE "settlement" = 'PAY_NOW' AND "status" <> 'CANCELLED';
UPDATE "restaurant_orders" SET "paymentStatus" = 'REFUNDED' WHERE "settlement" = 'PAY_NOW' AND "status" = 'CANCELLED';
