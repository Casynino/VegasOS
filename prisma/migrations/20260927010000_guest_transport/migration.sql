-- AlterEnum
ALTER TYPE "RevenueKind" ADD VALUE 'TRANSPORT';

-- AlterEnum
ALTER TYPE "TripStatus" ADD VALUE 'NO_SHOW';

-- AlterTable
ALTER TABLE "revenue_transactions" ADD COLUMN     "transportTripId" TEXT;

-- AlterTable
ALTER TABLE "transport_trips" ADD COLUMN     "bags" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "driverPhone" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "passengerEmail" TEXT,
ADD COLUMN     "priceAdjustedAt" TIMESTAMP(3),
ADD COLUMN     "priceAdjustedById" TEXT,
ADD COLUMN     "priceReason" TEXT,
ADD COLUMN     "reservationRef" TEXT,
ADD COLUMN     "roomNumber" TEXT,
ADD COLUMN     "serviceId" TEXT,
ADD COLUMN     "standardPrice" INTEGER,
ADD COLUMN     "vehicleName" TEXT,
ADD COLUMN     "vehiclePlate" TEXT;

-- CreateTable
CREATE TABLE "transport_services" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "TripType" NOT NULL,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transport_services_code_key" ON "transport_services"("code");

-- AddForeignKey
ALTER TABLE "revenue_transactions" ADD CONSTRAINT "revenue_transactions_transportTripId_fkey" FOREIGN KEY ("transportTripId") REFERENCES "transport_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "transport_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_priceAdjustedById_fkey" FOREIGN KEY ("priceAdjustedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

