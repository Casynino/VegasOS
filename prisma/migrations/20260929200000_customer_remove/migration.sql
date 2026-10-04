-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "deletedAt" TIMESTAMP(3);


-- Only admin, owner and manager change a customer's name or number, or remove a customer.
INSERT INTO "permissions" ("id", "code", "description")
VALUES ('perm_guests_delete', 'guests.delete', 'Change a customer''s name or phone number, and remove customers')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'guests.delete'
WHERE r."code" IN ('MANAGER', 'OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;
