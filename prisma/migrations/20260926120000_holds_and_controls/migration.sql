-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "noShowPolicy" TEXT NOT NULL DEFAULT 'RETAIN_PAYMENT',
ADD COLUMN     "unpaidHoldHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "reservation_rooms" ADD COLUMN     "discountSetAt" TIMESTAMP(3),
ADD COLUMN     "discountSetById" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "holdUntil" TIMESTAMP(3);


-- New permissions: reception can view the ledger; managers can confirm a booking without payment.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_ledger_view', 'ledger.view', 'View the general ledger (every money movement, read-only)'),
  ('perm_res_confirm_unpaid', 'reservations.confirm_unpaid', 'Confirm / hold a booking without payment')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'ledger.view'
WHERE r."code" IN ('ADMIN', 'OWNER', 'MANAGER', 'RECEPTIONIST') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'reservations.confirm_unpaid'
WHERE r."code" IN ('ADMIN', 'OWNER', 'MANAGER') ON CONFLICT DO NOTHING;
