-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('ALL', 'ROOM_TYPES', 'ROOMS');

-- CreateEnum
CREATE TYPE "PromotionChannel" AS ENUM ('ALL', 'WEBSITE', 'STAFF');

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "managerCanDiscount" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "manualDiscountMax" INTEGER NOT NULL DEFAULT 20000,
ADD COLUMN     "receptionCanDiscount" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "reservation_rooms" ADD COLUMN     "promoDiscountPerNight" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "promotionName" TEXT;

-- AlterTable
ALTER TABLE "room_nights" ADD COLUMN     "manualDiscount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promoDiscount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "promotionName" TEXT;

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "value" INTEGER NOT NULL,
    "scope" "PromotionScope" NOT NULL DEFAULT 'ALL',
    "roomTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roomIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel" "PromotionChannel" NOT NULL DEFAULT 'ALL',
    "startDate" DATE,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_isActive_startDate_endDate_idx" ON "promotions"("isActive", "startDate", "endDate");


-- Data: existing nights keep their prices; their discount was the booking's own (manual/standard) discount.
UPDATE "room_nights" SET "manualDiscount" = "discountAmount";

-- Data: the old "standard website discount" setting becomes a website-only promotion,
-- so online prices stay exactly as they are today.
INSERT INTO "promotions" ("id", "name", "type", "value", "scope", "channel", "isActive", "createdAt", "updatedAt")
SELECT 'promo_website_standard', 'Website price', 'FIXED', "defaultDiscountPerNight", 'ALL', 'WEBSITE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "hotel_settings"
WHERE "id" = 1 AND "applyDiscountToWebsite" = true AND "defaultDiscountPerNight" > 0;
