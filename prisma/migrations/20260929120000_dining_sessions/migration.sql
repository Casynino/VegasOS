-- CreateEnum
CREATE TYPE "DiningSessionStatus" AS ENUM ('ACTIVE', 'AWAITING_PAYMENT', 'PAID', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TableReservationStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "dining_sessions" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "DiningSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "locationId" TEXT NOT NULL,
    "openAtId" TEXT,
    "guestId" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "tableReservationId" TEXT,
    "businessDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedById" TEXT,
    "billRequestedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dining_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_session_members" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dining_session_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_seats" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dining_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_session_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "byId" TEXT,
    "byLabel" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dining_session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_moves" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "tableReservationId" TEXT,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "reason" TEXT,
    "byId" TEXT,
    "byLabel" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_reservations" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "TableReservationStatus" NOT NULL DEFAULT 'BOOKED',
    "locationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "reservedFor" TIMESTAMP(3) NOT NULL,
    "date" DATE NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "noShowAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dining_sessions_number_key" ON "dining_sessions"("number");

-- CreateIndex
CREATE UNIQUE INDEX "dining_sessions_openAtId_key" ON "dining_sessions"("openAtId");

-- CreateIndex
CREATE UNIQUE INDEX "dining_sessions_tableReservationId_key" ON "dining_sessions"("tableReservationId");

-- CreateIndex
CREATE INDEX "dining_sessions_locationId_startedAt_idx" ON "dining_sessions"("locationId", "startedAt");

-- CreateIndex
CREATE INDEX "dining_sessions_status_idx" ON "dining_sessions"("status");

-- CreateIndex
CREATE INDEX "dining_sessions_guestId_idx" ON "dining_sessions"("guestId");

-- CreateIndex
CREATE INDEX "dining_sessions_businessDate_idx" ON "dining_sessions"("businessDate");

-- CreateIndex
CREATE INDEX "dining_session_members_guestId_idx" ON "dining_session_members"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "dining_session_members_sessionId_guestId_key" ON "dining_session_members"("sessionId", "guestId");

-- CreateIndex
CREATE UNIQUE INDEX "dining_seats_tokenHash_key" ON "dining_seats"("tokenHash");

-- CreateIndex
CREATE INDEX "dining_seats_memberId_idx" ON "dining_seats"("memberId");

-- CreateIndex
CREATE INDEX "dining_session_events_sessionId_at_idx" ON "dining_session_events"("sessionId", "at");

-- CreateIndex
CREATE INDEX "table_moves_sessionId_idx" ON "table_moves"("sessionId");

-- CreateIndex
CREATE INDEX "table_moves_tableReservationId_idx" ON "table_moves"("tableReservationId");

-- CreateIndex
CREATE UNIQUE INDEX "table_reservations_reference_key" ON "table_reservations"("reference");

-- CreateIndex
CREATE INDEX "table_reservations_locationId_reservedFor_idx" ON "table_reservations"("locationId", "reservedFor");

-- CreateIndex
CREATE INDEX "table_reservations_date_status_idx" ON "table_reservations"("date", "status");

-- CreateIndex
CREATE INDEX "table_reservations_guestId_idx" ON "table_reservations"("guestId");

-- CreateIndex
CREATE INDEX "restaurant_orders_sessionId_idx" ON "restaurant_orders"("sessionId");

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dining_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "restaurant_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_openAtId_fkey" FOREIGN KEY ("openAtId") REFERENCES "restaurant_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_tableReservationId_fkey" FOREIGN KEY ("tableReservationId") REFERENCES "table_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_session_members" ADD CONSTRAINT "dining_session_members_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dining_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_session_members" ADD CONSTRAINT "dining_session_members_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_session_members" ADD CONSTRAINT "dining_session_members_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_seats" ADD CONSTRAINT "dining_seats_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "dining_session_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_session_events" ADD CONSTRAINT "dining_session_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dining_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_session_events" ADD CONSTRAINT "dining_session_events_byId_fkey" FOREIGN KEY ("byId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_moves" ADD CONSTRAINT "table_moves_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dining_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_moves" ADD CONSTRAINT "table_moves_tableReservationId_fkey" FOREIGN KEY ("tableReservationId") REFERENCES "table_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_moves" ADD CONSTRAINT "table_moves_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "restaurant_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_moves" ADD CONSTRAINT "table_moves_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "restaurant_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_moves" ADD CONSTRAINT "table_moves_byId_fkey" FOREIGN KEY ("byId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "restaurant_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Guards: an open session holds its own table (openAtId = locationId), and only open sessions hold one.
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_open_at_check"
  CHECK ("openAtId" IS NULL OR "openAtId" = "locationId");
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_open_status_check"
  CHECK (("openAtId" IS NOT NULL) = ("status" IN ('ACTIVE', 'AWAITING_PAYMENT', 'PAID')));
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_guest_count_check" CHECK ("guestCount" BETWEEN 1 AND 60);
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_guest_count_check" CHECK ("guestCount" BETWEEN 1 AND 60);

-- Open table orders from before sessions: one session per table (its latest customer), holding those orders.
INSERT INTO "dining_sessions" ("id", "number", "status", "locationId", "openAtId", "guestId", "guestCount", "source", "businessDate", "startedAt", "updatedAt")
SELECT 'ds_' || md5(t.lid || t.started::text), 'TS-' || to_char(t.started, 'YYYY') || '-' || lpad((row_number() OVER (ORDER BY t.started))::text, 4, '0'),
  'ACTIVE', t.lid, t.lid, t.guest, 1, 'ORDER', t.bdate, t.started, CURRENT_TIMESTAMP
FROM (
  SELECT o."locationId" AS lid, min(o."createdAt") AS started, min(o."businessDate") AS bdate,
    (array_agg(o."guestId" ORDER BY o."createdAt" DESC) FILTER (WHERE o."guestId" IS NOT NULL))[1] AS guest
  FROM "restaurant_orders" o JOIN "restaurant_locations" l ON l."id" = o."locationId"
  WHERE l."kind" = 'TABLE' AND o."type" = 'DINE_IN' AND o."status" NOT IN ('COMPLETED', 'COLLECTED', 'CANCELLED')
  GROUP BY o."locationId"
) t WHERE t.guest IS NOT NULL;

UPDATE "restaurant_orders" o SET "sessionId" = s."id"
FROM "dining_sessions" s
WHERE s."openAtId" = o."locationId" AND o."type" = 'DINE_IN' AND o."status" NOT IN ('COMPLETED', 'COLLECTED', 'CANCELLED');

INSERT INTO "dining_session_members" ("id", "sessionId", "guestId", "primary", "addedAt")
SELECT 'dm_' || md5(s."id"), s."id", s."guestId", true, s."startedAt" FROM "dining_sessions" s;

INSERT INTO "dining_session_events" ("id", "sessionId", "kind", "note", "byLabel", "at")
SELECT 'de_' || md5(s."id"), s."id", 'STARTED', 'Carried over from the open orders at the table', 'System', s."startedAt" FROM "dining_sessions" s;
