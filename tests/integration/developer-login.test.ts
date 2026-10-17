import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
// The real audit(), wrapped so a test can make ONE write fail ("the audit trail is down") and see what the sign-in does.
vi.mock("@/server/audit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/audit")>();
  return { ...real, audit: vi.fn(real.audit) };
});

import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { authenticate, DEVELOPER_LANDING } from "@/server/services/auth-login";
import { loginAction, logoutAction, type LoginState } from "@/app/staff/(auth)/login/actions";
import { auditOf, browser, makeSession, makeUser, Redirected, removeMadeUsers, sha256, thrownBy, type MadeUser } from "../support/developer";

/**
 * ONE door, for everybody (owner, 2026-10-17): an email and a password, exactly as a normal user's. No Developer / Staff choice, no ?as=,
 * no account type in the form. The server checks the password and the account's own role decides where the person lands: a Developer on
 * the Developer console, everyone else as before. Every earlier hardening stays: rate limits per address and per email (a Developer's
 * account keeps its stricter lock), the same words for every failure, a real hash on every path, the old session ended before the new
 * one starts, failed tries written down as the system's own entries, a Developer sign-in that cannot be written down does not stand.
 */
// The answer to a failed try: the ORIGINAL words, and the very same for a wrong password, an unknown email and a switched-off account.
const FAIL = "Incorrect email or password.";
const SIGN_IN_PAGE = "Sign-in page (not signed in)";
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

let dev: MadeUser;
let rec: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
let fin: MadeUser;
let offDev: MadeUser;
let offRec: MadeUser;

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Login" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Login" });
  boss = await makeUser("OWNER", { fullName: "Boss Login" });
  md = await makeUser("ADMIN", { fullName: "MD Login" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Login" });
  fin = await makeUser("FINANCE", { fullName: "Finance Login" });
  offDev = await makeUser("DEVELOPER", { fullName: "Off Dev Login", isActive: false });
  offRec = await makeUser("RECEPTIONIST", { fullName: "Off Rec Login", isActive: false });
});
afterAll(async () => {
  await removeMadeUsers();
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:" } } });
});
beforeEach(async () => {
  browser.reset(); // a new browser on a fresh address (the login limits count per address and per email)
  // Every test starts clean: the shared accounts hold no session left by an earlier test, and no sign-in counter is carried over
  // (the limits are per email, and these accounts are tried many times across the file).
  await db.session.deleteMany({ where: { userId: { in: [dev, rec, boss, md, mgr, fin, offDev, offRec].map((u) => u.id) } } });
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:" } } });
});

const form = (email: string, password: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};
/** Press "Sign in". */
async function signIn(email: string, password: string, extra: Record<string, string> = {}): Promise<{ state: LoginState; to: string | null }> {
  try {
    return { state: await loginAction(undefined, form(email, password, extra)), to: null };
  } catch (e) {
    if (e instanceof Redirected) return { state: undefined, to: e.url };
    throw e;
  }
}
const sessionsOf = (userId: string) => db.session.findMany({ where: { userId } });
/** The failed-sign-in entries ABOUT an account (the account is the record they are about, never the one that wrote them), oldest first. */
const failedAbout = (entityId: string | null) => db.auditLog.findMany({ where: { action: "auth.login_failed", entityId }, orderBy: { createdAt: "asc" } });
async function thrownRedirect(run: () => Promise<unknown>): Promise<string | null> {
  try { await run(); return null; } catch (e) { if (e instanceof Redirected) return e.url; throw e; }
}

// ───────────────────────────────────────────── authenticate() ─────────────────────────────────────────────
describe("authenticate(): an email and a password — the account's own role says what kind it is", () => {
  it("the Developer's credentials: in, as a DEVELOPER", async () => {
    expect(await authenticate(dev.email, dev.password)).toEqual({ ok: true, userId: dev.id, fullName: dev.fullName, accountType: "DEVELOPER" });
  });

  it("a staff member's credentials: in, as STAFF", async () => {
    expect(await authenticate(rec.email, rec.password)).toEqual({ ok: true, userId: rec.id, fullName: rec.fullName, accountType: "STAFF" });
  });

  it("the Boss, the MD, a Manager and Finance sign in as STAFF", async () => {
    for (const u of [boss, md, mgr, fin]) expect(await authenticate(u.email, u.password), u.role).toEqual({ ok: true, userId: u.id, fullName: u.fullName, accountType: "STAFF" });
  });

  it("a wrong password, an unknown email and a switched-off account all fail with the same shape", async () => {
    const failures = [
      await authenticate(dev.email, "wrong-password-1"),
      await authenticate(rec.email, "wrong-password-1"),
      await authenticate(rec.email, ""),
      await authenticate("nobody@devtest.local", "whatever-123"),
      await authenticate(offDev.email, offDev.password), // right password — but switched off
      await authenticate(offRec.email, offRec.password),
    ];
    for (const f of failures) {
      expect(f.ok).toBe(false);
      expect(Object.keys(f).sort()).toEqual(["active", "actual", "ok", "passwordOk", "userId"]);
    }
  });

  it("a failed try on a real account gives that account's id and kind (for the audit trail) and whether the password was right; an unknown email gives none", async () => {
    expect(await authenticate(dev.email, "wrong-password-1")).toEqual({ ok: false, userId: dev.id, actual: "DEVELOPER", passwordOk: false, active: true });
    expect(await authenticate(rec.email, "wrong-password-1")).toEqual({ ok: false, userId: rec.id, actual: "STAFF", passwordOk: false, active: true });
    expect(await authenticate(offDev.email, offDev.password)).toEqual({ ok: false, userId: offDev.id, actual: "DEVELOPER", passwordOk: true, active: false });
    expect(await authenticate(offRec.email, offRec.password)).toEqual({ ok: false, userId: offRec.id, actual: "STAFF", passwordOk: true, active: false });
    expect(await authenticate("nobody@devtest.local", "whatever-123")).toEqual({ ok: false, userId: null, actual: null, passwordOk: false, active: false });
  });

  it("an answer never carries the password or its hash", async () => {
    const stored = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { passwordHash: true } });
    for (const r of [await authenticate(dev.email, dev.password), await authenticate(dev.email, "x")]) {
      const text = JSON.stringify(r);
      expect(text).not.toContain(dev.password);
      expect(text).not.toContain(stored.passwordHash);
      expect(text).not.toContain("argon2");
    }
  });

  it("an unknown email takes about as long as a wrong password (a real hash is checked either way)", async () => {
    await authenticate("nobody@devtest.local", "warm-up-1"); // builds the stand-in hash once
    const time = async (email: string) => {
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) await authenticate(email, "wrong-password-1");
      return performance.now() - t0;
    };
    const known = await time(rec.email);
    const unknown = await time("nobody@devtest.local");
    expect(unknown).toBeGreaterThan(known * 0.3);
    expect(unknown).toBeLessThan(known * 3);
  });

  it("a Developer's account keeps its stricter lock: after 5 tries the 6th is refused BEFORE its password counts — even the right one", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Lock Direct" });
    for (let i = 1; i <= 5; i++) expect((await authenticate(d.email, `wrong-pass-${i}-x`)).ok, `try ${i}`).toBe(false);
    const refused = await thrownBy(() => authenticate(d.email, d.password));
    expect(refused).toBeInstanceOf(AppError);
    expect((refused as AppError).message).toBe(TOO_MANY);
    expect((refused as AppError).code).toBe("RATE_LIMITED");
  });

  it("a staff account has no such lock inside authenticate() (its limits are the sign-in action's: 8 per email, 20 per address)", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff No Direct Lock" });
    for (let i = 1; i <= 7; i++) expect((await authenticate(s.email, `wrong-pass-${i}-x`)).ok).toBe(false);
    expect((await authenticate(s.email, s.password)).ok).toBe(true);
  });
});

// ───────────────────────────────────────────── loginAction: a failed try ─────────────────────────────────────────────
describe("loginAction: a failed try", () => {
  it("a wrong password on the Developer's account: the plain original error, no session, and an entry ABOUT that account — written by the system, not by it", async () => {
    const before = (await failedAbout(dev.id)).length;
    const { state, to } = await signIn(dev.email, "not-the-password-1");
    expect(to).toBeNull();
    expect(state).toEqual({ error: FAIL, email: dev.email });
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    expect(browser.cookies.size).toBe(0);

    const rows = (await failedAbout(dev.id)).slice(before);
    expect(rows).toHaveLength(1);
    // Nobody is signed in: the entry has no user, no role, and is the system's — never the Developer's own activity.
    expect(rows[0]).toMatchObject({ userId: null, actorType: "SYSTEM", actorRole: null, actorLabel: SIGN_IN_PAGE, entityType: "User", entityId: dev.id, ipAddress: browser.ip });
    expect(rows[0].after).toEqual({ accountType: "DEVELOPER", accountExists: true, reasonKind: "bad password" });
    expect(await auditOf(dev.id, "auth.login_failed")).toHaveLength(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.id } })).lastLoginAt).toBeNull();
  });

  it("a wrong password on a staff account: the same words, an entry about it written by the system", async () => {
    const before = (await failedAbout(rec.id)).length;
    const { state, to } = await signIn(rec.email, "not-the-password-2");
    expect(to).toBeNull();
    expect(state).toEqual({ error: FAIL, email: rec.email });
    const rows = (await failedAbout(rec.id)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, actorType: "SYSTEM", actorLabel: SIGN_IN_PAGE, entityId: rec.id });
    expect(rows[0].after).toEqual({ accountType: "STAFF", accountExists: true, reasonKind: "bad password" });
    expect(await auditOf(rec.id, "auth.login_failed")).toHaveLength(0);
    expect(await sessionsOf(rec.id)).toHaveLength(0);
  });

  it("an email nobody holds: the same words, no session, and NO entry at all (and never the typed email or password)", async () => {
    const typed = `nobody-here-${Date.now()}@devtest.local`;
    const total = await db.auditLog.count({ where: { action: "auth.login_failed" } });
    const { state, to } = await signIn(typed, "whatever-123");
    expect(to).toBeNull();
    expect(state).toEqual({ error: FAIL, email: typed });
    expect(await db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(total);
    expect(browser.cookies.size).toBe(0);
  });

  it("a switched-off account: the very same words, no session, an entry about the account (a right password is noted as 'account switched off')", async () => {
    for (const u of [offDev, offRec]) {
      const before = (await failedAbout(u.id)).length;
      const { state, to } = await signIn(u.email, u.password);
      expect(to).toBeNull();
      expect(state?.error).toBe(FAIL);
      expect(await sessionsOf(u.id)).toHaveLength(0);
      const rows = (await failedAbout(u.id)).slice(before);
      expect(rows).toHaveLength(1);
      expect(rows[0].after).toMatchObject({ accountExists: true, reasonKind: "account switched off" });
    }
    const { state } = await signIn(offRec.email, "wrong-pass-9");
    expect(state?.error).toBe(FAIL);
    expect((await failedAbout(offRec.id)).at(-1)!.after).toMatchObject({ reasonKind: "bad password" });
  });

  it("every way to fail gives the same words — nothing says which accounts exist or what kind they are", async () => {
    const answers = new Set<string | undefined>();
    for (const [email, password] of [
      [dev.email, "wrong-pass-1"], [rec.email, "wrong-pass-1"], ["nobody@devtest.local", "x1y2z3-abc"], [offDev.email, offDev.password], [offRec.email, offRec.password],
    ] as const) answers.add((await signIn(email, password)).state?.error);
    expect([...answers]).toEqual([FAIL]);
  });

  it("the failure text is the ORIGINAL one — it did not change when the Developer door came and went", () => {
    expect(FAIL).toBe("Incorrect email or password.");
  });

  it("no password ever reaches the audit trail — nor the typed email of an unknown account", async () => {
    const ghost = `ghost-secret-${Date.now()}@devtest.local`;
    await signIn(dev.email, "typed-wrong-pass-77");
    await signIn(rec.email, "typed-wrong-pass-78");
    await signIn(ghost, "ghost-typed-pass-88");
    const rows = await db.auditLog.findMany({ where: { OR: [{ userId: { in: [dev.id, rec.id] } }, { action: "auth.login_failed" }] } });
    const text = JSON.stringify(rows);
    for (const secret of [dev.password, rec.password, "typed-wrong-pass-77", "typed-wrong-pass-78", "ghost-typed-pass-88", ghost]) expect(text).not.toContain(secret);
  });

  it("there is no door to choose: a stray 'accountType' / 'as' value in the form changes nothing — the account decides", async () => {
    const strays: Record<string, string>[] = [{ accountType: "STAFF" }, { accountType: "DEVELOPER" }, { accountType: "ADMIN" }, { as: "developer" }, { as: "staff" }, { accountType: "", as: "x" }];
    for (const extra of strays) {
      browser.reset();
      await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:" } } }); // (the Developer's own lock is 5 tries — this loop signs it in 6 times)
      const developer = await signIn(dev.email, dev.password, extra);
      expect(developer.to, JSON.stringify(extra)).toBe(DEVELOPER_LANDING);
      expect((await getCurrentUser())?.actorType).toBe("DEVELOPER");
      browser.reset();
      const staff = await signIn(rec.email, rec.password, extra);
      expect(staff.to, JSON.stringify(extra)).toBe("/staff");
      expect((await getCurrentUser())?.actorType).toBe("STAFF");
    }
    // ... and a wrong password is just as wrong whatever door the form claims
    const wrong = await signIn(dev.email, "wrong-pass-5", { accountType: "DEVELOPER" });
    expect(wrong.state).toEqual({ error: FAIL, email: dev.email });
  });

  it("a bad email or an empty password is a form error, not an attempt on any account", async () => {
    const total = await db.auditLog.count({ where: { action: "auth.login_failed" } });
    expect((await signIn("not-an-email", "x")).state?.error).toBe("Enter a valid email address.");
    expect((await signIn(dev.email, "")).state?.error).toBe("Enter your password.");
    expect(await db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(total);
  });

  it("a failed try does not sign anybody out: the browser keeps the session it had", async () => {
    await makeSession(rec.id);
    const { state } = await signIn(dev.email, "wrong-pass-1");
    expect(state?.error).toBe(FAIL);
    expect((await getCurrentUser())?.id).toBe(rec.id);
  });
});

// ───────────────────────────────────────────── loginAction: signing in ─────────────────────────────────────────────
describe("loginAction: signing in", () => {
  it("the Developer: in, to the Developer console — a DEVELOPER session of 4 hours, a 'login' entry, no secret kept", async () => {
    const before = (await auditOf(dev.id, "auth.login")).length;
    const { state, to } = await signIn(dev.email, dev.password);
    expect(to).toBe("/staff/developer");
    expect(DEVELOPER_LANDING).toBe("/staff/developer");
    expect(state).toBeUndefined();

    const sessions = await sessionsOf(dev.id);
    expect(sessions).toHaveLength(1);
    const hours = (sessions[0].expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(3.98);
    expect(hours).toBeLessThanOrEqual(4);
    expect(sessions[0].tokenHash).toBe(sha256(browser.sessionToken!));
    expect(sessions[0].ipAddress).toBe(browser.ip);
    expect(sessions[0].workAsUserId).toBeNull(); // a new session never starts out working as anybody

    const rows = (await auditOf(dev.id, "auth.login")).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: dev.fullName, entityType: "User", entityId: dev.id, ipAddress: browser.ip });
    expect(rows[0].after).toEqual({ accountType: "DEVELOPER" });
    expect(JSON.stringify(rows)).not.toContain(dev.password);
    expect(JSON.stringify(rows)).not.toContain(browser.sessionToken!);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.id } })).lastLoginAt).not.toBeNull();

    const me = await getCurrentUser();
    expect(me?.id).toBe(dev.id);
    expect(me?.actorType).toBe("DEVELOPER");
    expect(me?.actorId).toBe(dev.id);
    expect(me?.workAs).toBeNull();
    expect(me?.permissions.has("developer.access")).toBe(true);
  });

  it("a staff member: in, to /staff (which opens their own dashboard), as STAFF, with the normal session length", async () => {
    const { to } = await signIn(rec.email, rec.password);
    expect(to).toBe("/staff");
    const sessions = await sessionsOf(rec.id);
    expect(sessions).toHaveLength(1);
    const hours = (sessions[0].expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(13.98);
    expect(hours).toBeLessThanOrEqual(14);
    const rows = await auditOf(rec.id, "auth.login");
    expect(rows.at(-1)).toMatchObject({ actorType: "STAFF", actorRole: "RECEPTIONIST" });
    expect(rows.at(-1)!.after).toEqual({ accountType: "STAFF" });
    const me = await getCurrentUser();
    expect(me?.actorType).toBe("STAFF");
    expect(me?.permissions.has("developer.access")).toBe(false);
  });

  it("the Boss, the MD, a Manager and Finance sign in exactly as before — to /staff, with no Developer right", async () => {
    for (const u of [boss, md, mgr, fin]) {
      browser.reset();
      expect((await signIn(u.email, u.password)).to, u.role).toBe("/staff");
      const me = (await getCurrentUser())!;
      expect([me.id, me.actorType, me.workAs, me.permissions.has("developer.access")], u.role).toEqual([u.id, "STAFF", null, false]);
    }
  });

  it("an account told to choose a new password still signs in the same way (the 'must change password' flag is not a sign-in gate)", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff Must Change" });
    await db.user.update({ where: { id: s.id }, data: { mustChangePassword: true } });
    expect((await signIn(s.email, s.password)).to).toBe("/staff");
    expect((await getCurrentUser())?.mustChangePassword).toBe(true);
  });

  it("an email typed with capitals and spaces still signs in (as before)", async () => {
    const { to } = await signIn(`  ${rec.email.toUpperCase()} `, rec.password);
    expect(to).toBe("/staff");
  });
});

// ───────────────────────────────────────────── one identity per browser ─────────────────────────────────────────────
describe("one browser, one identity: switching needs a new sign-in, and logging out of one never signs in the other", () => {
  it("staff session in the browser, then the Developer signs in: the staff session is ended and the browser is the Developer only", async () => {
    await signIn(rec.email, rec.password);
    const staffToken = browser.sessionToken!;
    expect(await sessionsOf(rec.id)).toHaveLength(1);

    expect((await signIn(dev.email, dev.password)).to).toBe("/staff/developer");
    expect(await sessionsOf(rec.id)).toHaveLength(0); // the earlier session of this browser is gone
    expect((await getCurrentUser())?.actorType).toBe("DEVELOPER");

    browser.cookies.set("vlh_session", staffToken); // the old cookie, put back
    expect(await getCurrentUser()).toBeNull();
  });

  it("the Developer's session in the browser, then a staff sign-in: the Developer session is ended — the staff session has no Developer right", async () => {
    await signIn(dev.email, dev.password);
    const devToken = browser.sessionToken!;
    expect(await sessionsOf(dev.id)).toHaveLength(1);

    expect((await signIn(rec.email, rec.password)).to).toBe("/staff");
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    const me = (await getCurrentUser())!;
    expect(me.id).toBe(rec.id);
    expect(me.actorType).toBe("STAFF");
    expect(me.permissions.has("developer.access")).toBe(false);
    expect(me.permissions.has("audit.view")).toBe(false);

    browser.cookies.set("vlh_session", devToken);
    expect(await getCurrentUser()).toBeNull();
  });

  it("a Developer who is working as someone and then signs in again (anyone) leaves nothing of the earlier session behind", async () => {
    await signIn(dev.email, dev.password);
    await db.session.update({ where: { tokenHash: sha256(browser.sessionToken!) }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    expect((await getCurrentUser())?.workAs).not.toBeNull();
    await signIn(dev.email, dev.password);
    expect(await sessionsOf(dev.id)).toHaveLength(1);
    const me = (await getCurrentUser())!;
    expect([me.id, me.workAs]).toEqual([dev.id, null]); // a new session starts as the Developer, never as the person
  });

  it("the Developer in one browser and the Boss in another: each is its own identity, neither disturbs the other", async () => {
    await signIn(dev.email, dev.password);
    const a = browser.save();
    browser.reset();
    await signIn(boss.email, boss.password);
    const b = browser.save();
    expect(a.cookies.get("vlh_session")).not.toBe(b.cookies.get("vlh_session"));

    browser.restore(a);
    expect((await getCurrentUser())?.actorType).toBe("DEVELOPER");
    browser.restore(b);
    const staff = (await getCurrentUser())!;
    expect([staff.id, staff.actorType]).toEqual([boss.id, "STAFF"]);

    // logging out of the Developer account (browser A) ...
    browser.restore(a);
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    expect(await getCurrentUser()).toBeNull();
    expect(browser.cookies.size).toBe(0); // ... leaves browser A signed out, not signed in as anyone else
    expect(await sessionsOf(dev.id)).toHaveLength(0);

    // ... and does not touch the staff session in browser B
    browser.restore(b);
    expect((await getCurrentUser())?.id).toBe(boss.id);
    expect(await sessionsOf(boss.id)).toHaveLength(1);

    // and the other way: logging out of the staff account does not sign the Developer in
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    expect(await getCurrentUser()).toBeNull();
    expect(await sessionsOf(boss.id)).toHaveLength(0);
    expect(await sessionsOf(dev.id)).toHaveLength(0);
  });

  it("logging out: a 'logout' entry under the real account (DEVELOPER for the Developer, STAFF for staff), the session row gone, the cookies cleared", async () => {
    await signIn(dev.email, dev.password);
    const before = (await auditOf(dev.id, "auth.logout")).length;
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    const rows = (await auditOf(dev.id, "auth.logout")).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", entityId: dev.id });
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    expect(browser.cookies.size).toBe(0);

    browser.reset();
    await signIn(rec.email, rec.password);
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    expect((await auditOf(rec.id, "auth.logout")).at(-1)).toMatchObject({ actorType: "STAFF", actorRole: "RECEPTIONIST" });
  });

  it("logging out while WORKING AS someone signs the whole Developer session out — the entry is the Developer's, never the person's", async () => {
    await signIn(dev.email, dev.password);
    await db.session.update({ where: { tokenHash: sha256(browser.sessionToken!) }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    const me = (await getCurrentUser())!;
    expect([me.id, me.actorId, me.workAs?.developerId]).toEqual([rec.id, dev.id, dev.id]); // the screen is Asha's, the identity is the Developer's
    const devOut = (await auditOf(dev.id, "auth.logout")).length;
    const recOut = (await auditOf(rec.id, "auth.logout")).length;

    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    expect(await sessionsOf(dev.id)).toHaveLength(0); // the whole session is gone (it is not "stop working as", it is signing out)
    expect(browser.cookies.size).toBe(0);
    expect(await getCurrentUser()).toBeNull();

    const rows = (await auditOf(dev.id, "auth.logout")).slice(devOut);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: dev.fullName, entityId: dev.id });
    expect((await auditOf(rec.id, "auth.logout")).length).toBe(recOut); // nothing was written under the receptionist's name
    // and the end of working as is written down too, as the Developer's
    const ended = await auditOf(dev.id, "developer.work_as_ended");
    expect(ended.length).toBeGreaterThanOrEqual(1);
    expect(ended.at(-1)).toMatchObject({ actorType: "DEVELOPER", entityId: rec.id });
  });

  it("logging out when nobody is signed in: just back to the sign-in page, nothing recorded", async () => {
    const total = await db.auditLog.count({ where: { action: "auth.logout" } });
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    expect(await db.auditLog.count({ where: { action: "auth.logout" } })).toBe(total);
  });

  it("signing in again as the same account in the same browser leaves one session, not two", async () => {
    await signIn(rec.email, rec.password);
    await signIn(rec.email, rec.password);
    expect(await sessionsOf(rec.id)).toHaveLength(1);
  });
});

// ───────────────────────────────────────────── rate limits ─────────────────────────────────────────────
describe("a Developer's account is guarded harder than a staff account — found out from the account, not from a door", () => {
  it("the 6th try on one Developer account within 15 minutes is refused — even with the right password — and signs nobody in", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Limit" });
    for (let i = 1; i <= 5; i++) expect((await signIn(d.email, `wrong-pass-${i}-x`)).state?.error, `try ${i}`).toBe(FAIL);
    expect(await failedAbout(d.id)).toHaveLength(5);

    const sixth = await signIn(d.email, d.password);
    expect(sixth.to).toBeNull();
    expect(sixth.state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(d.id)).toHaveLength(0);
    expect(browser.cookies.size).toBe(0);
    expect(await auditOf(d.id, "auth.login")).toHaveLength(0);

    expect((await signIn(d.email, d.password)).state?.error).toBe(TOO_MANY); // and it stays shut
  });

  it("the lock follows the account, not the address: tries from 6 different addresses are still stopped at the 6th", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Limit Spread" });
    for (let i = 1; i <= 5; i++) { browser.reset(); expect((await signIn(d.email, `wrong-pass-${i}-x`)).state?.error).toBe(FAIL); }
    browser.reset();
    expect((await signIn(d.email, d.password)).state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(d.id)).toHaveLength(0);
  });

  it("one Developer's lock never closes another account: another Developer, and every staff account, still sign in", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Locked" });
    const other = await makeUser("DEVELOPER", { fullName: "Dev Other" });
    for (let i = 1; i <= 6; i++) await signIn(d.email, `wrong-pass-${i}-x`);
    expect((await signIn(d.email, d.password)).state?.error).toBe(TOO_MANY);
    browser.reset();
    expect((await signIn(other.email, other.password)).to).toBe("/staff/developer");
    browser.reset();
    expect((await signIn(rec.email, rec.password)).to).toBe("/staff");
  });

  it("the Developer's right password within its 5 tries signs in (the lock counts every try, the 5th still passes)", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Fifth" });
    for (let i = 1; i <= 4; i++) await signIn(d.email, `wrong-pass-${i}-x`);
    expect((await signIn(d.email, d.password)).to).toBe("/staff/developer");
  });

  it("an email nobody holds follows the ordinary limit — the 9th try is refused, with the same words as any other email", async () => {
    const email = `ghost-${Date.now()}@devtest.local`;
    for (let i = 1; i <= 8; i++) expect((await signIn(email, "x1y2z3-abc")).state?.error, `try ${i}`).toBe(FAIL);
    expect((await signIn(email, "x1y2z3-abc")).state?.error).toBe(TOO_MANY);
  });

  it("a staff account is looser: 6 wrong tries do not stop the right password (limit 8)", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff Limit" });
    for (let i = 1; i <= 6; i++) expect((await signIn(s.email, `wrong-pass-${i}-x`)).state?.error).toBe(FAIL);
    expect((await signIn(s.email, s.password)).to).toBe("/staff");
  });

  it("... but it has a limit too: the 9th try on a staff account is refused", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff Limit 2" });
    for (let i = 1; i <= 8; i++) expect((await signIn(s.email, `wrong-pass-${i}-x`)).state?.error).toBe(FAIL);
    const ninth = await signIn(s.email, s.password);
    expect(ninth.to).toBeNull();
    expect(ninth.state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(s.id)).toHaveLength(0);
  });

  it("the address limit is the same for everybody: the 21st try from one address within 15 minutes is refused, whichever account it is for", async () => {
    for (let i = 1; i <= 20; i++) expect((await signIn(`nobody-${i}@devtest.local`, "x1y2z3-abc")).state?.error, `try ${i}`).toBe(FAIL);
    const d = await makeUser("DEVELOPER", { fullName: "Dev Limit Ip" });
    expect((await signIn(d.email, d.password)).state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(d.id)).toHaveLength(0);
    // another address is not affected
    browser.reset();
    expect((await signIn(d.email, d.password)).to).toBe("/staff/developer");
  });

  it("staff sign-ins from one address (the hotel's) are counted as before: 12 tries leave room for the Developer's own sign-in", async () => {
    for (let i = 1; i <= 12; i++) await signIn(`nobody-${i}@devtest.local`, "x1y2z3-abc");
    const d = await makeUser("DEVELOPER", { fullName: "Dev Same Address" });
    expect((await signIn(d.email, d.password)).to).toBe("/staff/developer");
  });
});

// ───────────────────────────────────────────── session and cookie ─────────────────────────────────────────────
describe("the session a sign-in starts", () => {
  it("a token the browser already held is never adopted (no fixation): the new cookie is a new random value and the planted one is no session", async () => {
    for (const [u, to] of [[rec, "/staff"], [dev, "/staff/developer"]] as const) {
      browser.reset();
      browser.cookies.set("vlh_session", "attacker-chosen-token");
      expect((await signIn(u.email, u.password)).to, u.role).toBe(to);
      const fresh = browser.sessionToken!;
      expect(fresh, u.role).not.toBe("attacker-chosen-token");
      expect(fresh.length, u.role).toBeGreaterThanOrEqual(43); // 32 random bytes
      expect(await db.session.count({ where: { tokenHash: sha256("attacker-chosen-token") } }), u.role).toBe(0);
      browser.cookies.set("vlh_session", "attacker-chosen-token");
      expect(await getCurrentUser(), u.role).toBeNull();
    }
  });

  it("two sign-ins give two different tokens; the earlier one stops working", async () => {
    await signIn(rec.email, rec.password);
    const first = browser.sessionToken!;
    await signIn(rec.email, rec.password);
    const second = browser.sessionToken!;
    expect(second).not.toBe(first);
    browser.cookies.set("vlh_session", first);
    expect(await getCurrentUser()).toBeNull();
    browser.cookies.set("vlh_session", second);
    expect((await getCurrentUser())?.id).toBe(rec.id);
  });

  it("the cookies: the session cookie is httpOnly, SameSite=Lax, site-wide, ends with the session (Developer 4 hours); 'secure' in production; the hint cookie holds no token", async () => {
    await signIn(dev.email, dev.password);
    const opts = browser.cookieOptions.get("vlh_session")!;
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(opts.domain).toBeUndefined(); // this host only
    expect(opts.secure).toBe(false); // not production here
    const hours = ((opts.expires as Date).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(3.98);
    expect(hours).toBeLessThanOrEqual(4);
    expect(browser.cookies.get("vlh_staff")).toBe("1"); // a hint for the public site only
    expect(JSON.stringify([...browser.cookies])).not.toContain(dev.password);

    vi.stubEnv("NODE_ENV", "production");
    try {
      browser.reset();
      await signIn(dev.email, dev.password);
      expect(browser.cookieOptions.get("vlh_session")).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("'remember me' (or anything like it) in the form does not lengthen a Developer's session: 4 hours at most", async () => {
    const f = form(dev.email, dev.password);
    for (const k of ["remember", "rememberMe", "remember_me", "keepSignedIn", "stayLoggedIn", "maxAge", "expires", "sessionHours"]) f.set(k, "on");
    f.set("maxAge", "999999999");
    await expect(loginAction(undefined, f)).rejects.toBeInstanceOf(Redirected);
    const [row] = await sessionsOf(dev.id);
    expect((row.expiresAt.getTime() - Date.now()) / 3_600_000).toBeLessThanOrEqual(4);
    expect(((browser.cookieOptions.get("vlh_session")!.expires as Date).getTime() - Date.now()) / 3_600_000).toBeLessThanOrEqual(4);
  });

  it("nothing in the form can make a new session start out working as somebody", async () => {
    const f = form(dev.email, dev.password, { workAsUserId: rec.id, workAs: rec.id });
    await expect(loginAction(undefined, f)).rejects.toBeInstanceOf(Redirected);
    const [row] = await sessionsOf(dev.id);
    expect([row.workAsUserId, row.workAsStartedAt]).toEqual([null, null]);
    expect((await getCurrentUser())?.workAs).toBeNull();
  });
});

// ───────────────────────────────────────────── the audit trail is down ─────────────────────────────────────────────
describe("when the audit trail cannot be written", () => {
  it("a Developer's sign-in does not stand: no session row, no cookie, an error — and the next try works", async () => {
    vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
    const err = await thrownBy(() => loginAction(undefined, form(dev.email, dev.password)));
    expect((err as Error).message).toBe("audit down");
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    expect(browser.sessionToken).toBeNull();
    expect(await getCurrentUser()).toBeNull();

    const { to } = await signIn(dev.email, dev.password);
    expect(to).toBe("/staff/developer");
    expect(await sessionsOf(dev.id)).toHaveLength(1);
  });

  it("signing out always ends the session, even when the 'logout' entry cannot be written", async () => {
    await signIn(rec.email, rec.password);
    expect(await sessionsOf(rec.id)).toHaveLength(1);
    vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
    const err = await thrownBy(() => logoutAction());
    expect((err as Error).message).toBe("audit down");
    expect(await sessionsOf(rec.id)).toHaveLength(0);
    expect(browser.sessionToken).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it("a failed try on a real account still gets the very same answer when its entry cannot be written (no clue which accounts exist)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
      const { state, to } = await signIn(rec.email, "wrong-pass-1");
      expect(to).toBeNull();
      expect(state).toEqual({ error: FAIL, email: rec.email });
      expect(quiet).toHaveBeenCalledTimes(1);
      expect(String(quiet.mock.calls[0])).not.toContain(rec.email);
    } finally {
      quiet.mockRestore();
    }
  });
});

// ───────────────────────────────────────────── what the visitor can measure ─────────────────────────────────────────────
describe("the visitor cannot tell the failures apart by the time they take", () => {
  it("a wrong password, an unknown email and a switched-off account all take about as long (a real hash is checked every time)", async () => {
    await signIn("warm-up@devtest.local", "x1y2z3-abc"); // builds the stand-in hash once
    const median = async (run: () => Promise<unknown>) => {
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        browser.reset();
        const t0 = performance.now();
        await run();
        times.push(performance.now() - t0);
      }
      return times.sort((a, b) => a - b)[2];
    };
    let n = 0;
    const m = {
      staffWrongPassword: await median(() => signIn(rec.email, "wrong-pass-1")),
      developerWrongPassword: await median(() => signIn(dev.email, "wrong-pass-1")),
      unknownEmail: await median(() => signIn(`ghost-${++n}-${Date.now()}@devtest.local`, "wrong-pass-1")),
      switchedOff: await median(() => signIn(offRec.email, offRec.password)),
    };
    const all = Object.values(m);
    const ratio = Math.max(...all) / Math.min(...all);
    expect(ratio, JSON.stringify(m)).toBeLessThan(3);
  });

  it("a Developer account that is locked still costs a real hash before it answers (the refusal is not instant)", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Lock Timing" });
    await signIn("warm-up2@devtest.local", "x1y2z3-abc");
    for (let i = 1; i <= 5; i++) await signIn(d.email, `wrong-pass-${i}-x`);
    const t0 = performance.now();
    const refused = await signIn(d.email, "wrong-pass-6-x");
    const took = performance.now() - t0;
    expect(refused.state?.error).toBe(TOO_MANY);
    const tU = performance.now();
    await signIn(`ghost-t-${Date.now()}@devtest.local`, "wrong-pass-1");
    const unknown = performance.now() - tU;
    expect(took).toBeGreaterThan(unknown * 0.3);
  });
});
