-- Waiters have no stores (owner, 2026-10-04): the Waiter role loses inventory.view, inventory.use and inventory.request.
-- Stock still comes off by the recipes when orders are marked ready (no permission involved).
DELETE FROM "role_permissions"
 WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'RESTAURANT')
   AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('inventory.view', 'inventory.use', 'inventory.request'));
