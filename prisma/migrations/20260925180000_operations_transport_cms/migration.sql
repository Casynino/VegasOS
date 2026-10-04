-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('DINING', 'TRANSPORT', 'CONVENIENCE', 'BUSINESS', 'OTHER');

-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('AIRPORT_PICKUP', 'AIRPORT_DROPOFF', 'HOTEL_TRANSFER', 'GUEST_TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'ASSIGNED', 'EN_ROUTE', 'PICKED_UP', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('TOWELS', 'CLEANING', 'MAINTENANCE', 'RESTAURANT', 'TRANSPORT', 'GENERAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MediaCategory" AS ENUM ('ROOMS', 'EXTERIOR', 'RECEPTION', 'RESTAURANT', 'BAR', 'BREAKFAST', 'MEETING_ROOM', 'FACILITIES', 'EXPERIENCE', 'OTHER');

-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "preferences" TEXT;

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "airportTransferPrice" INTEGER,
ADD COLUMN     "barHours" TEXT,
ADD COLUMN     "breakfastHours" TEXT,
ADD COLUMN     "earlyDeparturePolicy" TEXT NOT NULL DEFAULT 'CHARGE_USED_NIGHTS',
ADD COLUMN     "lateCheckoutFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "receptionHours" TEXT DEFAULT '24 hours',
ADD COLUMN     "restaurantHours" TEXT,
ADD COLUMN     "wifiNetwork" TEXT,
ADD COLUMN     "wifiPassword" TEXT;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "reservation_charges" ADD COLUMN     "category" TEXT,
ADD COLUMN     "kind" "RevenueKind" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "reservation_rooms" ADD COLUMN     "earlyDepartureReason" TEXT,
ADD COLUMN     "lateCheckoutNote" TEXT,
ADD COLUMN     "lateCheckoutUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "eta" TEXT,
ADD COLUMN     "externalData" JSONB,
ADD COLUMN     "welcomeChecklist" JSONB;

-- CreateTable
CREATE TABLE "room_assignments" (
    "id" TEXT NOT NULL,
    "reservationRoomId" TEXT NOT NULL,
    "fromRoomId" TEXT NOT NULL,
    "toRoomId" TEXT NOT NULL,
    "reason" TEXT,
    "priceDifference" INTEGER,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_services" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "ServiceCategory" NOT NULL DEFAULT 'OTHER',
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isChargeable" BOOLEAN NOT NULL DEFAULT false,
    "price" INTEGER,
    "priceNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plateNumber" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_trips" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "TripType" NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'REQUESTED',
    "reservationId" TEXT,
    "guestId" TEXT,
    "passengerName" TEXT NOT NULL,
    "passengerPhone" TEXT,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "pickupLocation" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "flightNumber" TEXT,
    "passengers" INTEGER NOT NULL DEFAULT 1,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "charge" INTEGER,
    "chargeId" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "transport_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT,
    "roomId" TEXT,
    "guestId" TEXT,
    "type" "RequestType" NOT NULL,
    "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
    "description" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "MediaCategory" NOT NULL,
    "description" TEXT,
    "altText" TEXT NOT NULL,
    "url" TEXT,
    "fileId" TEXT,
    "roomTypeId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isIllustrative" BOOLEAN NOT NULL DEFAULT false,
    "creditText" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_content" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "site_content_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "room_assignments_reservationRoomId_idx" ON "room_assignments"("reservationRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_services_code_key" ON "hotel_services"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plateNumber_key" ON "vehicles"("plateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transport_trips_reference_key" ON "transport_trips"("reference");

-- CreateIndex
CREATE INDEX "transport_trips_pickupAt_idx" ON "transport_trips"("pickupAt");

-- CreateIndex
CREATE INDEX "transport_trips_status_idx" ON "transport_trips"("status");

-- CreateIndex
CREATE INDEX "transport_trips_driverId_pickupAt_idx" ON "transport_trips"("driverId", "pickupAt");

-- CreateIndex
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");

-- CreateIndex
CREATE INDEX "service_requests_reservationId_idx" ON "service_requests"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_fileId_key" ON "media_assets"("fileId");

-- CreateIndex
CREATE INDEX "media_assets_category_isActive_sortOrder_idx" ON "media_assets"("category", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "media_assets_roomTypeId_sortOrder_idx" ON "media_assets"("roomTypeId", "sortOrder");

-- AddForeignKey
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_reservationRoomId_fkey" FOREIGN KEY ("reservationRoomId") REFERENCES "reservation_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_fromRoomId_fkey" FOREIGN KEY ("fromRoomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_toRoomId_fkey" FOREIGN KEY ("toRoomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

