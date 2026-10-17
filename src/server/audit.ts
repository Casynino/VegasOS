import "server-only";
import { db, workAsOfRequest, type Tx } from "./db";
import { getSettings, businessDayConfig } from "./settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import { Prisma } from "@/generated/prisma/client";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { withActingAs, workAsLabel } from "./work-as-session";

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
 * WORK AS (owner, 2026-10-17): when this request is a Developer working as a staff member and the entry says that staff member acted, the
 * entry is written as what really happened — the DEVELOPER acted: their id, the label "Nino (Developer) as Neema (Receptionist)", and
 * after.actingAs = who they were acting as. The hotel's own records (who checked a guest in) still carry the staff member's id; only the
 * audit trail tells the whole truth. Read from the request's own session (never from an argument), so an entry written by anyone else in
 * the same moment — or in a job, a webhook, the person's own browser — is never touched.
 */
async function asWhoReallyActed(actor: AuditActor, entry: AuditEntry): Promise<{ actor: AuditActor; entry: AuditEntry }> {
  if (!actor.userId) return { actor, entry };
  const state = await workAsOfRequest();
  if (!state || state.targetId !== actor.userId) return { actor, entry };
  return {
    actor: { ...actor, userId: state.developerId, label: workAsLabel(state.developerName, state.targetName, state.targetRoleName) },
    entry: { ...entry, after: withActingAs(entry.after, { id: state.targetId, name: state.targetName, role: state.targetRoleName }) },
  };
}

/**
 * Record an audit entry. Pass the transaction client so the audit row commits
 * or rolls back together with the change it describes.
 */
export async function audit(tx: Tx | typeof db, actorAsGiven: AuditActor, entryAsGiven: AuditEntry): Promise<void> {
  const settings = await getSettings();
  const now = new Date();
  const { actor, entry } = await asWhoReallyActed(actorAsGiven, entryAsGiven);
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
