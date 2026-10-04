-- AlterTable
ALTER TABLE "restaurant_order_items" ADD COLUMN     "discountAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "discountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountById" TEXT,
ADD COLUMN     "discountReason" TEXT;

-- AlterTable
ALTER TABLE "room_nights" ADD COLUMN     "compById" TEXT,
ADD COLUMN     "compReason" TEXT,
ADD COLUMN     "complimentary" BOOLEAN NOT NULL DEFAULT false;

