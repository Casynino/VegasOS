import "server-only";
import { db, rawDb } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { assertNotWorkAs, currentSessionTokenHash, getCurrentUser, permissionsWhileWorkingAs, requestMeta, type CurrentUser } from "../auth";
import { canBeWorkedAs, SYSTEM_ROLE_CODE, trueActor, withActingAs, withinWorkAsLimit, WORK_AS_HOURS } from "../work-as-session";
import { MIN_REASON, roleBlocksDeveloper } from "./staff-accounts";
import { tellBossSoon } from "./report-delivery";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { staffHome } from "@/lib/staff-home";
import { msg } from "@/i18n/msg";

/**
 * THE DEVELOPER'S ACCESS DESK (owner, 2026-10-17): "Work as" a staff member, suspend an account, sign a person out everywhere.
 *
 *  WORK AS opens a person's real dashboard WITHOUT their password: the Developer then holds that person's rights MINUS everything about
 *  money (every right the Developer is denied) — so a payment, a discount, a withdrawal or a purchase is refused by the ordinary rights
 *  checks — and the decision gates keep refusing a Developer. It lives on the Developer's OWN session row (workAsUserId / workAsStartedAt):
 *  it ends when the Developer presses Stop, 4 hours after it started, or when the session ends. The hotel's own records (who checked a
 *  guest in) carry the person's id; the audit trail is written under the DEVELOPER ("Nino (Developer) as Neema (Receptionist)").
 *  The Boss is told on WhatsApp every time one starts.
 *
 *  WORK AS CAN NEVER TAKE OVER AN ACCOUNT: while working as someone no account, password, login email, role, right, session or preference
 *  can be changed — refused by assertNotWorkAs in the code AND by the write fence under it (server/db.ts).
 *
 *  Every function re-checks on the server that the caller is a Developer (the account's role in the database, never a form field or a
 *  parameter); a refused attempt by a Developer is kept in the audit trail.
 */

const FORBIDDEN_DEV = "Only the Developer account can do this.";
const notFound = () => new AppError(msg("Staff member not found."), "NOT_FOUND");

/** The request's address, or none outside a request (a job, a test without headers). */
async function callerIp(): Promise<string | null> {
  try { return (await requestMeta()).ipAddress; } catch { return null; }
}

/** A signed-in Developer session (while working as someone too) — for pages and actions of the Developer console. It does not go through authorize(). */
export async function requireDeveloperSession(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Your session has expired. Please sign in again.", "UNAUTHENTICATED");
  if (user.actorType !== "DEVELOPER") throw new AppError(FORBIDDEN_DEV, "FORBIDDEN");
  return user;
}

/** The caller must be a Developer: as the account's role in the database says right now (not as the object passed in claims). */
async function verifiedDeveloper(developer: CurrentUser | null | undefined) {
  if (!developer || developer.actorType !== "DEVELOPER") throw new AppError(FORBIDDEN_DEV, "FORBIDDEN");
  const row = await db.user.findUnique({ where: { id: developer.actorId }, select: { id: true, fullName: true, isActive: true, role: { select: { code: true } } } });
  if (!row || !row.isActive || row.role.code !== DEVELOPER_ROLE_CODE) throw new AppError(FORBIDDEN_DEV, "FORBIDDEN");
  return row;
}

/** Keep a refused attempt (best effort — it never changes what the person sees). A Developer's every refusal is kept. */
async function keepRefusal(who: CurrentUser | null | undefined, action: string, targetId: string | null, e: unknown, extra: Record<string, unknown> = {}) {
  if (!who) return;
  try {
    const a = trueActor(who);
    const known = e instanceof AppError;
    await audit(db, { userId: a.id, label: a.label, ipAddress: await callerIp() }, {
      action, entityType: "User", entityId: targetId,
      after: withActingAs({ ...extra, error: known ? e.message : "unexpected error", code: known ? e.code : "ERROR" }, a.actingAs),
    });
  } catch { /* the audit trail must never break the answer */ }
}

/** Run a step; when it is refused or fails, keep the refusal and pass the error on. */
async function attempt<T>(who: CurrentUser, action: string, targetId: string, extra: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    await keepRefusal(who, action, targetId, e, extra);
    throw e;
  }
}

// ───────────────────────────────────────── who is on the list ─────────────────────────────────────────

export interface AccessPerson {
  id: string;
  fullName: string;
  email: string;
  roleCode: string;
  roleName: string;
  roleDescription: string;
  isActive: boolean;
  lastSignedInAt: Date | null;
  canWorkAs: boolean;
  canSuspend: boolean;
  canReactivate: boolean;
  canSignOut: boolean;
  /** Why a button is missing, in English ("Can't be suspended here") — shown with t(). */
  note: string | null;
}

/** The order the roles are listed in: the Boss first, then management, then the departments; any other role after them by name. */
const ROLE_ORDER = ["OWNER", "ADMIN", "MANAGER", "FINANCE", "ACCOUNTANT", "RECEPTIONIST", "RESTAURANT", "KITCHEN", "RESTAURANT_SCREEN", "DRIVER"];
const NOTE_BOSS = msg("Can't be suspended here");
const NOTE_REACTIVATE = msg("Only the Boss or the MD can switch this account back on");

/** What changes whether an account is on or off, as the audit trail kept it. */
const SWITCH_ACTIONS = ["user.suspended", "user.reactivated", "user.deactivated", "user.role_changed"];

/**
 * Of these (switched-off) accounts, the ones this Developer may switch back on: the LAST thing that happened to the account's on/off
 * state is this Developer's own suspension. If anyone has switched it on or off since (the Boss, the MD, another Developer), it is not theirs.
 */
async function suspendedByMe(developerId: string, userIds: string[]): Promise<Set<string>> {
  const mine = new Set<string>();
  if (!userIds.length) return mine;
  const rows = await db.auditLog.findMany({
    where: { entityType: "User", entityId: { in: userIds }, action: { in: SWITCH_ACTIONS } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entityId: true, action: true, userId: true, before: true, after: true },
  });
  const last = new Map<string, string | null>(); // account → who last switched it (null = someone else's switch)
  const isFlag = (v: unknown) => (v && typeof v === "object" ? (v as { isActive?: unknown }).isActive : undefined);
  for (const r of rows) {
    if (!r.entityId) continue;
    if (r.action === "user.suspended") last.set(r.entityId, r.userId);
    else if (r.action === "user.role_changed") { if (isFlag(r.before) !== isFlag(r.after)) last.set(r.entityId, null); }
    else last.set(r.entityId, null);
  }
  for (const [id, by] of last) if (by === developerId) mine.add(id);
  return mine;
}

/**
 * Every account except the Developer's own and the system's, grouped by role (the Boss first), with what the Developer may press on each.
 * Needs a Developer session — it works inside "work as" too, but then nothing may be pressed.
 */
export async function accessPeople(developer: CurrentUser): Promise<{ roleCode: string; roleName: string; roleDescription: string; people: AccessPerson[] }[]> {
  const dev = await verifiedDeveloper(developer);
  const busy = !!developer.workAs; // working as someone: only Stop is available
  const users = await db.user.findMany({
    where: { role: { code: { notIn: [DEVELOPER_ROLE_CODE, SYSTEM_ROLE_CODE] } } },
    select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true, roleId: true, role: { select: { code: true, name: true, description: true } } },
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });
  const off = users.filter((u) => !u.isActive);
  const offRoleIds = [...new Set(off.map((u) => u.roleId))];
  const [mine, blockedList] = await Promise.all([
    suspendedByMe(dev.id, off.map((u) => u.id)),
    Promise.all(offRoleIds.map(async (roleId) => ((await roleBlocksDeveloper(roleId)) ? roleId : null))),
  ]);
  const blockedRoles = new Set(blockedList.filter((r): r is string => r !== null));

  const groups = new Map<string, { roleCode: string; roleName: string; roleDescription: string; people: AccessPerson[] }>();
  for (const u of users) {
    const boss = u.role.code === "OWNER";
    const canReactivate = !busy && !u.isActive && mine.has(u.id) && !blockedRoles.has(u.roleId);
    const person: AccessPerson = {
      id: u.id, fullName: u.fullName, email: u.email, roleCode: u.role.code, roleName: u.role.name, roleDescription: u.role.description ?? "",
      isActive: u.isActive, lastSignedInAt: u.lastLoginAt,
      canWorkAs: !busy && u.isActive,
      canSuspend: !busy && u.isActive && !boss,
      canReactivate,
      canSignOut: !busy && u.isActive && !boss,
      note: boss ? NOTE_BOSS : !u.isActive && !canReactivate ? NOTE_REACTIVATE : null,
    };
    const g = groups.get(u.role.code) ?? { roleCode: u.role.code, roleName: u.role.name, roleDescription: u.role.description ?? "", people: [] };
    g.people.push(person);
    groups.set(u.role.code, g);
  }
  const rank = (code: string) => { const i = ROLE_ORDER.indexOf(code); return i === -1 ? ROLE_ORDER.length : i; };
  return [...groups.values()].sort((a, b) => rank(a.roleCode) - rank(b.roleCode) || a.roleName.localeCompare(b.roleName));
}

// ─────────────────────────────────────────────── work as ───────────────────────────────────────────────

/** Start working as a person: their dashboard, their rights minus money, on the Developer's own session. Returns where to go. */
export async function startWorkAs(developer: CurrentUser, targetUserId: string): Promise<{ home: string }> {
  const ipAddress = await callerIp();
  const refuse = async (error: AppError, why: string): Promise<never> => {
    await keepRefusal(developer, "developer.work_as_refused", targetUserId, error, { why });
    throw error;
  };

  // The session on the server, not the object passed in: it must be a Developer's own session.
  const tokenHash = await currentSessionTokenHash();
  if (!tokenHash) throw new AppError("Your session has expired. Please sign in again.", "UNAUTHENTICATED");
  const session = await rawDb.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, workAsUserId: true, workAsStartedAt: true, user: { select: { isActive: true, role: { select: { code: true } } } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive || session.user.role.code !== DEVELOPER_ROLE_CODE || session.userId !== developer?.actorId || developer.actorType !== "DEVELOPER") {
    return refuse(new AppError(FORBIDDEN_DEV, "FORBIDDEN"), "not a Developer session");
  }
  if (developer.workAs || (session.workAsUserId && withinWorkAsLimit(session.workAsStartedAt))) {
    return refuse(new AppError(msg("You are already working as someone. Press Stop first."), "CONFLICT"), "already working as someone");
  }

  const target = await db.user.findUnique({ where: { id: targetUserId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  if (!target || target.role.code === SYSTEM_ROLE_CODE) return refuse(notFound(), "no such account");
  if (target.role.code === DEVELOPER_ROLE_CODE) return refuse(new AppError(msg("You cannot work as a Developer account."), "FORBIDDEN"), "a Developer account");
  if (!canBeWorkedAs(target)) return refuse(new AppError(msg("That account is switched off, so you cannot work as that person."), "CONFLICT"), "account is switched off");

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.session.update({ where: { id: session.id }, data: { workAsUserId: target.id, workAsStartedAt: now } });
    // No work-as without its line in the trail: both or neither.
    await audit(tx, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
      action: "developer.work_as_started", entityType: "User", entityId: target.id,
      after: { targetName: target.fullName, targetRole: target.role.name, targetRoleCode: target.role.code, endsAfterHours: WORK_AS_HOURS },
    });
  });

  // The Boss is told every time (in each reader's language; it never blocks and never throws).
  const developerName = developer.actorName;
  const person = target.fullName;
  const roleName = target.role.name;
  tellBossSoon((t, settings) => t("{developer} (Developer) started working as {person} ({role}) at {time}.", { developer: developerName, person, role: t(roleName), time: t.time(now, settings.timezone) }));

  return { home: staffHome(permissionsWhileWorkingAs(target.role.permissions.map((rp) => rp.permission.code))) };
}

/** Stop working as someone: the Developer is themselves again (on the same session). */
export async function endWorkAs(user: CurrentUser): Promise<void> {
  if (user.actorType !== "DEVELOPER") throw new AppError(FORBIDDEN_DEV, "FORBIDDEN");
  const tokenHash = await currentSessionTokenHash();
  if (!tokenHash) return;
  const session = await rawDb.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, workAsUserId: true, workAsStartedAt: true, workAsUser: { select: { fullName: true, role: { select: { name: true } } } } },
  });
  if (!session || session.userId !== user.actorId || !session.workAsUserId) return;
  await rawDb.session.update({ where: { id: session.id }, data: { workAsUserId: null, workAsStartedAt: null } });
  const minutes = session.workAsStartedAt ? Math.max(0, Math.round((Date.now() - session.workAsStartedAt.getTime()) / 60_000)) : null;
  await audit(db, { userId: user.actorId, label: user.actorName, ipAddress: await callerIp() }, {
    action: "developer.work_as_ended", entityType: "User", entityId: session.workAsUserId,
    after: { targetName: session.workAsUser?.fullName ?? null, targetRole: session.workAsUser?.role.name ?? null, minutes },
  });
}

// ───────────────────────────────────── suspend, switch back on, sign out ─────────────────────────────────────

/** The account the Developer may act on: a Developer account and the system's own are never touched here. */
async function loadAccount(userId: string) {
  const target = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target || target.role.code === SYSTEM_ROLE_CODE) throw notFound();
  if (target.role.code === DEVELOPER_ROLE_CODE) throw new AppError(msg("A Developer account cannot be changed here."), "FORBIDDEN");
  return target;
}

function checkReason(raw: string | null | undefined): string {
  const reason = (raw ?? "").trim();
  if (reason.length < MIN_REASON) throw new AppError(msg("Give the reason for this change (at least 5 characters)."), "VALIDATION", { reason: msg("Give the reason (at least 5 characters).") });
  if (reason.length > 500) throw new AppError(msg("The reason is too long."), "VALIDATION", { reason: msg("The reason is too long.") });
  return reason;
}

/** Switch an account off and sign its person out everywhere, until it is switched back on. Needs a reason and the word CONFIRM. */
export async function suspendAccount(developer: CurrentUser, targetUserId: string, input: { reason: string; confirm: string }): Promise<void> {
  await verifiedDeveloper(developer);
  return attempt(developer, "user.suspend_failed", targetUserId, {}, async () => {
    assertNotWorkAs(developer, "suspend accounts");
    const reason = checkReason(input.reason);
    if (input.confirm !== "CONFIRM") throw new AppError(msg("Type CONFIRM to suspend this account."), "VALIDATION", { confirm: msg("Type CONFIRM exactly.") });
    const target = await loadAccount(targetUserId);
    if (target.id === developer.actorId) throw new AppError(msg("You cannot suspend your own account."), "FORBIDDEN");
    if (target.role.code === "OWNER") throw new AppError(msg("Can't be suspended here: this is the Boss's account."), "FORBIDDEN");
    if (!target.isActive) throw new AppError(msg("This account is already suspended."), "CONFLICT");
    const ipAddress = await callerIp();
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { isActive: false } });
      const ended = await tx.session.deleteMany({ where: { userId: target.id } });
      await audit(tx, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
        action: "user.suspended", entityType: "User", entityId: target.id,
        before: { fullName: target.fullName, email: target.email, role: target.role.code, isActive: true },
        after: { isActive: false, reason, signedOut: ended.count },
      });
    });
  });
}

/**
 * Switch back on an account THIS Developer suspended — only that (not one the Boss, the MD or another Developer switched off), and never an
 * account whose role holds money rights or "users.manage" (the Boss or the MD does that).
 */
export async function reactivateAccount(developer: CurrentUser, targetUserId: string, input: { reason: string }): Promise<void> {
  await verifiedDeveloper(developer);
  return attempt(developer, "user.reactivate_failed", targetUserId, {}, async () => {
    assertNotWorkAs(developer, "switch accounts back on");
    const reason = checkReason(input.reason);
    const target = await loadAccount(targetUserId);
    if (target.isActive) throw new AppError(msg("This account is not suspended."), "CONFLICT");
    if (!(await suspendedByMe(developer.actorId, [target.id])).has(target.id)) {
      throw new AppError(msg("You can only switch back on accounts you suspended yourself."), "FORBIDDEN");
    }
    if (await roleBlocksDeveloper(target.roleId)) {
      throw new AppError(msg("The Developer account cannot do this: it would give access to money. Ask the Boss or the MD."), "FORBIDDEN");
    }
    const ipAddress = await callerIp();
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { isActive: true } });
      await audit(tx, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
        action: "user.reactivated", entityType: "User", entityId: target.id,
        before: { fullName: target.fullName, email: target.email, role: target.role.code, isActive: false },
        after: { isActive: true, reason },
      });
    });
  });
}

/** End every open session of a person, on every phone and computer. They can sign straight back in. */
export async function signOutEverywhere(developer: CurrentUser, targetUserId: string): Promise<{ sessionsEnded: number }> {
  await verifiedDeveloper(developer);
  return attempt(developer, "user.sign_out_failed", targetUserId, {}, async () => {
    assertNotWorkAs(developer, "sign people out everywhere");
    const target = await loadAccount(targetUserId);
    if (target.id === developer.actorId) throw new AppError(msg("You cannot sign yourself out here: use Sign out."), "FORBIDDEN");
    const ipAddress = await callerIp();
    return db.$transaction(async (tx) => {
      const ended = await tx.session.deleteMany({ where: { userId: target.id } });
      await audit(tx, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
        action: "user.signed_out_everywhere", entityType: "User", entityId: target.id,
        after: { fullName: target.fullName, role: target.role.code, sessionsEnded: ended.count },
      });
      return { sessionsEnded: ended.count };
    });
  });
}
