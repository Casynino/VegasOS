-- The meeting room holds up to 10 people (hotel, 2026-09-27).
UPDATE "room_types" SET "maxAdults" = 10, "updatedAt" = now() WHERE "code" = 'MEETING_ROOM';
