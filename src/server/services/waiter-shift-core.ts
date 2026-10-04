import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "../audit";
import { getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import type { Actor } from "./reservations";

/**
 * A WAITER'S SHIFT — the low-level pieces shared by the order engine, the tables and the waiter's
 * own shift controls. Every waiter has their own (several at once; reception stays one desk).
 */

type Tx = Prisma.TransactionClient;

/** One waiter at a time: taking work, receiving it and closing the shift wait for each other. */
export async function lockWaiterTx(tx: Tx, ...userIds: (string | null | undefined)[]) {
  for (const id of [...new Set(userIds.filter((x): x is string => !!x))].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`waiter-shift:${id}`}))::text`;
}

/** The waiter's open restaurant shift, if any. */
export const openWaiterShiftTx = (tx: Tx, userId: string) => tx.actualShift.findFirst({ where: { userId, endedAt: null, department: "RESTAURANT" } });

/** Taking work starts the waiter's shift when it is not running yet — recorded like any start. */
export async function ensureWaiterShiftTx(tx: Tx, userId: string, actor: Actor, now: Date, why: string) {
  await lockWaiterTx(tx, userId);
  const open = await tx.actualShift.findFirst({ where: { userId, endedAt: null } });
  if (open) return open;
  const settings = await getSettingsTx(tx);
  const shift = await tx.actualShift.create({ data: { department: "RESTAURANT", businessDate: toDbDate(businessDateOf(now, stayConfig(settings))), userId, startedAt: now } });
  await audit(tx, actor, { action: "shift.started", entityType: "ActualShift", entityId: shift.id, after: { department: "RESTAURANT", waiterId: userId, started: why } });
  return shift;
}
