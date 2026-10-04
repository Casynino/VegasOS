-- A role for kitchen / bar staff: orders and till payments only.
INSERT INTO "roles" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES ('role_restaurant', 'RESTAURANT', 'Restaurant & bar staff', 'Takes restaurant, bar and room-service orders and moves them through the kitchen.', true, now(), now())
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
  SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('restaurant.orders', 'revenue.record') WHERE r."code" = 'RESTAURANT'
ON CONFLICT DO NOTHING;
