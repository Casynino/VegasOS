-- Waiters never record expenses (owner, 2026-10-04): the Waiter role loses expenses.record.
DELETE FROM "role_permissions"
 WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'RESTAURANT')
   AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = 'expenses.record');

UPDATE "roles" SET "description" = 'Waiter: serves customers — makes their orders, serves them, adds items, shows the bill, texts customers. Payments are recorded at the Restaurant Counter. No expenses.'
 WHERE "code" = 'RESTAURANT';
