-- CreateEnum
CREATE TYPE "ShiftDepartment" AS ENUM ('RECEPTION', 'RESTAURANT');

-- AlterTable
ALTER TABLE "actual_shifts" ADD COLUMN     "department" "ShiftDepartment" NOT NULL DEFAULT 'RECEPTION';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "pinSetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "waiter_assignments" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "orderId" TEXT,
    "locationId" TEXT,
    "roomNumber" TEXT,
    "kind" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "reason" TEXT,
    "byId" TEXT,
    "byLabel" TEXT,
    "byRole" TEXT,
    "deviceUserId" TEXT,
    "batchId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waiter_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waiter_assignments_orderId_at_idx" ON "waiter_assignments"("orderId", "at");

-- CreateIndex
CREATE INDEX "waiter_assignments_toUserId_at_idx" ON "waiter_assignments"("toUserId", "at");

-- CreateIndex
CREATE INDEX "waiter_assignments_fromUserId_at_idx" ON "waiter_assignments"("fromUserId", "at");

-- CreateIndex
CREATE INDEX "waiter_assignments_locationId_at_idx" ON "waiter_assignments"("locationId", "at");

-- CreateIndex
CREATE INDEX "actual_shifts_department_endedAt_idx" ON "actual_shifts"("department", "endedAt");

-- AddForeignKey
ALTER TABLE "waiter_assignments" ADD CONSTRAINT "waiter_assignments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_assignments" ADD CONSTRAINT "waiter_assignments_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_assignments" ADD CONSTRAINT "waiter_assignments_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One open RECEPTION shift in the hotel (the desk), as before — and one open shift per person, so
-- every waiter can work their own restaurant shift at the same time.
DROP INDEX IF EXISTS "actual_shifts_one_open";
CREATE UNIQUE INDEX "actual_shifts_one_open_reception" ON "actual_shifts" ((true)) WHERE "endedAt" IS NULL AND "department" = 'RECEPTION';
CREATE UNIQUE INDEX "actual_shifts_one_open_per_person" ON "actual_shifts" ("userId") WHERE "endedAt" IS NULL;

-- Waiters work their own restaurant shift; the shared restaurant screen identifies them by PIN.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_restaurant_shift', 'restaurant.shift', 'Work own restaurant shift: start it, and close it only when no table or order is left (or it is transferred)'),
  ('perm_restaurant_device', 'restaurant.device', 'The main restaurant screen (shared computer / iPad): each waiter says who they are with their PIN')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('restaurant.shift', 'restaurant.device')
WHERE r."code" IN ('ADMIN', 'OWNER') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'restaurant.shift'
WHERE r."code" = 'RESTAURANT' ON CONFLICT DO NOTHING;

-- The role for the main restaurant computer / iPad.
INSERT INTO "roles" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt") VALUES
  ('role_restaurant_screen', 'RESTAURANT_SCREEN', 'Restaurant screen (shared device)', 'The main restaurant computer / iPad: sees the whole restaurant. Waiters take orders in charge and take payments on it with their own PIN — never under the screen''s name.', true, now(), now())
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('restaurant.orders', 'restaurant.serve', 'restaurant.device', 'kitchen.orders', 'bar.orders', 'revenue.record', 'guests.view')
WHERE r."code" = 'RESTAURANT_SCREEN' ON CONFLICT DO NOTHING;
