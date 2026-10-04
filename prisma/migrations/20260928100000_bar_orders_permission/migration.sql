-- Drinks-only orders are prepared by the waiters (the bar); the kitchen prepares food and food + drinks.
INSERT INTO "permissions" ("id", "code", "description")
VALUES ('perm_bar_orders', 'bar.orders', 'Restaurant portal as the bar: accept, prepare and mark drinks-only orders ready')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'bar.orders'
WHERE r."code" IN ('RESTAURANT', 'MANAGER', 'OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;

UPDATE "permissions" SET "description" = 'Restaurant portal as the cook (Mpishi): accept, prepare and mark food orders ready; take orders' WHERE "code" = 'kitchen.orders';
