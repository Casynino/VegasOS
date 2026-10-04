
-- CreateTable
CREATE TABLE "room_qr_codes" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "generatedById" TEXT,
    "regeneratedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_access_sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "stay_access_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_qr_codes_roomId_key" ON "room_qr_codes"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "room_qr_codes_token_key" ON "room_qr_codes"("token");

-- CreateIndex
CREATE UNIQUE INDEX "stay_access_sessions_tokenHash_key" ON "stay_access_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "stay_access_sessions_reservationId_idx" ON "stay_access_sessions"("reservationId");

-- AddForeignKey
ALTER TABLE "room_qr_codes" ADD CONSTRAINT "room_qr_codes_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_qr_codes" ADD CONSTRAINT "room_qr_codes_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_access_sessions" ADD CONSTRAINT "stay_access_sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_access_sessions" ADD CONSTRAINT "stay_access_sessions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_access_sessions" ADD CONSTRAINT "stay_access_sessions_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: each room's QR token moves to its own record (the printed cards keep working).
INSERT INTO "room_qr_codes" ("id", "roomId", "token", "active", "createdAt", "updatedAt")
SELECT 'rqr_' || substr(md5(r."id"), 1, 20), r."id", r."menuToken", true, now(), now() FROM "rooms" r WHERE r."menuToken" IS NOT NULL;

DROP INDEX "rooms_menuToken_key";
ALTER TABLE "rooms" DROP COLUMN "menuToken";
