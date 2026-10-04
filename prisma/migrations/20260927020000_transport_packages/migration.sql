-- AlterTable
ALTER TABLE "transport_trips" ADD COLUMN     "priceOption" TEXT;

-- CreateTable
CREATE TABLE "transport_service_options" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transport_service_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transport_service_options_serviceId_idx" ON "transport_service_options"("serviceId");

-- AddForeignKey
ALTER TABLE "transport_service_options" ADD CONSTRAINT "transport_service_options_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "transport_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prices: airport pickup & drop-off TZS 40,000; meeting / business trips by time & distance.
UPDATE "transport_services" SET "price" = 40000 WHERE "code" IN ('AIRPORT_PICKUP', 'AIRPORT_DROPOFF');
UPDATE "transport_services" SET "price" = 30000 WHERE "code" = 'MEETING';
INSERT INTO "transport_service_options" ("id", "serviceId", "name", "description", "price", "isActive", "sortOrder") VALUES
  ('trsopt_meeting_short', 'trsvc_meeting', 'Short trip', 'Nearby, a few hours', 30000, true, 10),
  ('trsopt_meeting_half', 'trsvc_meeting', 'Half day', 'Across the city, up to half a day', 50000, true, 20),
  ('trsopt_meeting_full', 'trsvc_meeting', 'Full day', 'Long distance or the whole day', 100000, true, 30)
ON CONFLICT ("id") DO NOTHING;
