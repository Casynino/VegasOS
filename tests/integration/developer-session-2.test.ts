import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() runs its job at once and keeps the promise, so a test can wait for "after the answer" work (the Boss's notice).
const later = vi.hoisted(() => ({ jobs: [] as Promise<unknown>[] }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: (job: () => unknown) => { later.jobs.push(Promise.resolve().then(job)); } }));
// The Boss's WhatsApp never leaves the test: each call takes the next outcome the test prepared ("throw" = the provider fails badly).
const wire = vi.hoisted(() => ({ outcomes: [] as ({ ok: true } | { ok: false; error: string } | "throw")[], sent: [] as { to: string; text: string }[] }));
vi.mock("@/server/services/messaging", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMessage: vi.fn(async (req: { to: string; text: string }) => {
    wire.sent.push({ to: req.to, text: req.text });
    const outcome = wire.outcomes.shift() ?? { ok: true as const };
    if (outcome === "throw") throw new Error("provider down");
    return outcome;
  }),
}));

import { db, rawDb } from "@/server/db";
import { getCurrentUser, getCurrentUserQuiet } from "@/server/auth";
import { AppError } from "@/server/errors";
import { FAILED_SIGN_IN_ACTION, FAILED_SIGN_IN_LABEL, FAILED_SIGN_IN_ROWS_PER_HOUR, FAILED_SIGN_IN_SUPPRESSED_ACTION, recordFailedSignIn, type Failure } from "@/server/services/auth-login";
import { ENDPOINT_REFUSED_ACTION, requireDeveloperSession, signOutEverywhere, startWorkAs } from "@/server/services/work-as";
import { logDeveloperView } from "@/server/services/developer-view-log";
import { changePasswordAction } from "@/app/staff/(app)/account/actions";
import { updateUserAction } from "@/app/staff/(app)/users/actions";
import { GET as alertsRoute } from "@/app/api/staff/alerts/route";
import { GET as pulseRoute } from "@/app/api/restaurant/pulse/route";
import { developerPasswordProblems, validateDeveloperPassword } from "@/lib/developer-password";
import { validatePasswordStrength } from "@/server/auth";
import { WORK_AS_HOURS } from "@/server/work-as-session";
import { browser, makeSession, makeUser, removeMadeUsers, sha256, thrownBy, type MadeUser } from "../support/developer";

/**
 * Developer account — the session and sign-in fixes of the review (owner, 2026-10-17):
 *   1. the idle rule cannot be kept awake by a background poll (and the timers themselves are off for a Developer — see src/components/staff/quiet*.test.ts);
 *   2. the lock on the Developer's sign-in does not give the account away (tests/integration/developer-login.test.ts has the sign-in side);
 *   3. a flood of failed sign-ins cannot fill the permanent audit trail;
 *   4. the page-visit valve never erases evidence (tests/integration/developer-console.test.ts);
 *   5. a work-as that ends by itself is written down, the Boss's notice is traceable, a staff member at the Developer's door leaves a trace;
 *   6. the account page is logged;
 *   7. one password rule for the Developer;
 *   8. the Boss is never signed out from Access;
 *   9. the Users page is closed to the Developer (it holds no 'users.manage'), so its dialog has no Developer branch;
 *  10. a work-as whose person was switched off does not block a new start.
 */

let dev: MadeUser;
let rec: MadeUser;
let fin: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let cook: MadeUser;
let savedRecipients: unknown;

beforeAll(async () => {
  [dev, rec, fin, boss, md, cook] = await Promise.all([
    makeUser("DEVELOPER", { fullName: "Sess Dev" }), makeUser("RECEPTIONIST", { fullName: "Sess Neema" }), makeUser("FINANCE", { fullName: "Sess Fatma" }),
    makeUser("OWNER", { fullName: "Sess Boss" }), makeUser("ADMIN", { fullName: "Sess MD" }), makeUser("KITCHEN", { fullName: "Sess Cook" }),
  ]);
  savedRecipients = (await db.hotelSettings.findUnique({ where: { id: 1 } }))?.reportRecipients;
});
afterAll(async () => {
  browser.reset();
  await db.hotelSettings.updateMany({ data: { reportRecipients: (savedRecipients ?? []) as never } });
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  later.jobs.length = 0;
  wire.outcomes.length = 0;
  wire.sent.length = 0;
  await db.$executeRawUnsafe(`TRUNCATE "audit_logs"`); // every test counts its own entries
  const everyone = [dev, rec, fin, boss, md, cook].map((u) => u.id);
  await rawDb.session.deleteMany({ where: { userId: { in: everyone } } });
  await rawDb.user.updateMany({ where: { id: { in: everyone } }, data: { isActive: true, mustChangePassword: false } });
  await db.hotelSettings.updateMany({ data: { reportRecipients: [] } });
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "pwchange:" } } });
});

const entries = (action: string, where: Record<string, unknown> = {}) => db.auditLog.findMany({ where: { action, ...where }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const sessionRow = (hash: string) => rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } });
/** Sign in: a fresh browser holding a real session (ages in minutes). Returns the token's hash. */
async function signedInAs(u: MadeUser, opts: { createdMinAgo?: number; seenMinAgo?: number; expiresInMin?: number } = {}): Promise<string> {
  browser.reset();
  return sha256(await makeSession(u.id, { createdMinAgo: opts.createdMinAgo ?? 1, seenMinAgo: opts.seenMinAgo ?? 0, expiresInMin: opts.expiresInMin }));
}
/** The Developer signed in and working as this person (written straight to the session row, as startWorkAs does). */
async function workingAs(target: MadeUser, opts: { startedMinAgo?: number; createdMinAgo?: number; seenMinAgo?: number } = {}): Promise<string> {
  const hash = await signedInAs(dev, { createdMinAgo: opts.createdMinAgo, seenMinAgo: opts.seenMinAgo });
  await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - (opts.startedMinAgo ?? 1) * 60_000) } });
  return hash;
}
const me = async () => {
  const u = await getCurrentUser();
  if (!u) throw new Error("not signed in");
  return u;
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

// ═════════════════════════════════ 1. the idle rule cannot be kept awake ═════════════════════════════════
describe("a background poll never counts as use for a Developer", () => {
  it("the quiet read does not move the session's last-seen time; a page load does", async () => {
    const hash = await signedInAs(dev, { seenMinAgo: 20 });
    const before = (await sessionRow(hash)).lastSeenAt.getTime();
    for (let i = 0; i < 5; i++) expect(await getCurrentUserQuiet()).toMatchObject({ id: dev.id, actorType: "DEVELOPER" });
    expect((await sessionRow(hash)).lastSeenAt.getTime(), "five quiet reads").toBe(before);
    await me(); // a page load
    expect((await sessionRow(hash)).lastSeenAt.getTime()).toBeGreaterThan(before);
  });

  it("the two JSON polls (the bell's and the order boards') are quiet reads: they leave the Developer's last-seen time alone, in the console and while working as someone", async () => {
    for (const asPerson of [false, true]) {
      const hash = asPerson ? await workingAs(rec, { seenMinAgo: 20 }) : await signedInAs(dev, { seenMinAgo: 20 });
      const before = (await sessionRow(hash)).lastSeenAt.getTime();
      await alertsRoute();
      await pulseRoute();
      expect((await sessionRow(hash)).lastSeenAt.getTime(), asPerson ? "working as Neema" : "in the console").toBe(before);
    }
  });

  it("so an open tab cannot keep a Developer signed in: 29 minutes idle is still in (the polls change nothing), 31 minutes idle is out for the quiet read too", async () => {
    const hash = await signedInAs(dev, { seenMinAgo: 29 });
    await getCurrentUserQuiet();
    await alertsRoute();
    expect(await getCurrentUserQuiet()).not.toBeNull();
    expect((await sessionRow(hash)).lastSeenAt.getTime(), "still where it was").toBeLessThan(Date.now() - 28 * 60_000);
    await rawDb.session.update({ where: { tokenHash: hash }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    expect(await getCurrentUserQuiet()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it("staff are not affected: their quiet read still renews the sliding session, exactly as before", async () => {
    const hash = await signedInAs(rec, { seenMinAgo: 20 });
    const before = (await sessionRow(hash)).lastSeenAt.getTime();
    await getCurrentUserQuiet();
    expect((await sessionRow(hash)).lastSeenAt.getTime()).toBeGreaterThan(before);
  });
});

// ═════════════════════════════════ 3. a flood of failed sign-ins ═════════════════════════════════
describe("failed sign-ins: at most 10 entries per account per hour, then one marker", () => {
  const failure = (userId: string, over: Partial<Failure> = {}): Failure => ({ ok: false, userId, actual: "STAFF", passwordOk: false, active: true, ...over });
  const rowsFor = (id: string) => entries(FAILED_SIGN_IN_ACTION, { entityId: id });
  const markersFor = (id: string) => entries(FAILED_SIGN_IN_SUPPRESSED_ACTION, { entityId: id });

  it("the first 10 tries in the hour are written; the 11th and every later one are not — ONE marker says so", async () => {
    expect(FAILED_SIGN_IN_ROWS_PER_HOUR).toBe(10);
    for (let i = 1; i <= 10; i++) await recordFailedSignIn(failure(rec.id), "41.1.1.1");
    expect(await rowsFor(rec.id)).toHaveLength(10);
    expect(await markersFor(rec.id)).toHaveLength(0);

    for (let i = 11; i <= 40; i++) await recordFailedSignIn(failure(rec.id), "41.1.1.1");
    expect(await rowsFor(rec.id), "no more rows").toHaveLength(10);
    const markers = await markersFor(rec.id);
    expect(markers, "one marker").toHaveLength(1);
    expect(markers[0]).toMatchObject({ userId: null, actorType: "SYSTEM", actorLabel: FAILED_SIGN_IN_LABEL, entityType: "User", entityId: rec.id, after: { accountType: "STAFF", count: 10, limit: 10, windowMinutes: 60 } });
  });

  it("many tries at the same moment still make 10 rows and one marker", async () => {
    await Promise.all(Array.from({ length: 25 }, () => recordFailedSignIn(failure(fin.id), "41.2.2.2")));
    expect(await rowsFor(fin.id)).toHaveLength(10);
    expect(await markersFor(fin.id)).toHaveLength(1);
  });

  it("the count is per account: one account's flood never hides another's try", async () => {
    for (let i = 0; i < 14; i++) await recordFailedSignIn(failure(rec.id), "41.3.3.3");
    await recordFailedSignIn(failure(md.id), "41.3.3.3");
    expect(await rowsFor(md.id)).toHaveLength(1);
    expect(await markersFor(md.id)).toHaveLength(0);
  });

  it("only the last hour counts: older rows do not use up the 10, and after an hour the marker is written again", async () => {
    const old = (n: number) => Array.from({ length: n }, () => ({ userId: null, actorType: "SYSTEM", actorLabel: FAILED_SIGN_IN_LABEL, action: FAILED_SIGN_IN_ACTION, entityType: "User", entityId: cook.id, businessDate: new Date("2026-10-14"), createdAt: new Date(Date.now() - 61 * 60_000) }));
    await db.auditLog.createMany({ data: old(10) });
    await recordFailedSignIn(failure(cook.id), "41.4.4.4");
    expect(await rowsFor(cook.id), "10 old rows + 1 new").toHaveLength(11);
    // 10 recent rows and a marker older than an hour: the flood goes on, so a new marker is written for the new hour
    await db.auditLog.createMany({ data: [{ ...old(1)[0], action: FAILED_SIGN_IN_SUPPRESSED_ACTION }] });
    for (let i = 0; i < 12; i++) await recordFailedSignIn(failure(cook.id), "41.4.4.4");
    expect(await rowsFor(cook.id)).toHaveLength(20); // 10 old + 10 in the hour: never more than 10 in the hour
    const recent = (await rowsFor(cook.id)).filter((r) => r.createdAt.getTime() > Date.now() - 3600_000);
    expect(recent).toHaveLength(10);
    expect((await markersFor(cook.id)).filter((r) => r.createdAt.getTime() > Date.now() - 3600_000)).toHaveLength(1);
  });

  it("an email nobody holds writes nothing, and never the typed password or email; the rate limits are not touched", async () => {
    const total = await db.auditLog.count();
    await recordFailedSignIn({ ok: false, userId: null, actual: null, passwordOk: false, active: false }, "41.5.5.5");
    expect(await db.auditLog.count()).toBe(total);
  });

  it("the Developer's account is capped the same way, and its locked tries are marked 'locked'", async () => {
    for (let i = 0; i < 12; i++) await recordFailedSignIn(failure(dev.id, { actual: "DEVELOPER", locked: true }), "41.6.6.6");
    const rows = await rowsFor(dev.id);
    expect(rows).toHaveLength(10);
    expect(rows[0].after).toMatchObject({ accountType: "DEVELOPER", reasonKind: "locked" });
    expect((await markersFor(dev.id))[0].after).toMatchObject({ accountType: "DEVELOPER" });
  });
});

// ═════════════════════════════════ 5a. a work-as that ends by itself leaves a record ═════════════════════════════════
describe("a work-as that ends by itself is written down (once), as the Developer", () => {
  const expired = () => entries("developer.work_as_expired");
  const own = (row: { userId: string | null; actorType: string | null; actorLabel: string | null }) => expect(row).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: dev.fullName });

  it("the person was switched off: the next page load finds it, clears it and writes ONE entry; the Developer is themselves again", async () => {
    const hash = await workingAs(rec, { startedMinAgo: 7 });
    expect(await getCurrentUser()).toMatchObject({ id: rec.id, actorId: dev.id });
    await rawDb.user.update({ where: { id: rec.id }, data: { isActive: false } });
    expect(await getCurrentUser()).toMatchObject({ id: dev.id, actorType: "DEVELOPER", workAs: null });
    const rows = await expired();
    expect(rows).toHaveLength(1);
    own(rows[0]);
    expect(rows[0]).toMatchObject({ entityType: "User", entityId: rec.id, after: { targetName: rec.fullName, targetRole: "Receptionist", endedBy: "account" } });
    expect((rows[0].after as { minutes: number }).minutes).toBeGreaterThanOrEqual(7);
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: null, workAsStartedAt: null });
    // nothing more on later requests
    await getCurrentUser();
    await getCurrentUserQuiet();
    expect(await expired()).toHaveLength(1);
  });

  it("many requests at the same moment still make ONE entry", async () => {
    await workingAs(rec);
    await rawDb.user.update({ where: { id: rec.id }, data: { isActive: false } });
    await Promise.all(Array.from({ length: 25 }, () => getCurrentUser())); // more than the connection pool holds
    expect(await expired()).toHaveLength(1);
  });

  it("the quiet read finds it too — and still does not count as use", async () => {
    const hash = await workingAs(rec, { seenMinAgo: 20 });
    const seen = (await sessionRow(hash)).lastSeenAt.getTime();
    await rawDb.user.update({ where: { id: rec.id }, data: { isActive: false } });
    expect(await getCurrentUserQuiet()).toMatchObject({ id: dev.id, workAs: null });
    expect(await expired()).toHaveLength(1);
    expect((await sessionRow(hash)).lastSeenAt.getTime()).toBe(seen);
  });

  it("the person's account was removed (the link is cleared by the database, the start time stays): written as ended, without a name", async () => {
    const gone = await makeUser("RECEPTIONIST", { fullName: "Sess Removed" });
    const hash = await workingAs(gone);
    await rawDb.user.delete({ where: { id: gone.id } });
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: null });
    expect(await getCurrentUser()).toMatchObject({ id: dev.id, workAs: null });
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: null, after: { targetName: null, endedBy: "account" } });
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: null, workAsStartedAt: null });
  });

  it("the Developer's session ended while working as someone (idle for 30 minutes, or expired): written as ended by the session", async () => {
    const idle = await workingAs(rec, { seenMinAgo: 31 });
    expect(await getCurrentUser()).toBeNull();
    let rows = await expired();
    expect(rows).toHaveLength(1);
    own(rows[0]);
    expect(rows[0].after).toMatchObject({ targetName: rec.fullName, endedBy: "session" });
    expect(await sessionRow(idle)).toMatchObject({ workAsUserId: null, workAsStartedAt: null });

    await db.$executeRawUnsafe(`TRUNCATE "audit_logs"`);
    const hash = await workingAs(rec);
    await rawDb.session.update({ where: { tokenHash: hash }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCurrentUser()).toBeNull();
    rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ endedBy: "session" });
  });

  it("the 4 hours were over (a session row that says so): written as ended by the limit, with at most 4 hours of work", async () => {
    const hash = await signedInAs(dev, { createdMinAgo: 10 });
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: rec.id, workAsStartedAt: hoursAgo(WORK_AS_HOURS + 3) } });
    expect(await getCurrentUser()).toMatchObject({ id: dev.id, workAs: null });
    const rows = await expired();
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ endedBy: "limit", targetName: rec.fullName, minutes: WORK_AS_HOURS * 60 });
  });

  it("nothing is written for a work-as that is still good, for a Developer who works as nobody, or for a staff session (a forged row on it changes nothing and records nothing)", async () => {
    await workingAs(rec);
    await getCurrentUser();
    await signedInAs(dev);
    await getCurrentUser();
    const hash = await signedInAs(fin);
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    expect(await getCurrentUser()).toMatchObject({ id: fin.id, workAs: null, actorType: "STAFF" });
    expect(await expired()).toHaveLength(0);
  });

  it("the entry cannot break the request: when the audit trail is down the Developer is still themselves, and the next request writes it", async () => {
    await workingAs(rec);
    await rawDb.user.update({ where: { id: rec.id }, data: { isActive: false } });
    const real = await import("@/server/audit");
    const spy = vi.spyOn(real, "audit").mockRejectedValueOnce(new Error("audit trail down"));
    try {
      expect(await getCurrentUser()).toMatchObject({ id: dev.id, workAs: null });
    } finally {
      spy.mockRestore();
    }
    expect(await expired()).toHaveLength(0);
    await getCurrentUser();
    expect(await expired()).toHaveLength(1);
  });
});

// ═════════════════════════════════ 10. a stale work-as does not block a new start ═════════════════════════════════
describe("starting work as someone while the session row still says 'working as' a person who was switched off", () => {
  it("is allowed: the old one is cleared and written as ended, then the new one starts", async () => {
    const hash = await signedInAs(dev);
    const devUser = await me(); // the caller's object was made before the row went stale: it does not know
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: rec.id, workAsStartedAt: new Date(Date.now() - 5 * 60_000) } });
    await rawDb.user.update({ where: { id: rec.id }, data: { isActive: false } });

    const out = await startWorkAs(devUser, fin.id);
    expect(out.home).toBeTruthy();
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: fin.id });
    const ended = await entries("developer.work_as_expired");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", entityId: rec.id, after: { targetName: rec.fullName, endedBy: "account" } });
    expect((await entries("developer.work_as_started")).map((r) => r.entityId)).toEqual([fin.id]);
    expect(await entries("developer.work_as_refused")).toHaveLength(0);
  });

  it("is allowed when the page load had already found it (the loader cleared it): one 'expired' entry, then the start", async () => {
    const hash = await workingAs(rec);
    await rawDb.user.update({ where: { id: rec.id }, data: { isActive: false } });
    await startWorkAs(await me(), fin.id);
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: fin.id });
    expect((await entries("developer.work_as_expired")).map((r) => r.entityId)).toEqual([rec.id]);
    expect((await entries("developer.work_as_started")).map((r) => r.entityId)).toEqual([fin.id]);
  });

  it("is allowed after the 4 hours were over (a row that says so), written as ended by the limit", async () => {
    const hash = await signedInAs(dev, { createdMinAgo: 10 });
    const devUser = await me();
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: rec.id, workAsStartedAt: hoursAgo(WORK_AS_HOURS + 1) } });
    await startWorkAs(devUser, fin.id);
    expect((await entries("developer.work_as_expired"))[0].after).toMatchObject({ endedBy: "limit" });
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: fin.id });
  });

  it("a start that races a good one is still refused: the row is good, only the caller's object did not know", async () => {
    const hash = await signedInAs(dev);
    const devUser = await me(); // not working as anyone
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    const err = await thrownBy(() => startWorkAs(devUser, fin.id));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("CONFLICT");
    expect(await sessionRow(hash)).toMatchObject({ workAsUserId: rec.id });
    expect(await entries("developer.work_as_expired")).toHaveLength(0);
  });
});

// ═════════════════════════════════ 5b. the Boss's notice is traceable ═════════════════════════════════
describe("the Boss's notice of a start is written down: who was meant to be told, who was", () => {
  const notice = () => entries("developer.work_as_notice");
  const settle = () => Promise.all(later.jobs.splice(0));

  it("two recipients, both told: recipients 2, told 2, failed 0 — an entry as the Developer, naming the person worked as", async () => {
    await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "+255700000001" }, { name: "MD", phone: "+255700000002" }] } });
    await signedInAs(dev);
    await startWorkAs(await me(), rec.id);
    await settle();
    expect(wire.sent.map((s) => s.to)).toEqual(["+255700000001", "+255700000002"]);
    const rows = await notice();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: dev.fullName, entityType: "User", entityId: rec.id, after: { targetName: rec.fullName, recipients: 2, told: 2, failed: 0 } });
  });

  it("one refused by the provider, one send that blows up: told 0, failed 2 — and the start itself stands", async () => {
    await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "+255700000001" }, { name: "MD", phone: "+255700000002" }] } });
    wire.outcomes.push({ ok: false, error: "no credit" }, "throw");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await signedInAs(dev);
      await startWorkAs(await me(), rec.id);
      await settle();
    } finally {
      log.mockRestore();
    }
    expect((await notice())[0].after).toMatchObject({ recipients: 2, told: 0, failed: 2 });
    expect(await entries("developer.work_as_started")).toHaveLength(1);
  });

  it("one told, one not: told 1, failed 1", async () => {
    await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "+255700000001" }, { name: "MD", phone: "+255700000002" }] } });
    wire.outcomes.push({ ok: true }, { ok: false, error: "no credit" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await signedInAs(dev);
      await startWorkAs(await me(), rec.id);
      await settle();
    } finally {
      log.mockRestore();
    }
    expect((await notice())[0].after).toMatchObject({ recipients: 2, told: 1, failed: 1 });
  });

  it("nobody is set to receive reports: the trail says recipients 0 — the Boss was NOT told, and that is now visible", async () => {
    await signedInAs(dev);
    await startWorkAs(await me(), rec.id);
    await settle();
    expect(wire.sent).toHaveLength(0);
    expect((await notice())[0].after).toMatchObject({ recipients: 0, told: 0, failed: 0 });
  });

  it("a refused start tells nobody and writes no notice", async () => {
    await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "+255700000001" }] } });
    await signedInAs(dev);
    const err = await thrownBy(async () => startWorkAs(await me(), "no-such-account"));
    expect(err).toBeInstanceOf(AppError);
    await settle();
    expect(wire.sent).toHaveLength(0);
    expect(await notice()).toHaveLength(0);
  });

  it("when the notice's own entry cannot be written the start still stands (it only leaves a line in the server log)", async () => {
    await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "+255700000001" }] } });
    await signedInAs(dev);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const real = await import("@/server/audit");
    const realAudit = real.audit;
    // only the notice's own entry fails — the start's entry (written first, in its transaction) is the real one
    const spy = vi.spyOn(real, "audit").mockImplementation(async (tx, actor, entry) => {
      if (entry.action === "developer.work_as_notice") throw new Error("audit trail down");
      return realAudit(tx, actor, entry);
    });
    try {
      await startWorkAs(await me(), rec.id);
      await settle();
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
    expect(await entries("developer.work_as_started")).toHaveLength(1);
    expect(wire.sent).toHaveLength(1);
    expect(await notice()).toHaveLength(0);
  });
});

// ═════════════════════════════════ 5c. a staff member at the Developer's door ═════════════════════════════════
describe("someone who is not a Developer reaching for the Developer's pages and actions leaves a trace", () => {
  const refused = (userId?: string) => entries(ENDPOINT_REFUSED_ACTION, userId ? { userId } : {});

  it("refused (FORBIDDEN), and ONE entry under their own name: who, from where, which page", async () => {
    await signedInAs(rec);
    browser.headers.set("x-pathname", "/staff/developer/access");
    const err = await thrownBy(() => requireDeveloperSession());
    expect([(err as AppError).code, (err as AppError).message]).toEqual(["FORBIDDEN", "Only the Developer account can do this."]);
    const rows = await refused();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: rec.id, actorType: "STAFF", actorRole: "RECEPTIONIST", actorLabel: rec.fullName, entityType: "Permission", entityId: "developer.access", after: { path: "/staff/developer/access" } });
    expect(rows[0].ipAddress).toBe(browser.ip);
  });

  it("bounded: a loop of refused calls writes one entry per person per 10 minutes — at the same moment too", async () => {
    await signedInAs(rec);
    await Promise.all(Array.from({ length: 25 }, () => thrownBy(() => requireDeveloperSession())));
    for (let i = 0; i < 5; i++) await thrownBy(() => requireDeveloperSession());
    expect(await refused(rec.id)).toHaveLength(1);
    // a different person has their own entry
    await signedInAs(fin);
    await thrownBy(() => requireDeveloperSession());
    expect(await refused(fin.id)).toHaveLength(1);
    // after 10 minutes the next refusal is written again (an old entry is 11 minutes old)
    await signedInAs(md);
    await db.auditLog.create({ data: { userId: md.id, actorType: "STAFF", actorRole: "ADMIN", actorLabel: md.fullName, action: ENDPOINT_REFUSED_ACTION, entityType: "Permission", entityId: "developer.access", businessDate: new Date("2026-10-14"), createdAt: new Date(Date.now() - 11 * 60_000) } });
    await thrownBy(() => requireDeveloperSession());
    expect(await refused(md.id)).toHaveLength(2);
  });

  it("nobody signed in: UNAUTHENTICATED and no entry (there is no one to name); a Developer gets in and leaves none", async () => {
    browser.reset();
    const err = await thrownBy(() => requireDeveloperSession());
    expect((err as AppError).code).toBe("UNAUTHENTICATED");
    await signedInAs(dev);
    expect(await requireDeveloperSession()).toMatchObject({ id: dev.id, actorType: "DEVELOPER" });
    expect(await refused()).toHaveLength(0);
  });

  it("the entry can never break the answer", async () => {
    await signedInAs(rec);
    const real = await import("@/server/audit");
    const spy = vi.spyOn(real, "audit").mockRejectedValueOnce(new Error("audit trail down"));
    try {
      const err = await thrownBy(() => requireDeveloperSession());
      expect((err as AppError).code).toBe("FORBIDDEN");
    } finally {
      spy.mockRestore();
    }
  });
});

// ═════════════════════════════════ 6. the account page is logged ═════════════════════════════════
describe("the account page is a logged page for a Developer, in any mode", () => {
  it("in its console the Developer's visit to /staff/account is one entry", async () => {
    await signedInAs(dev);
    const u = await me();
    expect(await logDeveloperView(u, "/staff/account")).toBe("logged");
    const rows = await entries("developer.viewed", { entityId: "/staff/account" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER" });
  });

  it("while working as someone it shows that person's profile and sessions — the visit is one entry under the Developer, saying as whom", async () => {
    await workingAs(rec);
    const u = await me();
    expect(await logDeveloperView(u, "/staff/account")).toBe("logged");
    const rows = await entries("developer.viewed", { entityId: "/staff/account" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: `${dev.fullName} (Developer) as ${rec.fullName} (Receptionist)` });
    expect(rows[0].after).toMatchObject({ path: "/staff/account", actingAs: { id: rec.id, name: rec.fullName } });
    // a staff member's own account page is never written
    await signedInAs(rec);
    expect(await logDeveloperView(await me(), "/staff/account")).toBe("not-developer");
  });
});

// ═════════════════════════════════ 7. one password rule for the Developer ═════════════════════════════════
describe("the Developer's password: one rule", () => {
  const EMAIL = "amani.developer@example.com";
  // [password, what is wrong with it (the words from the setup command and the document), or none]
  const TABLE: [string, string[]][] = [
    ["Correct-Horse-Battery-9!", []],
    ["a Long Phrase 2 Remember!", []],
    ["Tz-hotel-Vegas#2026-ok", []],
    ["Short1!aA", ["it is shorter than 14 characters"]],
    ["Abcdefghijklm1!", []], // exactly 15 — fine
    ["Abcdefghijk1!z", []], // exactly 14 — fine
    ["Abcdefghij1!z", ["it is shorter than 14 characters"]], // 13
    ["lower-case-only-9999!!", ["it has no capital letter"]],
    ["UPPER-CASE-ONLY-9999!!", ["it has no small letter"]],
    ["No-Digits-Here-At-All!", ["it has no number"]],
    ["NoSymbolsHere12345Abc", ["it has no symbol"]],
    ["Good-Pass-1234-zzz! ", ["it starts or ends with a space"]],
    [" Good-Pass-1234-zzz!", ["it starts or ends with a space"]],
    ["My-Password-Is-Good-1!", ["it contains an easy word or pattern"]],
    ["Qwerty-Keyboard-9999!!", ["it contains an easy word or pattern"]],
    ["Super-Admin-Account-77!", ["it contains an easy word or pattern"]],
    ["Aa1!".repeat(60), ["it is longer than 200 characters"]],
    [EMAIL, ["it has no capital letter", "it has no number", "it is the same as the email address"]],
    ["Amani.developer-Rules-9!", ["it contains the first part of the email address"]],
  ];

  it.each(TABLE)("%s", (password, problems) => {
    expect(developerPasswordProblems(password, EMAIL).sort()).toEqual([...problems].sort());
    const said = validateDeveloperPassword(password, EMAIL);
    expect(said === null).toBe(problems.length === 0);
  });

  it("the first part of a short email name (under 5 characters) is not looked for", () => {
    expect(developerPasswordProblems("Joe-Is-Here-Today-1!", "joe@example.com")).toEqual([]);
  });

  it("is the rule the setup command and the document state: the same numbers and words (a drift guard on the script's text)", () => {
    const script = readFileSync(path.resolve(import.meta.dirname, "../../scripts/provision-developer.mjs"), "utf8");
    expect(script).toContain("password.length < 14");
    expect(script).toContain("password.length > 200");
    expect(script).toContain("/password|passwort|qwerty|123456|letmein|admin/.test(lower)");
    expect(script).toContain("local.length >= 5 && lower.includes(local)");
    for (const sentence of ["it has no capital letter", "it has no small letter", "it has no number", "it has no symbol", "it starts or ends with a space", "it is the same as the email address", "it contains the first part of the email address", "it contains an easy word or pattern"]) {
      expect(script, sentence).toContain(sentence);
    }
  });

  it("is stricter than the staff rule on every point", () => {
    expect(validatePasswordStrength("abcdef12345")).toBeNull(); // a staff password: 10+ characters, letters and numbers
    expect(validateDeveloperPassword("abcdef12345", EMAIL)).not.toBeNull();
  });

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("changing the Developer's own password: a staff-strength one is refused (field error, nothing changed); one that follows the rule is accepted and signs the other sessions out", async () => {
    await signedInAs(dev);
    await makeSession(dev.id, { setCookie: false });
    const before = (await db.user.findUniqueOrThrow({ where: { id: dev.id } })).passwordHash;
    const weak = await changePasswordAction(undefined, form({ currentPassword: dev.password, newPassword: "Staffpass12345", confirmPassword: "Staffpass12345" }));
    expect(weak.ok).toBe(false);
    expect(!weak.ok && weak.fieldErrors?.newPassword).toMatch(/at least 14 characters/);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.id } })).passwordHash).toBe(before);

    const same = await changePasswordAction(undefined, form({ currentPassword: dev.password, newPassword: dev.email, confirmPassword: dev.email }));
    expect(same.ok).toBe(false);

    const good = "Tz-Vegas-Dev#2026-ok";
    const ok = await changePasswordAction(undefined, form({ currentPassword: dev.password, newPassword: good, confirmPassword: good }));
    expect(ok.ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.id } })).passwordHash).not.toBe(before);
    expect(await db.session.count({ where: { userId: dev.id } }), "the other session was signed out").toBe(1);
    expect(await entries("user.password_changed")).toHaveLength(1);
  });

  it("staff keep the staff rule exactly: a 10+ character password with letters and numbers is accepted", async () => {
    await signedInAs(rec);
    const ok = await changePasswordAction(undefined, form({ currentPassword: rec.password, newPassword: "Staffpass12345", confirmPassword: "Staffpass12345" }));
    expect(ok.ok).toBe(true);
    const weak = await changePasswordAction(undefined, form({ currentPassword: "Staffpass12345", newPassword: "short1", confirmPassword: "short1" }));
    expect(!weak.ok && weak.fieldErrors?.newPassword).toBe("Password must be at least 10 characters.");
  });
});

// ═════════════════════════════════ 8. the Boss is never signed out from Access ═════════════════════════════════
describe("sign a person out everywhere: never the Boss", () => {
  it("refused on the server (the Access page hides the button too): the Boss's sessions stay, the refusal is kept, and the MD still can be signed out", async () => {
    await signedInAs(dev);
    const devUser = await me();
    await makeSession(boss.id, { setCookie: false });
    await makeSession(md.id, { setCookie: false });
    process.env.PERMANENT_OWNER_EMAILS = boss.email; // the Boss here is a permanent owner (owner, 2026-10-19); another Boss could be signed out
    const err = await thrownBy(() => signOutEverywhere(devUser, boss.id));
    delete process.env.PERMANENT_OWNER_EMAILS;
    expect([(err as AppError).code, (err as AppError).message]).toEqual(["FORBIDDEN", "Can't sign a permanent owner out here"]);
    expect(await db.session.count({ where: { userId: boss.id } })).toBe(1);
    const failed = await entries("user.sign_out_failed", { entityId: boss.id });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER" });
    expect(await entries("user.signed_out_everywhere")).toHaveLength(0);

    expect(await signOutEverywhere(devUser, md.id)).toEqual({ sessionsEnded: 1 });
    expect(await db.session.count({ where: { userId: md.id } })).toBe(0);
  });
});

// ═════════════════════════════════ 9. the Users page is closed to the Developer ═════════════════════════════════
describe("the Users page: the Developer cannot reach it, so its form has no Developer branch", () => {
  const form = (user: MadeUser, over: Record<string, string> = {}) => {
    const f = new FormData();
    const fields = { userId: user.id, fullName: `${user.fullName} X`, email: user.email, phone: "", roleId: "", ...over };
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("the Developer's form is refused whatever it sends (a new name, the current on/off state, an unticked box): nothing is saved (the Developer holds no 'users.manage')", async () => {
    await signedInAs(dev);
    const before = await db.user.findUniqueOrThrow({ where: { id: cook.id } });
    for (const over of [{ roleId: before.roleId, isActive: "true" }, { roleId: before.roleId }] as Record<string, string>[]) {
      const res = await updateUserAction(undefined, form(cook, over));
      expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await db.user.findUniqueOrThrow({ where: { id: cook.id } })).toEqual(before);
  });

  it("the dialog itself is the Boss's and the MD's alone: the on/off box is the ordinary one, with no Developer wording and no reason fields", () => {
    const dialog = readFileSync(path.resolve(import.meta.dirname, "../../src/app/staff/(app)/users/user-dialogs.tsx"), "utf8");
    expect(dialog).toContain('<NativeCheckbox name="isActive" defaultChecked={user.isActive} label={t("Account active (unticking signs them out immediately)")} />');
    for (const gone of ["isDeveloper", "ReasonField", "roleLocked", "passwordLocked", "Account is active", "use Access in the Developer console", "setup script"]) expect(dialog, gone).not.toContain(gone);
  });
});
