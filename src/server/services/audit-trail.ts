import "server-only";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { redact, type ActorType } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { friendlyAction } from "@/lib/activity-words";
import { msg } from "@/i18n/msg";
import { addDays, diffDays, fromDbDate, isBusinessDate, localCalendarDate, toDbDate, zonedInstant } from "@/lib/time/business-date";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The audit trail, read-only (owner, 2026-10-14). The one reader of audit_logs for the Audit trail page.
 *
 *  - Whoever holds "audit.view" (the Boss, the MD, the Developer) sees EVERY entry — Developer actions included: accountability.
 *  - Nothing here writes, edits or deletes an entry (the database refuses it anyway). A Developer's visit to this page is noted by
 *    the layout like every sensitive page (developer-view-log.ts) — not here.
 *  - Every search is bounded: a date range of at most MAX_DAYS days, 50 rows a page read with one row of look-ahead (no count
 *    of the whole table), and a deepest page (MAX_PAGE) — beyond it the person narrows the dates.
 *  - Before / after values come back with secret-looking keys already hidden (redact()); the page hides them again when it draws them.
 */

export const AUDIT_PAGE_SIZE = 50;
/** The deepest page one search reaches (10,000 entries) — narrow the dates to go further back. */
export const AUDIT_MAX_PAGE = 200;
/** The longest date range one search covers. */
export const AUDIT_MAX_DAYS = 366;
/** What the page opens on: today and the six days before. */
export const AUDIT_DEFAULT_DAYS = 7;

export type ActorFilter = "ALL" | "DEVELOPER" | "STAFF" | "SYSTEM";
export const ACTOR_FILTERS: readonly ActorFilter[] = ["ALL", "DEVELOPER", "STAFF", "SYSTEM"];

export interface AuditFilter {
  /** Who acted: everyone, a Developer, staff, or the system and the website. */
  actor: ActorFilter;
  /** One person's account id ("" = anyone). */
  userId: string;
  /** Part of the action's name, any case ("" = any). */
  action: string;
  /** The module — the kind of record (entityType), exactly ("" = any). */
  module: string;
  /** Calendar days in the hotel's time zone, inclusive. */
  from: string;
  to: string;
  page: number;
}

/** Whoever is looking: only the rights matter here. */
export interface AuditViewer {
  permissions: ReadonlySet<string>;
}

export const canViewAuditTrail = (v: AuditViewer | null | undefined): boolean => !!v && v.permissions.has("audit.view");

/** Refuses anyone without "audit.view" — the page checks too; this is the guard that stays with the data. */
export function assertCanViewAuditTrail(v: AuditViewer | null | undefined): asserts v is AuditViewer {
  if (!canViewAuditTrail(v)) throw new AppError("You do not have permission to do this.", "FORBIDDEN");
}

/** Boss and MD see Developer actions (accountability); so does the Developer. Kept as one rule so it can only be narrowed in one place. */
export const seesDeveloperActions = (v: AuditViewer): boolean => canViewAuditTrail(v);

/** A failed attempt by its name: ending "_failed" (a sign-in, a staff change), or a refusal ("developer.denied", "….refused"). */
export const isFailureAction = (action: string): boolean => /(_failed|\.denied|\.refused)$/.test(action);

/** A failure by its name, or by the entry itself saying so (a Developer's inspection that ended with `ok: false`). */
export const isFailureEntry = (action: string, after: unknown): boolean => isFailureAction(action) || field(after, "ok") === false;

// ─────────────────────────────────────────────── the words ───────────────────────────────────────────────

/** Plain words for the entries the activity list has no words for (failed attempts, staff accounts, the audit trail itself). */
const WORDS: Record<string, string> = {
  // A failed sign-in is nobody's action: it is the system's entry about an account that someone tried (see recordFailedSignIn).
  "auth.login_failed": msg("Failed sign-in (not signed in)"),
  "developer.denied": msg("was refused — no permission"),
  "developer.viewed": msg("looked at a page"),
  "developer.viewed_limit": msg("opened very many pages in a short time (not every page is listed)"),
  "developer.exported": msg("exported records to a file"),
  "developer.downloaded": msg("downloaded a file"),
  "developer.inspected": msg("checked what a person can do"),
  "developer.provisioned": msg("set up the Developer account"),
  "developer.password_rotated": msg("changed the Developer password"),
  "developer.deactivated": msg("switched the Developer account off"),
  "user.created": msg("added a staff account"),
  "user.deleted": msg("removed a staff account"),
  "user.updated": msg("changed a staff account's details"),
  "user.role_changed": msg("changed a staff account's role"),
  "user.deactivated": msg("switched a staff account off"),
  "user.reactivated": msg("switched a staff account back on"),
  "user.password_reset": msg("reset a password"),
  "user.create_failed": msg("could not add a staff account"),
  "user.update_failed": msg("could not change a staff account"),
  "user.password_reset_failed": msg("could not reset a password"),
  "user.permission_change_failed": msg("could not change a role's rights"),
  "user.delete_failed": msg("could not remove a staff account"),
  "withdrawal.refused": msg("had a withdrawal refused"),
  "setup.team_logins": msg("set up the team's sign-ins"),
};

/** What an action was, in plain words ("checked a guest in"); the raw name when nobody wrote words for it. */
export function auditActionWords(action: string): string {
  return WORDS[action] ?? friendlyAction(action);
}

// ─────────────────────────────────────────────── the filter ───────────────────────────────────────────────

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Plain text from the address bar: no control characters, trimmed, bounded. */
const text = (v: string | string[] | undefined, max: number) => (one(v) ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export interface ParsedFilter { filter: AuditFilter; rangeShortened: boolean }

/**
 * The address bar's parameters (who, user, action, module, from, to, page) as one safe filter. Nothing here can make a search
 * wider than MAX_DAYS or deeper than MAX_PAGE; a mistake in the address falls back to the default, never to an error.
 */
export function parseAuditFilter(raw: Raw, today: string): ParsedFilter {
  const who = text(raw.who, 12).toUpperCase();
  const actor = (ACTOR_FILTERS as readonly string[]).includes(who) ? (who as ActorFilter) : "ALL";
  const f = one(raw.from), t = one(raw.to);
  let to = isBusinessDate(t) ? t : today;
  let from = isBusinessDate(f) ? f : addDays(to, -(AUDIT_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  let rangeShortened = false;
  if (diffDays(from, to) > AUDIT_MAX_DAYS - 1) {
    from = addDays(to, -(AUDIT_MAX_DAYS - 1));
    rangeShortened = true;
  }
  const n = Math.floor(Number(one(raw.page)));
  return {
    rangeShortened,
    filter: {
      actor,
      userId: text(raw.user, 64),
      action: text(raw.action, 80),
      module: text(raw.module, 80),
      from, to,
      page: Number.isFinite(n) ? Math.min(AUDIT_MAX_PAGE, Math.max(1, n)) : 1,
    },
  };
}

/** The hotel's calendar today (the page's default end of the range). */
export const auditToday = (timezone: string, now: Date = new Date()) => localCalendarDate(now, timezone);

// The three kinds of rows. A row written before the type existed (a script that writes SQL directly) has no type: it is read as
// staff or system by whether an account is behind it — and as a Developer's when that account is a Developer account.
const DEV_ACCOUNT: Prisma.AuditLogWhereInput = { user: { is: { role: { is: { code: DEVELOPER_ROLE_CODE } } } } };
export const DEVELOPER_ROWS: Prisma.AuditLogWhereInput = { OR: [{ actorType: "DEVELOPER" }, { actorType: null, ...DEV_ACCOUNT }] };
const STAFF_ROWS: Prisma.AuditLogWhereInput = { OR: [{ actorType: "STAFF" }, { actorType: null, userId: { not: null }, NOT: DEV_ACCOUNT }] };
const SYSTEM_ROWS: Prisma.AuditLogWhereInput = { OR: [{ actorType: { in: ["SYSTEM", "WEBSITE"] } }, { actorType: null, userId: null }] };

/** The date part of every search: exact instants in the hotel's time zone, plus the indexed business date (a day either side) so the database never scans the whole table. */
function dateWhere(from: string, to: string, timezone: string): Prisma.AuditLogWhereInput[] {
  return [
    { createdAt: { gte: zonedInstant(from, 0, timezone), lt: zonedInstant(addDays(to, 1), 0, timezone) } },
    { businessDate: { gte: toDbDate(addDays(from, -2)), lte: toDbDate(addDays(to, 2)) } },
  ];
}

/** What was typed, as plain text for a LIKE search: a % or _ is itself, not a wildcard (Postgres's escape character is the backslash). */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** The database filter for a search. `developers` = may the viewer see a Developer's actions. */
export function auditWhere(f: AuditFilter, o: { developers: boolean; timezone: string }): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = dateWhere(f.from, f.to, o.timezone);
  if (f.actor === "DEVELOPER") and.push(DEVELOPER_ROWS);
  else if (f.actor === "STAFF") and.push(STAFF_ROWS);
  else if (f.actor === "SYSTEM") and.push(SYSTEM_ROWS);
  if (!o.developers) and.push({ NOT: DEVELOPER_ROWS });
  if (f.userId) and.push({ userId: f.userId });
  if (f.action) and.push({ action: { contains: likeLiteral(f.action), mode: "insensitive" } });
  if (f.module) and.push({ entityType: f.module });
  return { AND: and };
}

// ─────────────────────────────────────────────── the rows ───────────────────────────────────────────────

export interface AuditRow {
  id: string;
  at: Date;
  businessDate: string;
  actorType: ActorType;
  /** The role code the account held when it acted, and its name now (the code when the role is gone). */
  actorRole: string | null;
  roleName: string | null;
  /** The name written with the entry (a snapshot — it stays even when the account is renamed or removed). */
  actorName: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ok: boolean;
  /** The reason given for a sensitive change, and the problem a failed attempt ran into — both from the entry's "after". */
  reason: string | null;
  problem: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  filter: AuditFilter;
  timezone: string;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** On the deepest page with more behind it: the person must narrow the dates. */
  limitReached: boolean;
}

const short = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const field = (json: unknown, key: string): unknown => (json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>)[key] : undefined);

/** One search: newest first, one page of 50, read with one extra row to know whether a next page exists. */
export async function queryAuditTrail(viewer: AuditViewer, filter: AuditFilter): Promise<AuditPage> {
  assertCanViewAuditTrail(viewer);
  const { timezone } = await getSettings();
  const page = Math.min(AUDIT_MAX_PAGE, Math.max(1, Math.floor(filter.page) || 1));
  const found = await db.auditLog.findMany({
    where: auditWhere(filter, { developers: seesDeveloperActions(viewer), timezone }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE + 1,
    include: { user: { select: { role: { select: { code: true } } } } },
  });
  const more = found.length > AUDIT_PAGE_SIZE;
  const rows = found.slice(0, AUDIT_PAGE_SIZE);
  const roles = rows.length ? new Map((await db.role.findMany({ select: { code: true, name: true } })).map((r) => [r.code, r.name])) : new Map<string, string>(); // a small table

  return {
    filter: { ...filter, page },
    timezone,
    pageSize: AUDIT_PAGE_SIZE,
    hasPrevious: page > 1,
    hasNext: more && page < AUDIT_MAX_PAGE,
    limitReached: more && page >= AUDIT_MAX_PAGE,
    rows: rows.map((r): AuditRow => {
      const code = r.actorRole ?? r.user?.role.code ?? null;
      const actorType: ActorType = (r.actorType as ActorType | null)
        ?? (r.userId ? (code === DEVELOPER_ROLE_CODE ? "DEVELOPER" : "STAFF") : r.actorLabel === "website" ? "WEBSITE" : "SYSTEM");
      const before = redact(r.before);
      const after = redact(r.after);
      return {
        id: r.id,
        at: r.createdAt,
        businessDate: fromDbDate(r.businessDate),
        actorType,
        actorRole: code,
        roleName: code ? roles.get(code) ?? code : null,
        actorName: short(r.actorLabel, 120),
        userId: r.userId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        ok: !isFailureEntry(r.action, after),
        reason: short(field(after, "reason") ?? field(before, "reason"), 400),
        problem: short(field(after, "error") ?? field(after, "problem"), 400),
        before,
        after,
        ipAddress: r.ipAddress,
      };
    }),
  };
}

export interface AuditChoices {
  /** The people in the "Person" list (a Developer's account only for those who may see Developer actions). */
  users: { id: string; name: string; role: string; developer: boolean }[];
  /** The modules (kinds of record) that have entries in the chosen dates. */
  modules: string[];
}

/** What the filter boxes offer: the people, and the modules seen in the chosen dates (never the whole table). */
export async function auditFilterChoices(viewer: AuditViewer, filter: AuditFilter): Promise<AuditChoices> {
  assertCanViewAuditTrail(viewer);
  const { timezone } = await getSettings();
  const developers = seesDeveloperActions(viewer);
  const [users, modules] = await Promise.all([
    db.user.findMany({
      where: developers ? {} : { role: { is: { code: { not: DEVELOPER_ROLE_CODE } } } },
      select: { id: true, fullName: true, role: { select: { code: true, name: true } } },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
    db.auditLog.groupBy({
      by: ["entityType"],
      where: { AND: [...dateWhere(filter.from, filter.to, timezone), ...(developers ? [] : [{ NOT: DEVELOPER_ROWS }])] },
      orderBy: { entityType: "asc" },
      take: 200,
    }),
  ]);
  const names = modules.map((m) => m.entityType);
  return {
    users: users.map((u) => ({ id: u.id, name: u.fullName, role: u.role.name, developer: u.role.code === DEVELOPER_ROLE_CODE })),
    // A module typed in the address that has no entries in these dates stays selectable (so the filter on screen says what is applied).
    modules: filter.module && !names.includes(filter.module) ? [...names, filter.module].sort() : names,
  };
}
