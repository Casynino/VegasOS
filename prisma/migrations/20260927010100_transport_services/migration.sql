-- Guest transport: its own income line, and the services the hotel offers with their prices (admin can change them).
INSERT INTO "revenue_categories" ("id", "code", "name", "kind", "sortOrder")
VALUES ('revcat_transport', 'TRANSPORT', 'Transport', 'TRANSPORT', 95)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "transport_services" ("id", "code", "name", "description", "type", "price", "isActive", "isPublic", "sortOrder", "updatedAt") VALUES
  ('trsvc_airport_pickup', 'AIRPORT_PICKUP', 'Airport pickup', 'From the airport to Vegas Luxury Hotel — our driver meets you at arrivals.', 'AIRPORT_PICKUP', 40000, true, true, 10, now()),
  ('trsvc_airport_dropoff', 'AIRPORT_DROPOFF', 'Airport drop-off', 'From the hotel to the airport, on time for your flight.', 'AIRPORT_DROPOFF', 40000, true, true, 20, now()),
  ('trsvc_meeting', 'MEETING', 'Meeting / business trip', 'From the hotel to your meeting in the city.', 'HOTEL_TRANSFER', 30000, true, true, 30, now()),
  ('trsvc_custom', 'CUSTOM', 'Custom trip', 'Anywhere you need to go — tell us where and when.', 'GUEST_TRANSPORT', 50000, true, true, 40, now())
ON CONFLICT ("code") DO NOTHING;

-- Transport charges already on guest bills count as transport income.
UPDATE "reservation_charges" SET "kind" = 'TRANSPORT' WHERE "category" = 'TRANSPORT' AND "kind" = 'OTHER';
