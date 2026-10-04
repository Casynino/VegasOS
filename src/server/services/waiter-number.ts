import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";

/**
 * Every waiter has a number — WTR-001, WTR-002… — shown beside their name wherever a waiter is picked
 * (the Counter, transfers, managers), so two with the same first name are never confused. Given in the
 * order waiters were added, once; never reused. A waiter = a role that works waiter shifts (not the
 * shared Counter account, not management).
 */
const NUMBER_WAITERS = `
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
  UPDATE "users" u SET "staffCode" = 'WTR-' || LPAD((base.m + waiter.rn)::text, 3, '0') FROM waiter, base WHERE u."id" = waiter."id"`;

/** Give a number to every waiter who has none yet (one at a time across the system). */
export async function numberWaitersTx(tx: Prisma.TransactionClient | typeof db) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('waiter-numbers'))`);
  await tx.$executeRawUnsafe(NUMBER_WAITERS);
}
