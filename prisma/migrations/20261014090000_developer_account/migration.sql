-- The Developer account (owner, 2026-10-14): a separate, clearly marked super-user identity for the developer, and an audit trail that
-- always says who it was. Additive: nothing is deleted, no existing right or role changes, no account is created here (the Developer
-- user is created only by the controlled setup script).

-- 1. The audit trail knows the TYPE of whoever acted (taken from the signed-in account when the entry is written).
ALTER TABLE "audit_logs" ADD COLUMN "actorType" TEXT, ADD COLUMN "actorRole" TEXT;
CREATE INDEX "audit_logs_actorType_createdAt_idx" ON "audit_logs" ("actorType", "createdAt");
-- What is already there is classified once: no Developer existed before this migration.
UPDATE "audit_logs" a SET "actorType" = CASE WHEN a."userId" IS NULL THEN CASE WHEN a."actorLabel" = 'website' THEN 'WEBSITE' ELSE 'SYSTEM' END ELSE 'STAFF' END,
  "actorRole" = (SELECT r."code" FROM "users" u JOIN "roles" r ON r."id" = u."roleId" WHERE u."id" = a."userId")
 WHERE a."actorType" IS NULL;

-- 2. The new rights.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_audit_view', 'audit.view', 'See the full audit trail: who did what, when, as a Developer or as staff (read-only; nobody can change or delete it)'),
  ('perm_developer_access', 'developer.access', 'Developer super user: the developer console and system diagnostics. Held only by the Developer role — never by the Boss, the MD or any staff role')
ON CONFLICT ("code") DO NOTHING;

-- 3. The Developer role: ONLY the rights written out below (DEVELOPER_ALLOWED + the developer-only right, src/lib/permissions.ts) —
--    an allow-list, so a right added in future is NOT given to the Developer until a person puts it in that list. Everything that
--    writes or decides about money (DEVELOPER_DENIED) is simply absent. A unit test checks that this list and the code are the same.
INSERT INTO "roles" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES ('role_developer', 'DEVELOPER', 'Developer (super user)',
  'The system''s developer: sees and troubleshoots every department, the settings, the staff accounts and the audit trail, with every action recorded as a Developer action. Cannot record, change, approve, pay, reverse or void money, decide what a guest or supplier owes, or change where guests pay or the money limits. Created only by a controlled setup — never from the Users page.',
  true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'DEVELOPER' AND p."code" IN (
  'dashboard.admin', 'dashboard.owner', 'dashboard.manager', 'dashboard.front_desk', 'dashboard.finance', 'dashboard.procurement',
  'reports.view', 'finance.view', 'ledger.view', 'invoices.view', 'corporate.view', 'expenses.view_all', 'cash.handover.view',
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.check_in', 'reservations.check_out', 'reservations.checkin_override',
  'guests.view', 'guests.manage', 'guests.delete',
  'rooms.view', 'rooms.status.update', 'rooms.manage', 'rooms.block',
  'meeting.view', 'meeting.manage',
  'hotel_qr.manage',
  'shifts.view', 'shifts.work', 'shifts.manage', 'staff.activity.view', 'users.manage', 'settings.manage',
  'contact.view', 'requests.view', 'requests.manage',
  'transport.view', 'transport.request', 'transport.manage', 'transport.driver',
  'website.manage', 'booking_requests.view', 'booking_requests.manage',
  'restaurant.orders', 'restaurant.serve', 'restaurant.shift', 'kitchen.orders', 'bar.orders',
  'inventory.view', 'inventory.request', 'inventory.use', 'assets.view', 'assets.manage',
  'audit.view', 'developer.access')
ON CONFLICT DO NOTHING;

-- 4. The Boss and the MD may read the full audit trail (so they can see every Developer action); they never receive the developer-only right.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'audit.view' WHERE r."code" IN ('OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;

-- 5. The audit trail cannot be edited or deleted — not by the application, not by a person with a query tool:
--    a row may only be inserted. Two narrow exceptions, both set inside a transaction on purpose: (a) a maintenance script or the app's
--    one "mark an earlier entry as cancelled" step sets vegas.audit_maintenance = 'on' for that transaction; (b) when a user row is
--    removed the database itself blanks the link to it (the entry keeps the name and the account type).
CREATE OR REPLACE FUNCTION "audit_logs_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('vegas.audit_maintenance', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."userId" IS NULL AND OLD."userId" IS NOT NULL
     AND (NEW."id", NEW."actorLabel", NEW."actorType", NEW."actorRole", NEW."action", NEW."entityType", NEW."entityId", NEW."before", NEW."after", NEW."ipAddress", NEW."businessDate", NEW."createdAt")
         IS NOT DISTINCT FROM
         (OLD."id", OLD."actorLabel", OLD."actorType", OLD."actorRole", OLD."action", OLD."entityType", OLD."entityId", OLD."before", OLD."after", OLD."ipAddress", OLD."businessDate", OLD."createdAt") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The audit trail cannot be changed or deleted.' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "audit_logs_no_change" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "audit_logs_guard"();
