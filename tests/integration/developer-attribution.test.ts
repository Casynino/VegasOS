import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after(): outside a real request there is nothing to run it, so a test either lets it throw (the code then runs the work straight away,
// as a script would) or collects what was scheduled and runs it by hand, when it chooses.
const h = vi.hoisted(() => ({ scheduled: [] as (() => unknown)[], mode: { schedule: false } }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    if (!h.mode.schedule) throw new Error("after() was called outside a request");
    h.scheduled.push(fn);
  },
}));
// The real audit(), wrapped so a test can make ONE write fail ("the audit trail is down").
vi.mock("@/server/audit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/audit")>();
  return { ...real, audit: vi.fn(real.audit) };
});

import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { generateDailyReport } from "@/server/services/daily-report";
import { ensureRoomReport } from "@/server/services/room-report";
import { generateShiftReport } from "@/server/services/shift-report";
import { UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR, UNKNOWN_DEVELOPER_KEY } from "@/server/services/auth-login";
import { auditActionWords, auditToday, parseAuditFilter, queryAuditTrail, type AuditViewer } from "@/server/services/audit-trail";
import { toDbDate } from "@/lib/time/business-date";
import { loginAction, type LoginState } from "@/app/staff/(auth)/login/actions";
import {
  generateReportAction, regenerateRoomReportAction, sendReportAction, sendRoomReportAction, sendRoomReportByDateAction,
} from "@/app/staff/(app)/reports/daily/actions";
import { regenerateShiftReportAction, sendShiftReportAction, makeShiftReportAction } from "@/app/staff/(app)/shifts/[id]/report/actions";
import { sendStaffReportAction } from "@/app/staff/(app)/reports/staff/actions";
import { auditOf, browser, makeSession, makeUser, Redirected, removeMadeUsers, type MadeUser } from "../support/developer";

/**
 * Who is named in the audit trail (owner, 2026-10-14: everything the Developer does is recorded under its own true identity).
 *  - A report made, regenerated or sent BY HAND carries the signed-in person (a Developer included); the scheduled runs stay the system's.
 *  - Regenerating a financial report is a decision about the money reports: a Developer is refused (and the refusal is written down);
 *    the MD, the Boss and the managers are exactly as before.
 *  - A failed sign-in is never written under the account that was tried: it is the system's entry, naming that account only as the record.
 */
const SIGN_IN_PAGE = "Sign-in page (not signed in)";
const STAFF_FAIL = "Incorrect email or password.";
const DEV_FAIL = "Incorrect email or password for the Developer account.";
const MD_ONLY = "Only the MD or the owner can regenerate a report — it is kept as a record.";
// Past days nobody has a report for (the test's own; cleaned before and after).
const D = { devMake: "2019-03-11", service: "2019-03-12", system: "2019-03-13", md: "2019-03-14", mgr: "2019-03-15", refuse: "2019-03-16", room: "2019-03-17", roomSend: "2019-03-18", send: "2019-03-19" };
const DATES = Object.values(D);

let dev: MadeUser;
let md: MadeUser;
let boss: MadeUser;
let mgr: MadeUser;
let rec: MadeUser;
let timezone: string;
let shiftId: string;
let staffReportId: string;
const viewer: AuditViewer = { permissions: new Set(["audit.view"]) };

async function cleanReports() {
  await db.roomReport.deleteMany({ where: { businessDate: { in: DATES.map(toDbDate) } } });
  await db.dailyReport.deleteMany({ where: { businessDate: { in: DATES.map(toDbDate) } } });
}

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Attribution" });
  md = await makeUser("ADMIN", { fullName: "MD Attribution" });
  boss = await makeUser("OWNER", { fullName: "Boss Attribution" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Attribution" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Attribution" });
  timezone = (await getSettings()).timezone;
  await db.hotelSettings.updateMany({ data: { reportRecipients: [] } }); // nothing is ever really sent
  await cleanReports();

  // A closed shift (the seeded receptionist's) and a weekly report row to send.
  const asha = await db.user.findUniqueOrThrow({ where: { email: "asha@vegas.test" } });
  const now = Date.now();
  const shift = await db.actualShift.create({
    data: { department: "RECEPTION", businessDate: toDbDate(new Date().toISOString().slice(0, 10)), userId: asha.id, startedAt: new Date(now - 3 * 3_600_000), endedAt: new Date(now - 3_600_000), closedById: asha.id },
  });
  shiftId = shift.id;
  const staffReport = await db.staffReport.create({
    data: { key: `TEST:attribution:${randomUUID()}`, kind: "WEEK", fromDate: toDbDate("2019-03-04"), toDate: toDbDate("2019-03-10"), data: {}, summaryText: "", shareToken: randomUUID(), shareExpiresAt: new Date(now + 86_400_000) },
  });
  staffReportId = staffReport.id;
});
afterAll(async () => {
  await db.staffReport.deleteMany({ where: { id: staffReportId } });
  await db.shiftReport.deleteMany({ where: { shiftId } }); // its earlier versions go with it
  await db.actualShift.deleteMany({ where: { id: shiftId } });
  await cleanReports();
  await removeMadeUsers();
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:" } } });
});
beforeEach(async () => {
  browser.reset();
  h.mode.schedule = false;
  h.scheduled.length = 0;
  await db.session.deleteMany({ where: { userId: { in: [dev, md, boss, mgr, rec].map((u) => u.id) } } });
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:" } } });
});
afterEach(() => { h.mode.schedule = false; });

/** Sign in the fake browser as this account (a real session row) and run what the person does next. */
async function as<T>(u: MadeUser, run: () => Promise<T>): Promise<T> {
  browser.reset();
  await makeSession(u.id);
  return run();
}
const entries = (action: string, where: Record<string, unknown> = {}) => db.auditLog.findMany({ where: { action, ...where }, orderBy: { createdAt: "asc" } });
/** The audit page's own search (the Boss's view), for one filter. */
async function trail(raw: Record<string, string>) {
  return queryAuditTrail(viewer, parseAuditFilter(raw, auditToday(timezone)).filter);
}
const form = (email: string, password: string, accountType: string) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  f.set("accountType", accountType);
  return f;
};
async function signIn(email: string, password: string, door: "STAFF" | "DEVELOPER"): Promise<LoginState | "signed-in"> {
  try {
    return await loginAction(undefined, form(email, password, door));
  } catch (e) {
    if (e instanceof Redirected) return "signed-in";
    throw e;
  }
}
const errorOf = (s: LoginState | "signed-in") => (typeof s === "object" ? s?.error : undefined);
const failedAbout = (entityId: string | null) => entries("auth.login_failed", { entityId });

// ───────────────────────────────────────────── reports made, regenerated and sent by hand ─────────────────────────────────────────────
/** The Developer role gets one right for a while (the test database only), to prove the server refuses the DECISION even if a right is ever granted. */
async function grantDeveloper(code: string) {
  const [role, permission] = await Promise.all([db.role.findUniqueOrThrow({ where: { code: "DEVELOPER" } }), db.permission.findUniqueOrThrow({ where: { code } })]);
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  return async () => { await db.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } }); };
}
const deniedBy = async (u: MadeUser) => (await auditOf(u.id, "developer.denied")).length;

describe("what a Developer can do with the reports (the daily and room reports are not among them)", () => {
  it("making, regenerating or sending the daily and room reports: refused at the door (the Developer does not hold the right), nothing changes, the refusal is written down", async () => {
    await generateDailyReport(D.refuse, "system");
    await ensureRoomReport(D.refuse);
    const daily = await db.dailyReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.refuse) } });
    const before = await deniedBy(dev);
    const tries: (() => Promise<unknown>)[] = [
      () => generateReportAction({ date: D.devMake }),
      () => generateReportAction({ date: D.refuse, reason: "I would like a fresh copy please" }),
      () => regenerateRoomReportAction({ date: D.refuse, reason: "I would like a fresh copy please" }),
      () => sendReportAction({ reportId: daily.id }),
      () => sendRoomReportAction({ reportId: daily.id }),
      () => sendRoomReportByDateAction({ date: D.refuse }),
    ];
    for (const run of tries) expect(await as(dev, run)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await deniedBy(dev)).toBe(before + tries.length);
    expect(await db.dailyReport.count({ where: { businessDate: toDbDate(D.devMake) } })).toBe(0);
    expect((await db.dailyReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.refuse) } })).version).toBe(1);
    expect((await db.roomReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.refuse) } })).version).toBe(1);
    for (const a of ["report.daily_generated", "report.daily_regenerated", "report.room_regenerated", "report.daily_sent", "report.room_sent"]) expect(await auditOf(dev.id, a), a).toHaveLength(0);
  });

  it("services: a regeneration with a Developer's id is a DEVELOPER entry — the daily report, the room report and the shift report", async () => {
    const by = `${dev.fullName} (Developer (super user))`;
    const who = { by, userId: dev.id, ipAddress: "41.1.2.3", automatic: false, reason: "checking the numbers" };
    await generateDailyReport(D.service, "system"); // the day's report exists (made by the system)
    await generateDailyReport(D.service, who);
    await ensureRoomReport(D.service, { by });
    await ensureRoomReport(D.service, { regenerate: true, by, reason: "checking the numbers", actor: { userId: dev.id, label: by, ipAddress: "41.1.2.3" } });
    await generateShiftReport(shiftId); // made by the system
    await generateShiftReport(shiftId, { regenerate: { by, reason: "checking the numbers", userId: dev.id, ipAddress: "41.1.2.3" } });

    for (const action of ["report.daily_regenerated", "report.room_regenerated", "report.shift_regenerated"]) {
      const rows = await entries(action, { userId: dev.id });
      expect(rows, action).toHaveLength(1);
      expect(rows[0], action).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: by, ipAddress: "41.1.2.3" });
      const page = await trail({ who: "DEVELOPER", user: dev.id, action });
      expect(page.rows.map((r) => r.id), action).toContain(rows[0].id);
    }
    // the Developer's name never marks an earlier, scheduled entry
    expect((await entries("report.shift_generated", { entityType: "ShiftReport" })).at(-1)).toMatchObject({ userId: null, actorType: "SYSTEM", actorLabel: "system" });
  });

  it("the scheduled runs stay the system's: no user, 'system' — and the scheduled room report writes nothing, as before", async () => {
    await generateDailyReport(D.system, { by: "system", automatic: true, reason: null });
    const daily = await entries("report.daily_generated", { entityId: (await db.dailyReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.system) } })).id });
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ userId: null, actorType: "SYSTEM", actorRole: null, actorLabel: "system" });

    const room = await ensureRoomReport(D.system, { automatic: true });
    expect(await db.auditLog.count({ where: { entityType: "RoomReport", entityId: room.id } })).toBe(0);
  });

  it("the MD regenerates a daily report as before: allowed, with a reason — written under the MD (staff), not as the system", async () => {
    await generateDailyReport(D.md, "system");
    const res = await as(md, () => generateReportAction({ date: D.md, reason: "fixing a wrong figure" }));
    expect(res.ok).toBe(true);
    const report = await db.dailyReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.md) } });
    expect(report.version).toBe(2);
    const rows = await auditOf(md.id, "report.daily_regenerated");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: md.id, actorType: "STAFF", entityId: report.id, ipAddress: browser.ip });
  });

  it("a manager without the MD / owner right gets the very same words as before", async () => {
    await generateDailyReport(D.mgr, "system");
    const res = await as(mgr, () => generateReportAction({ date: D.mgr, reason: "fixing a wrong figure" }));
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN", error: MD_ONLY });
    expect((await db.dailyReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.mgr) } })).version).toBe(1);
  });

  it("the room report: the MD regenerates and sends it as before — written under the MD, and the report itself says what it always said", async () => {
    await ensureRoomReport(D.room); // made by the system
    expect((await as(md, () => regenerateRoomReportAction({ date: D.room, reason: "a fresh copy please" }))).ok).toBe(true);
    const report = await db.roomReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.room) } });
    expect(report.version).toBe(2);
    const rows = await auditOf(md.id, "report.room_regenerated");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "STAFF", entityId: report.id, userId: md.id });
    expect(report.generatedBy).toContain(md.fullName);

    // sending, for a day that has no room report yet: the send makes it and names the person; the report itself is still "system"
    expect((await as(md, () => sendRoomReportByDateAction({ date: D.roomSend }))).ok).toBe(true);
    expect((await auditOf(md.id, "report.room_sent")).at(-1)).toMatchObject({ actorType: "STAFF", entityType: "RoomReport", entityId: null });
    expect((await auditOf(md.id, "report.room_generated")).at(-1)).toMatchObject({ actorType: "STAFF", entityType: "RoomReport" });
    expect((await db.roomReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.roomSend) } })).generatedBy).toBe("system");
  });

  it("a Developer is refused to regenerate a shift report; the MD still can (written under the MD)", async () => {
    await generateShiftReport(shiftId); // exists (made by the system, or earlier in this file)
    const version = (await db.shiftReport.findUniqueOrThrow({ where: { shiftId } })).version;
    const before = await deniedBy(dev);
    const refused = await as(dev, () => regenerateShiftReportAction({ shiftId, reason: "a fresh copy please" }));
    expect(refused).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await db.shiftReport.findUniqueOrThrow({ where: { shiftId } })).version).toBe(version);
    const denied = (await auditOf(dev.id, "developer.denied")).slice(before);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actorType: "DEVELOPER", userId: dev.id });
    expect(denied[0].entityId).toContain("dashboard.admin"); // it held the Boss-level dashboard right — the decision is what it is refused

    const done = await as(md, () => regenerateShiftReportAction({ shiftId, reason: "a fresh copy please" }));
    expect(done.ok).toBe(true);
    expect((await db.shiftReport.findUniqueOrThrow({ where: { shiftId } })).version).toBe(version + 1);
    expect((await auditOf(md.id, "report.shift_regenerated")).at(-1)).toMatchObject({ actorType: "STAFF", userId: md.id });
  });

  it("a person who makes a missing shift report 'now' is named; the automatic one is not", async () => {
    await db.shiftReport.deleteMany({ where: { shiftId } });
    const res = await as(mgr, () => makeShiftReportAction({ shiftId }));
    expect(res.ok).toBe(true);
    const report = await db.shiftReport.findUniqueOrThrow({ where: { shiftId } });
    expect(report.generatedBy).toBe("system"); // the report itself is as before
    expect(report.automatic).toBe(true);
    const rows = await entries("report.shift_generated", { entityId: report.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: mgr.id, actorType: "STAFF" });
  });

  it("a Developer sending a shift report or a staff report again: allowed, and written under the Developer", async () => {
    const shiftReport = await generateShiftReport(shiftId);
    expect((await as(dev, () => sendShiftReportAction({ reportId: shiftReport.id }))).ok).toBe(true);
    expect((await as(dev, () => sendStaffReportAction({ reportId: staffReportId, force: true }))).ok).toBe(true);

    const mine = async (action: string) => (await auditOf(dev.id, action)).map((r) => ({ type: r.entityType, id: r.entityId, actorType: r.actorType, role: r.actorRole, ip: r.ipAddress?.startsWith("41.") ? "an address" : r.ipAddress, userId: r.userId, after: r.after }));
    const who = { actorType: "DEVELOPER", role: "DEVELOPER", ip: "an address", userId: dev.id }; // the request's address (a new one for each person at the keyboard)
    expect(await mine("report.shift_sent")).toEqual([{ ...who, type: "ShiftReport", id: shiftReport.id, after: { force: false } }]);
    expect(await mine("report.staff_sent")).toEqual([{ ...who, type: "StaffReport", id: staffReportId, after: { force: true } }]);

    // an ordinary manager's send is theirs, as staff
    expect((await as(mgr, () => sendShiftReportAction({ reportId: shiftReport.id }))).ok).toBe(true);
    expect((await auditOf(mgr.id, "report.shift_sent")).at(-1)).toMatchObject({ actorType: "STAFF", entityId: shiftReport.id });
  });

  it("an unauthorised person's attempt writes nothing and sends nothing", async () => {
    const sends = { action: { in: ["report.daily_sent", "report.shift_sent", "report.staff_sent", "report.room_sent"] }, userId: rec.id };
    for (const run of [
      () => sendReportAction({ reportId: "does-not-matter" }),
      () => sendShiftReportAction({ reportId: "does-not-matter" }),
      () => sendStaffReportAction({ reportId: "does-not-matter" }),
      () => sendRoomReportAction({ reportId: "does-not-matter" }),
    ]) expect(await as(rec, run)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: sends })).toBe(0);
  });
});

describe("even if a Developer were ever given the daily-report right, the server still refuses the decision", () => {
  let revoke: () => Promise<void>;
  beforeAll(async () => { revoke = await grantDeveloper("reports.daily.manage"); });
  afterAll(async () => { await revoke(); });

  it("making a missing daily report: allowed — one entry under the Developer, found by 'who = Developer' and not under staff", async () => {
    const res = await as(dev, () => generateReportAction({ date: D.devMake }));
    expect(res.ok).toBe(true);

    const rows = await auditOf(dev.id, "report.daily_generated");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", entityType: "DailyReport", ipAddress: browser.ip });
    expect(rows[0].actorLabel).toContain(dev.fullName);

    const page = await trail({ who: "DEVELOPER", user: dev.id, action: "report.daily_generated" });
    expect(page.rows.find((r) => r.id === rows[0].id)).toMatchObject({ actorType: "DEVELOPER", userId: dev.id });
    expect((await trail({ who: "STAFF", user: dev.id, action: "report.daily_generated" })).rows).toHaveLength(0);
  });

  it("regenerating a daily report: refused whatever the reason — the report stays as it was and the refusal is written down", async () => {
    await generateDailyReport(D.refuse, "system");
    const report0 = await db.dailyReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.refuse) } });
    const before = await deniedBy(dev);
    const regenerated = (await auditOf(dev.id, "report.daily_regenerated")).length;
    const res = await as(dev, () => generateReportAction({ date: D.refuse, reason: "I would like a fresh copy please" }));
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const report = await db.dailyReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.refuse) } });
    expect(report.version).toBe(report0.version);
    expect(report.generatedBy).toBe(report0.generatedBy);
    expect((await auditOf(dev.id, "report.daily_regenerated")).length).toBe(regenerated);

    const denied = (await auditOf(dev.id, "developer.denied")).slice(before);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actorType: "DEVELOPER", entityType: "Permission" });
    expect(denied[0].entityId).toContain("dashboard.admin");
  });

  it("regenerating a room report: refused (the report stays as it was); the MD still can", async () => {
    await ensureRoomReport(D.room);
    const version = (await db.roomReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.room) } })).version;
    const before = await deniedBy(dev);
    const refused = await as(dev, () => regenerateRoomReportAction({ date: D.room, reason: "a fresh copy please" }));
    expect(refused).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await db.roomReport.findUniqueOrThrow({ where: { businessDate: toDbDate(D.room) } })).version).toBe(version);
    expect(await deniedBy(dev)).toBe(before + 1);
    expect(await auditOf(dev.id, "report.room_regenerated")).toHaveLength(1); // only the service-level one, from the test above
  });

  it("sending the daily and room reports again is allowed — and written under the Developer, with the room report made by that send named too", async () => {
    const daily = await generateDailyReport(D.send, "system");
    expect((await as(dev, () => sendReportAction({ reportId: daily.id, force: true }))).ok).toBe(true);
    expect((await as(dev, () => sendRoomReportAction({ reportId: daily.id }))).ok).toBe(true);
    expect((await as(dev, () => sendRoomReportByDateAction({ date: D.roomSend }))).ok).toBe(true);

    const mine = async (action: string) => (await auditOf(dev.id, action)).map((r) => ({ type: r.entityType, id: r.entityId, actorType: r.actorType, role: r.actorRole, ip: r.ipAddress?.startsWith("41.") ? "an address" : r.ipAddress, userId: r.userId, after: r.after }));
    const who = { actorType: "DEVELOPER", role: "DEVELOPER", ip: "an address", userId: dev.id }; // the request's address (a new one for each person at the keyboard)
    expect(await mine("report.daily_sent")).toEqual([{ ...who, type: "DailyReport", id: daily.id, after: { force: true } }]);
    const roomSent = await mine("report.room_sent");
    expect(roomSent).toEqual([
      { ...who, type: "DailyReport", id: daily.id, after: { force: false } },
      { ...who, type: "RoomReport", id: null, after: { businessDate: D.roomSend, force: false } },
    ]);
    const made = await auditOf(dev.id, "report.room_generated");
    expect(made.length).toBeGreaterThanOrEqual(1);
    for (const r of made) expect(r).toMatchObject({ actorType: "DEVELOPER", entityType: "RoomReport", userId: dev.id });
    for (const date of [D.send, D.roomSend]) expect((await db.roomReport.findUniqueOrThrow({ where: { businessDate: toDbDate(date) } })).generatedBy).toBe("system");
  });
});

// ───────────────────────────────────────────── failed sign-ins ─────────────────────────────────────────────
describe("a failed sign-in is the system's entry — never the account's own", () => {
  it("a wrong password on the Developer account and on a staff account: SYSTEM entries naming the account as the record, found under 'who = System' and nowhere else", async () => {
    expect(errorOf(await signIn(dev.email, "not-the-password-1", "DEVELOPER"))).toBe(DEV_FAIL);
    expect(errorOf(await signIn(rec.email, "not-the-password-1", "STAFF"))).toBe(STAFF_FAIL);
    expect(errorOf(await signIn(rec.email, rec.password, "DEVELOPER"))).toBe(DEV_FAIL);

    const devRows = await failedAbout(dev.id);
    const recRows = await failedAbout(rec.id);
    expect(devRows).toHaveLength(1);
    expect(recRows).toHaveLength(2);
    for (const r of [...devRows, ...recRows]) expect(r).toMatchObject({ userId: null, actorType: "SYSTEM", actorRole: null, actorLabel: SIGN_IN_PAGE, entityType: "User", ipAddress: browser.ip });
    expect(devRows[0].after).toEqual({ accountType: "DEVELOPER", accountExists: true, reasonKind: "bad password" });
    expect(recRows.map((r) => r.after)).toEqual([
      { accountType: "STAFF", accountExists: true, reasonKind: "bad password" },
      { accountType: "DEVELOPER", accountExists: true, reasonKind: "wrong account type" },
    ]);
    // nothing under either account's own activity
    expect(await auditOf(dev.id, "auth.login_failed")).toHaveLength(0);
    expect(await auditOf(rec.id, "auth.login_failed")).toHaveLength(0);

    // the audit page: they are System entries, in nobody's Developer or Staff list, and not under either person
    const system = await trail({ who: "SYSTEM", action: "auth.login_failed" });
    for (const r of [...devRows, ...recRows]) {
      const shown = system.rows.find((x) => x.id === r.id);
      expect(shown, r.id).toMatchObject({ actorType: "SYSTEM", userId: null, actorName: SIGN_IN_PAGE, entityType: "User", entityId: r.entityId, ok: false });
    }
    for (const who of ["DEVELOPER", "STAFF"]) {
      const other = await trail({ who, action: "auth.login_failed" });
      for (const r of [...devRows, ...recRows]) expect(other.rows.map((x) => x.id), who).not.toContain(r.id);
    }
    for (const u of [dev, rec]) expect((await trail({ user: u.id, action: "auth.login_failed" })).rows).toHaveLength(0);
  });

  it("the plain words say it was not a person signed in", () => {
    expect(auditActionWords("auth.login_failed")).toBe("Failed sign-in (not signed in)");
  });

  it("every new or renamed action has plain words (not its raw name)", () => {
    for (const a of [
      "auth.login_failed", "user.role_changed", "user.updated", "user.deactivated", "user.reactivated", "user.password_reset", "developer.viewed", "developer.viewed_limit",
      "developer.exported", "developer.downloaded", "developer.inspected", "developer.denied", "developer.provisioned", "developer.password_rotated", "developer.deactivated",
      "report.room_generated", "report.room_regenerated", "report.daily_sent", "report.room_sent", "report.shift_sent", "report.staff_sent",
    ]) {
      const words = auditActionWords(a);
      expect(words, a).not.toMatch(/[._]/);
      expect(words.length, a).toBeGreaterThan(8);
    }
  });

  it("an unknown email at the Developer door is written with no account and no typed text; at the Staff door nothing is written", async () => {
    const typed = `ghost-${randomUUID()}@devtest.local`;
    const since = new Date();
    expect(errorOf(await signIn(typed, "ghost-typed-pass-1", "DEVELOPER"))).toBe(DEV_FAIL);
    expect(errorOf(await signIn(`staff-${typed}`, "ghost-typed-pass-1", "STAFF"))).toBe(STAFF_FAIL);
    const rows = (await failedAbout(null)).filter((r) => r.createdAt >= since);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, actorType: "SYSTEM", actorLabel: SIGN_IN_PAGE, entityId: null, ipAddress: browser.ip });
    expect(rows[0].after).toEqual({ accountType: "DEVELOPER", accountExists: false });
    expect(JSON.stringify(rows)).not.toContain("ghost");
  });

  it("the entry is written AFTER the answer: the answer to a real account, an unknown email and a staff try all do the same work before they go out", async () => {
    h.mode.schedule = true;
    const total = () => db.auditLog.count({ where: { action: "auth.login_failed" } });
    const start = await total();

    // a real account, a wrong password
    expect(errorOf(await signIn(rec.email, "not-the-password-2", "STAFF"))).toBe(STAFF_FAIL);
    expect(h.scheduled).toHaveLength(1);
    expect(await total()).toBe(start); // nothing written yet — the answer did not wait for it
    // an unknown email at the Developer door
    expect(errorOf(await signIn(`ghost-${randomUUID()}@devtest.local`, "x1y2z3-abc", "DEVELOPER"))).toBe(DEV_FAIL);
    expect(h.scheduled).toHaveLength(2);
    expect(await total()).toBe(start);
    // an unknown email at the Staff door (it will write nothing, but it is scheduled the same way)
    expect(errorOf(await signIn(`ghost-${randomUUID()}@devtest.local`, "x1y2z3-abc", "STAFF"))).toBe(STAFF_FAIL);
    expect(h.scheduled).toHaveLength(3);

    await Promise.all(h.scheduled.map((run) => run()));
    expect(await total()).toBe(start + 2); // the real account's and the Developer door's unknown email
  });

  it("an entry that cannot be written never changes the answer (and nothing in the console names the account or the email)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(audit).mockRejectedValueOnce(new Error("audit down"));
    try {
      expect(errorOf(await signIn(rec.email, "not-the-password-3", "STAFF"))).toBe(STAFF_FAIL);
      expect(quiet).toHaveBeenCalledTimes(1);
      expect(String(quiet.mock.calls[0])).not.toContain(rec.email);
    } finally {
      quiet.mockRestore();
    }
  });
});

// ───────────────────────────────────────────── the flood bound ─────────────────────────────────────────────
describe("unknown Developer emails: written, but capped", () => {
  it(`at most ${UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR} entries an hour from the whole system — every attempt is still refused with the same words, and real accounts are still written`, async () => {
    const since = new Date();
    const answers = new Set<string | undefined>();
    for (let i = 1; i <= UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR + 7; i++) {
      browser.reset(); // another visitor each time (the per-address limits count per address)
      answers.add(errorOf(await signIn(`flood-${i}-${randomUUID()}@devtest.local`, "x1y2z3-abc", "DEVELOPER")));
    }
    expect([...answers]).toEqual([DEV_FAIL]); // never "too many attempts", never different words
    const written = (await failedAbout(null)).filter((r) => r.createdAt >= since);
    expect(written).toHaveLength(UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR);
    for (const r of written) expect(r.after).toEqual({ accountType: "DEVELOPER", accountExists: false });

    // the cap is only about emails nobody holds: a real account's failed try is written as always
    browser.reset();
    expect(errorOf(await signIn(dev.email, "not-the-password-4", "DEVELOPER"))).toBe(DEV_FAIL);
    expect((await failedAbout(dev.id)).filter((r) => r.createdAt >= since)).toHaveLength(1);

    // ... and the next hour starts a new count
    await db.$executeRaw`UPDATE "rate_limit_buckets" SET "windowStart" = now() - interval '61 minutes' WHERE "key" = ${UNKNOWN_DEVELOPER_KEY}`;
    browser.reset();
    expect(errorOf(await signIn(`flood-after-${randomUUID()}@devtest.local`, "x1y2z3-abc", "DEVELOPER"))).toBe(DEV_FAIL);
    expect((await failedAbout(null)).filter((r) => r.createdAt >= since)).toHaveLength(UNKNOWN_DEVELOPER_ENTRIES_PER_HOUR + 1);
  });
});
