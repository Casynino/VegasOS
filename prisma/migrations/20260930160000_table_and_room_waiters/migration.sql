-- AlterTable
ALTER TABLE "restaurant_locations" ADD COLUMN     "waiterId" TEXT;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "serviceWaiterId" TEXT;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_serviceWaiterId_fkey" FOREIGN KEY ("serviceWaiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

