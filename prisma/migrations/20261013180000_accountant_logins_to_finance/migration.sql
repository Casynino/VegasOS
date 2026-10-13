-- Before the split (owner, 2026-10-13) the Accountant role held the money rights. Anyone who already has that login keeps
-- working exactly as before — they become Finance (the same rights, nothing added). Purchasing logins are made afterwards, as
-- Accountant, from Staff. Nothing is deleted; no one's rights widen.
UPDATE "users" SET "roleId" = (SELECT "id" FROM "roles" WHERE "code" = 'FINANCE')
WHERE "roleId" = (SELECT "id" FROM "roles" WHERE "code" = 'ACCOUNTANT')
  AND EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'FINANCE');
