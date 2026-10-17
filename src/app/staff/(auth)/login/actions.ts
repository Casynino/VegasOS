"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { createSession, destroySession, getCurrentUser, requestMeta } from "@/server/auth";
import { afterTheAnswer, authenticate, DEVELOPER_LANDING, recordFailedSignIn } from "@/server/services/auth-login";
import { endWorkAs } from "@/server/services/work-as";
import { rateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(msg("Enter a valid email address.")),
  password: z.string().min(1, msg("Enter your password.")),
});

export type LoginState = { error?: string; email?: string } | undefined;

/**
 * The one sign-in. An email and a password — nothing in the form says what kind of account it is (the server finds out from the
 * account itself). Every failure gets the same words; the tries are limited per address and per email, and a Developer's account
 * has a stricter lock of its own (see authenticate()).
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  // The answer is shown on the sign-in screen in the visitor's language (English stays as it is).
  const t = await getT();
  if (!parsed.success) return { error: t(parsed.error.issues[0].message), email };

  const { ipAddress } = await requestMeta();
  let result;
  try {
    await rateLimit(`login:ip:${ipAddress ?? "unknown"}`, 20, 15 * 60);
    await rateLimit(`login:email:${parsed.data.email}`, 8, 15 * 60);
    result = await authenticate(parsed.data.email, parsed.data.password);
  } catch (e) {
    if (e instanceof AppError) return { error: e.i18n ? t(e.i18n.key, e.i18n.vars) : t(e.message), email };
    throw e;
  }

  if (!result.ok) {
    // The try is kept in the audit trail as the system's own entry (nobody is signed in), after the answer has gone out so the answer takes
    // the same time for a real account and for an unknown email. The visitor is told the same thing whatever went wrong — never a clue on screen.
    await afterTheAnswer(() => recordFailedSignIn(result, ipAddress));
    return { error: t("Incorrect email or password."), email };
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

  redirect(result.accountType === "DEVELOPER" ? DEVELOPER_LANDING : "/staff");
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  try {
    if (user) {
      const { ipAddress } = await requestMeta();
      // While a Developer is working as someone, the person signing out is the DEVELOPER (user.actorId): working as ends with the
      // session, is written down as ended, and the sign-out is the Developer's entry — never the staff member's.
      if (user.workAs) {
        try { await endWorkAs(user); } catch { console.error("work_as_ended could not be written to the audit trail"); }
      }
      await audit(db, { userId: user.actorId, label: user.actorName, ipAddress }, {
        action: "auth.logout", entityType: "User", entityId: user.actorId,
      });
    }
  } finally {
    // Signing out always ends the session — even when the audit trail could not be written.
    await destroySession();
  }
  redirect("/staff/login");
}
