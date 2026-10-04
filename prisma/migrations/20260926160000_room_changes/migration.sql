-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "roomDowngradePolicy" TEXT NOT NULL DEFAULT 'CHOOSE';

-- AlterTable
ALTER TABLE "room_assignments" ADD COLUMN     "charged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "compensation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "effectiveDate" DATE,
ADD COLUMN     "fromTypeName" TEXT,
ADD COLUMN     "newStandardPrice" INTEGER,
ADD COLUMN     "nights" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "oldPrice" INTEGER,
ADD COLUMN     "oldRoomStatus" TEXT,
ADD COLUMN     "reasonCode" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "toTypeName" TEXT;

