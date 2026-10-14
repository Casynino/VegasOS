import "server-only";
import { after } from "next/server";
import { db } from "../db";
import { audit } from "../audit";
import { hashPassword, verifyPassword } from "../auth";
import { rateLimit } from "../rate-limit";
import { AppError } from "../errors";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { msg } from "@/i18n/msg";

/**
 * Signing in to one of the two kinds of account. The choice on the sign-in page ("Developer account" / "Staff account") is NOT
 * proof of anything: the password is checked on the server for the account asked, and the account's own role decides which kind
 * it is. A Developer's email and password on the Staff form fails; a staff member's on the Developer form fails — with the same
 * answer as a wrong password, so the form says nothing about which accounts exist.
 */
export type AccountType = "STAFF" | "DEVELOPER";

export type Failure = {
  ok: false;
  /** The account the email belongs to, when there is one (for the audit trail of a failed attempt). */
  userId: string | null;
  actual: AccountType | null;
  /** Was the password right? Only for the audit trail (a right password at the wrong door is worth a second look) — never shown to the visitor. */
  passwordOk: boolean;
};

export type Authentication = { ok: true; userId: string; fullName: string; accountType: AccountType } | Failure;

// A real hash of a random value, so an unknown email takes as long as a wrong password.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

export async function authenticate(email: string, password: string, asked: AccountType): Promise<Authentication> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, fullName: true, passwordHash: true, isActive: true, role: { select: { code: true } } } });
  const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  const actual: AccountType | null = user ? (user.role.code === DEVELOPER_ROLE_CODE ? "DEVELOPER" : "STAFF") : null;
  if (!user || !passwordOk || !user.isActive || actual !== asked) return { ok: false, userId: user?.id ?? null, actual, passwordOk: !!user && passwordOk };
  return { ok: true, userId: user.id, fullName: user.fullName, accountType: actual };
}

// ───────────────────────────────────────────── a failed sign-in, in the audit trail ─────────────────────────────────────────────

/**
 * What a failed attempt is filed under. Nobody is signed in when it happens, so it is NEVER written under the account it was tried
 * on (anyone on the internet could otherwise make rows that look like the Developer's or a staff member's own activity): it has no
 * user, it is the system's ("SYSTEM"), and the targeted account is named only as the record it was about (entityId).
 */
export const FAILED_SIGN_IN_LABEL = msg("Sign-in page (not signed in)");

/** The most "nobody holds this Developer email" entries written in one hour, from the whole system (a flood costs a few rows, not the table). */
export const UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR = 20;
export const UNKNOWN_DEVELOPER_KEY = "login:trail:unknown-developer";

/**
 * Write down one failed attempt (never throws — the answer the visitor gets is the same whether or not this works).
 *  - a real account (right or wrong door, wrong password, switched off): one entry naming the account as the record, with what was asked and why it failed;
 *  - an email nobody holds, tried at the DEVELOPER door: one entry without any account, at most UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR an hour
 *    (then it stops writing, but the sign-in is refused exactly the same);
 *  - an email nobody holds at the Staff door: nothing (the rate limits already hold it, and it is only noise).
 * Neither the typed password nor the typed email of an unknown account is ever written.
 */
export async function recordFailedSignIn(failure: Failure, asked: AccountType, ipAddress: string | null): Promise<void> {
  try {
    const actor = { label: FAILED_SIGN_IN_LABEL, ipAddress };
    if (failure.userId) {
      await audit(db, actor, {
        action: "auth.login_failed", entityType: "User", entityId: failure.userId,
        after: { accountType: asked, accountExists: true, reasonKind: failure.passwordOk && failure.actual !== asked ? "wrong account type" : "bad password" },
      });
    } else if (asked === "DEVELOPER") {
      try {
        await rateLimit(UNKNOWN_DEVELOPER_KEY, UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR, 60 * 60);
      } catch (e) {
        if (e instanceof AppError) return; // this hour's entries are used up: keep refusing, stop writing
        throw e;
      }
      await audit(db, actor, { action: "auth.login_failed", entityType: "User", entityId: null, after: { accountType: "DEVELOPER", accountExists: false } });
    }
  } catch {
    /* the answer must be the same for every kind of failure — a trail that cannot be written never turns it into an error page */
    console.error("auth.login_failed could not be written to the audit trail");
  }
}

/**
 * Run `work` once the answer has gone out (Next's after()), so a failed sign-in answers in the same time whatever there is to write
 * down — a visitor cannot tell a real account from an unknown email by how long the answer takes. Where there is no request to
 * hang it on (a script, a test) it runs straight away. `work` must never throw.
 */
export async function afterTheAnswer(work: () => Promise<void>): Promise<void> {
  try {
    after(work);
  } catch {
    await work();
  }
}
