
-- CreateEnum
CREATE TYPE "BookingQrEventType" AS ENUM ('SCAN', 'SEARCH', 'SELECT', 'ATTEMPT');

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "hotelQrEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hotelQrPayAtHotel" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "bookingQrId" TEXT;

-- CreateTable
CREATE TABLE "booking_qr_codes" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "placement" TEXT,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "generatedById" TEXT,
    "regeneratedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_qr_events" (
    "id" TEXT NOT NULL,
    "qrId" TEXT NOT NULL,
    "type" "BookingQrEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_qr_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_qr_codes_token_key" ON "booking_qr_codes"("token");

-- CreateIndex
CREATE INDEX "booking_qr_events_qrId_type_createdAt_idx" ON "booking_qr_events"("qrId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "booking_qr_events_createdAt_idx" ON "booking_qr_events"("createdAt");

-- CreateIndex
CREATE INDEX "reservations_bookingQrId_idx" ON "reservations"("bookingQrId");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_bookingQrId_fkey" FOREIGN KEY ("bookingQrId") REFERENCES "booking_qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_qr_codes" ADD CONSTRAINT "booking_qr_codes_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_qr_events" ADD CONSTRAINT "booking_qr_events_qrId_fkey" FOREIGN KEY ("qrId") REFERENCES "booking_qr_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The Hotel booking QR is a booking channel of its own: its bookings show as "Hotel QR" everywhere sources show.
INSERT INTO "booking_sources" ("id", "code", "name", "isActive", "isSystem", "sortOrder")
VALUES ('src_hotel_qr', 'HOTEL_QR', 'Hotel QR', true, true, 1)
ON CONFLICT ("code") DO NOTHING;

-- Managing the Hotel QR (print, regenerate, revoke, switch on/off, its numbers) is the Admin's — reception views and prints it.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_hotel_qr_manage', 'hotel_qr.manage', 'Hotel booking QR (Admin): create, regenerate, revoke and switch QR codes on or off; booking from the QR; its numbers')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'hotel_qr.manage'
WHERE r."code" IN ('ADMIN', 'OWNER')
ON CONFLICT DO NOTHING;

-- The first QR, for the reception desk (more can be added for the entrance, rooms, flyers…).
INSERT INTO "booking_qr_codes" ("id", "label", "placement", "token", "active", "isActive", "sortOrder", "updatedAt")
VALUES ('bqr_reception', 'Reception', 'At the reception desk', substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), true, true, 0, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
