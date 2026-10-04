-- CreateEnum
CREATE TYPE "BookingRequestStatus" AS ENUM ('NEW', 'REVIEWING', 'CONTACTED', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "BookingRequestEventType" AS ENUM ('SUBMITTED', 'STATUS_CHANGED', 'CONTACTED', 'NOTE', 'ASSIGNED', 'CUSTOMER_LINKED', 'CONVERTED');

-- CreateTable
CREATE TABLE "booking_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "manageToken" TEXT NOT NULL,
    "status" "BookingRequestStatus" NOT NULL DEFAULT 'NEW',
    "sourceId" TEXT NOT NULL,
    "guestId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "nationality" TEXT,
    "checkInDate" DATE NOT NULL,
    "checkOutDate" DATE NOT NULL,
    "expectedArrivalTime" TEXT,
    "roomTypeId" TEXT NOT NULL,
    "requestedRoomId" TEXT,
    "roomCount" INTEGER NOT NULL DEFAULT 1,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "specialRequests" TEXT,
    "notes" TEXT,
    "transportRequested" BOOLEAN NOT NULL DEFAULT false,
    "transportDetails" JSONB,
    "estimatedNet" INTEGER,
    "assignedToId" TEXT,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "reservationId" TEXT,
    "rejectionReason" TEXT,
    "holdExpiresAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_request_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "BookingRequestEventType" NOT NULL,
    "fromStatus" "BookingRequestStatus",
    "toStatus" "BookingRequestStatus",
    "note" TEXT,
    "contactedAt" TIMESTAMP(3),
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_requests_reference_key" ON "booking_requests"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "booking_requests_manageToken_key" ON "booking_requests"("manageToken");

-- CreateIndex
CREATE UNIQUE INDEX "booking_requests_reservationId_key" ON "booking_requests"("reservationId");

-- CreateIndex
CREATE INDEX "booking_requests_status_createdAt_idx" ON "booking_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "booking_requests_phone_idx" ON "booking_requests"("phone");

-- CreateIndex
CREATE INDEX "booking_requests_checkInDate_idx" ON "booking_requests"("checkInDate");

-- CreateIndex
CREATE INDEX "booking_requests_businessDate_idx" ON "booking_requests"("businessDate");

-- CreateIndex
CREATE INDEX "booking_request_events_requestId_createdAt_idx" ON "booking_request_events"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "booking_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_requestedRoomId_fkey" FOREIGN KEY ("requestedRoomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request_events" ADD CONSTRAINT "booking_request_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "booking_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request_events" ADD CONSTRAINT "booking_request_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

