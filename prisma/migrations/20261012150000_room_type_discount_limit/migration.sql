-- A room type can have its own staff discount limit. Empty = the hotel's limit (hotel_settings.manualDiscountMax),
-- so every room keeps the limit it has today. Who may give a discount at all is unchanged.

-- AlterTable
ALTER TABLE "room_types" ADD COLUMN     "manualDiscountMax" INTEGER;

-- The Twin room (TZS 160,000 a night): staff may take up to TZS 40,000 off a night.
UPDATE "room_types" SET "manualDiscountMax" = 40000 WHERE "slug" = 'twin';
