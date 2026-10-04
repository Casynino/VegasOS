-- Waiter numbers (owner, 2026-10-04): WTR-001, WTR-002… in the order waiters were added. The old 4-character
-- waiter IDs (no longer used) are cleared first.
UPDATE "users" SET "staffCode" = NULL WHERE "staffCode" IS NOT NULL AND "staffCode" !~ '^WTR-[0-9]+$';

WITH waiter AS (
  SELECT u."id", ROW_NUMBER() OVER (ORDER BY u."createdAt", u."id") AS rn
    FROM "users" u
   WHERE u."staffCode" IS NULL
     AND EXISTS (SELECT 1 FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId" WHERE rp."roleId" = u."roleId" AND p."code" = 'restaurant.shift')
     AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId" WHERE rp."roleId" = u."roleId"
                     AND p."code" IN ('restaurant.device', 'dashboard.manager', 'dashboard.owner', 'dashboard.admin'))
), base AS (
  SELECT COALESCE(MAX(CAST(SUBSTRING("staffCode" FROM 5) AS INTEGER)), 0) AS m FROM "users" WHERE "staffCode" ~ '^WTR-[0-9]+$'
)
UPDATE "users" u SET "staffCode" = 'WTR-' || LPAD((base.m + waiter.rn)::text, 3, '0') FROM waiter, base WHERE u."id" = waiter."id";
