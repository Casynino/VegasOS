-- AlterTable
ALTER TABLE "reservation_charges" ADD COLUMN     "menuItemId" TEXT;

-- AddForeignKey
ALTER TABLE "reservation_charges" ADD CONSTRAINT "reservation_charges_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Food & drinks already on guests' bills from restaurant orders: link each line to its menu item.
UPDATE "reservation_charges" c SET "menuItemId" = oi."menuItemId"
FROM "restaurant_order_items" oi
WHERE oi."orderId" = c."restaurantOrderId" AND c."menuItemId" IS NULL AND oi."menuItemId" IS NOT NULL
  AND split_part(c."description", ' · ', 1) IN (oi."name", oi."quantity" || ' × ' || oi."name");
