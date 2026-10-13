-- The Accountant gets full control of the money (owner, 2026-10-13): record payments and sales, withdraw from nTZS,
-- make and send the daily reports, change restaurant prices — plus read-only views of shifts, stock and assets.
-- One new right (restaurant.prices: the price of a menu item and nothing else). Additive only.
INSERT INTO "permissions" ("id", "code", "description")
VALUES ('perm_restaurant_prices', 'restaurant.prices', 'Change the selling prices of menu items (Accountant) — nothing else on the menu; each order keeps the price it was placed at')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN
  ('reports.daily.manage', 'payments.record', 'revenue.record', 'withdrawals.manage', 'restaurant.prices', 'shifts.view', 'inventory.view', 'assets.view')
WHERE r."code" = 'ACCOUNTANT'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'restaurant.prices'
WHERE r."code" IN ('OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;
