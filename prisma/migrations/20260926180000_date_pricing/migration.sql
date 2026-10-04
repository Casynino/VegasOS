-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "dateChangeExcessPolicy" TEXT NOT NULL DEFAULT 'NO_REFUND',
ADD COLUMN     "dateChangePayNow" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN     "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "room_nights" ADD COLUMN     "priceRuleId" TEXT,
ADD COLUMN     "priceRuleName" TEXT;

-- CreateTable
CREATE TABLE "price_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "PromotionScope" NOT NULL DEFAULT 'ROOM_TYPES',
    "roomTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roomIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "priority" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_rules_isActive_startDate_endDate_idx" ON "price_rules"("isActive", "startDate", "endDate");


-- Priorities follow the old "most specific wins" order: a room's own > its room type's > all rooms.
UPDATE "promotions" SET "priority" = CASE "scope" WHEN 'ROOMS' THEN 30 WHEN 'ROOM_TYPES' THEN 20 ELSE 10 END;
