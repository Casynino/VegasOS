import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { assertNotWorkAs, hashPassword, validatePasswordStrength } from "../auth";
import { AppError, isUniqueViolation } from "../errors";
import { DEVELOPER_DENIED, DEVELOPER_ROLE_CODE, isDeveloperOnly, PERMISSIONS } from "@/lib/permissions";
import { numberWaitersTx } from "./waiter-number";
import { msg } from "@/i18n/msg";

/**
 * Staff accounts and what each role may do — every rule lives here, on the server, so the Users page (and anything else)
 * cannot get round it. The actions in app/staff/(app)/users only check the signed-in person's right, read the form and call this.
 *
 * The Developer account (owner, 2026-10-14):
 *  - it is made ONLY by the setup script — nobody can create it, or give its role to anyone, from here;
 *  - no one but a Developer can see, edit, deactivate, reset, remove or change the role of a Developer account (it simply is not found);
 *  - nobody — the Developer included — can give the right "developer.access" to a role, or change the Developer role's rights;
 *  - a Developer who makes a sensitive change gives a reason (5+ characters), written into the audit entry;
 *  - every change is audited with before / after (never a password or a hash), and a refused attempt is audited as "…_failed";
 *  - NO BACK DOOR TO MONEY (owner, 2026-10-14): the Developer can never write money, so it must not be able to make — or take over — an
 *    account that can. For a Developer acting here (read from the database, so it follows the data):
 *      a. an account whose role holds ANY money right (DEVELOPER_DENIED, or "users.manage", which could make such an account) cannot be
 *         created, re-activated, re-emailed, re-roled, reset or removed by it, and such a role cannot be given to anyone;
 *      b. no money right (and not "users.manage") can be given to any role, and "audit.view" can never be taken away (oversight stays);
 *      c. nobody can reset a Developer account's password here (only the setup script's --rotate does), the Developer's own included.
 *    The Boss, the MD and everyone else keep exactly what they have today.
 *  - WORKING AS SOMEONE (owner, 2026-10-17): while a Developer works as another person NOTHING here may be changed — no account made,
 *    changed, re-emailed, reset or removed, no right given or taken. Every changing function starts with assertNotWorkAs (a refused
 *    attempt is audited like any other), and the database refuses the same writes underneath (the fence in server/db.ts). Looking at the
 *    list (staffDirectory) stays open.
 */

/** "Online · nTZS" — the system account that records what customers pay online; never a person's role. */
export const SYSTEM_ROLE = "SYSTEM_ONLINE";
export const MIN_REASON = 5;
const MAX_REASON = 500;

/** Who is acting: from the signed-in session on the server (authorize()) — never from the form or the page. */
export interface AccountActor {
  id: string;
  fullName: string;
  roleCode: string;
  actorType: "DEVELOPER" | "STAFF";
  /** Set (by authorize()) while a Developer works as someone: nothing here may then be changed. */
  workAs?: object | null;
}
export interface AccountMeta { ipAddress?: string | null }

const isDev = (a: AccountActor) => a.actorType === "DEVELOPER" || a.roleCode === DEVELOPER_ROLE_CODE;
const notFound = () => new AppError(msg("Staff member not found."), "NOT_FOUND");

/**
 * The rights that put an account (or a role) out of the Developer's reach: every right it is denied (money), and "users.manage" —
 * an account that can make accounts could make one that moves money, which is the same back door one step later.
 */
export const DEVELOPER_NO_BACK_DOOR: readonly string[] = [...DEVELOPER_DENIED, "users.manage"];
/** True when these rights (a role's) put it out of the Developer's reach. The Users page uses it to show only what can work. */
export const blocksDeveloper = (rightCodes: Iterable<string>) => [...rightCodes].some((c) => DEVELOPER_NO_BACK_DOOR.includes(c));
const moneyBlocked = () => new AppError(msg("The Developer account cannot do this: it would give access to money. Ask the Boss or the MD."), "FORBIDDEN");
/**
 * Does this role (read from the database now) hold any right that puts it out of the Developer's reach? The Developer role is the one
 * exception: it holds "users.manage" itself, and its accounts are fenced by their own rules (its role is never given, changed or reset here).
 */
export async function roleBlocksDeveloper(roleId: string): Promise<boolean> {
  return (await db.rolePermission.count({ where: { roleId, role: { code: { not: DEVELOPER_ROLE_CODE } }, permission: { code: { in: [...DEVELOPER_NO_BACK_DOOR] } } } })) > 0;
}
/**
 * "This email is already used" for a person who may see every account; for anyone else the Developer's own email is never confirmed as
 * "already there" — it says only that it cannot be used.
 */
async function emailConflict(actor: AccountActor, email: string): Promise<AppError> {
  if (!isDev(actor)) {
    const holder = await db.user.findUnique({ where: { email }, select: { role: { select: { code: true } } } });
    if (holder?.role.code === DEVELOPER_ROLE_CODE) {
      return new AppError(msg("This email cannot be used."), "CONFLICT", { email: msg("This email cannot be used.") });
    }
  }
  return new AppError("A staff account with this email already exists.", "CONFLICT", { email: msg("Already in use") });
}

/** A Developer's reason for a sensitive change: required (5+ characters). Anyone else is never asked. */
function reasonOf(actor: AccountActor, raw: string | null | undefined): string | null {
  if (!isDev(actor)) return null;
  const reason = (raw ?? "").trim();
  if (reason.length < MIN_REASON) {
    throw new AppError(msg("Give the reason for this change (at least 5 characters)."), "VALIDATION", { reason: msg("Give the reason (at least 5 characters).") });
  }
  if (reason.length > MAX_REASON) throw new AppError(msg("The reason is too long."), "VALIDATION", { reason: msg("The reason is too long.") });
  return reason;
}

/** A refused attempt is kept in the audit trail (best effort — it never changes what the person sees). */
async function sensitive<T>(
  actor: AccountActor, meta: AccountMeta,
  fail: { action: string; entityType: "User" | "Role"; entityId?: string | null; context?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const known = e instanceof AppError;
    // A Developer's every failed attempt is kept; for staff, mistakes in a form (VALIDATION) are not worth a line — a refusal is.
    if (isDev(actor) || (known && e.code !== "VALIDATION")) {
      try {
        await audit(db, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
          action: fail.action, entityType: fail.entityType, entityId: fail.entityId ?? null,
          after: { ...fail.context, error: known ? e.message : "unexpected error", code: known ? e.code : "ERROR" },
        });
      } catch { /* the audit trail must never break the answer */ }
    }
    throw e;
  }
}

async function assertCanAssignRole(actor: AccountActor, roleId: string) {
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new AppError("Role not found.", "NOT_FOUND");
  if (role.code === SYSTEM_ROLE) throw new AppError("That role is for the system only.", "FORBIDDEN");
  if (role.code === DEVELOPER_ROLE_CODE) {
    // Someone who cannot see the Developer role never learns it exists.
    if (!isDev(actor)) throw new AppError("Role not found.", "NOT_FOUND");
    throw new AppError(msg("The Developer account is made only by the setup script — it cannot be given here."), "FORBIDDEN");
  }
  if (role.code === "OWNER" && actor.roleCode !== "OWNER") {
    throw new AppError("Only an owner can grant the Owner role.", "FORBIDDEN");
  }
  // The Developer never gives a role that holds money rights (or "users.manage") — to a new account or to an existing one.
  if (isDev(actor) && (await roleBlocksDeveloper(role.id))) throw moneyBlocked();
  return role;
}

/** The target account — a system account is never listed, and a Developer account is not there for anyone who is not a Developer. */
async function loadTarget(actor: AccountActor, userId: string) {
  const target = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target || target.role.code === SYSTEM_ROLE) throw notFound();
  if (target.role.code === DEVELOPER_ROLE_CODE && !isDev(actor)) throw notFound();
  return target;
}

// ───────────────────────────── what the Users page may show ─────────────────────────────

/** The staff list and the roles this person may see (a Developer account and the Developer role only for a Developer). */
export async function staffDirectory(actor: AccountActor) {
  const dev = isDev(actor);
  const hidden = dev ? [SYSTEM_ROLE] : [SYSTEM_ROLE, DEVELOPER_ROLE_CODE];
  const [users, roles] = await Promise.all([
    // The PIN's state only (set / locked) — never its hash. "Online · nTZS" is not a person — never listed or edited here.
    db.user.findMany({
      where: { role: { code: { notIn: hidden } } },
      select: {
        id: true, fullName: true, email: true, phone: true, roleId: true, isActive: true, mustChangePassword: true, lastLoginAt: true,
        role: { select: { code: true, name: true } },
      },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    }),
    db.role.findMany({ where: { code: { notIn: hidden } }, include: { permissions: { include: { permission: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return { users, roles };
}

// ───────────────────────────────────── changes ─────────────────────────────────────

export interface CreateAccountInput { fullName: string; email: string; phone: string | null; roleId: string; password: string; reason?: string | null }

export async function createStaffAccount(actor: AccountActor, input: CreateAccountInput, meta: AccountMeta = {}): Promise<string> {
  return sensitive(actor, meta, { action: "user.create_failed", entityType: "User", context: { email: input.email, roleId: input.roleId, reason: input.reason?.trim() || undefined } }, async () => {
    assertNotWorkAs(actor, "create accounts");
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError(weak, "VALIDATION", { password: weak });
    const role = await assertCanAssignRole(actor, input.roleId);
    const reason = reasonOf(actor, input.reason);
    try {
      return await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName: input.fullName, email: input.email, phone: input.phone, roleId: role.id,
            passwordHash: await hashPassword(input.password), mustChangePassword: false,
          },
        });
        await numberWaitersTx(tx); // a new waiter gets the next WTR number
        await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
          action: "user.created", entityType: "User", entityId: user.id,
          after: { fullName: user.fullName, email: user.email, role: role.code, ...(reason && { reason }) },
        });
        return user.id;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw await emailConflict(actor, input.email);
      throw e;
    }
  });
}

export interface UpdateAccountInput { userId: string; fullName: string; email: string; phone: string | null; roleId: string; isActive: boolean; reason?: string | null }

export async function updateStaffAccount(actor: AccountActor, input: UpdateAccountInput, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.update_failed", entityType: "User", entityId: input.userId, context: { roleId: input.roleId, isActive: input.isActive, reason: input.reason?.trim() || undefined } }, async () => {
    assertNotWorkAs(actor, "change accounts, roles or login emails");
    const target = await loadTarget(actor, input.userId);
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can change an owner account.", "FORBIDDEN");
    }
    // An account with money access: the Developer may change its name and phone and switch it OFF (a safety brake) — never its sign-in
    // email, its role, or switch it back on (each of those could hand the account to someone else).
    if (isDev(actor) && (input.roleId !== target.roleId || input.email !== target.email || (input.isActive && !target.isActive)) && (await roleBlocksDeveloper(target.roleId))) {
      throw moneyBlocked();
    }
    // An unchanged role needs no check (a Developer account keeps its role when its name is edited); a new one is checked in full.
    const newRole = input.roleId === target.roleId ? target.role : await assertCanAssignRole(actor, input.roleId);
    if (target.id === actor.id && (!input.isActive || newRole.id !== target.roleId)) {
      throw new AppError("You cannot deactivate yourself or change your own role.");
    }
    const losingOwner = target.role.code === "OWNER" && target.isActive && (newRole.code !== "OWNER" || !input.isActive);
    if (losingOwner) {
      const owners = await db.user.count({ where: { isActive: true, role: { code: "OWNER" } } });
      if (owners <= 1) throw new AppError("There must always be at least one active owner.");
    }
    const roleChanged = newRole.id !== target.roleId;
    const activeChanged = input.isActive !== target.isActive;
    const emailChanged = input.email !== target.email;
    // A role, the email (how they sign in) and switching an account on or off are the sensitive ones.
    const reason = roleChanged || activeChanged || emailChanged ? reasonOf(actor, input.reason) : null;

    try {
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: target.id },
          data: { fullName: input.fullName, email: input.email, phone: input.phone, roleId: newRole.id, isActive: input.isActive },
        });
        if (!input.isActive || roleChanged || emailChanged) {
          await tx.session.deleteMany({ where: { userId: target.id } }); // force re-login
        }
        if (roleChanged) await numberWaitersTx(tx); // became a waiter: they get a WTR number
        await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
          action: roleChanged ? "user.role_changed" : activeChanged ? (input.isActive ? "user.reactivated" : "user.deactivated") : "user.updated",
          entityType: "User", entityId: target.id,
          before: { fullName: target.fullName, email: target.email, phone: target.phone, role: target.role.code, isActive: target.isActive },
          after: { fullName: input.fullName, email: input.email, phone: input.phone, role: newRole.code, isActive: input.isActive, ...(reason && { reason }) },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw await emailConflict(actor, input.email);
      throw e;
    }
  });
}

export async function resetStaffPassword(actor: AccountActor, input: { userId: string; password: string; reason?: string | null }, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.password_reset_failed", entityType: "User", entityId: input.userId, context: { reason: input.reason?.trim() || undefined } }, async () => {
    assertNotWorkAs(actor, "change a password");
    // A Developer's reset follows the same password rule as everyone's.
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError(weak, "VALIDATION", { password: weak });
    const target = await loadTarget(actor, input.userId);
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can reset an owner's password.", "FORBIDDEN");
    }
    // A Developer account's password is changed only by the setup script (--rotate): no one can reset it here, the Developer's own included.
    if (target.role.code === DEVELOPER_ROLE_CODE) throw new AppError(msg("A Developer password is changed only with the setup script, not here."), "FORBIDDEN");
    if (isDev(actor) && (await roleBlocksDeveloper(target.roleId))) throw moneyBlocked();
    const reason = reasonOf(actor, input.reason);
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { passwordHash: await hashPassword(input.password), mustChangePassword: false },
      });
      const ended = await tx.session.deleteMany({ where: { userId: target.id } });
      // Never the password or its hash — only that it was reset and who was signed out.
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
        action: "user.password_reset", entityType: "User", entityId: target.id,
        before: { fullName: target.fullName, email: target.email, role: target.role.code },
        after: { reset: true, signedOut: ended.count, ...(reason && { reason }) },
      });
    });
  });
}

export interface RolePermissionInput { roleId: string; permission: string; granted: boolean; reason?: string | null }

export async function setRolePermission(actor: AccountActor, input: RolePermissionInput, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.permission_change_failed", entityType: "Role", entityId: input.roleId, context: { permission: input.permission, granted: input.granted, reason: input.reason?.trim() || undefined } }, async () => {
    assertNotWorkAs(actor, "change roles or rights");
    // Own keys only: "constructor" or "toString" are not rights (they would pass an `in` check and then fail as a server error).
    if (!Object.hasOwn(PERMISSIONS, input.permission)) throw new AppError("Unknown permission.", "VALIDATION");
    // "developer.access" belongs to the Developer role alone — no one can give it to a role, not even the Developer.
    if (isDeveloperOnly(input.permission)) throw new AppError(msg("That right belongs to the Developer role alone — it cannot be given to or taken from any role here."), "FORBIDDEN");
    const role = await db.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new AppError("Role not found.", "NOT_FOUND");
    if (role.code === DEVELOPER_ROLE_CODE) {
      if (!isDev(actor)) throw new AppError("Role not found.", "NOT_FOUND");
      throw new AppError(msg("The Developer role's rights cannot be changed here."), "FORBIDDEN");
    }
    if (role.code === "OWNER") throw new AppError("The Owner role always has every permission.");
    if (role.code === SYSTEM_ROLE) throw new AppError("That role is for the system only.", "FORBIDDEN");
    if (actor.roleCode !== "OWNER" && role.code === "MANAGER") {
      throw new AppError("Only an owner can change manager permissions.", "FORBIDDEN");
    }
    if (isDev(actor)) {
      // The Developer never gives a right that moves money (or lets someone make such an account), and never takes oversight away.
      if (input.granted && (DEVELOPER_DENIED as readonly string[]).includes(input.permission)) {
        throw new AppError(msg("The Developer account cannot give this right: it is about money. Ask the Boss or the MD."), "FORBIDDEN");
      }
      if (input.granted && input.permission === "users.manage") {
        throw new AppError(msg("The Developer account cannot give the right to manage staff accounts. Ask the Boss or the MD."), "FORBIDDEN");
      }
      if (!input.granted && input.permission === "audit.view") {
        throw new AppError(msg("The Developer account cannot take away the right to see the audit trail. Ask the Boss or the MD."), "FORBIDDEN");
      }
    }
    const reason = reasonOf(actor, input.reason);
    const permission = await db.permission.findUniqueOrThrow({ where: { code: input.permission } });
    await db.$transaction(async (tx) => {
      if (input.granted) {
        await tx.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: permission.id }], skipDuplicates: true });
      } else {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      }
      await numberWaitersTx(tx); // a role that now works waiter shifts: its people get WTR numbers
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
        action: "user.permission_changed", entityType: "Role", entityId: role.id,
        before: { role: role.code, permission: input.permission, granted: !input.granted },
        after: { role: role.code, permission: input.permission, granted: input.granted, ...(reason && { reason }) },
      });
    });
  });
}

const isFkViolation = (err: unknown) => {
  const e = err as { code?: string };
  if (e?.code === "P2003" || e?.code === "P2014") return true;
  const text = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
  return text.includes("23503") || text.includes("foreign key");
};

export async function deleteStaffAccount(actor: AccountActor, input: { userId: string; reason?: string | null }, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.delete_failed", entityType: "User", entityId: input.userId, context: { reason: input.reason?.trim() || undefined } }, async () => {
    assertNotWorkAs(actor, "remove accounts");
    const target = await loadTarget(actor, input.userId);
    if (target.id === actor.id) throw new AppError("You cannot delete your own account.");
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can delete an owner account.", "FORBIDDEN");
    }
    if (isDev(actor) && (await roleBlocksDeveloper(target.roleId))) throw moneyBlocked();
    if (target.role.code === "OWNER") {
      const owners = await db.user.count({ where: { isActive: true, role: { code: "OWNER" } } });
      if (owners <= 1) throw new AppError("There must always be at least one active owner.");
    }
    const reason = reasonOf(actor, input.reason);
    try {
      await db.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: target.id } });
        await tx.user.delete({ where: { id: target.id } });
        await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
          action: "user.deleted", entityType: "User", entityId: target.id,
          before: { fullName: target.fullName, email: target.email, role: target.role.code },
          ...(reason && { after: { reason } }),
        });
      });
    } catch (e) {
      if (isFkViolation(e)) {
        throw new AppError("This person has records in the system (shifts, payments, etc.). Deactivate their account instead.", "CONFLICT");
      }
      throw e;
    }
  });
}
