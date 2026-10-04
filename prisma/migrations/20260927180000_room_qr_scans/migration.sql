-- DropForeignKey
ALTER TABLE "stay_access_sessions" DROP CONSTRAINT "stay_access_sessions_guestId_fkey";

-- DropForeignKey
ALTER TABLE "stay_access_sessions" DROP CONSTRAINT "stay_access_sessions_reservationId_fkey";

-- DropForeignKey
ALTER TABLE "stay_access_sessions" DROP CONSTRAINT "stay_access_sessions_roomId_fkey";

-- AlterTable
ALTER TABLE "room_qr_codes" ADD COLUMN     "lastScannedAt" TIMESTAMP(3),
ADD COLUMN     "scanCount" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "stay_access_sessions";

