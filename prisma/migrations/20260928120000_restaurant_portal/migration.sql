-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "newOrderSound" TEXT NOT NULL DEFAULT 'bell',
ADD COLUMN     "orderSoundEverySeconds" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "orderSoundMode" TEXT NOT NULL DEFAULT 'REPEAT',
ADD COLUMN     "orderSoundVolume" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "orderSoundsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "readyOrderSound" TEXT NOT NULL DEFAULT 'chime';

-- AlterTable
ALTER TABLE "restaurant_order_events" ADD COLUMN     "byRole" TEXT;

-- AlterTable
ALTER TABLE "restaurant_order_items" ADD COLUMN     "preparedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "deliveredById" TEXT,
ADD COLUMN     "deliveredTo" TEXT,
ADD COLUMN     "preparingAt" TIMESTAMP(3),
ADD COLUMN     "takenAt" TIMESTAMP(3),
ADD COLUMN     "takenById" TEXT;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One flow for every order: … READY → OUT_FOR_DELIVERY (taken by waiter) → DELIVERED → COMPLETED.
-- Orders already handed over and settled are completed; collected takeaways too.
UPDATE "restaurant_orders" SET "status" = 'COMPLETED', "completedAt" = COALESCE("completedAt", "deliveredAt", "statusChangedAt")
  WHERE "status" = 'COLLECTED' OR ("status" = 'DELIVERED' AND "settlement" <> 'UNPAID');
-- Orders that already went past "preparing" have every line done.
UPDATE "restaurant_order_items" i SET "preparedAt" = COALESCE(o."readyAt", o."statusChangedAt")
  FROM "restaurant_orders" o WHERE o."id" = i."orderId" AND o."status" IN ('READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'COLLECTED');

-- The restaurant portal's two roles: Mpishi (the cook — food and drinks) and Waiter.
UPDATE "roles" SET "name" = 'Mpishi (cook)', "description" = 'Restaurant: prepares food and drinks — accept, prepare, mark ready; can take orders.' WHERE "code" = 'KITCHEN';
UPDATE "roles" SET "name" = 'Waiter', "description" = 'Restaurant: takes ready orders to the room or table, marks them delivered, takes orders and payments.' WHERE "code" = 'RESTAURANT';
DELETE FROM "role_permissions" rp USING "roles" r, "permissions" p
  WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id" AND r."code" = 'RESTAURANT' AND p."code" = 'kitchen.orders';
UPDATE "permissions" SET "description" = 'Restaurant portal as the cook (Mpishi): accept, prepare and mark orders ready; take orders' WHERE "code" = 'kitchen.orders';
UPDATE "permissions" SET "description" = 'Restaurant portal as a waiter / reception: take orders, take ready orders out and mark them delivered' WHERE "code" = 'restaurant.orders';
