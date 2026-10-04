-- Reception's money is the guests' payments and its Collections (owner, 2026-10-04): Income and Expenses
-- belong to managers and the MD. The Receptionist role loses expenses.record and expenses.view_all;
-- the Manager role keeps both (given here in case it only had them through reception's list).
DELETE FROM "role_permissions"
 WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'RECEPTIONIST')
   AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('expenses.record', 'expenses.view_all'));

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
 WHERE r."code" = 'MANAGER' AND p."code" IN ('expenses.record', 'expenses.view_all')
ON CONFLICT DO NOTHING;
