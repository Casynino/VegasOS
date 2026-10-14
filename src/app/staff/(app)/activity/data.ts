import "server-only";
import { db } from "@/server/db";
import { redact, type ActorType } from "@/server/audit";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { toDbDate } from "@/lib/time/business-date";
import { DEVELOPER_ROWS, seesDeveloperActions, type AuditViewer } from "@/server/services/audit-trail";
import type { Prisma } from "@/generated/prisma/client";

/**
 * What the older "Staff activity" page reads (owner, 2026-10-14). The same rule as the Audit trail page: whoever holds "audit.view"
 * (the Boss, the MD, the Developer) sees every row, a Developer's included; everyone else (a manager…) sees NO Developer row — not the
 * rows a Developer wrote, not the Developer's account in the "Staff member" list, not the "developer" area. Nothing here writes anything.
 * Before / after values come back with secret-looking keys already hidden (redact()).
 */

export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityQuery {
  /** Calendar days (business dates), inclusive. */
  from: string;
  to: string;
  userId?: string;
  /** The first part of the action's name ("reservation"). */
  area?: string;
  page: number;
}

export interface ActivityRow {
  id: string;
  createdAt: Date;
  /** The account's name, else the name written with the entry ("website", "system"); null when there is neither. */
  who: string | null;
  actorType: ActorType;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface ActivityData {
  rows: ActivityRow[];
  total: number;
  users: { id: string; fullName: string }[];
  areas: string[];
  /** May this viewer see Developer actions (and so the actor-type badge on every row)? */
  developers: boolean;
}

/** The database filter: the page's own filters, and — for a viewer who may not see Developer actions — "not a Developer's, not about the Developer account". */
export function activityWhere(q: ActivityQuery, developers: boolean): Prisma.AuditLogWhereInput {
  return {
    businessDate: { gte: toDbDate(q.from), lte: toDbDate(q.to) },
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.area ? { action: { startsWith: `${q.area}.` } } : {}),
    // Fail toward hiding: the Developer's own rows, and every "developer.*" entry (also the ones a setup script wrote about the account).
    ...(developers ? {} : { AND: [{ NOT: DEVELOPER_ROWS }, { NOT: { action: { startsWith: "developer." } } }] }),
  };
}

export async function loadActivity(viewer: AuditViewer, q: ActivityQuery): Promise<ActivityData> {
  const developers = seesDeveloperActions(viewer);
  const where = activityWhere(q, developers);
  const [found, total, users, areas] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { fullName: true, role: { select: { code: true } } } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_PAGE_SIZE,
      skip: (Math.max(1, q.page) - 1) * ACTIVITY_PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.user.findMany({
      where: developers ? {} : { role: { is: { code: { not: DEVELOPER_ROLE_CODE } } } },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    db.$queryRaw<{ area: string }[]>`SELECT DISTINCT split_part("action", '.', 1) AS area FROM "audit_logs" ORDER BY 1`,
  ]);
  return {
    developers,
    total,
    users,
    areas: areas.map((a) => a.area).filter((a) => developers || a !== "developer"),
    rows: found.map((r): ActivityRow => {
      const code = r.actorRole ?? r.user?.role.code ?? null;
      const actorType = (r.actorType as ActorType | null)
        ?? (r.userId ? (code === DEVELOPER_ROLE_CODE ? "DEVELOPER" : "STAFF") : r.actorLabel === "website" ? "WEBSITE" : "SYSTEM");
      return {
        id: r.id,
        createdAt: r.createdAt,
        who: r.user?.fullName ?? r.actorLabel ?? null,
        actorType,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before == null ? null : redact(r.before),
        after: r.after == null ? null : redact(r.after),
      };
    }),
  };
}
