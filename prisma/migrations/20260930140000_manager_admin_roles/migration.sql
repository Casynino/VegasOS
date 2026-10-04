-- Manager = hotel operations authority; Admin (MD) = business and system authority.
-- Managers keep every operational power (monitor, decide, intervene, stock, bookings, orders);
-- set-up moves to the Admin: rooms and room types, the menu and prices, tables and QR codes,
-- restaurant order sounds. (Expense types and suppliers are checked against Admin permissions in code.)
DELETE FROM "role_permissions"
WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "code" = 'MANAGER')
  AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('rooms.manage', 'restaurant.menu'));

UPDATE "permissions" SET "description" = 'Room set-up (Admin): add and edit rooms, room types, amenities and room QR cards' WHERE "code" = 'rooms.manage';
UPDATE "permissions" SET "description" = 'Restaurant set-up (Admin): menu, prices, categories, photos, tables, restaurant QR codes and order sounds' WHERE "code" = 'restaurant.menu';

UPDATE "roles" SET "description" = 'Business and system authority: everything the Manager does, plus staff and access, configuration (rooms, menu, tables, inventory structure), pricing, payment accounts, settings and audit.' WHERE "code" = 'ADMIN';
UPDATE "roles" SET "description" = 'Hotel operations authority: runs and supervises the hotel every day — monitors every department, makes operational decisions and steps in; staff do the routine work.' WHERE "code" = 'MANAGER';
UPDATE "roles" SET "description" = 'Business authority: receives the reports, reviews performance and makes the high-level decisions; does not run the hotel day to day.' WHERE "code" = 'OWNER';
