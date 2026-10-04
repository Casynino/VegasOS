-- Stock requests are the restaurant's (owner, 2026-10-04): the Receptionist role loses inventory.request;
-- the Manager role keeps it (given here in case it only had it through reception's list).
DELETE FROM "role_permissions"
 WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'RECEPTIONIST')
   AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = 'inventory.request');

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
 WHERE r."code" = 'MANAGER' AND p."code" = 'inventory.request'
ON CONFLICT DO NOTHING;
