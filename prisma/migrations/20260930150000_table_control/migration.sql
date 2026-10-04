-- AlterTable
ALTER TABLE "dining_sessions" ADD COLUMN     "waiterId" TEXT;

-- AlterTable
ALTER TABLE "restaurant_locations" ADD COLUMN     "blockedAs" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "blockedReason" TEXT;

-- AddForeignKey
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

