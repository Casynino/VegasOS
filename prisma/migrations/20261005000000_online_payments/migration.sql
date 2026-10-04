-- DropForeignKey
ALTER TABLE "mobile_payments" DROP CONSTRAINT "mobile_payments_requestedById_fkey";

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "onlinePayBooking" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePayEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePayInvoices" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePayMeeting" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePayRestaurant" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePayRoomService" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePayStayBill" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePayTransport" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "mobile_payments" ADD COLUMN     "clientKey" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "initiator" TEXT NOT NULL DEFAULT 'STAFF',
ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "targetKey" TEXT,
ADD COLUMN     "tripId" TEXT,
ALTER COLUMN "requestedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "payOnlineAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "transport_trips" ADD COLUMN     "payToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "mobile_payments_publicToken_key" ON "mobile_payments"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_payments_clientKey_key" ON "mobile_payments"("clientKey");

-- CreateIndex
CREATE INDEX "mobile_payments_targetKey_status_idx" ON "mobile_payments"("targetKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transport_trips_payToken_key" ON "transport_trips"("payToken");

-- AddForeignKey
ALTER TABLE "mobile_payments" ADD CONSTRAINT "mobile_payments_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_payments" ADD CONSTRAINT "mobile_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_payments" ADD CONSTRAINT "mobile_payments_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "transport_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Who records the payments customers make online themselves (nTZS): a system account — it cannot sign in (inactive,
-- no usable password) and has no permissions; it only stands for "Online · nTZS" on those payments.
INSERT INTO "roles" ("id", "code", "name", "description", "isSystem", "updatedAt")
VALUES ('role_system_online', 'SYSTEM_ONLINE', 'Online payments (system)', 'Records payments customers make online through nTZS. Not a person; cannot sign in.', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "users" ("id", "email", "fullName", "passwordHash", "roleId", "isActive", "updatedAt")
VALUES ('usr_online_ntzs', 'online-payments@system.invalid', 'Online · nTZS', '!no-login', (SELECT "id" FROM "roles" WHERE "code" = 'SYSTEM_ONLINE'), false, CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO NOTHING;
