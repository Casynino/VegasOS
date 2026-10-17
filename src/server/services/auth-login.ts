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
 * Signing in — ONE door for everybody (owner, 2026-10-17): an email and a password, exactly as a normal user's. There is no choice of
 * "Developer" or "Staff" on the page and nothing the visitor sends says which kind of account it is: the password is checked on the
 * server and the account's own role decides (a Developer lands on the Developer console, everyone else as before).
 *
 * The visitor is told the same thing whatever went wrong — wrong password, an email nobody holds, a switched-off account — and every
 * path checks a real password hash, so the answer says nothing about which accounts exist.
 */
export type AccountType = "STAFF" | "DEVELOPER";

export type Failure = {
  ok: false;
  /** The account the email belongs to, when there is one (for the audit trail of a failed attempt). */
  userId: string | null;
  actual: AccountType | null;
  /** Was the password right? Only for the audit trail (a right password on a switched-off account is worth a second look) — never shown to the visitor. */
  passwordOk: boolean;
  /** Is the account switched on? Only for the audit trail. */
  active: boolean;
};

/** Where a Developer lands after signing in: the console. (Everyone else is sent to /staff, which opens their own dashboard.) */
export const DEVELOPER_LANDING = "/staff/developer";

export type Authentication = { ok: true; userId: string; fullName: string; accountType: AccountType } | Failure;

/** A Developer's account keeps a stricter lock than staff accounts: 5 tries in 15 minutes (the staff limit of 8 per email still applies first). */
export const DEVELOPER_TRIES = 5;
export const DEVELOPER_WINDOW_SECONDS = 15 * 60;
export const developerLockKey = (email: string) => `login:email:dev:${email}`;

// A real hash of a random value, so an unknown email takes as long as a wrong password.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

/**
 * Look the account up, apply the Developer's stricter lock when the email turns out to be a Developer's (BEFORE its password is
 * checked, so a flood of guesses is stopped, not answered), then check the password. The lock throws the same "Too many attempts"
 * AppError the other limits throw; a refused try still costs one real hash, like any other answer.
 */
export async function authenticate(email: string, password: string): Promise<Authentication> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, fullName: true, passwordHash: true, isActive: true, role: { select: { code: true } } } });
  const actual: AccountType | null = user ? (user.role.code === DEVELOPER_ROLE_CODE ? "DEVELOPER" : "STAFF") : null;
  if (actual === "DEVELOPER") {
    try {
      await rateLimit(developerLockKey(email), DEVELOPER_TRIES, DEVELOPER_WINDOW_SECONDS);
    } catch (e) {
      if (e instanceof AppError) await verifyPassword(await getDummyHash(), password);
      throw e;
    }
  }
  const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !passwordOk || !user.isActive) return { ok: false, userId: user?.id ?? null, actual, passwordOk: !!user && passwordOk, active: !!user?.isActive };
  return { ok: true, userId: user.id, fullName: user.fullName, accountType: actual! };
}

// ───────────────────────────────────────────── a failed sign-in, in the audit trail ─────────────────────────────────────────────

/**
 * What a failed attempt is filed under. Nobody is signed in when it happens, so it is NEVER written under the account it was tried
 * on (anyone on the internet could otherwise make rows that look like the Developer's or a staff member's own activity): it has no
 * user, it is the system's ("SYSTEM"), and the targeted account is named only as the record it was about (entityId).
 */
export const FAILED_SIGN_IN_LABEL = msg("Sign-in page (not signed in)");

/**
 * Write down one failed attempt (never throws — the answer the visitor gets is the same whether or not this works).
 *  - a real account: one entry naming the account as the record, with the account's kind and why it failed;
 *  - an email nobody holds: nothing (the rate limits already hold it, and it is only noise).
 * Neither the typed password nor the typed email of an unknown account is ever written.
 */
export async function recordFailedSignIn(failure: Failure, ipAddress: string | null): Promise<void> {
  try {
    if (!failure.userId) return;
    await audit(db, { label: FAILED_SIGN_IN_LABEL, ipAddress }, {
      action: "auth.login_failed", entityType: "User", entityId: failure.userId,
      after: { accountType: failure.actual, accountExists: true, reasonKind: failure.passwordOk && !failure.active ? "account switched off" : "bad password" },
    });
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
