"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { createSession, destroySession, getCurrentUser, hashPassword, requestMeta, verifyPassword } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { isRestaurantDevice } from "@/lib/permissions";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email address.")),
  password: z.string().min(1, msg("Enter your password.")),
});

export type LoginState = { error?: string; email?: string } | undefined;

// Real hash of a random value so unknown emails take as long as wrong passwords.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  // The answer is shown on the sign-in screen in the visitor's language (English stays as it is).
  const t = await getT();
  if (!parsed.success) return { error: t(parsed.error.issues[0].message), email };

  const { ipAddress } = await requestMeta();
  try {
    await rateLimit(`login:ip:${ipAddress ?? "unknown"}`, 20, 15 * 60);
    await rateLimit(`login:email:${parsed.data.email}`, 8, 15 * 60);
  } catch (e) {
    if (e instanceof AppError) return { error: e.i18n ? t(e.i18n.key, e.i18n.vars) : t(e.message), email };
    throw e;
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), parsed.data.password);
  if (!user || !ok || !user.isActive) {
    return { error: t("Incorrect email or password."), email };
  }

  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
    action: "auth.login", entityType: "User", entityId: user.id,
  });

  // A person chooses their own password first; the restaurant screen (its password is the MD's) goes straight in.
  const perms = user.mustChangePassword ? await db.permission.findMany({ where: { roles: { some: { roleId: user.roleId } } }, select: { code: true } }) : [];
  redirect(user.mustChangePassword && !isRestaurantDevice(new Set(perms.map((p) => p.code))) ? "/staff/account?first=1" : "/staff");
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    const { ipAddress } = await requestMeta();
    await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
      action: "auth.logout", entityType: "User", entityId: user.id,
    });
  }
  await destroySession();
  redirect("/staff/login");
}
