-- Room-service delivery fees are their own income line (a new enum value must be used in a later migration).
INSERT INTO "revenue_categories" ("id", "code", "name", "kind", "sortOrder")
VALUES ('revcat_room_service', 'ROOM_SERVICE', 'Room service fee', 'ROOM_SERVICE', 90)
ON CONFLICT ("code") DO NOTHING;
