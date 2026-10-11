-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "spinAllowRestaurant" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "spinAllowRoom" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "spinBudgetPremium" INTEGER NOT NULL DEFAULT 15000,
ADD COLUMN     "spinBudgetStandard" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "spinEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spinEndsOn" DATE,
ADD COLUMN     "spinMaxItemPrice" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "spinStartsOn" DATE,
ADD COLUMN     "spinsPerStay" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "giftValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isGift" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "room_types" ADD COLUMN     "spinTier" TEXT;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "spinTier" TEXT;

-- CreateTable
CREATE TABLE "spin_qr_codes" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "generatedById" TEXT,
    "regeneratedAt" TIMESTAMP(3),
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_sessions" (
    "id" TEXT NOT NULL,
    "reservationRoomId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "spinsAllowed" INTEGER NOT NULL,
    "budget" INTEGER NOT NULL,
    "spinsUsed" INTEGER NOT NULL DEFAULT 0,
    "valueUsed" INTEGER NOT NULL DEFAULT 0,
    "fulfilment" TEXT,
    "introSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_results" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "spinNumber" INTEGER NOT NULL,
    "clientKey" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameI18n" JSONB,
    "value" INTEGER NOT NULL,
    "fulfilment" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "spin_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spin_prizes" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "valueOverride" INTEGER,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spin_qr_codes_roomId_key" ON "spin_qr_codes"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "spin_qr_codes_token_key" ON "spin_qr_codes"("token");

-- CreateIndex
CREATE UNIQUE INDEX "spin_sessions_reservationRoomId_key" ON "spin_sessions"("reservationRoomId");

-- CreateIndex
CREATE INDEX "spin_sessions_reservationId_idx" ON "spin_sessions"("reservationId");

-- CreateIndex
CREATE INDEX "spin_sessions_createdAt_idx" ON "spin_sessions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "spin_results_clientKey_key" ON "spin_results"("clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "spin_results_orderId_key" ON "spin_results"("orderId");

-- CreateIndex
CREATE INDEX "spin_results_createdAt_idx" ON "spin_results"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "spin_results_sessionId_spinNumber_key" ON "spin_results"("sessionId", "spinNumber");

-- CreateIndex
CREATE UNIQUE INDEX "spin_prizes_menuItemId_key" ON "spin_prizes"("menuItemId");

-- AddForeignKey
ALTER TABLE "spin_qr_codes" ADD CONSTRAINT "spin_qr_codes_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_qr_codes" ADD CONSTRAINT "spin_qr_codes_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_sessions" ADD CONSTRAINT "spin_sessions_reservationRoomId_fkey" FOREIGN KEY ("reservationRoomId") REFERENCES "reservation_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_sessions" ADD CONSTRAINT "spin_sessions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_sessions" ADD CONSTRAINT "spin_sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_results" ADD CONSTRAINT "spin_results_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "spin_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_results" ADD CONSTRAINT "spin_results_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_results" ADD CONSTRAINT "spin_results_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spin_prizes" ADD CONSTRAINT "spin_prizes_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The database itself refuses a sixth spin or a gift over the stay's budget, whatever the code does.
ALTER TABLE "spin_sessions" ADD CONSTRAINT "spin_sessions_spins_check" CHECK ("spinsUsed" >= 0 AND "spinsUsed" <= "spinsAllowed");
ALTER TABLE "spin_sessions" ADD CONSTRAINT "spin_sessions_value_check" CHECK ("valueUsed" >= 0 AND "valueUsed" <= "budget");
ALTER TABLE "spin_results" ADD CONSTRAINT "spin_results_number_check" CHECK ("spinNumber" >= 1);
ALTER TABLE "spin_results" ADD CONSTRAINT "spin_results_value_check" CHECK ("value" >= 0);

-- Spin to Win set-up (switch, budgets, gifts, cards) is the Admin's and the owner's.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_spin_manage', 'spin.manage', 'Spin to Win (Admin): switch it on or off, spins and budgets, which menu items are gifts, the room cards')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'spin.manage'
WHERE r."code" IN ('ADMIN', 'OWNER')
ON CONFLICT DO NOTHING;
