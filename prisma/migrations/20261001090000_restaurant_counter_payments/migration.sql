-- AlterTable
ALTER TABLE "restaurant_order_payments" ADD COLUMN     "atCounter" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handedOverById" TEXT;

-- AddForeignKey
ALTER TABLE "restaurant_order_payments" ADD CONSTRAINT "restaurant_order_payments_handedOverById_fkey" FOREIGN KEY ("handedOverById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Waiters serve; the shared Restaurant Counter account records the official restaurant payments.
DELETE FROM "role_permissions"
 WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'RESTAURANT')
   AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = 'revenue.record');

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r, "permissions" p
 WHERE r."code" = 'RESTAURANT_SCREEN' AND p."code" IN ('revenue.record', 'restaurant.payments.confirm')
ON CONFLICT DO NOTHING;

UPDATE "roles" SET "name" = 'Restaurant Counter (shared account)',
  "description" = 'The one shared Restaurant account at the Counter: sees the whole restaurant and records every official restaurant payment. Waiters type their ID there for the service they do — never a Counter person''s own account.'
 WHERE "code" = 'RESTAURANT_SCREEN';

UPDATE "permissions" SET "description" = 'Confirm restaurant payments (the Restaurant Counter''s own are confirmed as they are recorded)'
 WHERE "code" = 'restaurant.payments.confirm';
