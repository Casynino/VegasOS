-- DropForeignKey
ALTER TABLE "restaurant_orders" DROP CONSTRAINT "restaurant_orders_createdById_fkey";

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'STAFF',
ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

