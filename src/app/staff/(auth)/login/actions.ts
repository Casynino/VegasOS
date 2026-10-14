"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { createSession, destroySession, getCurrentUser, requestMeta } from "@/server/auth";
import { afterTheAnswer, authenticate, recordFailedSignIn } from "@/server/services/auth-login";
import { rateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email address.")),
  password: z.string().min(1, msg("Enter your password.")),
  // Which door was chosen. Not an authentication: the server checks the account itself (see authenticate()).
  accountType: z.enum(["STAFF", "DEVELOPER"]).default("STAFF"),
});

export type LoginState = { error?: string; email?: string; accountType?: "STAFF" | "DEVELOPER" } | undefined;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({ email: formData.get("email"), password: formData.get("password"), accountType: formData.get("accountType") === "DEVELOPER" ? "DEVELOPER" : "STAFF" });
  const email = String(formData.get("email") ?? "");
  const chosen = formData.get("accountType") === "DEVELOPER" ? "DEVELOPER" : "STAFF";
  // The answer is shown on the sign-in screen in the visitor's language (English stays as it is).
  const t = await getT();
  if (!parsed.success) return { error: t(parsed.error.issues[0].message), email, accountType: chosen };

  const { ipAddress } = await requestMeta();
  const developer = parsed.data.accountType === "DEVELOPER";
  try {
    // The Developer door is guarded harder: a few tries, then a wait. Its address count is its own: the hotel's staff all sign in
    // from one address, and their sign-ins must never use up the Developer door's few tries (nor its tries the staff door's).
    await rateLimit(`login:ip:${developer ? "dev:" : ""}${ipAddress ?? "unknown"}`, developer ? 8 : 20, 15 * 60);
    await rateLimit(`login:email:${developer ? "dev:" : ""}${parsed.data.email}`, developer ? 5 : 8, 15 * 60);
  } catch (e) {
    if (e instanceof AppError) return { error: e.i18n ? t(e.i18n.key, e.i18n.vars) : t(e.message), email, accountType: chosen };
    throw e;
  }

  const result = await authenticate(parsed.data.email, parsed.data.password, parsed.data.accountType);
  if (!result.ok) {
    // The try is kept in the audit trail as the system's own entry (nobody is signed in), after the answer has gone out so the answer takes
    // the same time for a real account and for an unknown email. The visitor is told the same thing whatever went wrong — never a clue on screen.
    await afterTheAnswer(() => recordFailedSignIn(result, parsed.data.accountType, ipAddress));
    return { error: developer ? t("Incorrect email or password for the Developer account.") : t("Incorrect email or password."), email, accountType: chosen };
  }

  // One identity per browser: whatever session this browser held is ended before the new one starts.
  await destroySession();
  const signedInAt = new Date(Date.now() - 1000);
  await createSession(result.userId);
  try {
    await db.user.update({ where: { id: result.userId }, data: { lastLoginAt: new Date() } });
    await audit(db, { userId: result.userId, label: result.fullName, ipAddress }, {
      action: "auth.login", entityType: "User", entityId: result.userId, after: { accountType: result.accountType },
    });
  } catch (e) {
    // A Developer's sign-in that cannot be written to the audit trail does not stand: no session is left behind without a trail.
    if (result.accountType === "DEVELOPER") {
      await db.session.deleteMany({ where: { userId: result.userId, createdAt: { gte: signedInAt } } });
      await destroySession();
    }
    throw e;
  }

  redirect("/staff");
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  try {
    if (user) {
      const { ipAddress } = await requestMeta();
      await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
        action: "auth.logout", entityType: "User", entityId: user.id,
      });
    }
  } finally {
    // Signing out always ends the session — even when the audit trail could not be written.
    await destroySession();
  }
  redirect("/staff/login");
}
