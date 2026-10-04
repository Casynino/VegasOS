-- AlterEnum
ALTER TYPE "RestaurantOrderStatus" ADD VALUE 'COLLECTED';

-- AlterEnum
ALTER TYPE "RestaurantOrderType" ADD VALUE 'PICKUP';

-- AlterEnum
ALTER TYPE "RestaurantSettlement" ADD VALUE 'UNPAID';

-- AlterTable
ALTER TABLE "guest_messages" ADD COLUMN     "restaurantOrderId" TEXT;

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "orderPrepMinutes" INTEGER,
ADD COLUMN     "publicOrderingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "clientKey" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "guestId" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "readyById" TEXT,
ADD COLUMN     "trackToken" TEXT,
ALTER COLUMN "source" SET DEFAULT 'RESTAURANT';

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "menuToken" TEXT;

-- CreateTable
CREATE TABLE "restaurant_order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "from" "RestaurantOrderStatus",
    "to" "RestaurantOrderStatus" NOT NULL,
    "byId" TEXT,
    "byLabel" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_order_events_orderId_at_idx" ON "restaurant_order_events"("orderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_trackToken_key" ON "restaurant_orders"("trackToken");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_clientKey_key" ON "restaurant_orders"("clientKey");

-- CreateIndex
CREATE INDEX "restaurant_orders_guestId_idx" ON "restaurant_orders"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_menuToken_key" ON "rooms"("menuToken");

-- AddForeignKey
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_restaurantOrderId_fkey" FOREIGN KEY ("restaurantOrderId") REFERENCES "restaurant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_readyById_fkey" FOREIGN KEY ("readyById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_events" ADD CONSTRAINT "restaurant_order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_events" ADD CONSTRAINT "restaurant_order_events_byId_fkey" FOREIGN KEY ("byId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: order sources get their real names; every room gets its menu QR token.
UPDATE "restaurant_orders" SET "source" = 'GUEST_LINK' WHERE "source" = 'GUEST';
UPDATE "restaurant_orders" SET "source" = 'RESTAURANT' WHERE "source" = 'STAFF';
UPDATE "restaurant_orders" o SET "guestId" = r."guestId" FROM "reservations" r WHERE o."reservationId" = r."id" AND o."guestId" IS NULL;
UPDATE "rooms" SET "menuToken" = substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 12) WHERE "menuToken" IS NULL;

-- The kitchen: its own permission and role (orders to prepare — nothing financial).
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_kitchen_orders', 'kitchen.orders', 'Kitchen portal: accept orders and mark them ready (no prices, payments or reports)')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "roles" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES ('role_kitchen', 'KITCHEN', 'Kitchen', 'Sees orders to prepare in the kitchen portal: accept, prepare, mark ready.', true, now(), now())
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
  SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'kitchen.orders'
  WHERE r."code" IN ('KITCHEN', 'ADMIN', 'OWNER', 'MANAGER', 'RESTAURANT')
ON CONFLICT DO NOTHING;
