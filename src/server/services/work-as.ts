import "server-only";
import { db, rawDb } from "../db";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { assertNotWorkAs, currentSessionTokenHash, getCurrentUser, hashPassword, permissionsWhileWorkingAs, requestMeta, validatePasswordStrength, type CurrentUser } from "../auth";
import { canBeWorkedAs, SYSTEM_ROLE_CODE, trueActor, withActingAs, withinWorkAsLimit, WORK_AS_HOURS } from "../work-as-session";
import { tellBossSoon } from "./report-delivery";
import { numberWaitersTx } from "./waiter-number";
import { recordWorkAsEnded } from "./work-as-expired";
import { keepEndpointRefusal } from "./endpoint-refusal";
import { removeAccountAccess, unusablePasswordHash } from "./account-removal";
import { DEVELOPER_DENIED, DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { isPermanentOwner, LAST_BOSS_REFUSAL, PERMANENT_OWNER_REFUSAL } from "@/lib/permanent-owners";
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
 *  can be changed — refused by assertNotWorkAs in the code AND by the write fence under it (server/db.ts). Outside work as, the Developer
 *  cannot change existing accounts, passwords, login emails, roles or rights (services/staff-accounts.ts): only the Boss and the MD.
 *  Its share of accounts is this file: Add an account, Work as, Suspend, Sign out everywhere, and switching back on what it suspended itself.
 *
 *  SUSPEND and SIGN OUT EVERYWHERE are kept (a compromised staff account must be stoppable at once), but they are power: so the Boss is told
 *  on WhatsApp EVERY time, as for Work as (who, whom, when, why), and how the telling went is written down ("developer.access_notice").
 *
 *  Every function re-checks on the server that the caller is a Developer (the account's role in the database, never a form field or a
 *  parameter); a refused attempt by a Developer is kept in the audit trail.
 */

const FORBIDDEN_DEV = "Only the Developer account can do this.";
const notFound = () => new AppError(msg("Staff member not found."), "NOT_FOUND");
/** The shortest reason that is accepted for a suspension or a re-activation. */
const MIN_REASON = 5;

/**
 * Does this role (read from the database now) hold ANY right the Developer is denied — money, or the management of accounts
 * (DEVELOPER_DENIED)? Then the Developer never switches its accounts back on, even ones it suspended itself: the Boss or the MD does that.
 * (The Developer cannot create or change accounts, passwords, roles or rights at all — see services/staff-accounts.ts; this is the one
 * account switch it has, and it stops short of the people who run the money.)
 */
async function roleHoldsDeniedRight(roleId: string): Promise<boolean> {
  return (await db.rolePermission.count({ where: { roleId, permission: { code: { in: [...DEVELOPER_DENIED] } } } })) > 0;
}
/** Said to the Developer when it tries to switch back on an account whose role holds a right it is denied — and written in the failed attempt's audit entry. */
export const REACTIVATE_REFUSAL = msg("The Developer account cannot switch this account back on: its role holds rights about money or accounts. Ask the Boss or the MD.");

/** The request's address, or none outside a request (a job, a test without headers). */
async function callerIp(): Promise<string | null> {
  try { return (await requestMeta()).ipAddress; } catch { return null; }
}

// Someone who is not a Developer at the Developer's door is kept in one place (the pages use it too): services/endpoint-refusal.ts.
export { ENDPOINT_REFUSED_ACTION, ENDPOINT_REFUSED_MINUTES } from "./endpoint-refusal";

/** A signed-in Developer session (while working as someone too) — for pages and actions of the Developer console. It does not go through authorize(). */
export async function requireDeveloperSession(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Your session has expired. Please sign in again.", "UNAUTHENTICATED");
  if (user.actorType !== "DEVELOPER") {
    // A staff member at the Developer's door: refused, and not without a trace.
    await keepEndpointRefusal(user);
    throw new AppError(FORBIDDEN_DEV, "FORBIDDEN");
  }
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
  /** Delete (not only suspend) — everyone except the Boss, the MD and the Developers; refused again by the server when the person has records. */
  canDelete: boolean;
  /** Why a button is missing, in English ("Can't be suspended or signed out here") — shown with t(). */
  note: string | null;
}

/** The order the roles are listed in: the Boss first, then management, then the departments; any other role after them by name. */
const ROLE_ORDER = ["OWNER", "ADMIN", "MANAGER", "FINANCE", "ACCOUNTANT", "RECEPTIONIST", "RESTAURANT", "KITCHEN", "RESTAURANT_SCREEN", "DRIVER"];
const NOTE_PERMANENT = msg("Permanent owner: can't be suspended or deleted");
const NOTE_LAST_BOSS = msg("The only Boss: can't be suspended or deleted");
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
    where: { removedAt: null, role: { code: { notIn: [DEVELOPER_ROLE_CODE, SYSTEM_ROLE_CODE] } } },
    select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true, roleId: true, role: { select: { code: true, name: true, description: true } } },
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });
  const off = users.filter((u) => !u.isActive);
  const offRoleIds = [...new Set(off.map((u) => u.roleId))];
  const [mine, blockedList] = await Promise.all([
    suspendedByMe(dev.id, off.map((u) => u.id)),
    Promise.all(offRoleIds.map(async (roleId) => ((await roleHoldsDeniedRight(roleId)) ? roleId : null))),
  ]);
  const blockedRoles = new Set(blockedList.filter((r): r is string => r !== null));

  const activeBosses = users.filter((u) => u.role.code === "OWNER" && u.isActive).length;
  const groups = new Map<string, { roleCode: string; roleName: string; roleDescription: string; people: AccessPerson[] }>();
  for (const u of users) {
    const permanent = isPermanentOwner({ email: u.email, roleCode: u.role.code });
    const lastBoss = u.role.code === "OWNER" && u.isActive && activeBosses <= 1;
    const protectedOne = permanent || lastBoss;
    const canReactivate = !busy && !u.isActive && mine.has(u.id) && !blockedRoles.has(u.roleId);
    const person: AccessPerson = {
      id: u.id, fullName: u.fullName, email: u.email, roleCode: u.role.code, roleName: u.role.name, roleDescription: u.role.description ?? "",
      isActive: u.isActive, lastSignedInAt: u.lastLoginAt,
      canWorkAs: !busy && u.isActive,
      canSuspend: !busy && u.isActive && !protectedOne,
      canReactivate,
      canSignOut: !busy && u.isActive && !permanent,
      canDelete: !busy && !protectedOne,
      note: permanent ? NOTE_PERMANENT : lastBoss ? NOTE_LAST_BOSS : !u.isActive && !canReactivate ? NOTE_REACTIVATE : null,
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
  const already = () => refuse(new AppError(msg("You are already working as someone. Press Stop first."), "CONFLICT"), "already working as someone");
  if (developer.workAs) return already();
  // The session row may still say "working as" although the loader no longer honours it (the 4 hours are over, or that person has since been
  // switched off or removed): that is no work-as, so it must not block a new start. It is cleared first — and written down as ended by itself.
  // Only a row that is STILL good (a start that raced this one) blocks.
  if (session.workAsUserId || session.workAsStartedAt) {
    const inTime = withinWorkAsLimit(session.workAsStartedAt);
    const holder = session.workAsUserId && inTime ? await rawDb.user.findUnique({ where: { id: session.workAsUserId }, select: { isActive: true, role: { select: { code: true } } } }) : null;
    if (holder && canBeWorkedAs(holder)) return already();
    await recordWorkAsEnded({ id: session.id, workAsUserId: session.workAsUserId, workAsStartedAt: session.workAsStartedAt }, { id: developer.actorId, fullName: developer.actorName },
      session.workAsUserId && !inTime ? "limit" : "account", ipAddress);
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
  tellBossSoon((t, settings) => t("{developer} (Developer) started working as {person} ({role}) at {time}.", { developer: developerName, person, role: t(roleName), time: t.time(now, settings.timezone) }),
    // Once the notice is over, how it went is written down too — so the Boss's telling is traceable (best effort, it never blocks).
    async (told) => {
      await audit(db, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
        action: "developer.work_as_notice", entityType: "User", entityId: target.id,
        after: { targetName: person, recipients: told.recipients, told: told.told, failed: told.failed },
      });
    });

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
  const minutes = session.workAsStartedAt ? Math.max(0, Math.round((Date.now() - session.workAsStartedAt.getTime()) / 60_000)) : null;
  const ipAddress = await callerIp();
  // The end and its line in the trail are ONE transaction (as when a work-as ends by itself, see work-as-expired.ts): an end is never left
  // without its line. If the trail cannot be written, nothing changes — the Developer is still working as the person and may press Stop again.
  // The clearing is the claim, so two Stops at the same moment (or a Stop and an end by itself) make ONE line.
  await rawDb.$transaction(async (tx) => {
    const claimed = await tx.session.updateMany({
      where: { id: session.id, workAsUserId: session.workAsUserId, workAsStartedAt: session.workAsStartedAt },
      data: { workAsUserId: null, workAsStartedAt: null },
    });
    if (claimed.count !== 1) return; // someone else ended it (and wrote the line) first
    await audit(tx, { userId: user.actorId, label: user.actorName, ipAddress }, {
      action: "developer.work_as_ended", entityType: "User", entityId: session.workAsUserId,
      after: { targetName: session.workAsUser?.fullName ?? null, targetRole: session.workAsUser?.role.name ?? null, minutes },
    });
  });
}

// ───────────────────────────────────── suspend, switch back on, sign out ─────────────────────────────────────

/** The account the Developer may act on: a Developer account and the system's own are never touched here. */
async function loadAccount(userId: string) {
  const target = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target || target.removedAt || target.role.code === SYSTEM_ROLE_CODE) throw notFound();
  if (target.role.code === DEVELOPER_ROLE_CODE) throw new AppError(msg("A Developer account cannot be changed here."), "FORBIDDEN");
  return target;
}

/** The last active Boss can be neither suspended nor deleted: there must always be one. */
async function assertNotLastBoss(target: { id: string; isActive: boolean; role: { code: string } }): Promise<void> {
  if (target.role.code !== "OWNER" || !target.isActive) return;
  const others = await db.user.count({ where: { isActive: true, role: { code: "OWNER" }, id: { not: target.id } } });
  if (others === 0) throw new AppError(LAST_BOSS_REFUSAL, "FORBIDDEN");
}

function checkReason(raw: string | null | undefined): string {
  const reason = (raw ?? "").trim();
  if (reason.length < MIN_REASON) throw new AppError(msg("Give the reason for this change (at least 5 characters)."), "VALIDATION", { reason: msg("Give the reason (at least 5 characters).") });
  if (reason.length > 500) throw new AppError(msg("The reason is too long."), "VALIDATION", { reason: msg("The reason is too long.") });
  return reason;
}

/** A reason kept short for a WhatsApp message. */
const shortReason = (reason: string, max = 200) => (reason.length > max ? `${reason.slice(0, max - 1)}…` : reason);

/**
 * The Boss is told, on WhatsApp, that the Developer suspended an account or signed a person out everywhere — the same way as when a Work as
 * starts: who, whom, when and why, in each reader's language. It never blocks and never throws; how the telling went is written down
 * ("developer.access_notice": who was meant to be told, who was), so a notice that reached nobody can be seen in the Audit.
 */
function tellBossAboutAccess(
  developer: CurrentUser, ipAddress: string | null, now: Date,
  what: { kind: "suspended"; reason: string } | { kind: "deleted"; reason: string } | { kind: "signed_out_everywhere" } | { kind: "created" },
  target: { id: string; fullName: string; role: { name: string } },
) {
  const developerName = developer.actorName;
  const person = target.fullName;
  const roleName = target.role.name;
  tellBossSoon((t, settings) => {
    const vars = { developer: developerName, person, role: t(roleName), time: t.time(now, settings.timezone) };
    if (what.kind === "created") return t("{developer} (Developer) created an account for {person} ({role}) at {time}.", vars);
    if (what.kind === "deleted") return t("{developer} (Developer) deleted the account of {person} ({role}) at {time}. Reason: {reason}. Everything they did stays recorded under their name.", { ...vars, reason: shortReason(what.reason) });
    return what.kind === "suspended"
      ? t("{developer} (Developer) suspended {person} ({role}) at {time}. Reason: {reason}. You can switch the account back on in Staff & roles.", { ...vars, reason: shortReason(what.reason) })
      : t("{developer} (Developer) signed {person} ({role}) out of every phone and computer at {time}. They can sign straight back in.", vars);
  },
  async (told) => {
    await audit(db, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
      action: "developer.access_notice", entityType: "User", entityId: target.id,
      after: { what: what.kind, targetName: person, targetRole: roleName, recipients: told.recipients, told: told.told, failed: told.failed },
    });
  });
}

/** Switch an account off and sign its person out everywhere, until it is switched back on. Needs a reason and the word CONFIRM. The Boss is told. */
export async function suspendAccount(developer: CurrentUser, targetUserId: string, input: { reason: string; confirm: string }): Promise<void> {
  await verifiedDeveloper(developer);
  return attempt(developer, "user.suspend_failed", targetUserId, {}, async () => {
    assertNotWorkAs(developer, "suspend accounts");
    const reason = checkReason(input.reason);
    if (input.confirm !== "CONFIRM") throw new AppError(msg("Type CONFIRM to suspend this account."), "VALIDATION", { confirm: msg("Type CONFIRM exactly.") });
    const target = await loadAccount(targetUserId);
    if (target.id === developer.actorId) throw new AppError(msg("You cannot suspend your own account."), "FORBIDDEN");
    if (isPermanentOwner({ email: target.email, roleCode: target.role.code })) throw new AppError(PERMANENT_OWNER_REFUSAL, "FORBIDDEN");
    if (!target.isActive) throw new AppError(msg("This account is already suspended."), "CONFLICT");
    await assertNotLastBoss(target);
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
    // Told only once the suspension stands (a refused or failed one tells nobody).
    tellBossAboutAccess(developer, ipAddress, new Date(), { kind: "suspended", reason }, target);
  });
}

/**
 * DELETE an account (owner, 2026-10-19: "as Developer I should be able to delete an account, not only suspend it" — and "delete an account does not
 * delete the data: the records stay, with that name and who did what"). Needs a reason and the word DELETE. The person is signed out, can never sign in
 * again and the account leaves every list; the account row stays, so everything they did (bookings, payments, shifts, orders, audit entries) keeps
 * their name — which is why even a person with records can be deleted. Any account can be deleted — the Boss's and the MD's too — except another
 * Developer's, the system's, your own, a permanent owner's and the last active Boss's.
 * Written to the audit trail under the Developer, and the Boss is told.
 */
export async function deleteAccount(developer: CurrentUser, targetUserId: string, input: { reason: string; confirm: string }): Promise<void> {
  await verifiedDeveloper(developer);
  return attempt(developer, "user.delete_failed", targetUserId, {}, async () => {
    assertNotWorkAs(developer, "delete accounts");
    const reason = checkReason(input.reason);
    if (input.confirm !== "DELETE") throw new AppError(msg("Type DELETE to delete this account."), "VALIDATION", { confirm: msg("Type DELETE exactly.") });
    const target = await loadAccount(targetUserId);
    if (target.id === developer.actorId) throw new AppError(msg("You cannot delete your own account."), "FORBIDDEN");
    if (isPermanentOwner({ email: target.email, roleCode: target.role.code })) throw new AppError(PERMANENT_OWNER_REFUSAL, "FORBIDDEN");
    await assertNotLastBoss(target);
    const ipAddress = await callerIp();
    // The account is REMOVED, not erased: the person loses all access and the account leaves the lists, but everything they did stays under their name.
    const unusable = await unusablePasswordHash();
    await db.$transaction(async (tx) => {
      await removeAccountAccess(tx, target.id, unusable);
      await audit(tx, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
        action: "user.deleted", entityType: "User", entityId: target.id,
        before: { fullName: target.fullName, email: target.email, role: target.role.code, isActive: target.isActive },
        after: { reason, removed: true, recordsKept: true },
      });
    });
    // Told only once the account is gone (a refused or failed one tells nobody).
    tellBossAboutAccess(developer, ipAddress, new Date(), { kind: "deleted", reason }, target);
  });
}

/**
 * Switch back on an account THIS Developer suspended — only that (not one the Boss, the MD or another Developer switched off), and never an
 * account whose role holds any right the Developer is denied (money, or the management of accounts: the Boss or the MD does that).
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
    if (await roleHoldsDeniedRight(target.roleId)) {
      throw new AppError(REACTIVATE_REFUSAL, "FORBIDDEN");
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
    // A permanent owner is never signed out from here (the Access page hides the button; the server refuses it too).
    if (isPermanentOwner({ email: target.email, roleCode: target.role.code })) throw new AppError(msg("Can't sign a permanent owner out here"), "FORBIDDEN");
    const ipAddress = await callerIp();
    const done = await db.$transaction(async (tx) => {
      const ended = await tx.session.deleteMany({ where: { userId: target.id } });
      await audit(tx, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
        action: "user.signed_out_everywhere", entityType: "User", entityId: target.id,
        after: { fullName: target.fullName, role: target.role.code, sessionsEnded: ended.count },
      });
      return { sessionsEnded: ended.count };
    });
    tellBossAboutAccess(developer, ipAddress, new Date(), { kind: "signed_out_everywhere" }, target);
    return done;
  });
}

// ───────────────────────────── adding an account ─────────────────────────────

/** The roles an account can be given from the Access page: every role but the Developer's and the system's. */
export async function accountRoleChoices(developer: CurrentUser): Promise<{ id: string; name: string; code: string }[]> {
  await verifiedDeveloper(developer);
  return db.role.findMany({ where: { code: { notIn: [DEVELOPER_ROLE_CODE, SYSTEM_ROLE_CODE] } }, select: { id: true, name: true, code: true }, orderBy: { createdAt: "asc" } });
}

export interface NewAccountInput { fullName: string; email: string; phone: string | null; roleId: string; password: string }

/**
 * ADD AN ACCOUNT from the Access page. The password is a temporary one that is handed over: it is checked against the staff rule, stored
 * only as a hash, never written to the audit trail or the notice. The person signs in at once; nothing forces a change of password (owner,
 * 2026-10-18) — they change it from their account page when they wish. The creation is recorded under the Developer and the Boss is told
 * on WhatsApp. Not while working as someone.
 */
export async function createAccount(developer: CurrentUser, input: NewAccountInput): Promise<{ userId: string; fullName: string; email: string; roleName: string }> {
  await verifiedDeveloper(developer);
  return attempt(developer, "user.create_failed", "", { email: input.email, roleId: input.roleId }, async () => {
    assertNotWorkAs(developer, "add accounts");
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError(weak, "VALIDATION", { password: weak });
    const role = await db.role.findUnique({ where: { id: input.roleId } });
    if (!role || role.code === SYSTEM_ROLE_CODE || role.code === DEVELOPER_ROLE_CODE) throw new AppError(msg("Choose a role."), "VALIDATION", { roleId: msg("Choose a role.") });
    const ipAddress = await callerIp();
    let userId: string;
    try {
      userId = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { fullName: input.fullName, email: input.email, phone: input.phone, roleId: role.id, passwordHash: await hashPassword(input.password), mustChangePassword: false },
        });
        await numberWaitersTx(tx); // a new waiter gets the next WTR number
        await audit(tx, { userId: developer.actorId, label: developer.actorName, ipAddress }, {
          action: "user.created", entityType: "User", entityId: user.id,
          after: { fullName: user.fullName, email: user.email, role: role.code, createdBy: "Developer console" },
        });
        return user.id;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("A staff account with this email already exists.", "CONFLICT", { email: msg("Already in use") });
      throw e;
    }
    tellBossAboutAccess(developer, ipAddress, new Date(), { kind: "created" }, { id: userId, fullName: input.fullName, role: { name: role.name } });
    return { userId, fullName: input.fullName, email: input.email, roleName: role.name };
  });
}
