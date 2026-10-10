"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, hashPassword, requestMeta, validatePasswordStrength, type CurrentUser } from "@/server/auth";
import { AppError, isUniqueViolation, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { isRestaurantDevice, PERMISSIONS } from "@/lib/permissions";
import { numberWaitersTx } from "@/server/services/waiter-number";
import { msg } from "@/i18n/msg";

const CreateUserSchema = z.object({
  fullName: z.string().trim().min(2, msg("Full name is required.")).max(100),
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email.")),
  // Not asked for the restaurant screen's own login.
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  roleId: z.string().min(1, msg("Choose a role.")),
  password: z.string().min(1, msg("Set a temporary password.")),
});

/** "Online · nTZS" — the system account that records what customers pay online; never a person's role. */
const SYSTEM_ROLE = "SYSTEM_ONLINE";

async function assertCanAssignRole(actor: CurrentUser, roleId: string) {
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new AppError("Role not found.", "NOT_FOUND");
  if (role.code === SYSTEM_ROLE) throw new AppError("That role is for the system only.", "FORBIDDEN");
  if (role.code === "OWNER" && actor.roleCode !== "OWNER") {
    throw new AppError("Only an owner can grant the Owner role.", "FORBIDDEN");
  }
  return role;
}

export async function createUserAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const input = parseInput(CreateUserSchema, formData);
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError(weak, "VALIDATION", { password: weak });
    const role = await assertCanAssignRole(actor, input.roleId);
    // The restaurant screen's login is not a person: its password stays the one set here (no change at first sign-in).
    const roleCodes = (await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permission: { select: { code: true } } } })).map((p) => p.permission.code);
    const screen = isRestaurantDevice(new Set(roleCodes));
    const { ipAddress } = await requestMeta();
    try {
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName: input.fullName, email: input.email, phone: input.phone, roleId: role.id,
            passwordHash: await hashPassword(input.password), mustChangePassword: !screen,
          },
        });
        await numberWaitersTx(tx); // a new waiter gets the next WTR number
        await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
          action: "user.created", entityType: "User", entityId: user.id,
          after: { fullName: user.fullName, email: user.email, role: role.code },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("A staff account with this email already exists.", "CONFLICT", { email: msg("Already in use") });
      throw e;
    }
    revalidatePath("/staff/users");
    return null;
  }, msg("Staff account created. They must change the temporary password at first sign-in."));
}

const UpdateUserSchema = z.object({
  userId: z.string().min(1),
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).transform((v) => v || null),
  roleId: z.string().min(1),
  isActive: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function updateUserAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const input = parseInput(UpdateUserSchema, formData);
    const target = await db.user.findUnique({ where: { id: input.userId }, include: { role: true } });
    if (target?.role.code === SYSTEM_ROLE) throw new AppError("User not found.", "NOT_FOUND");
    if (!target) throw new AppError("Staff member not found.", "NOT_FOUND");
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can change an owner account.", "FORBIDDEN");
    }
    const newRole = await assertCanAssignRole(actor, input.roleId);
    if (target.id === actor.id && (!input.isActive || newRole.id !== target.roleId)) {
      throw new AppError("You cannot deactivate yourself or change your own role.");
    }
    const losingOwner = target.role.code === "OWNER" && target.isActive && (newRole.code !== "OWNER" || !input.isActive);
    if (losingOwner) {
      const owners = await db.user.count({ where: { isActive: true, role: { code: "OWNER" } } });
      if (owners <= 1) throw new AppError("There must always be at least one active owner.");
    }

    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { fullName: input.fullName, phone: input.phone, roleId: newRole.id, isActive: input.isActive },
      });
      if (!input.isActive || newRole.id !== target.roleId) {
        await tx.session.deleteMany({ where: { userId: target.id } }); // force re-login with new rights
      }
      if (newRole.id !== target.roleId) await numberWaitersTx(tx); // became a waiter: they get a WTR number
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
        action: newRole.id !== target.roleId ? "user.role_changed" : "user.updated",
        entityType: "User", entityId: target.id,
        before: { fullName: target.fullName, phone: target.phone, role: target.role.code, isActive: target.isActive },
        after: { fullName: input.fullName, phone: input.phone, role: newRole.code, isActive: input.isActive },
      });
    });
    revalidatePath("/staff/users");
    return null;
  }, msg("Staff member updated."));
}

const ResetSchema = z.object({ userId: z.string().min(1), password: z.string().min(1, msg("Enter a temporary password.")) });

export async function resetPasswordAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const input = parseInput(ResetSchema, formData);
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError(weak, "VALIDATION", { password: weak });
    const target = await db.user.findUnique({ where: { id: input.userId }, include: { role: true } });
    if (target?.role.code === SYSTEM_ROLE) throw new AppError("User not found.", "NOT_FOUND");
    if (!target) throw new AppError("Staff member not found.", "NOT_FOUND");
    if (target.role.code === "OWNER" && actor.roleCode !== "OWNER") {
      throw new AppError("Only an owner can reset an owner's password.", "FORBIDDEN");
    }
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { passwordHash: await hashPassword(input.password), mustChangePassword: true },
      });
      await tx.session.deleteMany({ where: { userId: target.id } });
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
        action: "user.password_reset", entityType: "User", entityId: target.id,
      });
    });
    return null;
  }, msg("Password reset. Share the temporary password with the staff member privately."));
}

const PermissionToggleSchema = z.object({
  roleId: z.string().min(1),
  permission: z.string().refine((p) => p in PERMISSIONS, msg("Unknown permission.")),
  granted: z.boolean(),
});

export async function setRolePermissionAction(input: z.input<typeof PermissionToggleSchema>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const data = parseInput(PermissionToggleSchema, input);
    const role = await db.role.findUnique({ where: { id: data.roleId } });
    if (!role) throw new AppError("Role not found.", "NOT_FOUND");
    if (role.code === "OWNER") throw new AppError("The Owner role always has every permission.");
    if (role.code === SYSTEM_ROLE) throw new AppError("That role is for the system only.", "FORBIDDEN");
    if (actor.roleCode !== "OWNER" && role.code === "MANAGER") {
      throw new AppError("Only an owner can change manager permissions.", "FORBIDDEN");
    }
    const permission = await db.permission.findUniqueOrThrow({ where: { code: data.permission } });
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      if (data.granted) {
        await tx.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: permission.id }], skipDuplicates: true });
      } else {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      }
      await numberWaitersTx(tx); // a role that now works waiter shifts: its people get WTR numbers
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
        action: "user.permission_changed", entityType: "Role", entityId: role.id,
        before: { role: role.code, permission: data.permission, granted: !data.granted },
        after: { role: role.code, permission: data.permission, granted: data.granted },
      });
    });
    revalidatePath("/staff/users");
    return null;
  });
}

/** The MD signs one restaurant screen out (lost or replaced) — the others stay signed in. */
export async function signOutScreenSessionAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const sessionId = String(formData.get("sessionId") ?? "");
    const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    if (!session) throw new AppError("That screen is already signed out.", "NOT_FOUND");
    if (!isRestaurantDevice(new Set(session.user.role.permissions.map((p) => p.permission.code)))) throw new AppError("Only the restaurant screen's sign-ins are managed here.", "FORBIDDEN");
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      await tx.session.delete({ where: { id: session.id } });
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
        action: "user.sessions_revoked", entityType: "User", entityId: session.userId, after: { screen: true, device: session.userAgent, lastSeen: session.lastSeenAt.toISOString() },
      });
    });
    revalidatePath("/staff/users");
    return null;
  }, msg("That screen is signed out."));
}
