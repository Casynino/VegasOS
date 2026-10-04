-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "meetingEndAt" TIMESTAMP(3),
ADD COLUMN     "meetingStartAt" TIMESTAMP(3);


-- Meeting room photos (labelled illustrative on the website until the hotel adds its own).
UPDATE "room_types" SET "images" = '["/images/illustrative/meeting-boardroom.webp","/images/illustrative/meeting-long-table.webp","/images/illustrative/meeting-city-view.webp","/images/illustrative/meeting-room.webp","/images/illustrative/meeting-screen.webp","/images/illustrative/meeting-chairs.webp"]'::jsonb
WHERE "code" = 'MEETING_ROOM' AND "images" = '[]'::jsonb;
