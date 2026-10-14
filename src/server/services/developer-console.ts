import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { DEVELOPER_IDLE_MINUTES, DEVELOPER_SESSION_HOURS, type CurrentUser } from "../auth";
import { getSettings } from "../settings";
import { ntzsEnabled, ntzsLive } from "./ntzs";
import { SYSTEM_ROLE } from "./staff-accounts";
import { WITHDRAWAL_UNSETTLED } from "@/lib/withdrawals";
import { DEVELOPER_DENIED, isDeveloperOnly, PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import { msg } from "@/i18n/msg";

/**
 * THE DEVELOPER CONSOLE (owner, 2026-10-14) — what the Developer sees about themselves, about the system's health and about
 * who may do what. Read-only. Everything is looked up on the server, and NOTHING here ever carries a secret: the system's
 * settings are reported as yes / no and counters only (is a key set — never what it is).
 *
 * Every function checks, again, that the caller really is the Developer account with the right "developer.access" (the page
 * checks too; hiding a link is never the protection). A deliberate inspection of a person's rights is written to the audit trail.
 */

/** The caller as the services read it: straight from the signed-in session (getCurrentUser). */
export type ConsoleUser = Pick<CurrentUser, "id" | "fullName" | "roleCode" | "roleName" | "actorType" | "permissions">;

/** Where the audit trail page lists only the Developer's actions (the page's own filter: who=DEVELOPER, see audit-trail.ts parseAuditFilter). */
export const AUDIT_DEVELOPER_HREF = "/staff/audit?who=DEVELOPER";

/** One plain sentence: why the Developer holds no money-writing right. Shown with the list of them. */
export const MONEY_RULE = msg("The Developer can see and fix everything in the system but never writes money — so a test or a mistake can never change the hotel's money, and every money entry stays with the person who made it (Finance, the Boss or the MD).");

/** The Developer's own door: the account type AND the right, both read from the database for this request. */
export function assertConsoleAccess(user: Pick<ConsoleUser, "actorType" | "permissions">): void {
  if (user.actorType !== "DEVELOPER" || !user.permissions.has("developer.access")) {
    throw new AppError(msg("You do not have permission to do this."), "FORBIDDEN");
  }
}

/** A right is a KEY of the list — not anything the object inherits ("constructor", "toString"…). */
const isRight = (code: string): code is PermissionCode => Object.hasOwn(PERMISSIONS, code);
const rightWords = (code: string): string | null => (isRight(code) ? PERMISSIONS[code] : null);
const short = (v: unknown, max = 200): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);
/** A query that fails must not take the whole page down: the part shows "unknown" instead. */
async function safe<T>(run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch { return null; }
}

// ───────────────────────────────────────────── 1. who is signed in ─────────────────────────────────────────────
export interface DeveloperIdentity {
  name: string;
  roleCode: string;
  roleName: string;
  /** Always "Developer" here — the console is only for that account type. */
  accountType: "Developer";
  /** How many rights the session holds right now. */
  rightsCount: number;
  /** The money-writing rights the Developer does NOT hold (in plain words), and the one-sentence reason. */
  notHeld: { code: string; description: string }[];
  /** Money rights that ARE held although they should not be (a role that was changed outside the setup) — empty when all is as designed. */
  heldButDenied: string[];
  reason: string;
  session: {
    startedAt: Date;
    lastSeenAt: Date;
    /** 4 hours after sign-in. */
    hardLimitAt: Date;
    /** 30 minutes after the last use. */
    idleLimitAt: Date;
    /** The earliest of the two: when the session ends if nothing changes. */
    endsAt: Date;
    endsBecause: "limit" | "idle";
    minutesLeft: number;
    limitHours: number;
    idleMinutes: number;
  } | null;
}

export async function developerIdentity(user: ConsoleUser, sessionTokenHash: string | null, now = new Date()): Promise<DeveloperIdentity> {
  assertConsoleAccess(user);
  const row = sessionTokenHash ? await db.session.findUnique({ where: { tokenHash: sessionTokenHash }, select: { userId: true, createdAt: true, lastSeenAt: true, expiresAt: true } }) : null;
  let session: DeveloperIdentity["session"] = null;
  if (row && row.userId === user.id) {
    const hardLimitAt = new Date(row.createdAt.getTime() + DEVELOPER_SESSION_HOURS * 3600_000);
    const idleLimitAt = new Date(row.lastSeenAt.getTime() + DEVELOPER_IDLE_MINUTES * 60_000);
    const hardEnd = new Date(Math.min(hardLimitAt.getTime(), row.expiresAt.getTime()));
    const idleFirst = idleLimitAt.getTime() < hardEnd.getTime();
    const endsAt = idleFirst ? idleLimitAt : hardEnd;
    session = {
      startedAt: row.createdAt, lastSeenAt: row.lastSeenAt, hardLimitAt, idleLimitAt, endsAt, endsBecause: idleFirst ? "idle" : "limit",
      minutesLeft: Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 60_000)), limitHours: DEVELOPER_SESSION_HOURS, idleMinutes: DEVELOPER_IDLE_MINUTES,
    };
  }
  return {
    name: user.fullName, roleCode: user.roleCode, roleName: user.roleName, accountType: "Developer",
    rightsCount: user.permissions.size,
    notHeld: DEVELOPER_DENIED.filter((c) => !user.permissions.has(c)).map((code) => ({ code, description: PERMISSIONS[code] })),
    heldButDenied: DEVELOPER_DENIED.filter((c) => user.permissions.has(c)),
    reason: MONEY_RULE,
    session,
  };
}

// ───────────────────────────────────────────── 2. system checks (yes / no and counters only) ─────────────────────────────────────────────
export interface Diagnostics {
  checkedAt: Date;
  database: { reachable: boolean };
  /** null = could not be read. */
  migrations: { applied: number; failed: number; latest: string | null } | null;
  ntzs: { configured: boolean; live: boolean; webhookSecret: boolean };
  whatsapp: { defaultKey: boolean; recipients: number; recipientsReady: number } | null;
  cron: { secretConfigured: boolean };
  deployment: { commit: string | null; environment: string | null };
  counts: {
    staffTotal: number;
    staffByRole: { code: string; name: string; count: number }[];
    openShifts: number;
    unsettledWithdrawals: number;
    failedMessages24h: number;
  } | null;
}

const ENVIRONMENTS = ["production", "preview", "development", "test"];

export async function systemDiagnostics(user: Pick<ConsoleUser, "actorType" | "permissions">, now = new Date()): Promise<Diagnostics> {
  assertConsoleAccess(user);
  const reachable = (await safe(() => db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`)) !== null;

  const migrations = await safe(async () => {
    const [r] = await db.$queryRaw<{ applied: number; failed: number; latest: string | null }[]>`
      SELECT
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS failed,
        (SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1) AS latest
      FROM _prisma_migrations`;
    return { applied: Number(r?.applied ?? 0), failed: Number(r?.failed ?? 0), latest: short(r?.latest, 120) };
  });

  // The report recipients: a person is "ready" when a key can be found for them (their own named key, else the default one) — the key itself is never read out.
  const whatsapp = await safe(async () => {
    const settings = await getSettings();
    const list = Array.isArray(settings.reportRecipients) ? (settings.reportRecipients as { apiKeyRef?: unknown }[]) : [];
    const defaultKey = !!process.env.CALLMEBOT_API_KEY;
    const ready = list.filter((r) => {
      const ref = typeof r?.apiKeyRef === "string" ? r.apiKeyRef : "";
      return (/^[A-Z0-9_]+$/.test(ref) && !!process.env[ref]) || defaultKey;
    }).length;
    return { defaultKey, recipients: list.length, recipientsReady: ready };
  });

  const counts = await safe(async () => {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const [roles, openShifts, unsettledWithdrawals, failedMessages24h] = await Promise.all([
      // The online-payments system account is not a person, so it is not counted as staff.
      db.role.findMany({ where: { code: { not: SYSTEM_ROLE } }, select: { code: true, name: true, _count: { select: { users: { where: { isActive: true } } } } }, orderBy: { name: "asc" } }),
      db.actualShift.count({ where: { endedAt: null } }),
      db.withdrawal.count({ where: { status: { in: WITHDRAWAL_UNSETTLED } } }),
      db.notificationDelivery.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    ]);
    const staffByRole = roles.map((r) => ({ code: r.code, name: r.name, count: r._count.users })).filter((r) => r.count > 0);
    return { staffTotal: staffByRole.reduce((n, r) => n + r.count, 0), staffByRole, openShifts, unsettledWithdrawals, failedMessages24h };
  });

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const env = (process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
  return {
    checkedAt: now,
    database: { reachable },
    migrations,
    // Booleans only: whether a key is set — never the key.
    ntzs: { configured: ntzsEnabled(), live: ntzsLive(), webhookSecret: !!process.env.NTZS_WEBHOOK_SECRET },
    whatsapp,
    cron: { secretConfigured: !!process.env.CRON_SECRET },
    deployment: { commit: sha ? sha.slice(0, 7) : null, environment: ENVIRONMENTS.includes(env) ? env : null },
    counts,
  };
}

// ───────────────────────────────────────────── 3. refused attempts ─────────────────────────────────────────────
export interface DeniedEntry {
  id: string;
  at: Date;
  /** The name as it was at that moment (the account may be gone since). */
  who: string;
  kind: "page" | "action" | null;
  /** The page it was on, when known. */
  path: string | null;
  /** The rights that would have allowed it. */
  needs: { code: string; description: string | null }[];
}

/** The newest refusals the Developer met ("developer.denied": a page or an action they may not use). */
export async function recentDenied(user: Pick<ConsoleUser, "actorType" | "permissions">, limit = 20): Promise<DeniedEntry[]> {
  assertConsoleAccess(user);
  const rows = await db.auditLog.findMany({
    where: { action: "developer.denied" }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(1, limit), 100),
    select: { id: true, createdAt: true, actorLabel: true, after: true },
  });
  return rows.map((r) => {
    const a = (r.after && typeof r.after === "object" && !Array.isArray(r.after) ? r.after : {}) as Record<string, unknown>;
    const needs = Array.isArray(a.needs) ? a.needs.filter((c): c is string => typeof c === "string").slice(0, 10).map((code) => ({ code: code.slice(0, 80), description: rightWords(code) })) : [];
    return { id: r.id, at: r.createdAt, who: short(r.actorLabel, 120) ?? "—", kind: a.kind === "page" || a.kind === "action" ? a.kind : null, path: short(a.path, 300), needs };
  });
}

// ───────────────────────────────────────────── 4. permission inspector ─────────────────────────────────────────────
export interface InspectableUser { id: string; name: string; roleName: string; active: boolean }

/** Everyone the inspector can look at (a person's name and role — nothing else). */
export async function listInspectableUsers(user: Pick<ConsoleUser, "actorType" | "permissions">): Promise<InspectableUser[]> {
  assertConsoleAccess(user);
  const rows = await db.user.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }], take: 1000,
    select: { id: true, fullName: true, isActive: true, role: { select: { name: true } } },
  });
  return rows.map((u) => ({ id: u.id, name: u.fullName, roleName: u.role.name, active: u.isActive }));
}

/** Every right there is, sorted, with its plain-words description (for the list the Developer picks from). */
export const listRights = (): { code: string; description: string }[] =>
  (Object.keys(PERMISSIONS) as PermissionCode[]).sort().map((code) => ({ code, description: PERMISSIONS[code] }));

export type Inspection =
  | {
      ok: true;
      person: { id: string; name: string; roleCode: string; roleName: string; active: boolean };
      right: { code: string; description: string; developerOnly: boolean; developerMoneyRight: boolean };
      has: boolean;
      /** The role that gives the right to this person (none when they do not have it). */
      grantedBy: { code: string; name: string } | null;
      /** Every role that holds the right. */
      rolesWithRight: { code: string; name: string }[];
      /** Everything this person can do, by their role. */
      rights: { code: string; description: string | null }[];
    }
  | { ok: false; problem: string };

/**
 * "Can this person do this?" — yes or no, which role gives it, and the person's whole list. Read-only. The inspection (who looked at
 * whom, which right, what the answer was — or that it failed) is written to the audit trail as "developer.inspected".
 */
export async function inspectPermission(user: ConsoleUser, input: { userId: string; code: string }, meta: { ipAddress?: string | null } = {}): Promise<Inspection> {
  assertConsoleAccess(user);
  const userId = (input.userId ?? "").trim().slice(0, 60);
  const code = (input.code ?? "").trim().slice(0, 80);
  const actor = { userId: user.id, label: user.fullName, ipAddress: meta.ipAddress ?? null };

  const refuse = async (problem: string): Promise<Inspection> => {
    await audit(db, actor, { action: "developer.inspected", entityType: "User", entityId: userId || null, after: { ok: false, right: code || null, problem } });
    return { ok: false, problem };
  };
  if (!userId) return refuse(msg("Choose a person."));
  if (!isRight(code)) return refuse(msg("Choose a right from the list."));

  const person = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, isActive: true, role: { select: { code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } } } },
  });
  if (!person) return refuse(msg("That person was not found."));

  const held = person.role.permissions.map((p) => p.permission.code).sort();
  const has = held.includes(code);
  const rolesWithRight = await db.role.findMany({ where: { permissions: { some: { permission: { code } } } }, select: { code: true, name: true }, orderBy: { name: "asc" } });
  const result: Inspection = {
    ok: true,
    person: { id: person.id, name: person.fullName, roleCode: person.role.code, roleName: person.role.name, active: person.isActive },
    right: { code, description: PERMISSIONS[code], developerOnly: isDeveloperOnly(code), developerMoneyRight: (DEVELOPER_DENIED as readonly string[]).includes(code) },
    has,
    grantedBy: has ? { code: person.role.code, name: person.role.name } : null,
    rolesWithRight,
    rights: held.map((c) => ({ code: c, description: rightWords(c) })),
  };
  await audit(db, actor, {
    action: "developer.inspected", entityType: "User", entityId: person.id,
    after: { ok: true, person: person.fullName, role: person.role.code, right: code, answer: has ? "yes" : "no" },
  });
  return result;
}

// ───────────────────────────────────────────── the page's one call ─────────────────────────────────────────────
export async function developerConsole(user: ConsoleUser, sessionTokenHash: string | null, now = new Date()) {
  assertConsoleAccess(user);
  const [identity, diagnostics, denied, people] = await Promise.all([
    developerIdentity(user, sessionTokenHash, now), systemDiagnostics(user, now), recentDenied(user, 20), listInspectableUsers(user),
  ]);
  return { identity, diagnostics, denied, people, rights: listRights(), auditHref: AUDIT_DEVELOPER_HREF };
}
