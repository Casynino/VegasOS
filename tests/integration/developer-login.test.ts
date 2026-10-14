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
import { authenticate } from "@/server/services/auth-login";
import { loginAction, logoutAction, type LoginState } from "@/app/staff/(auth)/login/actions";
import { auditOf, browser, makeSession, makeUser, Redirected, removeMadeUsers, sha256, thrownBy, type MadeUser } from "../support/developer";

/**
 * Two doors, two identities (owner, 2026-10-14). The sign-in page offers "Developer Account" and "Staff Account", but the choice
 * is not authentication: the server checks the password AND that the account really is of that kind. The Developer door is
 * guarded harder; every try on a real account is kept in the audit trail; one browser holds one identity at a time.
 */
// The answer to a failed try: the Staff door keeps its original words; the Developer door says which door it is. Within a door the
// answer is identical for a wrong password, a wrong account type, an unknown email and a switched-off account.
const STAFF_FAIL = "Incorrect email or password.";
const DEV_FAIL = "Incorrect email or password for the Developer account.";
const failFor = (door?: string) => (door === "DEVELOPER" ? DEV_FAIL : STAFF_FAIL);
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

const form = (email: string, password: string, accountType?: string) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  if (accountType !== undefined) f.set("accountType", accountType);
  return f;
};
/** Press "Sign in" on a door. */
async function signIn(email: string, password: string, door?: string): Promise<{ state: LoginState; to: string | null }> {
  try {
    return { state: await loginAction(undefined, form(email, password, door)), to: null };
  } catch (e) {
    if (e instanceof Redirected) return { state: undefined, to: e.url };
    throw e;
  }
}
const sessionsOf = (userId: string) => db.session.findMany({ where: { userId } });
/** The failed-sign-in entries ABOUT an account (the account is the record they are about, never the one that wrote them), oldest first. */
const failedAbout = (entityId: string | null) => db.auditLog.findMany({ where: { action: "auth.login_failed", entityId }, orderBy: { createdAt: "asc" } });

// ───────────────────────────────────────────── authenticate() ─────────────────────────────────────────────
describe("authenticate(): the password AND the kind of account must match the door", () => {
  it("Developer credentials on the Developer door: in, as a DEVELOPER", async () => {
    expect(await authenticate(dev.email, dev.password, "DEVELOPER")).toEqual({ ok: true, userId: dev.id, fullName: dev.fullName, accountType: "DEVELOPER" });
  });

  it("Developer credentials on the Staff door: refused", async () => {
    expect(await authenticate(dev.email, dev.password, "STAFF")).toEqual({ ok: false, userId: dev.id, actual: "DEVELOPER", passwordOk: true });
  });

  it("staff credentials on the Staff door: in, as STAFF", async () => {
    expect(await authenticate(rec.email, rec.password, "STAFF")).toEqual({ ok: true, userId: rec.id, fullName: rec.fullName, accountType: "STAFF" });
  });

  it("staff credentials on the Developer door: refused", async () => {
    expect(await authenticate(rec.email, rec.password, "DEVELOPER")).toEqual({ ok: false, userId: rec.id, actual: "STAFF", passwordOk: true });
  });

  it("the Boss, the MD, a Manager and Finance sign in on the Staff door and are refused at the Developer door", async () => {
    for (const u of [boss, md, mgr, fin]) {
      expect((await authenticate(u.email, u.password, "STAFF")).ok, `${u.role} staff door`).toBe(true);
      expect(await authenticate(u.email, u.password, "DEVELOPER"), `${u.role} developer door`).toEqual({ ok: false, userId: u.id, actual: "STAFF", passwordOk: true });
    }
  });

  it("a wrong password, an unknown email and an inactive account all fail with the same shape", async () => {
    const failures = [
      await authenticate(dev.email, "wrong-password-1", "DEVELOPER"),
      await authenticate(rec.email, "wrong-password-1", "STAFF"),
      await authenticate(dev.email, "", "DEVELOPER"),
      await authenticate("nobody@devtest.local", "whatever-123", "DEVELOPER"),
      await authenticate("nobody@devtest.local", "whatever-123", "STAFF"),
      await authenticate(offDev.email, offDev.password, "DEVELOPER"), // right password, right door — but switched off
      await authenticate(offRec.email, offRec.password, "STAFF"),
      await authenticate(dev.email, dev.password, "STAFF"), // right password, wrong door
      await authenticate(rec.email, rec.password, "DEVELOPER"),
    ];
    for (const f of failures) {
      expect(f.ok).toBe(false);
      expect(Object.keys(f).sort()).toEqual(["actual", "ok", "passwordOk", "userId"]);
    }
  });

  it("a failed try on a real account gives that account's id (for the audit trail) and whether the password was right; an unknown email gives none", async () => {
    expect(await authenticate(dev.email, "wrong-password-1", "DEVELOPER")).toEqual({ ok: false, userId: dev.id, actual: "DEVELOPER", passwordOk: false });
    expect(await authenticate(rec.email, "wrong-password-1", "STAFF")).toEqual({ ok: false, userId: rec.id, actual: "STAFF", passwordOk: false });
    expect(await authenticate(offDev.email, offDev.password, "DEVELOPER")).toEqual({ ok: false, userId: offDev.id, actual: "DEVELOPER", passwordOk: true });
    expect(await authenticate("nobody@devtest.local", "whatever-123", "DEVELOPER")).toEqual({ ok: false, userId: null, actual: null, passwordOk: false });
    expect(await authenticate("nobody@devtest.local", "whatever-123", "STAFF")).toEqual({ ok: false, userId: null, actual: null, passwordOk: false });
  });

  it("an answer never carries the password or its hash", async () => {
    const stored = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { passwordHash: true } });
    for (const r of [await authenticate(dev.email, dev.password, "DEVELOPER"), await authenticate(dev.email, dev.password, "STAFF"), await authenticate(dev.email, "x", "DEVELOPER")]) {
      const text = JSON.stringify(r);
      expect(text).not.toContain(dev.password);
      expect(text).not.toContain(stored.passwordHash);
      expect(text).not.toContain("argon2");
    }
  });

  it("an unknown email takes about as long as a wrong password (a real hash is checked either way)", async () => {
    await authenticate("nobody@devtest.local", "warm-up-1", "STAFF"); // builds the stand-in hash once
    const time = async (email: string) => {
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) await authenticate(email, "wrong-password-1", "DEVELOPER");
      return performance.now() - t0;
    };
    const known = await time(dev.email);
    const unknown = await time("nobody@devtest.local");
    expect(unknown).toBeGreaterThan(known * 0.3);
    expect(unknown).toBeLessThan(known * 3);
  });
});

// ───────────────────────────────────────────── loginAction: the two doors ─────────────────────────────────────────────
describe("loginAction: a failed try", () => {
  it("Developer door with a staff account's credentials: the Developer door's plain error, no session, and a 'login_failed' entry ABOUT that account — written by the system, not by it", async () => {
    const before = (await failedAbout(rec.id)).length;
    const { state, to } = await signIn(rec.email, rec.password, "DEVELOPER");
    expect(to).toBeNull();
    expect(state).toEqual({ error: DEV_FAIL, email: rec.email, accountType: "DEVELOPER" });
    expect(await sessionsOf(rec.id)).toHaveLength(0);
    expect(browser.cookies.size).toBe(0);

    const rows = (await failedAbout(rec.id)).slice(before);
    expect(rows).toHaveLength(1);
    // Nobody is signed in: the entry has no user, no role, and is the system's — never the staff member's own activity.
    expect(rows[0]).toMatchObject({ userId: null, actorType: "SYSTEM", actorRole: null, actorLabel: SIGN_IN_PAGE, entityType: "User", entityId: rec.id, ipAddress: browser.ip });
    expect(rows[0].after).toEqual({ accountType: "DEVELOPER", accountExists: true, reasonKind: "wrong account type" });
    expect(await auditOf(rec.id, "auth.login_failed")).toHaveLength(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: rec.id } })).lastLoginAt).toBeNull();
  });

  it("Staff door with the Developer's credentials: the Staff door's original error, no session, and an entry about the Developer account that is NOT under the Developer's own activity", async () => {
    const before = (await failedAbout(dev.id)).length;
    const { state, to } = await signIn(dev.email, dev.password, "STAFF");
    expect(to).toBeNull();
    expect(state).toEqual({ error: STAFF_FAIL, email: dev.email, accountType: "STAFF" });
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    expect(browser.cookies.size).toBe(0);

    const rows = (await failedAbout(dev.id)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, actorType: "SYSTEM", actorRole: null, actorLabel: SIGN_IN_PAGE, entityId: dev.id });
    expect(rows[0].after).toEqual({ accountType: "STAFF", accountExists: true, reasonKind: "wrong account type" });
    expect(await auditOf(dev.id, "auth.login_failed")).toHaveLength(0); // nothing under the Developer's own identity
  });

  it("a wrong password on the Developer account: the Developer door's error, an entry about it (reason: bad password), written by the system", async () => {
    const before = (await failedAbout(dev.id)).length;
    const { state } = await signIn(dev.email, "not-the-password-1", "DEVELOPER");
    expect(state?.error).toBe(DEV_FAIL);
    const rows = (await failedAbout(dev.id)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "SYSTEM", userId: null });
    expect(rows[0].after).toEqual({ accountType: "DEVELOPER", accountExists: true, reasonKind: "bad password" });
    expect(await sessionsOf(dev.id)).toHaveLength(0);
  });

  it("a wrong password at the WRONG door is a 'bad password' (the right password is what makes it 'wrong account type')", async () => {
    await signIn(dev.email, "not-the-password-2", "STAFF");
    const row = (await failedAbout(dev.id)).at(-1)!;
    expect(row.after).toEqual({ accountType: "STAFF", accountExists: true, reasonKind: "bad password" });
  });

  it("an unknown email at the Developer door: the same error, and one entry with no account in it (and not the typed email); at the Staff door: the same error, no entry", async () => {
    const typed = `nobody-here-${Date.now()}@devtest.local`;
    const total = await db.auditLog.count({ where: { action: "auth.login_failed" } });
    const dev1 = await signIn(typed, "whatever-123", "DEVELOPER");
    expect(dev1.state?.error).toBe(DEV_FAIL);
    expect(await db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(total + 1);
    const row = (await failedAbout(null)).at(-1)!;
    expect(row).toMatchObject({ userId: null, actorType: "SYSTEM", actorLabel: SIGN_IN_PAGE, entityType: "User", entityId: null, ipAddress: browser.ip });
    expect(row.after).toEqual({ accountType: "DEVELOPER", accountExists: false });
    expect(JSON.stringify(row)).not.toContain(typed);
    expect(JSON.stringify(row)).not.toContain("whatever-123");

    const staff1 = await signIn(`${typed}.staff`, "whatever-123", "STAFF");
    expect(staff1.state?.error).toBe(STAFF_FAIL);
    expect(await db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(total + 1); // the Staff door writes nothing for an unknown email
  });

  it("a switched-off account: the very same error, no session, an entry about the account", async () => {
    for (const [u, door] of [[offDev, "DEVELOPER"], [offRec, "STAFF"]] as const) {
      const before = (await failedAbout(u.id)).length;
      const { state, to } = await signIn(u.email, u.password, door);
      expect(to).toBeNull();
      expect(state?.error).toBe(failFor(door));
      expect(await sessionsOf(u.id)).toHaveLength(0);
      expect((await failedAbout(u.id)).length).toBe(before + 1);
    }
  });

  it("every way to fail gives the same words within a door — nothing says which accounts exist or what kind they are", async () => {
    const answers: Record<"STAFF" | "DEVELOPER", Set<string | undefined>> = { STAFF: new Set(), DEVELOPER: new Set() };
    for (const [email, password, door] of [
      [rec.email, rec.password, "DEVELOPER"], [dev.email, dev.password, "STAFF"], [dev.email, "wrong-pass-1", "DEVELOPER"], [rec.email, "wrong-pass-1", "STAFF"],
      ["nobody@devtest.local", "x1y2z3-abc", "DEVELOPER"], ["nobody@devtest.local", "x1y2z3-abc", "STAFF"], [offDev.email, offDev.password, "DEVELOPER"],
    ] as const) answers[door].add((await signIn(email, password, door)).state?.error);
    expect([...answers.STAFF]).toEqual([STAFF_FAIL]);
    expect([...answers.DEVELOPER]).toEqual([DEV_FAIL]);
  });

  it("the Staff door's failure text is the ORIGINAL one (it did not change when the Developer door was added)", () => {
    expect(STAFF_FAIL).toBe("Incorrect email or password.");
    expect(DEV_FAIL).not.toBe(STAFF_FAIL);
  });

  it("no password ever reaches the audit trail — nor the typed email of an unknown account", async () => {
    const ghost = `ghost-secret-${Date.now()}@devtest.local`;
    await signIn(dev.email, "typed-wrong-pass-77", "DEVELOPER");
    await signIn(rec.email, rec.password, "DEVELOPER");
    await signIn(ghost, "ghost-typed-pass-88", "DEVELOPER");
    const rows = await db.auditLog.findMany({ where: { OR: [{ userId: { in: [dev.id, rec.id] } }, { action: "auth.login_failed" }] } });
    const text = JSON.stringify(rows);
    for (const secret of [dev.password, rec.password, "typed-wrong-pass-77", "ghost-typed-pass-88", ghost]) expect(text).not.toContain(secret);
  });

  it("a missing or strange door value is the Staff door — it never opens the Developer door", async () => {
    for (const door of [undefined, "", "developer", "dev", "ADMIN", "DEVELOPER ", "true"]) {
      browser.reset();
      const { state, to } = await signIn(dev.email, dev.password, door);
      expect(to, `door ${JSON.stringify(door)}`).toBeNull();
      expect(state?.error).toBe(STAFF_FAIL);
    }
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    // and staff with no door value still sign in as before
    const ok = await signIn(rec.email, rec.password);
    expect(ok.to).toBe("/staff");
  });

  it("a bad email or an empty password is a form error, not an attempt on any account", async () => {
    const total = await db.auditLog.count({ where: { action: "auth.login_failed" } });
    expect((await signIn("not-an-email", "x", "DEVELOPER")).state?.error).toBe("Enter a valid email address.");
    expect((await signIn(dev.email, "", "DEVELOPER")).state?.error).toBe("Enter your password.");
    expect(await db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(total);
  });

  it("a failed try does not sign anybody out: the browser keeps the session it had", async () => {
    await makeSession(rec.id);
    const { state } = await signIn(dev.email, dev.password, "STAFF");
    expect(state?.error).toBe(STAFF_FAIL);
    expect((await getCurrentUser())?.id).toBe(rec.id);
  });
});

describe("loginAction: signing in", () => {
  it("the Developer door with the Developer's credentials: in, to /staff — a DEVELOPER session, a 'login' entry, no secret kept", async () => {
    const before = (await auditOf(dev.id, "auth.login")).length;
    const { state, to } = await signIn(dev.email, dev.password, "DEVELOPER");
    expect(to).toBe("/staff");
    expect(state).toBeUndefined();

    const sessions = await sessionsOf(dev.id);
    expect(sessions).toHaveLength(1);
    const hours = (sessions[0].expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(3.98);
    expect(hours).toBeLessThanOrEqual(4);
    expect(sessions[0].tokenHash).toBe(sha256(browser.sessionToken!));
    expect(sessions[0].ipAddress).toBe(browser.ip);

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
  });

  it("the Staff door with a staff member's credentials: in, as STAFF, with the normal session length", async () => {
    const { to } = await signIn(rec.email, rec.password, "STAFF");
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

  it("the Boss and the MD sign in on the Staff door and get no Developer right", async () => {
    for (const u of [boss, md]) {
      browser.reset();
      expect((await signIn(u.email, u.password, "STAFF")).to, u.role).toBe("/staff");
      const me = (await getCurrentUser())!;
      expect([me.id, me.actorType, me.permissions.has("audit.view"), me.permissions.has("developer.access")], u.role).toEqual([u.id, "STAFF", true, false]);
    }
  });

  it("an email typed with capitals and spaces still signs in (as before)", async () => {
    const { to } = await signIn(`  ${rec.email.toUpperCase()} `, rec.password, "STAFF");
    expect(to).toBe("/staff");
  });
});

// ───────────────────────────────────────────── one identity per browser ─────────────────────────────────────────────
describe("one browser, one identity: switching needs a new sign-in, and logging out of one never signs in the other", () => {
  it("staff session in the browser, then a Developer sign-in: the staff session is ended and the browser is the Developer only", async () => {
    await signIn(rec.email, rec.password, "STAFF");
    const staffToken = browser.sessionToken!;
    expect(await sessionsOf(rec.id)).toHaveLength(1);

    expect((await signIn(dev.email, dev.password, "DEVELOPER")).to).toBe("/staff");
    expect(await sessionsOf(rec.id)).toHaveLength(0); // the earlier session of this browser is gone
    expect((await getCurrentUser())?.actorType).toBe("DEVELOPER");

    browser.cookies.set("vlh_session", staffToken); // the old cookie, put back
    expect(await getCurrentUser()).toBeNull();
  });

  it("Developer session in the browser, then a staff sign-in: the Developer session is ended — the staff session has no Developer right", async () => {
    await signIn(dev.email, dev.password, "DEVELOPER");
    const devToken = browser.sessionToken!;
    expect(await sessionsOf(dev.id)).toHaveLength(1);

    expect((await signIn(rec.email, rec.password, "STAFF")).to).toBe("/staff");
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    const me = (await getCurrentUser())!;
    expect(me.id).toBe(rec.id);
    expect(me.actorType).toBe("STAFF");
    expect(me.permissions.has("developer.access")).toBe(false);
    expect(me.permissions.has("audit.view")).toBe(false);

    browser.cookies.set("vlh_session", devToken);
    expect(await getCurrentUser()).toBeNull();
  });

  it("the person's staff account and Developer account in two browsers: each is its own identity, neither disturbs the other", async () => {
    // browser A: the Developer account
    await signIn(dev.email, dev.password, "DEVELOPER");
    const a = browser.save();
    // browser B: the same person's staff account (a different account and a different session)
    browser.reset();
    await signIn(boss.email, boss.password, "STAFF");
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
    await signIn(dev.email, dev.password, "DEVELOPER");
    const before = (await auditOf(dev.id, "auth.logout")).length;
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    const rows = (await auditOf(dev.id, "auth.logout")).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", entityId: dev.id });
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    expect(browser.cookies.size).toBe(0);

    browser.reset();
    await signIn(rec.email, rec.password, "STAFF");
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    expect((await auditOf(rec.id, "auth.logout")).at(-1)).toMatchObject({ actorType: "STAFF", actorRole: "RECEPTIONIST" });
  });

  it("logging out when nobody is signed in: just back to the sign-in page, nothing recorded", async () => {
    const total = await db.auditLog.count({ where: { action: "auth.logout" } });
    expect(await thrownRedirect(() => logoutAction())).toBe("/staff/login");
    expect(await db.auditLog.count({ where: { action: "auth.logout" } })).toBe(total);
  });

  it("signing in again as the same account in the same browser leaves one session, not two", async () => {
    await signIn(rec.email, rec.password, "STAFF");
    await signIn(rec.email, rec.password, "STAFF");
    expect(await sessionsOf(rec.id)).toHaveLength(1);
  });
});

async function thrownRedirect(run: () => Promise<unknown>): Promise<string | null> {
  try { await run(); return null; } catch (e) { if (e instanceof Redirected) return e.url; throw e; }
}

// ───────────────────────────────────────────── rate limits ─────────────────────────────────────────────
describe("the Developer door is guarded harder than the Staff door", () => {
  it("the 6th try on one Developer account within 15 minutes is refused — even with the right password — and signs nobody in", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Limit" });
    for (let i = 1; i <= 5; i++) expect((await signIn(d.email, `wrong-pass-${i}-x`, "DEVELOPER")).state?.error, `try ${i}`).toBe(DEV_FAIL);
    const failed = (await failedAbout(d.id)).length;
    expect(failed).toBe(5);

    const sixth = await signIn(d.email, d.password, "DEVELOPER");
    expect(sixth.to).toBeNull();
    expect(sixth.state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(d.id)).toHaveLength(0);
    expect(browser.cookies.size).toBe(0);
    expect(await auditOf(d.id, "auth.login")).toHaveLength(0);

    expect((await signIn(d.email, d.password, "DEVELOPER")).state?.error).toBe(TOO_MANY); // and it stays shut
  });

  it("the limit follows the account, not the address: tries from 6 different addresses are still stopped at the 6th", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Limit Spread" });
    for (let i = 1; i <= 5; i++) { browser.reset(); expect((await signIn(d.email, `wrong-pass-${i}-x`, "DEVELOPER")).state?.error).toBe(DEV_FAIL); }
    browser.reset();
    expect((await signIn(d.email, d.password, "DEVELOPER")).state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(d.id)).toHaveLength(0);
  });

  it("the limit follows the address too: the 9th try from one address within 15 minutes is refused, whichever account it is for", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Dev Limit Ip" });
    for (let i = 1; i <= 8; i++) expect((await signIn(`nobody-${i}@devtest.local`, "x1y2z3-abc", "DEVELOPER")).state?.error, `try ${i}`).toBe(DEV_FAIL);
    expect((await signIn(d.email, d.password, "DEVELOPER")).state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(d.id)).toHaveLength(0);
  });

  it("an email nobody holds is stopped the same way at the 6th try, with the same words (nothing tells which accounts exist)", async () => {
    const email = `ghost-${Date.now()}@devtest.local`;
    for (let i = 1; i <= 5; i++) expect((await signIn(email, "x1y2z3-abc", "DEVELOPER")).state?.error).toBe(DEV_FAIL);
    expect((await signIn(email, "x1y2z3-abc", "DEVELOPER")).state?.error).toBe(TOO_MANY);
  });

  it("the Staff door is looser: 6 wrong tries on a staff account do not stop the right password (limit 8)", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff Limit" });
    for (let i = 1; i <= 6; i++) expect((await signIn(s.email, `wrong-pass-${i}-x`, "STAFF")).state?.error).toBe(STAFF_FAIL);
    expect((await signIn(s.email, s.password, "STAFF")).to).toBe("/staff");
  });

  it("... but it has a limit too: the 9th try on a staff account is refused", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff Limit 2" });
    for (let i = 1; i <= 8; i++) expect((await signIn(s.email, `wrong-pass-${i}-x`, "STAFF")).state?.error).toBe(STAFF_FAIL);
    const ninth = await signIn(s.email, s.password, "STAFF");
    expect(ninth.to).toBeNull();
    expect(ninth.state?.error).toBe(TOO_MANY);
    expect(await sessionsOf(s.id)).toHaveLength(0);
  });

  it("wrong tries at the Developer door do not lock a staff account out of the Staff door", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff Not Locked" });
    for (let i = 1; i <= 5; i++) await signIn(s.email, s.password, "DEVELOPER"); // right password, wrong door
    expect((await signIn(s.email, s.password, "DEVELOPER")).state?.error).toBe(TOO_MANY); // the Developer door is shut for that email
    expect((await signIn(s.email, s.password, "STAFF")).to).toBe("/staff"); // the Staff door is not
  });
});

// ───────────────────────────────────────────── the address counts are separate ─────────────────────────────────────────────
describe("the Developer door's address count is its own", () => {
  it("many staff sign-ins from one address (the hotel's) never use up the Developer door's tries", async () => {
    for (let i = 1; i <= 12; i++) await signIn(`nobody-${i}@devtest.local`, "x1y2z3-abc", "STAFF"); // 12 tries at the Staff door from this address
    const d = await makeUser("DEVELOPER", { fullName: "Dev Same Address" });
    const { to } = await signIn(d.email, d.password, "DEVELOPER"); // would be the 13th on a shared count, past the Developer door's 8
    expect(to).toBe("/staff");
  });

  it("a flood at the Developer door never closes the Staff door for that address", async () => {
    for (let i = 1; i <= 24; i++) await signIn(`nobody-dev-${i}@devtest.local`, "x1y2z3-abc", "DEVELOPER"); // far past both limits
    expect((await signIn(`nobody-dev-25@devtest.local`, "x1y2z3-abc", "DEVELOPER")).state?.error).toBe(TOO_MANY);
    const s = await makeUser("RECEPTIONIST", { fullName: "Staff Same Address" });
    expect((await signIn(s.email, s.password, "STAFF")).to).toBe("/staff");
  });
});

// ───────────────────────────────────────────── session and cookie ─────────────────────────────────────────────
describe("the session a sign-in starts", () => {
  it("a token the browser already held is never adopted (no fixation): the new cookie is a new random value and the planted one is no session", async () => {
    for (const [u, door] of [[rec, "STAFF"], [dev, "DEVELOPER"]] as const) {
      browser.reset();
      browser.cookies.set("vlh_session", "attacker-chosen-token");
      expect((await signIn(u.email, u.password, door)).to, door).toBe("/staff");
      const fresh = browser.sessionToken!;
      expect(fresh, door).not.toBe("attacker-chosen-token");
      expect(fresh.length, door).toBeGreaterThanOrEqual(43); // 32 random bytes
      expect(await db.session.count({ where: { tokenHash: sha256("attacker-chosen-token") } }), door).toBe(0);
      browser.cookies.set("vlh_session", "attacker-chosen-token");
      expect(await getCurrentUser(), door).toBeNull();
    }
  });

  it("two sign-ins give two different tokens; the earlier one stops working", async () => {
    await signIn(rec.email, rec.password, "STAFF");
    const first = browser.sessionToken!;
    await signIn(rec.email, rec.password, "STAFF");
    const second = browser.sessionToken!;
    expect(second).not.toBe(first);
    browser.cookies.set("vlh_session", first);
    expect(await getCurrentUser()).toBeNull();
    browser.cookies.set("vlh_session", second);
    expect((await getCurrentUser())?.id).toBe(rec.id);
  });

  it("the cookies: the session cookie is httpOnly, SameSite=Lax, site-wide, ends with the session (Developer 4 hours); 'secure' in production; the hint cookie holds no token", async () => {
    await signIn(dev.email, dev.password, "DEVELOPER");
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
      await signIn(dev.email, dev.password, "DEVELOPER");
      expect(browser.cookieOptions.get("vlh_session")).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("'remember me' (or anything like it) in the form does not lengthen a Developer's session: 4 hours at most", async () => {
    const f = form(dev.email, dev.password, "DEVELOPER");
    for (const k of ["remember", "rememberMe", "remember_me", "keepSignedIn", "stayLoggedIn", "maxAge", "expires", "sessionHours"]) f.set(k, "on");
    f.set("maxAge", "999999999");
    await expect(loginAction(undefined, f)).rejects.toBeInstanceOf(Redirected);
    const [row] = await sessionsOf(dev.id);
    expect((row.expiresAt.getTime() - Date.now()) / 3_600_000).toBeLessThanOrEqual(4);
    expect(((browser.cookieOptions.get("vlh_session")!.expires as Date).getTime() - Date.now()) / 3_600_000).toBeLessThanOrEqual(4);
  });
});

// ───────────────────────────────────────────── the audit trail is down ─────────────────────────────────────────────
describe("when the audit trail cannot be written", () => {
  it("a Developer's sign-in does not stand: no session row, no cookie, an error — and the next try works", async () => {
    vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
    const err = await thrownBy(() => loginAction(undefined, form(dev.email, dev.password, "DEVELOPER")));
    expect((err as Error).message).toBe("audit down");
    expect(await sessionsOf(dev.id)).toHaveLength(0);
    expect(browser.sessionToken).toBeNull();
    expect(await getCurrentUser()).toBeNull();

    const { to } = await signIn(dev.email, dev.password, "DEVELOPER");
    expect(to).toBe("/staff");
    expect(await sessionsOf(dev.id)).toHaveLength(1);
  });

  it("signing out always ends the session, even when the 'logout' entry cannot be written", async () => {
    await signIn(rec.email, rec.password, "STAFF");
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
      const { state, to } = await signIn(rec.email, "wrong-pass-1", "STAFF");
      expect(to).toBeNull();
      expect(state).toEqual({ error: STAFF_FAIL, email: rec.email, accountType: "STAFF" });
      expect(quiet).toHaveBeenCalledTimes(1);
      expect(String(quiet.mock.calls[0])).not.toContain(rec.email);
    } finally {
      quiet.mockRestore();
    }
  });
});

// ───────────────────────────────────────────── what the visitor can measure ─────────────────────────────────────────────
describe("the visitor cannot tell the failures apart by the time they take", () => {
  it("wrong password, right password at the wrong door, an unknown email and a switched-off account all take about as long (a real hash is checked every time)", async () => {
    await signIn("warm-up@devtest.local", "x1y2z3-abc", "STAFF"); // builds the stand-in hash once
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
      wrongPassword: await median(() => signIn(rec.email, "wrong-pass-1", "STAFF")),
      wrongDoor: await median(() => signIn(dev.email, dev.password, "STAFF")),
      developerWrongPassword: await median(() => signIn(dev.email, "wrong-pass-1", "DEVELOPER")),
      unknownEmail: await median(() => signIn(`ghost-${++n}-${Date.now()}@devtest.local`, "wrong-pass-1", "STAFF")),
      unknownEmailAtDeveloperDoor: await median(() => signIn(`ghost-${++n}-${Date.now()}@devtest.local`, "wrong-pass-1", "DEVELOPER")),
      switchedOff: await median(() => signIn(offRec.email, offRec.password, "STAFF")),
    };
    const all = Object.values(m);
    const ratio = Math.max(...all) / Math.min(...all);
    expect(ratio, JSON.stringify(m)).toBeLessThan(3);
  });
});
