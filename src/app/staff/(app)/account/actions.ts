"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, currentSessionTokenHash, hashPassword, requestMeta, validatePasswordStrength, verifyPassword } from "@/server/auth";
import { isRestaurantDevice } from "@/lib/permissions";
import { normalizePhone } from "@/server/services/guests";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { rateLimit } from "@/server/rate-limit";
import { msg } from "@/i18n/msg";

const Schema = z
  .object({
    // Not asked the first time (they just signed in with the temporary one) — asked for every later change.
    currentPassword: z.string().optional().transform((v) => v || ""),
    newPassword: z.string().min(1, msg("Enter a new password.")),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: msg("Passwords do not match."), path: ["confirmPassword"] })
  .refine((d) => !d.currentPassword || d.newPassword !== d.currentPassword, { message: msg("Choose a different password."), path: ["newPassword"] });

export async function changePasswordAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    const actor = await authorize();
    const input = parseInput(Schema, formData);
    await rateLimit(`pwchange:${actor.id}`, 10, 15 * 60);
    const weak = validatePasswordStrength(input.newPassword);
    if (weak) throw new AppError(weak, "VALIDATION", { newPassword: weak });
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.mustChangePassword) {
      // First sign-in: they just typed the temporary password — only a new, different one is asked.
      if (await verifyPassword(user.passwordHash, input.newPassword)) throw new AppError("Choose a password different from the temporary one.", "VALIDATION", { newPassword: msg("Same") });
    } else if (!input.currentPassword) {
      throw new AppError("Enter your current password.", "VALIDATION", { currentPassword: msg("Required") });
    } else if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError("Current password is incorrect.", "VALIDATION", { currentPassword: msg("Incorrect") });
    }
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
      });
      // A new password signs out every other device.
      const current = await currentSessionTokenHash();
      if (current) await tx.session.deleteMany({ where: { userId: actor.id, tokenHash: { not: current } } });
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
        action: "user.password_changed", entityType: "User", entityId: actor.id,
      });
    });
    return null;
  }, msg("Password changed."));
  if (result.ok && formData.get("first") === "1") redirect("/staff");
  return result;
}

const ProfileSchema = z.object({
  fullName: z.string().trim().min(2, msg("Enter your full name.")).max(80, msg("Name is too long.")),
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email address.")).max(120),
  phone: z.string().trim().max(30).optional().transform((v) => v || undefined),
  currentPassword: z.string().optional(),
});

/** Update the signed-in user's own name, email and phone. Changing the email (the login) needs the password. */
export async function updateProfileAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize();
    const input = parseInput(ProfileSchema, formData);
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    const phone = normalizePhone(input.phone);
    if (phone && !/^\+?\d{9,15}$/.test(phone)) throw new AppError("Enter a valid phone number.", "VALIDATION", { phone: msg("Enter a valid phone number.") });

    const emailChanged = input.email !== user.email;
    if (emailChanged) {
      await rateLimit(`emailchange:${actor.id}`, 10, 15 * 60);
      if (!input.currentPassword) throw new AppError("Enter your password to change your email.", "VALIDATION", { currentPassword: msg("Needed to change your email") });
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new AppError("Password is incorrect.", "VALIDATION", { currentPassword: msg("Incorrect") });
      }
      const taken = await db.user.findUnique({ where: { email: input.email } });
      if (taken) throw new AppError("Another staff account already uses this email.", "VALIDATION", { email: msg("Already in use") });
    }

    const changed = [
      input.fullName !== user.fullName && "name",
      emailChanged && "email",
      (phone ?? null) !== (user.phone ?? null) && "phone",
    ].filter(Boolean) as string[];
    if (changed.length === 0) return null;

    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { fullName: input.fullName, email: input.email, phone: phone ?? null } });
      await audit(tx, { userId: actor.id, label: input.fullName, ipAddress }, {
        action: "user.profile_updated", entityType: "User", entityId: actor.id,
        before: { fullName: user.fullName, email: user.email, phone: user.phone },
        after: { fullName: input.fullName, email: input.email, phone: phone ?? null },
      });
    });
    revalidatePath("/", "layout");
    return null;
  }, msg("Profile saved."));
}

/** Sign this account out everywhere except this browser. */
export async function signOutOtherDevicesAction(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize();
    // The restaurant screen's login may be on more than one screen: never signed out from one of them.
    if (isRestaurantDevice(actor.permissions)) throw new AppError("The restaurant screen's other screens are signed out by the MD (Staff & roles).", "FORBIDDEN");
    const current = await currentSessionTokenHash();
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      const { count } = await tx.session.deleteMany({ where: { userId: actor.id, ...(current && { tokenHash: { not: current } }) } });
      await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
        action: "user.sessions_revoked", entityType: "User", entityId: actor.id, after: { count },
      });
    });
    revalidatePath("/staff/account");
    return null;
  }, msg("Other devices signed out."));
}

