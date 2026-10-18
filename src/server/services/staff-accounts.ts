import "server-only";
import { isPermanentOwner, PERMANENT_OWNER_REFUSAL } from "@/lib/permanent-owners";
import { removeAccountAccess, unusablePasswordHash } from "./account-removal";
import { db } from "../db";
import { audit } from "../audit";
import { hashPassword, validatePasswordStrength } from "../auth";
import { AppError, isUniqueViolation } from "../errors";
import { DEVELOPER_ROLE_CODE, isDeveloperOnly, PERMISSIONS } from "@/lib/permissions";
import { numberWaitersTx } from "./waiter-number";
import { msg } from "@/i18n/msg";

/**
 * Staff accounts and what each role may do — every rule lives here, on the server, so the Users page (and anything else)
 * cannot get round it. The actions in app/staff/(app)/users only check the signed-in person's right, read the form and call this.
 *
 * THE DEVELOPER AND ACCOUNTS (owner, 2026-10-18, after every allow-list design was walked around in review):
 *  - THE DEVELOPER CANNOT CREATE OR CHANGE ACCOUNTS, PASSWORDS, LOGIN EMAILS, ROLES OR RIGHTS AT ALL. Only the Boss and the MD do (Users page).
 *    An account the Developer made, or whose password it set, is an account it can sign in as — and that account is not a Developer, so none of
 *    the Developer's fences apply to it. Whatever list of "harmless" rights is chosen, it can be got round (empty a role, then make an account in
 *    it; a password that outlives a widened role; a second Developer editing another). So there is no list: EVERY changing function here —
 *    createStaffAccount, updateStaffAccount, resetStaffPassword, deleteStaffAccount, setRolePermission (and so every role given to anyone) —
 *    refuses an actor who is a Developer (actorType DEVELOPER, the Developer role, or a Developer working as someone) with ONE plain message,
 *    before anything is read or written, and the refused attempt is audited as "…_failed" under the Developer.
 *  - Underneath, the Developer role does not hold "users.manage" (it is in DEVELOPER_DENIED), so the Users page and its actions are closed to it
 *    before they ever get here; this refusal is the second lock, for a role edited by hand in the database or a caller that skipped the first.
 *  - What the Developer keeps for accounts is on the Access page (services/work-as.ts): Work as, Suspend (reason + CONFIRM), Sign out everywhere,
 *    and Re-activate only its own suspensions of accounts whose role holds no right the Developer is denied.
 *  - The Developer account is made ONLY by the setup script: nobody can create it, or give its role to anyone, from here;
 *  - no one else can see, edit, deactivate, reset, remove or change the role of a Developer account (it simply is not found), and the Developer
 *    role and account are never listed;
 *  - nobody can give the right "developer.access" to a role, or change the Developer role's rights;
 *  - every change is audited with before / after (never a password or a hash), and a refused attempt is audited as "…_failed".
 */

/** "Online · nTZS" — the system account that records what customers pay online; never a person's role. */
export const SYSTEM_ROLE = "SYSTEM_ONLINE";

/** Who is acting: from the signed-in session on the server (authorize()) — never from the form or the page. */
export interface AccountActor {
  id: string;
  fullName: string;
  roleCode: string;
  actorType: "DEVELOPER" | "STAFF";
  /** Set (by authorize()) while a Developer works as someone. */
  workAs?: object | null;
}
export interface AccountMeta { ipAddress?: string | null }

/** A Developer: the account type, the Developer role, or a Developer working as someone (then the role is the person's, the type is still Developer). */
const isDev = (a: AccountActor) => a.actorType === "DEVELOPER" || a.roleCode === DEVELOPER_ROLE_CODE || !!a.workAs;
const notFound = () => new AppError(msg("Staff member not found."), "NOT_FOUND");

/** The one thing a Developer is told by every changing function here — and what the failed attempt's audit entry says. */
export const DEVELOPER_NO_ACCOUNTS = msg("The Developer account cannot create or change accounts, passwords, roles or rights. Ask the Boss or the MD.");
const refuseDeveloper = (actor: AccountActor) => {
  if (isDev(actor)) throw new AppError(DEVELOPER_NO_ACCOUNTS, "FORBIDDEN");
};

/** A refused attempt is kept in the audit trail (best effort — it never changes what the person sees). */
async function sensitive<T>(
  actor: AccountActor, meta: AccountMeta,
  fail: { action: string; entityType: "User" | "Role"; entityId?: string | null; context?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    refuseDeveloper(actor); // first of all: before anything is read, checked or written
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
  // The Developer role is made only by the setup script; to everyone who reaches this it does not exist.
  if (role.code === DEVELOPER_ROLE_CODE) throw new AppError("Role not found.", "NOT_FOUND");
  if (role.code === "OWNER" && actor.roleCode !== "OWNER") {
    throw new AppError("Only an owner can grant the Owner role.", "FORBIDDEN");
  }
  return role;
}

/** The target account — a system account is never listed, and a Developer account is not there for anyone who reaches this. */
async function loadTarget(userId: string) {
  const target = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target || target.removedAt || target.role.code === SYSTEM_ROLE || target.role.code === DEVELOPER_ROLE_CODE) throw notFound();
  return target;
}

// ───────────────────────────── what the Users page may show ─────────────────────────────

/** The staff list and the roles the Users page shows: never the system account, and never the Developer account or the Developer role. */
export async function staffDirectory() {
  const hidden = [SYSTEM_ROLE, DEVELOPER_ROLE_CODE];
  const [users, roles] = await Promise.all([
    // The PIN's state only (set / locked) — never its hash. "Online · nTZS" is not a person — never listed or edited here.
    db.user.findMany({
      where: { removedAt: null, role: { code: { notIn: hidden } } },
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

/** An email that is taken is worded the same whoever holds it — no address, the Developer's included, is singled out. */
const emailInUse = () => new AppError("A staff account with this email already exists.", "CONFLICT", { email: msg("Already in use") });

export interface CreateAccountInput { fullName: string; email: string; phone: string | null; roleId: string; password: string }

export async function createStaffAccount(actor: AccountActor, input: CreateAccountInput, meta: AccountMeta = {}): Promise<string> {
  return sensitive(actor, meta, { action: "user.create_failed", entityType: "User", context: { email: input.email, roleId: input.roleId } }, async () => {
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError(weak, "VALIDATION", { password: weak });
    const role = await assertCanAssignRole(actor, input.roleId);
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
          after: { fullName: user.fullName, email: user.email, role: role.code },
        });
        return user.id;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw emailInUse();
      throw e;
    }
  });
}

export interface UpdateAccountInput { userId: string; fullName: string; email: string; phone: string | null; roleId: string; isActive: boolean }

export async function updateStaffAccount(actor: AccountActor, input: UpdateAccountInput, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.update_failed", entityType: "User", entityId: input.userId, context: { roleId: input.roleId, isActive: input.isActive } }, async () => {
    const target = await loadTarget(input.userId);
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can change an owner account.", "FORBIDDEN");
    }
    const newRole = await assertCanAssignRole(actor, input.roleId);
    if (target.id === actor.id && (!input.isActive || newRole.id !== target.roleId)) {
      throw new AppError("You cannot deactivate yourself or change your own role.");
    }
    if (target.isActive && !input.isActive && isPermanentOwner({ email: target.email, roleCode: target.role.code })) throw new AppError(PERMANENT_OWNER_REFUSAL, "FORBIDDEN");
    const losingOwner = target.role.code === "OWNER" && target.isActive && (newRole.code !== "OWNER" || !input.isActive);
    if (losingOwner) {
      const owners = await db.user.count({ where: { isActive: true, role: { code: "OWNER" } } });
      if (owners <= 1) throw new AppError("There must always be at least one active owner.");
    }
    const roleChanged = newRole.id !== target.roleId;
    const activeChanged = input.isActive !== target.isActive;
    const emailChanged = input.email !== target.email;

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
        // Switching an account on or off is written as such: the Developer's Access page reads these lines to know whose switch was the last.
        await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
          action: roleChanged ? "user.role_changed" : activeChanged ? (input.isActive ? "user.reactivated" : "user.deactivated") : "user.updated",
          entityType: "User", entityId: target.id,
          before: { fullName: target.fullName, email: target.email, phone: target.phone, role: target.role.code, isActive: target.isActive },
          after: { fullName: input.fullName, email: input.email, phone: input.phone, role: newRole.code, isActive: input.isActive },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw emailInUse();
      throw e;
    }
  });
}

export async function resetStaffPassword(actor: AccountActor, input: { userId: string; password: string }, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.password_reset_failed", entityType: "User", entityId: input.userId }, async () => {
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError(weak, "VALIDATION", { password: weak });
    const target = await loadTarget(input.userId);
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can reset an owner's password.", "FORBIDDEN");
    }
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
        after: { reset: true, signedOut: ended.count },
      });
    });
  });
}

export interface RolePermissionInput { roleId: string; permission: string; granted: boolean }

export async function setRolePermission(actor: AccountActor, input: RolePermissionInput, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.permission_change_failed", entityType: "Role", entityId: input.roleId, context: { permission: input.permission, granted: input.granted } }, async () => {
    // Own keys only: "constructor" or "toString" are not rights (they would pass an `in` check and then fail as a server error).
    if (!Object.hasOwn(PERMISSIONS, input.permission)) throw new AppError("Unknown permission.", "VALIDATION");
    // "developer.access" belongs to the Developer role alone — no one can give it to a role.
    if (isDeveloperOnly(input.permission)) throw new AppError(msg("That right belongs to the Developer role alone — it cannot be given to or taken from any role here."), "FORBIDDEN");
    const role = await db.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new AppError("Role not found.", "NOT_FOUND");
    // The Developer role is not there for anyone who reaches this: its rights are fixed by the system.
    if (role.code === DEVELOPER_ROLE_CODE) throw new AppError("Role not found.", "NOT_FOUND");
    if (role.code === "OWNER") throw new AppError("The Owner role always has every permission.");
    if (role.code === SYSTEM_ROLE) throw new AppError("That role is for the system only.", "FORBIDDEN");
    if (actor.roleCode !== "OWNER" && role.code === "MANAGER") {
      throw new AppError("Only an owner can change manager permissions.", "FORBIDDEN");
    }
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
        after: { role: role.code, permission: input.permission, granted: input.granted },
      });
    });
  });
}

export async function deleteStaffAccount(actor: AccountActor, input: { userId: string }, meta: AccountMeta = {}): Promise<void> {
  return sensitive(actor, meta, { action: "user.delete_failed", entityType: "User", entityId: input.userId }, async () => {
    const target = await loadTarget(input.userId);
    if (target.id === actor.id) throw new AppError("You cannot delete your own account.");
    if (isPermanentOwner({ email: target.email, roleCode: target.role.code })) throw new AppError(PERMANENT_OWNER_REFUSAL, "FORBIDDEN");
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can delete an owner account.", "FORBIDDEN");
    }
    if (target.role.code === "OWNER") {
      const owners = await db.user.count({ where: { isActive: true, role: { code: "OWNER" } } });
      if (owners <= 1) throw new AppError("There must always be at least one active owner.");
    }
    // The account is REMOVED, not erased: the person loses all access and the account leaves the lists, but everything they did stays under their name.
    const unusable = await unusablePasswordHash();
    await db.$transaction(async (tx) => {
      await removeAccountAccess(tx, target.id, unusable);
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress: meta.ipAddress ?? null }, {
        action: "user.deleted", entityType: "User", entityId: target.id,
        before: { fullName: target.fullName, email: target.email, role: target.role.code },
        after: { removed: true, recordsKept: true },
      });
    });
  });
}
