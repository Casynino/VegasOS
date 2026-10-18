import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The cron's other jobs (reports, WhatsApp, payments…) are not what is tested here: each is replaced by a quick stand-in, the rest of its module stays real.
vi.mock("@/server/services/daily-report", async (orig) => ({ ...(await orig<Record<string, unknown>>()), runDailyReportJob: vi.fn(async () => ({ report: "stand-in" })) }));
vi.mock("@/server/services/shift-report", async (orig) => ({ ...(await orig<Record<string, unknown>>()), retryShiftReports: vi.fn(async () => null) }));
vi.mock("@/server/services/staff-report", async (orig) => ({ ...(await orig<Record<string, unknown>>()), runStaffPeriodJob: vi.fn(async () => null) }));
vi.mock("@/server/services/mobile-payments", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sweepMobilePayments: vi.fn(async () => null) }));
vi.mock("@/server/services/withdrawals", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sweepWithdrawals: vi.fn(async () => null) }));
vi.mock("@/server/services/invoices", async (orig) => ({ ...(await orig<Record<string, unknown>>()), refreshOverdueInvoices: vi.fn(async () => null) }));
vi.mock("@/server/services/booking-holds", async (orig) => ({ ...(await orig<Record<string, unknown>>()), refreshBookingStates: vi.fn(async () => null) }));
vi.mock("@/server/services/front-desk", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sendArrivalReminders: vi.fn(async () => null) }));

import { db, rawDb } from "@/server/db";
import { getCurrentUser, requirePagePermission } from "@/server/auth";
import { authenticate, DEVELOPER_TRIES, developerLockKey, signInProbeKey } from "@/server/services/auth-login";
import { recordWorkAsOfSessionsEnding, removeExpiredSessions } from "@/server/services/session-cleanup";
import { ENDPOINT_REFUSED_ACTION } from "@/server/services/endpoint-refusal";
import * as rateLimitModule from "@/server/rate-limit";
import { changePasswordAction, signOutOtherDevicesAction, updateProfileAction } from "@/app/staff/(app)/account/actions";
import { ChangePasswordForm } from "@/app/staff/(app)/account/change-password-form";
import { loginAction } from "@/app/staff/(auth)/login/actions";
import { GET as cronRoute } from "@/app/api/cron/daily-report/route";
import { I18nProvider } from "@/i18n/client";
import { PERMISSIONS } from "@/lib/permissions";
import { validateDeveloperPassword } from "@/lib/developer-password";
import session2Zh from "@/i18n/catalog/zh-CN/staff/developer-session2";
import session3Zh from "@/i18n/catalog/zh-CN/staff/developer-session3";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, sha256, type MadeUser } from "../support/developer";

/**
 * Developer account — the last review findings, session side (owner, 2026-10-17):
 *   1. a "work as" that ends with no request is written down (the cron's clean-up, a password change, "sign out my other devices");
 *   2. a staff member at the Developer's PAGES leaves a trace, as at its actions;
 *   3. the Developer's lock: every email does the same write before the hash, and only WRONG tries count (a good sign-in clears them);
 *   4. a staff member is never told that an email is the Developer's ("already in use");
 *   5. the Developer sees its own password rule where it changes the password;
 *   6. the audit.view right does not promise more than the database lock does.
 */

let dev: MadeUser;
let dev2: MadeUser;
let rec: MadeUser;
let fin: MadeUser;

beforeAll(async () => {
  [dev, dev2, rec, fin] = await Promise.all([
    makeUser("DEVELOPER", { fullName: "Three Dev" }), makeUser("DEVELOPER", { fullName: "Three Dev Two" }),
    makeUser("RECEPTIONIST", { fullName: "Three Neema" }), makeUser("FINANCE", { fullName: "Three Fatma" }),
  ]);
});
afterAll(async () => {
  browser.reset();
  await db.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "login:" } }, { key: { startsWith: "probe:signin:" } }] } });
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  vi.restoreAllMocks();
  await db.$executeRawUnsafe(`TRUNCATE "audit_logs"`); // every test counts its own entries
  await rawDb.session.deleteMany({ where: { userId: { in: [dev, dev2, rec, fin].map((u) => u.id) } } });
  await db.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "login:" } }, { key: { startsWith: "probe:signin:" } }, { key: { startsWith: "pwchange:" } }, { key: { startsWith: "emailchange:" } }] } });
});

const entries = (action: string, where: Record<string, unknown> = {}) => db.auditLog.findMany({ where: { action, ...where }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const expired = () => entries("developer.work_as_expired");
const sessionRow = (hash: string) => rawDb.session.findUnique({ where: { tokenHash: hash } });
const bucket = (key: string) => db.rateLimitBucket.findUnique({ where: { key } });
/** A Developer's session row (not the browser's) that is working as someone since `startedMinAgo`; `expiresInMin` negative = already expired. */
async function workingAsRow(who: MadeUser, target: MadeUser, opts: { expiresInMin?: number; startedMinAgo?: number; cookie?: boolean } = {}): Promise<string> {
  const hash = sha256(await makeSession(who.id, { createdMinAgo: 5, seenMinAgo: 1, expiresInMin: opts.expiresInMin ?? 100, setCookie: opts.cookie ?? false }));
  await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - (opts.startedMinAgo ?? 10) * 60_000) } });
  return hash;
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const GOOD = "Tz-Vegas-Dev#2026-ok";

// ═════════════════════════════ 1. a work-as that ends with no request is written down ═════════════════════════════
describe("the cron's clean-up of expired sessions writes the end of a work-as first", () => {
  it("an expired Developer session that still works as someone: ONE entry as the Developer (who, as whom, why), then the row is deleted — and a second run writes nothing more", async () => {
    const hash = await workingAsRow(dev, rec, { expiresInMin: -10, startedMinAgo: 25 });
    expect(await removeExpiredSessions()).toBeGreaterThanOrEqual(1);
    expect(await sessionRow(hash)).toBeNull();
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: dev.fullName, entityType: "User", entityId: rec.id, after: { targetName: rec.fullName, targetRole: "Receptionist", endedBy: "session" } });
    expect((rows[0].after as { reason: string }).reason).toMatch(/session ended/);
    expect((rows[0].after as { minutes: number }).minutes).toBeGreaterThanOrEqual(25);
    await removeExpiredSessions();
    expect(await expired()).toHaveLength(1);
  });

  it("nothing is written for what did not work as anyone: an expired Developer session with no work-as, a good session that does, or a staff session carrying a forged row", async () => {
    const plain = sha256(await makeSession(dev.id, { expiresInMin: -10, setCookie: false }));
    const good = await workingAsRow(dev2, rec, { expiresInMin: 60 });
    const forged = sha256(await makeSession(rec.id, { expiresInMin: -10, setCookie: false }));
    await rawDb.session.update({ where: { tokenHash: forged }, data: { workAsUserId: fin.id, workAsStartedAt: new Date() } });
    await removeExpiredSessions();
    expect(await sessionRow(plain)).toBeNull();
    expect(await sessionRow(forged)).toBeNull(); // deleted like any expired session…
    expect(await expired()).toHaveLength(0); // …and a staff row says nothing about a Developer
    expect(await sessionRow(good)).toMatchObject({ workAsUserId: rec.id }); // a session still good is not touched
  });

  it("a person who was removed (the link cleared by the database, the start time left) is still written as ended — without a name", async () => {
    const gone = await makeUser("RECEPTIONIST", { fullName: "Three Removed" });
    const hash = await workingAsRow(dev, gone, { expiresInMin: -1 });
    await rawDb.user.delete({ where: { id: gone.id } });
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: null });
    await removeExpiredSessions();
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, entityId: null, after: { targetName: null, endedBy: "session" } });
  });

  it("a request that finds the same dead session at the same moment does not make a second entry", async () => {
    await workingAsRow(dev, rec, { expiresInMin: -5, cookie: true });
    await Promise.all([getCurrentUser(), removeExpiredSessions(), getCurrentUser(), removeExpiredSessions()]);
    expect(await expired()).toHaveLength(1);
  });

  it("one row that fails never stops the clean-up: the other is still written and every expired session is deleted — nothing throws", async () => {
    const first = await workingAsRow(dev, rec, { expiresInMin: -5 });
    const second = await workingAsRow(dev2, fin, { expiresInMin: -5 });
    const real = await import("@/server/audit");
    vi.spyOn(real, "audit").mockRejectedValueOnce(new Error("audit trail down"));
    await expect(removeExpiredSessions()).resolves.toBeGreaterThanOrEqual(2);
    expect(await sessionRow(first)).toBeNull();
    expect(await sessionRow(second)).toBeNull();
    expect(await expired()).toHaveLength(1); // one failed, one was written
  });

  it("the cron route itself runs this clean-up (and the 24-hour clean-up of rate-limit windows, which also removes the sign-in probe counters)", async () => {
    process.env.CRON_SECRET = "session-3-cron-secret";
    const hash = await workingAsRow(dev, rec, { expiresInMin: -3, startedMinAgo: 40 });
    await db.rateLimitBucket.create({ data: { key: signInProbeKey("old-probe@devtest.local"), count: 3, windowStart: new Date(Date.now() - 25 * 3600_000) } });
    await db.rateLimitBucket.create({ data: { key: signInProbeKey("new-probe@devtest.local"), count: 1, windowStart: new Date() } });
    const refused = await cronRoute(new Request("http://localhost/api/cron/daily-report", { headers: { authorization: "Bearer wrong" } }));
    expect(refused.status).toBe(401);
    expect(await sessionRow(hash)).not.toBeNull(); // an unauthorised call changes nothing
    const ok = await cronRoute(new Request("http://localhost/api/cron/daily-report", { headers: { authorization: "Bearer session-3-cron-secret" } }));
    expect(ok.status).toBe(200);
    expect(await sessionRow(hash)).toBeNull();
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, entityId: rec.id, after: { endedBy: "session" } });
    expect(await bucket(signInProbeKey("old-probe@devtest.local"))).toBeNull();
    expect(await bucket(signInProbeKey("new-probe@devtest.local"))).not.toBeNull();
    // the route no longer deletes sessions by itself behind the entry's back
    expect(readFileSync(path.resolve(import.meta.dirname, "../../src/app/api/cron/daily-report/route.ts"), "utf8")).not.toContain("db.session.deleteMany");
  });
});

describe("a password change or 'sign out my other devices' writes the end of a work-as on the Developer's other sessions first", () => {
  it("changing the Developer's password: the other session that was working as someone is written as ended (with the address), then signed out — this session stays", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Pw" });
    const current = sha256(await makeSession(d.id, { createdMinAgo: 1 }));
    const other = await workingAsRow(d, rec, { startedMinAgo: 20 });
    const plainOther = sha256(await makeSession(d.id, { setCookie: false }));
    const res = await changePasswordAction(undefined, form({ currentPassword: d.password, newPassword: GOOD, confirmPassword: GOOD }));
    expect(res.ok).toBe(true);
    expect(await sessionRow(other)).toBeNull();
    expect(await sessionRow(plainOther)).toBeNull();
    expect(await sessionRow(current)).not.toBeNull();
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: d.id, actorType: "DEVELOPER", entityId: rec.id, ipAddress: browser.ip, after: { endedBy: "session" } });
    expect(await entries("user.password_changed")).toHaveLength(1);
  });

  it("a password that is refused changes nothing: no session is signed out and nothing is written", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Weak" });
    await makeSession(d.id, { createdMinAgo: 1 });
    const other = await workingAsRow(d, rec);
    const res = await changePasswordAction(undefined, form({ currentPassword: d.password, newPassword: "Staffpass12345", confirmPassword: "Staffpass12345" }));
    expect(res.ok).toBe(false);
    expect(await sessionRow(other)).toMatchObject({ workAsUserId: rec.id });
    expect(await expired()).toHaveLength(0);
  });

  it("a staff member's password change is exactly as before: other sessions go, nothing about a work-as is written (a forged row on a staff session records nothing)", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Three Staff Pw" });
    await makeSession(s.id, { createdMinAgo: 1 });
    const other = sha256(await makeSession(s.id, { setCookie: false }));
    await rawDb.session.update({ where: { tokenHash: other }, data: { workAsUserId: fin.id, workAsStartedAt: new Date() } });
    const res = await changePasswordAction(undefined, form({ currentPassword: s.password, newPassword: "Staffpass12345", confirmPassword: "Staffpass12345" }));
    expect(res.ok).toBe(true);
    expect(await sessionRow(other)).toBeNull();
    expect(await expired()).toHaveLength(0);
  });

  it("'sign out my other devices' as the Developer: the same — an entry for the other session that was working as someone, this session stays", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Out" });
    const current = sha256(await makeSession(d.id, { createdMinAgo: 1 }));
    const other = await workingAsRow(d, fin, { startedMinAgo: 15 });
    const res = await signOutOtherDevicesAction();
    expect(res.ok).toBe(true);
    expect(await sessionRow(other)).toBeNull();
    expect(await sessionRow(current)).not.toBeNull();
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: d.id, entityId: fin.id, ipAddress: browser.ip, after: { endedBy: "session" } });
    expect(await entries("user.sessions_revoked")).toHaveLength(1);
  });

  it("'sign out my other devices' as staff: unchanged — no work-as entry", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Three Staff Out" });
    await makeSession(s.id, { createdMinAgo: 1 });
    await makeSession(s.id, { setCookie: false });
    expect((await signOutOtherDevicesAction()).ok).toBe(true);
    expect(await expired()).toHaveLength(0);
  });

  it("signing in again in the same browser while working as someone writes the end first (the sign-in path of destroySession)", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Again" });
    const hash = await workingAsRow(d, rec, { cookie: true, startedMinAgo: 12 });
    expect(await getCurrentUser()).toMatchObject({ id: rec.id, actorId: d.id });
    expect(await redirectOf(() => loginAction(undefined, form({ email: d.email, password: d.password })))).toBe("/staff/developer");
    expect(await sessionRow(hash)).toBeNull();
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: d.id, entityId: rec.id, after: { endedBy: "session" } });
  });

  it("the helper never throws and writes nothing for a filter that matches no work-as", async () => {
    expect(await recordWorkAsOfSessionsEnding({ userId: "no-such-user" })).toBe(0);
    expect(await recordWorkAsOfSessionsEnding({ userId: rec.id })).toBe(0);
  });
});

// ═════════════════════════════ 2. the Developer's pages leave a trace for a non-Developer ═════════════════════════════
describe("a staff member reaching for a Developer PAGE leaves a trace (the actions already did)", () => {
  const refused = (userId?: string) => entries(ENDPOINT_REFUSED_ACTION, userId ? { userId } : {});
  const signedInAs = async (u: MadeUser) => { browser.reset(); await makeSession(u.id, { createdMinAgo: 1 }); };

  it("the page is refused (sent to the 'no access' page) and ONE entry is written under their own name: who, from where, which page", async () => {
    await signedInAs(rec);
    browser.headers.set("x-pathname", "/staff/developer/audit");
    expect(await redirectOf(() => requirePagePermission("developer.access"))).toBe("/staff/forbidden");
    const rows = await refused();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: rec.id, actorType: "STAFF", actorRole: "RECEPTIONIST", actorLabel: rec.fullName, entityType: "Permission", entityId: "developer.access", after: { path: "/staff/developer/audit" } });
    expect(rows[0].ipAddress).toBe(browser.ip);
  });

  it("bounded: a loop of page loads (at the same moment too) writes one entry per person per 10 minutes — page loads and refused actions share the one entry", async () => {
    await signedInAs(rec);
    await Promise.all(Array.from({ length: 20 }, () => redirectOf(() => requirePagePermission("developer.access"))));
    for (let i = 0; i < 3; i++) await redirectOf(() => requirePagePermission("developer.access"));
    expect(await refused(rec.id)).toHaveLength(1);
    const { requireDeveloperSession } = await import("@/server/services/work-as");
    await requireDeveloperSession().catch(() => null);
    expect(await refused(rec.id)).toHaveLength(1);
    await signedInAs(fin);
    await redirectOf(() => requirePagePermission("developer.access"));
    expect(await refused(fin.id)).toHaveLength(1);
  });

  it("a page that does not need the Developer-only right is refused exactly as before, with no such entry (and a staff member who holds the other right a page asks for just gets in)", async () => {
    await signedInAs(rec);
    expect(await redirectOf(() => requirePagePermission("finance.view"))).toBe("/staff/forbidden");
    expect(await refused()).toHaveLength(0);
    await signedInAs(fin);
    expect(await requirePagePermission("developer.access", "dashboard.finance")).toMatchObject({ id: fin.id }); // holds the second right: in
    expect(await refused()).toHaveLength(0);
  });

  it("a Developer gets in and leaves none; a Developer WORKING AS someone is refused by the ordinary rule (a 'developer.denied' entry), not as a stranger", async () => {
    await signedInAs(dev);
    expect(await requirePagePermission("developer.access")).toMatchObject({ id: dev.id, actorType: "DEVELOPER" });
    expect(await refused()).toHaveLength(0);
    browser.reset();
    await workingAsRow(dev2, rec, { cookie: true });
    expect(await redirectOf(() => requirePagePermission("developer.access"))).toBe("/staff/forbidden");
    expect(await refused()).toHaveLength(0);
    expect(await entries("developer.denied", { userId: dev2.id })).toHaveLength(1);
  });

  it("nobody signed in goes to the sign-in page, with no entry (there is no one to name); the entry can never break the answer", async () => {
    browser.reset();
    expect(await redirectOf(() => requirePagePermission("developer.access"))).toBe("/staff/login");
    expect(await refused()).toHaveLength(0);
    await signedInAs(rec);
    const real = await import("@/server/audit");
    vi.spyOn(real, "audit").mockRejectedValueOnce(new Error("audit trail down"));
    expect(await redirectOf(() => requirePagePermission("developer.access"))).toBe("/staff/forbidden");
  });
});

// ═════════════════════════════ 3. the Developer's lock: same work for every email, only wrong tries count ═════════════════════════════
describe("sign-in: every email does the same write before its password is checked", () => {
  it("an unknown email, a staff email and a Developer's email each take ONE counter write before the hash — the Developer's own lock key, every other email a probe key", async () => {
    const ghost = `ghost-${Date.now()}@devtest.local`;
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Probe" });
    for (const [email, key] of [[ghost, signInProbeKey(ghost)], [rec.email, signInProbeKey(rec.email)], [d.email, developerLockKey(d.email)]] as const) {
      const spy = vi.spyOn(rateLimitModule, "rateLimit");
      await authenticate(email, "wrong-pass-1-x");
      expect(spy.mock.calls.map((c) => c[0]), email).toEqual([key]);
      spy.mockRestore();
      expect((await bucket(key))?.count, key).toBe(1);
    }
    // the Developer's email does not also fill a probe row, and the probe keys are not sign-in keys of the Console's count
    expect(await bucket(signInProbeKey(d.email))).toBeNull();
    expect(signInProbeKey(ghost).startsWith("login:")).toBe(false);
  });

  it("a success is the same for all: one write before the hash, the counter cleared after (one delete) — staff, unknown and Developer alike", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Clear" });
    for (const [u, key] of [[rec, signInProbeKey(rec.email)], [d, developerLockKey(d.email)]] as const) {
      const spy = vi.spyOn(rateLimitModule, "rateLimit");
      expect((await authenticate(u.email, u.password)).ok).toBe(true);
      expect(spy.mock.calls.map((c) => c[0])).toEqual([key]);
      spy.mockRestore();
      expect(await bucket(key), key).toBeNull();
    }
  });

  it("the staff probe is never enforced: 12 wrong tries (more than the Developer's 5 and the action's 8) refuse nothing here, and the right password still signs in", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Three Probe Staff" });
    for (let i = 1; i <= 12; i++) expect(await authenticate(s.email, `wrong-pass-${i}-x`), `try ${i}`).toEqual({ ok: false, userId: s.id, actual: "STAFF", passwordOk: false, active: true });
    expect((await bucket(signInProbeKey(s.email)))?.count).toBe(12);
    expect((await authenticate(s.email, s.password)).ok).toBe(true);
  });
});

describe("the Developer's lock counts only WRONG tries", () => {
  it("right-password sign-ins never add up: seven in a row all work", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Seven" });
    for (let i = 1; i <= DEVELOPER_TRIES + 2; i++) expect((await authenticate(d.email, d.password)).ok, `sign-in ${i}`).toBe(true);
    expect(await bucket(developerLockKey(d.email))).toBeNull();
  });

  it("4 wrong tries then the right password: in, and the count starts again — 5 more wrong tries are all ordinary failures, the 6th is the lock (even the right password)", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Reset" });
    for (let i = 1; i <= 4; i++) await authenticate(d.email, `wrong-pass-${i}-x`);
    expect((await bucket(developerLockKey(d.email)))?.count).toBe(4);
    expect((await authenticate(d.email, d.password)).ok).toBe(true); // the 5th try still passes…
    expect(await bucket(developerLockKey(d.email))).toBeNull(); // …and clears the count
    for (let i = 1; i <= 5; i++) {
      const r = await authenticate(d.email, `wrong-pass-again-${i}-x`);
      expect(r, `wrong try ${i} after the reset`).toEqual({ ok: false, userId: d.id, actual: "DEVELOPER", passwordOk: false, active: true });
    }
    expect(await authenticate(d.email, d.password)).toMatchObject({ ok: false, locked: true });
  });

  it("the lock itself is unchanged: 5 wrong tries, then even the right password is refused as 'locked' — and a locked try clears nothing", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Still Locked" });
    for (let i = 1; i <= 5; i++) await authenticate(d.email, `wrong-pass-${i}-x`);
    for (let i = 0; i < 3; i++) expect(await authenticate(d.email, d.password)).toMatchObject({ ok: false, locked: true, passwordOk: false });
    expect((await bucket(developerLockKey(d.email)))?.count).toBeGreaterThan(DEVELOPER_TRIES);
  });

  it("a right password on a switched-off Developer account is a failure: it stays counted, and the 6th is locked", async () => {
    const off = await makeUser("DEVELOPER", { fullName: "Three Dev Off", isActive: false });
    for (let i = 1; i <= 5; i++) expect(await authenticate(off.email, off.password), `try ${i}`).toEqual({ ok: false, userId: off.id, actual: "DEVELOPER", passwordOk: true, active: false });
    expect(await authenticate(off.email, off.password)).toMatchObject({ ok: false, locked: true });
  });

  it("through the sign-in page: 4 wrong tries then the right password signs in and leaves no count behind", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Dev Page" });
    for (let i = 1; i <= 4; i++) expect(((await loginAction(undefined, form({ email: d.email, password: `wrong-pass-${i}-x` }))) as { error?: string }).error).toBe("Incorrect email or password.");
    const to = await redirectOf(() => loginAction(undefined, form({ email: d.email, password: d.password })));
    expect(to).toBe("/staff/developer");
    expect(await bucket(developerLockKey(d.email))).toBeNull();
  });

  it("the document says the same: 5 WRONG tries, and a good sign-in clears the count", () => {
    const doc = readFileSync(path.resolve(import.meta.dirname, "../../docs/developer-account.md"), "utf8");
    expect(doc).toContain(`**${DEVELOPER_TRIES} wrong tries for one Developer email in 15 minutes**`);
    expect(doc).toContain("**Only wrong tries count.** A sign-in that works clears the count");
    expect(doc).toContain("every email, whoever it belongs to and even one nobody holds, does the same database write before its password is checked");
  });
});

// ═════════════════════════════ 4. the Developer's email is not singled out ═════════════════════════════
describe("changing your own login email: the Developer's address is worded like any other taken address", () => {
  const profile = (u: MadeUser, email: string, password = u.password) => form({ fullName: u.fullName, email, phone: "", currentPassword: password });
  const signedInAs = async (u: MadeUser) => { browser.reset(); await makeSession(u.id, { createdMinAgo: 1 }); };

  it("a staff member typing the Developer's email gets the very same ordinary words as for any other address (the Developer's is not singled out) — nothing changes", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Three Mail Staff" });
    await signedInAs(s);
    const res = await updateProfileAction(undefined, profile(s, dev.email));
    const ordinary = await updateProfileAction(undefined, profile(s, fin.email));
    expect(res).toMatchObject({ ok: false, error: "Another staff account already uses this email.", code: "VALIDATION", fieldErrors: { email: "Already in use" } });
    expect(res, "same answer for the Developer's address and for a colleague's").toEqual(ordinary);
    expect((await db.user.findUniqueOrThrow({ where: { id: s.id } })).email).toBe(s.email);
  });

  it("the words for another staff account are exactly as before; a free address is saved as before", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Three Mail Other" });
    await signedInAs(s);
    const taken = await updateProfileAction(undefined, profile(s, fin.email));
    expect(taken).toMatchObject({ ok: false, error: "Another staff account already uses this email.", fieldErrors: { email: "Already in use" } });
    const free = `three-free-${Date.now()}@devtest.local`;
    expect((await updateProfileAction(undefined, profile(s, free))).ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: s.id } })).email).toBe(free);
  });

  it("the password is still asked first: a wrong password never reaches the address check, so it tells nothing about the address", async () => {
    const s = await makeUser("RECEPTIONIST", { fullName: "Three Mail Pw" });
    await signedInAs(s);
    const res = await updateProfileAction(undefined, profile(s, dev.email, "not-my-password"));
    expect(res).toMatchObject({ ok: false, error: "Password is incorrect." });
  });

  it("the Developer, who may see every account, keeps the plain words — for a staff address and for another Developer's", async () => {
    const d = await makeUser("DEVELOPER", { fullName: "Three Mail Dev" });
    await signedInAs(d);
    expect(await updateProfileAction(undefined, profile(d, rec.email))).toMatchObject({ ok: false, error: "Another staff account already uses this email.", fieldErrors: { email: "Already in use" } });
    expect(await updateProfileAction(undefined, profile(d, dev2.email))).toMatchObject({ ok: false, error: "Another staff account already uses this email." });
  });
});

// ═════════════════════════════ 5. the password hint ═════════════════════════════
describe("the password hint under 'New password'", () => {
  const html = (developer: boolean | undefined, zh = false) => {
    const form = createElement(ChangePasswordForm, developer === undefined ? {} : { developer });
    return renderToStaticMarkup(zh ? createElement(I18nProvider, { locale: "zh-CN", catalog: { ...session2Zh } } as ComponentProps<typeof I18nProvider>, form) : form);
  };
  const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
  const DEVELOPER_RULE = validateDeveloperPassword("short", null)!;

  it("staff (and the default) see the staff rule, word for word as before", () => {
    for (const h of [html(undefined), html(false)]) {
      expect(text(h)).toContain("At least 10 characters with letters and numbers.");
      expect(text(h)).not.toContain("14 characters");
    }
  });

  it("the Developer sees the Developer rule, in the words of the rule itself (src/lib/developer-password.ts) — and no longer the staff line", () => {
    expect(DEVELOPER_RULE).toMatch(/at least 14 characters/);
    expect(text(html(true))).toContain(DEVELOPER_RULE);
    expect(text(html(true))).not.toContain("At least 10 characters");
  });

  it("in Chinese the Developer's hint is translated (the sentence is already in the catalog)", () => {
    expect(text(html(true, true))).toContain("至少需要 14 个字符");
  });

  it("the account page shows it only for the Developer's OWN account (while working as someone that page is the person's, with the staff rule)", () => {
    const page = readFileSync(path.resolve(import.meta.dirname, "../../src/app/staff/(app)/account/page.tsx"), "utf8");
    expect(page).toContain('<ChangePasswordForm developer={user.actorType === "DEVELOPER" && !user.workAs} />');
  });
});

// ═════════════════════════════ 6. the audit.view wording ═════════════════════════════
describe("the audit.view right promises no more than the database lock does", () => {
  const WORDS = PERMISSIONS["audit.view"];
  it("says the database refuses any change or delete and points at the Audit page for the one exception — in the code, in the migration's seed, and in Chinese", () => {
    expect(WORDS).toBe("See the full audit trail: who did what, when, as a Developer or as staff (read-only; the database refuses any change or delete — the Audit page names the one exception)");
    expect(WORDS).not.toContain("nobody can change or delete it");
    const sql = readFileSync(path.resolve(import.meta.dirname, "../../prisma/migrations/20261014090000_developer_account/migration.sql"), "utf8");
    expect(sql).toContain(`('perm_audit_view', 'audit.view', '${WORDS}')`);
    expect(sql).not.toContain("nobody can change or delete it");
    expect(sql).toMatch(/\('perm_developer_access'[^;]*\)\nON CONFLICT \("code"\) DO NOTHING;/); // still idempotent: a second run changes nothing
    expect(session3Zh[WORDS]).toMatch(/只读/);
  });
});
