-- AlterEnum
ALTER TYPE "MediaCategory" ADD VALUE 'BATHROOMS';

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;

