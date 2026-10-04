-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staffCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_staffCode_key" ON "users"("staffCode");


-- Every waiter (a role that serves in the restaurant — not the shared screen, not management) gets a short ID:
-- two letters from their name + two digits, unique (e.g. "JU11").
WITH w AS (
  SELECT u.id,
    upper(
      left(regexp_replace(split_part(regexp_replace(u."fullName", '\s*\(.*\)', ''), ' ', 1), '[^A-Za-z]', '', 'g'), 1) ||
      coalesce(
        nullif(left(regexp_replace(split_part(regexp_replace(u."fullName", '\s*\(.*\)', ''), ' ', 2), '[^A-Za-z]', '', 'g'), 1), ''),
        substr(regexp_replace(u."fullName", '[^A-Za-z]', '', 'g'), 2, 1)
      )
    ) AS prefix
  FROM "users" u
  WHERE u."staffCode" IS NULL
    AND EXISTS (SELECT 1 FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId" WHERE rp."roleId" = u."roleId" AND p."code" = 'restaurant.serve')
    AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId" WHERE rp."roleId" = u."roleId" AND p."code" IN ('restaurant.device', 'dashboard.manager', 'dashboard.owner', 'dashboard.admin'))
), n AS (
  SELECT id, prefix, row_number() OVER (PARTITION BY prefix ORDER BY id) AS k FROM w WHERE length(prefix) = 2
)
UPDATE "users" SET "staffCode" = n.prefix || lpad((10 + n.k)::text, 2, '0') FROM n WHERE "users"."id" = n.id AND n.k <= 89;
