-- New photos supplied by the owner (2026-10-05): the building, rooms, room details, bathrooms and the meeting room.
-- They join the Media library (Staff → Website), so the gallery and every page that reads it show them. Fixed ids, so
-- running twice changes nothing; nothing existing is changed or removed.
INSERT INTO "media_assets" ("id", "title", "category", "altText", "url", "roomTypeId", "sortOrder", "isFeatured", "isActive", "isIllustrative", "width", "height", "updatedAt") VALUES
  ('media_photo_exterior_03', 'Hotel exterior', 'EXTERIOR', 'The yellow façade and entrance gate of Vegas Luxury Hotel', '/images/exterior/exterior-03.webp', NULL, -3, true, true, false, 960, 1280, CURRENT_TIMESTAMP),
  ('media_photo_exterior_04', 'Hotel exterior', 'EXTERIOR', 'Balconies of Vegas Luxury Hotel against a blue sky', '/images/exterior/exterior-04.webp', NULL, -2, true, true, false, 853, 1280, CURRENT_TIMESTAMP),
  ('media_photo_room_red_08', 'Guest room', 'ROOMS', 'Guest room with a king bed, red runner, sofa and a floor-to-ceiling window', '/images/room-red/room-red-08.webp', NULL, -1, true, true, false, 1125, 2000, CURRENT_TIMESTAMP),
  ('media_photo_room_red_09', 'Guest room', 'ROOMS', 'Bed dressed with Vegas Luxury Hotel cushions and a red runner', '/images/room-red/room-red-09.webp', NULL, 203, false, true, false, 2000, 1333, CURRENT_TIMESTAMP),
  ('media_photo_room_red_10', 'Guest room', 'ROOMS', 'The bed reflected in the room''s oval mirror', '/images/room-red/room-red-10.webp', NULL, 204, false, true, false, 1333, 2000, CURRENT_TIMESTAMP),
  ('media_photo_amenity_02', 'Room details', 'ROOMS', 'Sofa, oval mirror and a hotel bathrobe', '/images/amenity/amenity-02.webp', NULL, 205, false, true, false, 2000, 1333, CURRENT_TIMESTAMP),
  ('media_photo_amenity_03', 'Room details', 'ROOMS', 'Desk, kettle, mini fridge and room phone', '/images/amenity/amenity-03.webp', NULL, 206, false, true, false, 2000, 1333, CURRENT_TIMESTAMP),
  ('media_photo_amenity_04', 'Room details', 'ROOMS', 'Lounge sofa beside a tall oval mirror', '/images/amenity/amenity-04.webp', NULL, 207, false, true, false, 2000, 1333, CURRENT_TIMESTAMP),
  ('media_photo_bath_17', 'Bathroom', 'BATHROOMS', 'Washbasin with a round black mirror', '/images/bath/bath-17.webp', NULL, 208, false, true, false, 2000, 1333, CURRENT_TIMESTAMP),
  ('media_photo_bath_18', 'Bathroom', 'BATHROOMS', 'Wave-tiled bathroom with fresh towels', '/images/bath/bath-18.webp', NULL, 209, false, true, false, 2000, 1333, CURRENT_TIMESTAMP),
  ('media_photo_bath_19', 'Bathroom', 'BATHROOMS', 'Bathroom with a bathtub and shower', '/images/bath/bath-19.webp', NULL, 210, false, true, false, 2000, 1333, CURRENT_TIMESTAMP),
  ('media_photo_meeting_01', 'Meeting room', 'MEETING_ROOM', 'Vegas Luxury Hotel meeting room with a U-shaped boardroom table', '/images/meeting/meeting-01.webp', (SELECT "id" FROM "room_types" WHERE "code" = 'MEETING_ROOM' LIMIT 1), 211, false, true, false, 1280, 853, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- The meeting room's own photo leads its gallery (the stock photos stay after it).
UPDATE "room_types"
SET "images" = '["/images/meeting/meeting-01.webp"]'::jsonb || COALESCE("images", '[]'::jsonb)
WHERE "code" = 'MEETING_ROOM' AND NOT (COALESCE("images", '[]'::jsonb) @> '["/images/meeting/meeting-01.webp"]'::jsonb);
