import "server-only";
import { db, type Tx } from "./db";
import { getSettings, businessDayConfig } from "./settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import { Prisma } from "@/generated/prisma/client";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";

/** Who acted — always read from the signed-in account's role at the moment of writing, never from a page, a department or the caller. */
export type ActorType = "DEVELOPER" | "STAFF" | "SYSTEM" | "WEBSITE";

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

/** A key that holds a secret: its value is never written to the audit trail. */
const SECRET_KEY = /pass(word|wd|code)|secret|token|api[-_]?key|authorization|credential|cvv|^pin$|pinhash|private[-_]?key|cookie|bearer|(^|[^a-z])(otp|hash)([^a-z]|$)|[a-z]hash$/i;

/** The value as JSON, with every secret (passwords, tokens, keys, PINs…) replaced — the audit trail must never hold one. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[hidden]" : redact(v)]));
  }
  return value;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  // A BigInt cannot be written as JSON: it is kept as its digits (an audit entry must never fail because of one).
  return redact(JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))) as Prisma.InputJsonValue;
}

/** The type and role of whoever acted, from the account itself (its role in the database right now). */
export async function actorKind(tx: Tx | typeof db, actor: AuditActor): Promise<{ type: ActorType; role: string | null }> {
  if (!actor.userId) return { type: actor.label === "website" ? "WEBSITE" : "SYSTEM", role: null };
  const u = await tx.user.findUnique({ where: { id: actor.userId }, select: { role: { select: { code: true } } } });
  const role = u?.role.code ?? null;
  // The online-payment account is the system's own (it has no person behind it): its entries are the system's, not a staff member's.
  return { type: role === DEVELOPER_ROLE_CODE ? "DEVELOPER" : role === "SYSTEM_ONLINE" ? "SYSTEM" : "STAFF", role };
}

/**
 * Record an audit entry. Pass the transaction client so the audit row commits
 * or rolls back together with the change it describes.
 */
export async function audit(tx: Tx | typeof db, actor: AuditActor, entry: AuditEntry): Promise<void> {
  const settings = await getSettings();
  const now = new Date();
  const kind = await actorKind(tx, actor);
  await tx.auditLog.create({
    data: {
      userId: actor.userId ?? null,
      actorLabel: actor.label ?? null,
      actorType: kind.type,
      actorRole: kind.role,
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
