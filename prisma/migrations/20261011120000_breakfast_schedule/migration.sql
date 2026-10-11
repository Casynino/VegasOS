-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "breakfastDays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
ADD COLUMN     "breakfastEndMinutes" INTEGER NOT NULL DEFAULT 630,
ADD COLUMN     "breakfastLocation" TEXT,
ADD COLUMN     "breakfastNote" TEXT,
ADD COLUMN     "breakfastStartMinutes" INTEGER NOT NULL DEFAULT 360;

