-- The owner's call: reception and waiters (like managers and admin) see, edit and remove customers
-- freely. The Mpishi (KITCHEN) and drivers do not.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('guests.view', 'guests.manage', 'guests.delete')
WHERE r."code" IN ('RECEPTIONIST', 'RESTAURANT', 'MANAGER', 'OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;
