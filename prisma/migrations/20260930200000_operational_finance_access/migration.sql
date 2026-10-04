-- Reception and waiters record and see operational money (Income & Expenses). The general ledger and
-- the accounts (balances, transfers, the accounting layer) stay with managers and the MD.
DELETE FROM "role_permissions" rp USING "roles" r, "permissions" p
WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  AND r."code" IN ('RECEPTIONIST', 'RESTAURANT', 'KITCHEN', 'DRIVER') AND p."code" IN ('ledger.view', 'finance.view', 'finance.manage');

-- Reception keeps seeing every expense (it did through the ledger right before).
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'expenses.view_all' WHERE r."code" = 'RECEPTIONIST'
ON CONFLICT DO NOTHING;

-- Waiters record the expenses they pay out (their own list).
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'expenses.record' WHERE r."code" = 'RESTAURANT'
ON CONFLICT DO NOTHING;

-- Managers keep the ledger (it came to them with reception's rights).
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'ledger.view' WHERE r."code" IN ('MANAGER', 'ADMIN', 'OWNER')
ON CONFLICT DO NOTHING;
