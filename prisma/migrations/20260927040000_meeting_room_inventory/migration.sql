-- Meeting Room 102 becomes real room inventory: booked through the same reservations,
-- folio, payments and reports as the guest rooms. The old separate meeting-room booking
-- tables are removed — stop here rather than lose any booking made in them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "meeting_room_bookings") THEN
    RAISE EXCEPTION 'meeting_room_bookings has rows: move them to reservations before this migration';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "RoomCategory" AS ENUM ('GUEST_ROOM', 'MEETING_ROOM');

-- DropForeignKey
ALTER TABLE "meeting_room_bookings" DROP CONSTRAINT "meeting_room_bookings_corporateCustomerId_fkey";

-- DropForeignKey
ALTER TABLE "meeting_room_bookings" DROP CONSTRAINT "meeting_room_bookings_createdById_fkey";

-- DropForeignKey
ALTER TABLE "meeting_room_bookings" DROP CONSTRAINT "meeting_room_bookings_meetingRoomId_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_meetingBookingId_fkey";

-- DropIndex
DROP INDEX "payments_meetingBookingId_idx";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "meetingBookingId";

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "companyName" TEXT;

-- AlterTable
ALTER TABLE "room_types" ADD COLUMN     "category" "RoomCategory" NOT NULL DEFAULT 'GUEST_ROOM';

-- DropTable
DROP TABLE "meeting_room_bookings";

-- DropTable
DROP TABLE "meeting_rooms";

-- DropEnum
DROP TYPE "MeetingBookingStatus";



-- Meeting Room: a configurable room type (price stored here, changed in Settings → Pricing).
INSERT INTO "room_types" ("id", "code", "name", "slug", "category", "baseRate", "maxAdults", "maxChildren", "bedType", "shortDescription", "description", "images", "isActive", "isPublic", "sortOrder", "updatedAt")
VALUES ('rt_meeting_room', 'MEETING_ROOM', 'Meeting Room', 'meeting-room', 'MEETING_ROOM', 100000, 30, 0, NULL,
  'A private room for meetings, workshops and interviews — booked by the hour block.',
  'A private, air-conditioned meeting room for board meetings, workshops, interviews and small conferences, with Wi-Fi and refreshments from our restaurant and bar.',
  '[]', true, true, 6, now())
ON CONFLICT ("code") DO UPDATE SET "category" = 'MEETING_ROOM';

-- Room 102 is the meeting room (it was kept out of the guest-room list until now).
INSERT INTO "rooms" ("id", "number", "roomTypeId", "floor", "status", "isActive", "statusChangedAt", "updatedAt")
VALUES ('room_102', '102', (SELECT "id" FROM "room_types" WHERE "code" = 'MEETING_ROOM'), 1, 'AVAILABLE', true, now(), now())
ON CONFLICT ("number") DO UPDATE SET
  "roomTypeId" = (SELECT "id" FROM "room_types" WHERE "code" = 'MEETING_ROOM'),
  "isActive" = true, "status" = 'AVAILABLE', "statusNote" = NULL, "statusChangedAt" = now(), "updatedAt" = now();
