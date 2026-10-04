import "server-only";
import { db, type Tx } from "./db";
import { getSettings, businessDayConfig } from "./settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import { Prisma } from "@/generated/prisma/client";

export interface AuditActor {
  userId?: string | null;
  label?: string; // "website", "system", or user name snapshot
  ipAddress?: string | null;
}

export interface AuditEntry {
  action: string; // e.g. "reservation.created"
  entityType: string; // e.g. "Reservation"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Record an audit entry. Pass the transaction client so the audit row commits
 * or rolls back together with the change it describes.
 */
export async function audit(tx: Tx | typeof db, actor: AuditActor, entry: AuditEntry): Promise<void> {
  const settings = await getSettings();
  const now = new Date();
  await tx.auditLog.create({
    data: {
      userId: actor.userId ?? null,
      actorLabel: actor.label ?? null,
      ipAddress: actor.ipAddress ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      businessDate: toDbDate(businessDateOf(now, businessDayConfig(settings))),
      createdAt: now,
    },
  });
}
