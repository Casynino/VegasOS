"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertNotWorkAs, authorize, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { isRestaurantDevice } from "@/lib/permissions";
import { createStaffAccount, deleteStaffAccount, resetStaffPassword, setRolePermission, updateStaffAccount } from "@/server/services/staff-accounts";
import { msg } from "@/i18n/msg";

/*
 * Every rule (who may see or change a Developer account, who may give a right, the Developer's reason, the audit entries) lives
 * in server/services/staff-accounts.ts. Here: the signed-in person's own right to manage staff, the form, and the page refresh.
 * Who is acting — and whether it is the Developer — comes from the server's session, never from the form.
 */

/** The Developer's reason (only asked of a Developer; the server decides whether it is needed). */
const reason = z.string().trim().max(500).optional().transform((v) => v || null);

const CreateUserSchema = z.object({
  fullName: z.string().trim().min(2, msg("Full name is required.")).max(100),
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email.")),
  // Not asked for the restaurant screen's own login.
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  roleId: z.string().min(1, msg("Choose a role.")).max(64),
  password: z.string().min(1, msg("Set a temporary password.")),
  reason,
});

export async function createUserAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const input = parseInput(CreateUserSchema, formData);
    await createStaffAccount(actor, input, await requestMeta());
    revalidatePath("/staff/users");
    return null;
  }, msg("Staff account created. They must change the temporary password at first sign-in."));
}

const UpdateUserSchema = z.object({
  userId: z.string().min(1).max(64),
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email.")),
  phone: z.string().trim().max(30).transform((v) => v || null),
  roleId: z.string().min(1).max(64),
  isActive: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  reason,
});

export async function updateUserAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const input = parseInput(UpdateUserSchema, formData);
    await updateStaffAccount(actor, input, await requestMeta());
    revalidatePath("/staff/users");
    return null;
  }, msg("Staff member updated."));
}

const ResetSchema = z.object({ userId: z.string().min(1).max(64), password: z.string().min(1, msg("Enter a temporary password.")), reason });

export async function resetPasswordAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const input = parseInput(ResetSchema, formData);
    await resetStaffPassword(actor, input, await requestMeta());
    return null;
  }, msg("Password reset. Share the temporary password with the staff member privately."));
}

const PermissionToggleSchema = z.object({
  roleId: z.string().min(1).max(64),
  // The server decides what may be given (a right that exists, and never a Developer-only one).
  permission: z.string().min(1).max(100),
  granted: z.boolean(),
  reason: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
});

export async function setRolePermissionAction(input: z.input<typeof PermissionToggleSchema>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const data = parseInput(PermissionToggleSchema, input);
    await setRolePermission(actor, data, await requestMeta());
    revalidatePath("/staff/users");
    return null;
  });
}

const DeleteSchema = z.object({ userId: z.string().min(1).max(64), reason });

export async function deleteUserAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const input = parseInput(DeleteSchema, formData);
    await deleteStaffAccount(actor, input, await requestMeta());
    revalidatePath("/staff/users");
    return null;
  }, msg("Staff account removed."));
}

/** The MD signs one restaurant screen out (lost or replaced) — the others stay signed in. */
export async function signOutScreenSessionAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    assertNotWorkAs(actor, "sign a screen out");
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
