import "server-only";
import { after } from "next/server";
import { db } from "../db";
import { audit } from "../audit";
import { hashPassword, verifyPassword } from "../auth";
import { rateLimit } from "../rate-limit";
import { AppError } from "../errors";
import { inTurn } from "../in-turn";
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
  /**
   * Only present (true) when the Developer's own lock refused the try before its password was looked at. Only for the audit trail — the
   * visitor gets the very same words as for any other failure (see authenticate()).
   */
  locked?: true;
};

/** Where a Developer lands after signing in: the console. (Everyone else is sent to /staff, which opens their own dashboard.) */
export const DEVELOPER_LANDING = "/staff/developer";

export type Authentication = { ok: true; userId: string; fullName: string; accountType: AccountType } | Failure;

/**
 * A Developer's account keeps a stricter lock than staff accounts: 5 WRONG tries in 15 minutes (the staff limit of 8 per email still applies
 * first). Only wrong tries count: a sign-in that works clears the count (see authenticate()).
 */
export const DEVELOPER_TRIES = 5;
export const DEVELOPER_WINDOW_SECONDS = 15 * 60;
export const developerLockKey = (email: string) => `login:email:dev:${email}`;
/**
 * Every OTHER email gets the very same write before its password is checked, on this key, which nothing enforces (its limit can never be
 * reached). Without it only a Developer's email would do the extra database write — a difference a visitor could time. The key does not start
 * with "login:" so the Console's count of paused sign-ins never sees it; the cron's 24-hour clean-up of rate-limit windows removes it.
 */
export const signInProbeKey = (email: string) => `probe:signin:${email}`;
const NEVER_ENFORCED = Number.MAX_SAFE_INTEGER;

// A real hash of a random value, so an unknown email takes as long as a wrong password.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

/**
 * Look the account up, take this email's counter (ONE database write for every email, whatever it is), apply the Developer's stricter lock
 * when the email turns out to be a Developer's (BEFORE its password is checked, so a flood of guesses is stopped, not answered), then check
 * the password.
 *
 * ONLY WRONG TRIES COUNT toward the Developer's lock: the try takes its place in the count before the password is looked at (so a crowd of
 * guesses at the same moment is stopped at the 5th), and a sign-in that works clears the count again. Right-password sign-ins therefore never
 * add up, and a Developer who typed 4 wrong passwords and then the right one starts from zero. (A right password on a switched-off account is
 * a failure and stays counted.) A staff email's counter is the probe above: written, never enforced, cleared the same way.
 *
 * THE LOCK MUST NOT TELL (owner, 2026-10-17): when the Developer's lock refuses a try it is answered EXACTLY like a wrong password — an
 * ordinary failure, the same words ("Incorrect email or password."), and the same cost (one real hash, as for any other answer). If it
 * said "Too many attempts" from the 6th try, anyone could learn that an email is the Developer's: a staff or unknown email says that
 * only at the 9th try (the sign-in action's limit of 8 per email). The lock still refuses — even the right password — and the
 * try is marked `locked` in the Failure, which only the audit trail sees. (The sign-in action's own limits, per address and per email, still
 * say "Too many attempts" for every email alike — they reveal nothing about the account.)
 */
export async function authenticate(email: string, password: string): Promise<Authentication> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, fullName: true, passwordHash: true, isActive: true, role: { select: { code: true } } } });
  const actual: AccountType | null = user ? (user.role.code === DEVELOPER_ROLE_CODE ? "DEVELOPER" : "STAFF") : null;
  const developer = user && actual === "DEVELOPER" ? user : null;
  const counterKey = developer ? developerLockKey(email) : signInProbeKey(email);
  try {
    await rateLimit(counterKey, developer ? DEVELOPER_TRIES : NEVER_ENFORCED, DEVELOPER_WINDOW_SECONDS);
  } catch (e) {
    if (!developer || !(e instanceof AppError) || e.code !== "RATE_LIMITED") throw e;
    // Locked: refused, never looked at the password — but it costs one real hash and answers like any wrong password.
    await verifyPassword(await getDummyHash(), password);
    return { ok: false, userId: developer.id, actual, passwordOk: false, active: developer.isActive, locked: true };
  }
  const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !passwordOk || !user.isActive) return { ok: false, userId: user?.id ?? null, actual, passwordOk: !!user && passwordOk, active: !!user?.isActive };
  // It worked: this email's wrong tries are forgotten (best effort — a counter that cannot be cleared never stops a sign-in).
  try { await db.rateLimitBucket.deleteMany({ where: { key: counterKey } }); } catch { /* the count simply runs out with its window */ }
  return { ok: true, userId: user.id, fullName: user.fullName, accountType: actual! };
}

// ───────────────────────────────────────────── a failed sign-in, in the audit trail ─────────────────────────────────────────────

/**
 * What a failed attempt is filed under. Nobody is signed in when it happens, so it is NEVER written under the account it was tried
 * on (anyone on the internet could otherwise make rows that look like the Developer's or a staff member's own activity): it has no
 * user, it is the system's ("SYSTEM"), and the targeted account is named only as the record it was about (entityId).
 */
export const FAILED_SIGN_IN_LABEL = msg("Sign-in page (not signed in)");

/** A real account's failed tries are written down at most this many times an hour; past it, one marker says so (see recordFailedSignIn). */
export const FAILED_SIGN_IN_ROWS_PER_HOUR = 10;
export const FAILED_SIGN_IN_WINDOW_MINUTES = 60;
export const FAILED_SIGN_IN_ACTION = "auth.login_failed";
export const FAILED_SIGN_IN_SUPPRESSED_ACTION = "auth.login_failed_suppressed";

/**
 * Write down one failed attempt (never throws — the answer the visitor gets is the same whether or not this works).
 *  - a real account: one entry naming the account as the record, with the account's kind and why it failed;
 *  - an email nobody holds: nothing (the rate limits already hold it, and it is only noise).
 * Neither the typed password nor the typed email of an unknown account is ever written.
 *
 * AT MOST 10 ENTRIES PER ACCOUNT PER HOUR. The audit trail is permanent and cannot be edited, and anyone on the internet can fail a sign-in
 * for a real email, so a flood of tries would otherwise fill it for good (the sign-in limits only slow the flood). The 11th try within the hour
 * and every later one is not written; instead ONE marker entry "auth.login_failed_suppressed" is written for that hour (its `count` is the
 * number of tries already written, `limit` the cap) — so a flood is visible, and cheap. The sign-in limits themselves are not touched.
 */
export async function recordFailedSignIn(failure: Failure, ipAddress: string | null): Promise<void> {
  try {
    if (!failure.userId) return;
    const userId = failure.userId;
    const since = new Date(Date.now() - FAILED_SIGN_IN_WINDOW_MINUTES * 60_000);
    const actor = { label: FAILED_SIGN_IN_LABEL, ipAddress };
    // Tries for one account wait their turn HERE first, so a flood of them never queues up inside the database holding its connections
    // (each transaction below needs a second connection for the settings — a crowd of waiting ones would starve the pool).
    await inTurn(`login-failed:${userId}`, () => db.$transaction(async (tx) => {
      // One try at a time per account, so two at the same moment cannot both pass the count (or both write the marker).
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`login-failed:${userId}`}))::text`;
      const written = await tx.auditLog.count({ where: { action: FAILED_SIGN_IN_ACTION, entityId: userId, createdAt: { gte: since } } });
      if (written >= FAILED_SIGN_IN_ROWS_PER_HOUR) {
        const marked = await tx.auditLog.findFirst({ where: { action: FAILED_SIGN_IN_SUPPRESSED_ACTION, entityId: userId, createdAt: { gte: since } }, select: { id: true } });
        if (!marked) {
          await audit(tx, actor, {
            action: FAILED_SIGN_IN_SUPPRESSED_ACTION, entityType: "User", entityId: userId,
            after: { accountType: failure.actual, count: written, limit: FAILED_SIGN_IN_ROWS_PER_HOUR, windowMinutes: FAILED_SIGN_IN_WINDOW_MINUTES },
          });
        }
        return;
      }
      await audit(tx, actor, {
        action: FAILED_SIGN_IN_ACTION, entityType: "User", entityId: userId,
        after: {
          accountType: failure.actual, accountExists: true,
          reasonKind: failure.locked ? "locked" : failure.passwordOk && !failure.active ? "account switched off" : "bad password",
        },
      });
    }));
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
