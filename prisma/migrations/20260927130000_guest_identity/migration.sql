-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "altPhone" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN     "preferredChannel" TEXT,
ADD COLUMN     "reference" TEXT DEFAULT ('G-'::text || upper(substr(md5(((random())::text || (clock_timestamp())::text)), 1, 6))),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vip" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "bookingMessageTemplate" TEXT,
ADD COLUMN     "guestNotifications" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "welcomeMessageTemplate" TEXT;

-- CreateTable
CREATE TABLE "guest_messages" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "reservationId" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_messages_guestId_createdAt_idx" ON "guest_messages"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "guest_messages_reservationId_idx" ON "guest_messages"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "guests_reference_key" ON "guests"("reference");

-- AddForeignKey
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every existing guest gets a customer reference.
UPDATE "guests" SET "reference" = 'G-' || upper(substr(md5(random()::text || "id"), 1, 6)) WHERE "reference" IS NULL;
