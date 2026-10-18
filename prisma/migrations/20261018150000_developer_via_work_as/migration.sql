-- The hotel's own work is not the Developer's (owner, 2026-10-18): checking a guest in, taking an order, starting a shift, answering a
-- request, moving a room or using stock is Reception's, the kitchen's and the managers' work. The Developer's job is to see what is wrong in the
-- SYSTEM and what to fix; he reaches the hotel's work only by "Work as" a person, which hands him THAT PERSON'S rights (minus money), is audited
-- and is told to the Boss every time. So the Developer role no longer holds the rights below (DEVELOPER_BY_WORK_AS, src/lib/permissions.ts).
--
-- Only the DEVELOPER role's grants are removed. No other role, no user, no hotel record and no audit row is touched. It looks at everything
-- exactly as before (every "...view" right stays), so the console, Business and Audit pages are unchanged.
DELETE FROM "role_permissions"
WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'DEVELOPER')
  AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" IN (
  'reservations.create', 'reservations.edit', 'reservations.check_in', 'reservations.check_out', 'reservations.checkin_override',
  'guests.manage', 'guests.delete', 'rooms.status.update', 'rooms.manage', 'rooms.block', 'meeting.manage', 'hotel_qr.manage',
  'shifts.work', 'shifts.manage', 'requests.manage', 'transport.request', 'transport.manage', 'transport.driver', 'website.manage',
  'booking_requests.manage', 'restaurant.orders', 'restaurant.serve', 'restaurant.shift', 'kitchen.orders', 'bar.orders',
  'inventory.request', 'inventory.use', 'assets.manage'
  ));
