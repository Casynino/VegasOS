import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { NOT_WORK_ACTIONS } from "@/server/services/developer-console";
import { CHECK_IDS } from "@/server/services/developer-checks";
import { resetBusinessData } from "../support/helpers";
import { crashData, DATABASE_ITEM_ID, healthReport, healthScore, healthVerdict, LOGIN_LIMITS, SCORE, speedData, type HealthReport, type Severity } from "@/server/services/developer-health";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * The Developer home's health (owner, 2026-10-17), against a real database:
 *   1. the score rule is the written one: 100, −60 for a database that does not answer (once), −10 for each "fix now", −5 for each "look at", never below 0;
 *   2. a clean system says nothing needs attention; every card comes from a real row or a real setting — never a guess;
 *   3. no secret value is ever in what the console returns, whatever is set in the environment;
 *   4. only the Developer account gets any of it.
 * Time is passed in (`now`), so a test that needs an empty window uses a day far in the future, where no other test wrote anything.
 */

let dev: MadeUser;
let rec: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
let fin: MadeUser;
const everyone = () => [dev, rec, boss, md, mgr, fin];

async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id);
  return (await getCurrentUser()) as CurrentUser;
}

const ENV_KEYS = ["NTZS_API_KEY", "NTZS_WEBHOOK_SECRET", "NTZS_USER_ID", "CRON_SECRET", "CALLMEBOT_API_KEY", "CALLMEBOT_KEY_TESTA", "CALLMEBOT_KEY_TESTB", "VERCEL_GIT_COMMIT_SHA", "VERCEL_ENV"] as const;
const savedEnv: Record<string, string | undefined> = {};
let savedSettings: { reportEnabled: boolean; roomReportEnabled: boolean; reportRecipients: unknown; onlinePayEnabled: boolean } | null = null;

const settings = (data: { reportEnabled?: boolean; roomReportEnabled?: boolean; reportRecipients?: unknown; onlinePayEnabled?: boolean }) =>
  db.hotelSettings.update({ where: { id: 1 }, data: data as never });

/** Everything the tests made, taken away again (the audit trail forbids deleting — its maintenance door is opened for this transaction only). */
const made = { deliveries: [] as string[], mobile: [] as string[], withdrawals: [] as string[], shifts: [] as string[], requests: [] as string[], stock: [] as string[], reports: [] as string[] };
async function cleanup() {
  await db.notificationDelivery.deleteMany({ where: { id: { in: made.deliveries.splice(0) } } });
  await db.dailyReport.deleteMany({ where: { id: { in: made.reports.splice(0) } } });
  await db.mobilePayment.deleteMany({ where: { id: { in: made.mobile.splice(0) } } });
  await db.withdrawal.deleteMany({ where: { id: { in: made.withdrawals.splice(0) } } });
  await db.actualShift.deleteMany({ where: { id: { in: made.shifts.splice(0) } } });
  await db.serviceRequest.deleteMany({ where: { id: { in: made.requests.splice(0) } } });
  await db.stockRequest.deleteMany({ where: { id: { in: made.stock.splice(0) } } });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'on', true)`;
    await tx.auditLog.deleteMany({ where: { createdAt: { gte: new Date("2041-01-01T00:00:00Z") } } });
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'off', true)`;
  });
}

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Health Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Health" });
  boss = await makeUser("OWNER", { fullName: "Boss Health" });
  md = await makeUser("ADMIN", { fullName: "MD Health" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Health" });
  fin = await makeUser("FINANCE", { fullName: "Finance Health" });
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const s = await db.hotelSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  savedSettings = { reportEnabled: s.reportEnabled, roomReportEnabled: s.roomReportEnabled, reportRecipients: s.reportRecipients, onlinePayEnabled: s.onlinePayEnabled };
});
afterAll(async () => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  if (savedSettings) await settings(savedSettings).catch(() => undefined);
  await cleanup();
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  for (const k of ENV_KEYS) delete process.env[k];
  await db.session.deleteMany({ where: { userId: { in: everyone().map((u) => u.id) } } });
  // the quiet baseline: reports off, nothing to send, online payment off
  await settings({ reportEnabled: false, roomReportEnabled: false, reportRecipients: [], onlinePayEnabled: false });
});
afterEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  await cleanup();
});

const ids = (h: HealthReport) => h.items.map((i) => i.id);
const item = (h: HealthReport, id: string) => h.items.find((i) => i.id === id);
/** The number a count-card carries ("3 messages failed…" → 3). */
const count = (h: HealthReport, id: string) => Number(item(h, id)?.title.vars.n ?? 0);
/** The set-up of a healthy system: the scheduled jobs and online payment both have what they need. */
function healthyEnv() {
  process.env.CRON_SECRET = "cron-test-value";
  process.env.NTZS_API_KEY = "ntzs_test_value";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_test_value";
}

// ───────────────────────────────────────────── 1. the score ─────────────────────────────────────────────
describe("the score rule", () => {
  const items = (fix: number, look: number, info = 0) => [
    ...Array.from({ length: fix }, (_, i) => ({ id: `f${i}`, severity: "fix" as Severity })),
    ...Array.from({ length: look }, (_, i) => ({ id: `l${i}`, severity: "look" as Severity })),
    ...Array.from({ length: info }, (_, i) => ({ id: `i${i}`, severity: "info" as Severity })),
  ];

  it("is the rule written on the card: 100, −60 offline, −10 each fix now, −5 each look at, nothing for information", () => {
    expect(SCORE).toEqual({ start: 100, databaseOffline: 60, fixNow: 10, lookAt: 5 });
    expect(healthScore({ databaseOnline: true, items: [] })).toBe(100);
    expect(healthScore({ databaseOnline: true, items: items(1, 0) })).toBe(90);
    expect(healthScore({ databaseOnline: true, items: items(0, 1) })).toBe(95);
    expect(healthScore({ databaseOnline: true, items: items(2, 3) })).toBe(100 - 20 - 15);
    expect(healthScore({ databaseOnline: true, items: items(0, 0, 9) })).toBe(100);
  });

  it("a database that does not answer costs 60 — its own card is not counted again as a fix now", () => {
    expect(healthScore({ databaseOnline: false, items: [] })).toBe(40);
    expect(healthScore({ databaseOnline: false, items: [{ id: DATABASE_ITEM_ID, severity: "fix" }] })).toBe(40);
    expect(healthScore({ databaseOnline: false, items: [{ id: DATABASE_ITEM_ID, severity: "fix" }, { id: "x", severity: "fix" }, { id: "y", severity: "look" }] })).toBe(40 - 10 - 5);
  });

  it("never goes below 0", () => {
    expect(healthScore({ databaseOnline: true, items: items(10, 0) })).toBe(0);
    expect(healthScore({ databaseOnline: true, items: items(40, 40) })).toBe(0);
    expect(healthScore({ databaseOnline: false, items: items(6, 0) })).toBe(0);
    expect(healthScore({ databaseOnline: false, items: items(5, 0) })).toBe(0);
    expect(healthScore({ databaseOnline: false, items: items(4, 0) })).toBe(0);
    expect(healthScore({ databaseOnline: false, items: items(3, 1) })).toBe(5);
  });

  it("the plain sentence follows the worst thing: offline, then fix now, then look at, then well", () => {
    expect(healthVerdict(false, { fix: 5, look: 5 })).toBe("offline");
    expect(healthVerdict(true, { fix: 1, look: 5 })).toBe("fix");
    expect(healthVerdict(true, { fix: 0, look: 2 })).toBe("look");
    expect(healthVerdict(true, { fix: 0, look: 0 })).toBe("well");
  });
});

// ───────────────────────────────────────────── 2. a clean system, and the database ─────────────────────────────────────────────
describe("a clean system and a dead database", () => {
  it("a clean hotel: nothing to fix, nothing to look at — score 100, 'well', every system check ran and was fine (or honestly 'could not be checked')", async () => {
    healthyEnv();
    // The test database is shared by many test files: a clean hotel is made here (no business data, rooms free, an empty system log).
    await resetBusinessData();
    await db.$executeRaw`DELETE FROM "system_events"`;
    const h = await healthReport(await as(dev));
    expect(h.items.filter((i) => i.severity !== "info")).toEqual([]);
    expect(h.counts.fix).toBe(0);
    expect(h.counts.look).toBe(0);
    expect(h.score).toBe(100);
    expect(h.verdict).toBe("well");
    // every check ran: none is missing, and none is "fix" or "look"
    expect(h.checks.map((c) => c.id).sort()).toEqual([...CHECK_IDS].sort());
    expect(h.checks.filter((c) => c.state === "fix" || c.state === "look").map((c) => c.id)).toEqual([]);
    expect(h.database.online).toBe(true);
    expect(h.database.ms).toBeGreaterThan(0);
    // the headline figure is the number of different server errors in 24 hours (none yet), not "alerts waiting"
    expect(h.serverErrors24h).toBe(0);
    expect(h).not.toHaveProperty("alerts");
    // the card's figures are about the SYSTEM (checks, jobs) and who uses it: a count of people and of actions saved — never what the work was
    // (the owner asked for "actions today" back on the card, 2026-10-18: a count only, see developer-extras.test.ts for what it counts)
    expect(h.signedInToday).toEqual(expect.any(Number));
    expect(h.actionsToday).toEqual(expect.any(Number));
    expect(h.failedSignIns24h).toBe(await db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }));
  });

  it("the chips are the cards: counts of each kind, fix now first, then look at, then information; the score follows from them", async () => {
    // a missing cron secret (fix), a missing webhook secret (look) and a failed sign-in (information)
    process.env.NTZS_API_KEY = "ntzs_test_value";
    const now = new Date("2041-08-01T09:00:00Z");
    await db.auditLog.create({ data: { actorLabel: "Sign-in page (not signed in)", actorType: "SYSTEM", action: "auth.login_failed", entityType: "User", entityId: rec.id, businessDate: new Date("2041-08-01"), createdAt: new Date(now.getTime() - 3600_000) } });
    const h = await healthReport(await as(dev), now);
    expect(ids(h)).toEqual(expect.arrayContaining(["cron-secret", "ntzs-webhook", "failed-sign-ins"]));
    const rank = h.items.map((i) => ({ fix: 0, look: 1, info: 2 })[i.severity]);
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
    expect(h.counts).toEqual({ fix: h.items.filter((i) => i.severity === "fix").length, look: h.items.filter((i) => i.severity === "look").length, info: h.items.filter((i) => i.severity === "info").length });
    expect(h.score).toBe(healthScore({ databaseOnline: true, items: h.items }));
    expect(h.score).toBe(100 - 10 * h.counts.fix - 5 * h.counts.look);
    expect(h.verdict).toBe("fix");
  });

  it("a database that does not answer: one card, 60 lost, 'offline' — and the rest of the page still has something to show", async () => {
    healthyEnv();
    const user = await as(dev);
    const spy = vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("connection refused"));
    const spies = [
      vi.spyOn(db.user, "findFirst").mockRejectedValue(new Error("connection refused")), vi.spyOn(db.auditLog, "count").mockRejectedValue(new Error("connection refused")),
      vi.spyOn(db.auditLog, "findMany").mockRejectedValue(new Error("connection refused")), vi.spyOn(db.session, "count").mockRejectedValue(new Error("connection refused")),
      vi.spyOn(db.reservation, "findMany").mockRejectedValue(new Error("connection refused")), // the sixth question: the bookings list
    ];
    try {
      const h = await healthReport(user);
      expect(h.database).toEqual({ online: false, ms: null });
      expect(item(h, DATABASE_ITEM_ID)).toMatchObject({ severity: "fix" });
      expect(item(h, DATABASE_ITEM_ID)!.title.text).toBe("The database is not answering");
      expect(h.verdict).toBe("offline");
      expect(h.score).toBe(40);
      // nothing else is guessed while the database is down: the only cards are the database's own
      expect(ids(h).filter((id) => id !== DATABASE_ITEM_ID)).toEqual([]);
      // the speed part does not fall over either: no sample, no average
      const speed = await speedData(user);
      expect(speed.latency).toEqual({ samples: [], average: null, slowest: null });
      expect(speed.probes.every((p) => p.ms === null)).toBe(true);
    } finally {
      spy.mockRestore();
      for (const s of spies) s.mockRestore();
    }
  });
});

// ───────────────────────────────────────────── 3. cards from real rows ─────────────────────────────────────────────
describe("the Boss's reports (from reportTroubles)", () => {
  // 10:00 hotel time, far from any other test's rows: the daily report (due 08:00) and the room report (due 07:00) are both late if not made.
  const late = new Date("2041-06-15T07:00:00Z");
  const recipients = [{ name: "Boss", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_TESTA" }];

  it("not made: a fix-now card each for the daily and the room report", async () => {
    healthyEnv();
    await settings({ reportEnabled: true, roomReportEnabled: true, reportRecipients: recipients });
    const h = await healthReport(await as(dev), late);
    expect(item(h, "report-daily")).toMatchObject({ severity: "fix" });
    expect(item(h, "report-daily")!.title.text).toBe("The daily report was not made");
    expect(item(h, "report-room")!.title.text).toBe("The room report was not made");
    expect(h.counts.fix).toBeGreaterThanOrEqual(2);
  });

  it("made but not sent, then failed, then sent: the card follows the facts, and goes when the Boss has it", async () => {
    healthyEnv();
    await settings({ reportEnabled: true, roomReportEnabled: false, reportRecipients: recipients });
    const user = await as(dev);
    const report = await db.dailyReport.create({ data: { businessDate: new Date("2041-06-14"), data: {}, summaryText: "x", generatedAt: new Date("2041-06-15T04:00:00Z") } });
    made.reports.push(report.id);

    let it1 = item(await healthReport(user, late), "report-daily")!;
    expect(it1.title.text).toBe("The daily report did not reach the Boss");
    expect(it1.summary.text).toBe("The report is saved but has not been sent yet.");
    expect(it1.link?.href).toBe(`/staff/reports/daily/${report.id}`);

    const delivery = await db.notificationDelivery.create({ data: { dailyReportId: report.id, purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000001", status: "FAILED" } });
    made.deliveries.push(delivery.id);
    it1 = item(await healthReport(user, late), "report-daily")!;
    expect(it1.summary.text).toBe("A send was tried and failed. The report is saved.");

    await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt: new Date("2041-06-15T04:05:00Z") } });
    expect(item(await healthReport(user, late), "report-daily")).toBeUndefined();
  });

  it("nothing is flagged before the report's own time, or when reports are off or nobody receives them", async () => {
    healthyEnv();
    const user = await as(dev);
    await settings({ reportEnabled: true, roomReportEnabled: true, reportRecipients: recipients });
    const early = await healthReport(user, new Date("2041-06-15T03:00:00Z")); // 06:00 hotel time
    expect(ids(early)).not.toContain("report-daily");
    expect(ids(early)).not.toContain("report-room");
    await settings({ reportEnabled: false });
    expect(ids(await healthReport(user, late))).not.toContain("report-daily");
    await settings({ reportEnabled: true, reportRecipients: [] });
    expect(ids(await healthReport(user, late))).not.toContain("report-daily");
  });
});

describe("failed messages and withdrawals are system problems; the hotel's own work never is", () => {
  const mkDelivery = async (extra: object) => made.deliveries.push((await db.notificationDelivery.create({ data: { purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: `+2557001${Math.floor(Math.random() * 90000 + 10000)}`, ...extra } })).id);

  it("three failed WhatsApp messages in 24 hours with none sent is a fix-now card (the provider is down for us); two are not; an old one is not counted", async () => {
    healthyEnv();
    await resetBusinessData();
    const user = await as(dev);
    await mkDelivery({ status: "FAILED" });
    await mkDelivery({ status: "FAILED" });
    await mkDelivery({ status: "FAILED", updatedAt: new Date(Date.now() - 48 * 3600_000) });
    expect(ids(await healthReport(user))).not.toContain("deliveries-failed"); // two in the day: a wrong number, not the provider
    await mkDelivery({ status: "FAILED" });
    let h = await healthReport(user);
    expect(item(h, "deliveries-failed")).toMatchObject({ severity: "fix" });
    expect(item(h, "deliveries-failed")!.summary.vars.n).toBe(3);
    expect(item(h, "deliveries-failed")!.who!.text).toContain("system owner");
    // one message did go out: the provider works, so it is only worth a look
    await mkDelivery({ status: "SENT", sentAt: new Date() });
    h = await healthReport(user);
    expect(item(h, "deliveries-failed")).toMatchObject({ severity: "look" });
  });

  it("a withdrawal is a system problem only when it is stuck at nTZS: 2 hours for a phone, four days for a bank; nTZS's own approval and review and settled ones are not", async () => {
    healthyEnv();
    const user = await as(dev);
    await db.withdrawal.deleteMany({});
    const base = { amount: 10_000, requestedById: rec.id, businessDate: new Date("2026-10-14") };
    const hours = (n: number) => new Date(Date.now() - n * 3600_000);
    const mk = async (extra: object) => made.withdrawals.push((await db.withdrawal.create({ data: { destinationKind: "PHONE", ...base, ...extra } })).id);
    await mk({ status: "UNKNOWN", createdAt: hours(3) });                                              // stuck: counted
    await mk({ status: "SUBMITTING", createdAt: new Date(Date.now() - 5 * 60_000) });                 // just sent: not yet
    await mk({ status: "PROCESSING", createdAt: hours(1.5) });                                         // within the 2 hours: not yet
    await mk({ status: "PROCESSING", destinationKind: "BANK", createdAt: hours(30) });                 // a bank takes working days: not yet
    await mk({ status: "PROCESSING", destinationKind: "BANK", createdAt: hours(100) });                // over four days: counted
    await mk({ status: "IN_REVIEW", createdAt: hours(100) });                                          // nTZS is checking it itself: its wait
    await mk({ status: "AWAITING_APPROVAL", createdAt: hours(30) });                                   // nTZS's own approval: not the system
    await mk({ status: "COMPLETED", createdAt: hours(30) });                                           // finished: not counted
    await mk({ status: "IN_REVIEW", createdAt: hours(5), reconciledAt: new Date() });                  // settled by a person: not counted
    const h = await healthReport(user);
    expect(item(h, "withdrawals")).toMatchObject({ severity: "fix" });
    expect(item(h, "withdrawals")!.summary.vars.n).toBe(2);
  });

  it("the hotel's own work is NOT a Developer problem: a shift open for days, a request nobody answered, a payment that needs Finance, an account that never signed in — none is a card, none costs a point", async () => {
    healthyEnv();
    await resetBusinessData();
    await db.$executeRaw`DELETE FROM "system_events"`;
    const user = await as(dev);
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    made.shifts.push((await db.actualShift.create({ data: { userId: rec.id, department: "RECEPTION", businessDate: new Date("2026-10-14"), startedAt: days(3) } })).id);
    made.shifts.push((await db.actualShift.create({ data: { userId: mgr.id, department: "RESTAURANT", businessDate: new Date("2026-10-14"), startedAt: days(2) } })).id);
    made.requests.push((await db.serviceRequest.create({ data: { type: "GENERAL", description: "test", businessDate: new Date("2026-10-14"), status: "NEW", createdAt: days(5) } })).id);
    made.stock.push((await db.stockRequest.create({ data: { number: `SR-T-${Math.random().toString(36).slice(2, 9)}`, department: "KITCHEN", requestedById: rec.id, status: "SUBMITTED", updatedAt: days(5) } })).id);
    made.mobile.push((await db.mobilePayment.create({ data: { amount: 5000, phone: "255700001234", purpose: "RESTAURANT", status: "COMPLETED", attentionAt: new Date(), completedAt: new Date() } })).id);
    await makeUser("RECEPTIONIST", { fullName: "Ghost Never" }); // active, never signed in
    const h = await healthReport(user);
    for (const gone of ["shifts-long", "never-signed-in", "alerts-waiting", "mobile-payments"]) expect(ids(h), gone).not.toContain(gone);
    expect(h.items.filter((i) => i.severity !== "info")).toEqual([]);
    expect(h.score).toBe(100);
    expect(h.verdict).toBe("well");
    // nor is there any check about them
    for (const c of h.checks) expect(c.id).not.toMatch(/^(shift|never|alert|request|expense|dirty|owing|low-stock|stock-low|approval)/);
  });
});

describe("what was found about sign-ins and accounts (a day far from any other test's rows)", () => {
  const now = new Date("2041-07-10T09:00:00Z");
  const at = (minutesBefore: number) => new Date(now.getTime() - minutesBefore * 60_000);
  const row = (action: string, minutesBefore: number, extra: Record<string, unknown> = {}) =>
    db.auditLog.create({ data: { actorLabel: "t", actorType: "SYSTEM", action, entityType: "User", businessDate: new Date("2041-07-10"), createdAt: at(minutesBefore), ...extra } });

  it("failed sign-ins in the last 24 hours (information, with the lock rule); an older one is not counted", async () => {
    healthyEnv();
    for (const m of [30, 120, 600]) await row("auth.login_failed", m, { entityId: rec.id });
    await row("auth.login_failed", 30 * 60, { entityId: rec.id }); // 30 hours ago
    const h = await healthReport(await as(dev), now);
    expect(h.failedSignIns24h).toBe(3);
    expect(item(h, "failed-sign-ins")).toMatchObject({ severity: "info" });
    expect(count(h, "failed-sign-ins")).toBe(3);
    expect(item(h, "failed-sign-ins")!.summary.vars).toEqual({ dev: LOGIN_LIMITS.developerEmail, staff: LOGIN_LIMITS.staffEmail });
    expect([LOGIN_LIMITS.developerEmail, LOGIN_LIMITS.staffEmail]).toEqual([5, 8]);
  });

  it("refusals to the Developer in the last 24 hours are information; ten or more are a look-at check (never both cards)", async () => {
    healthyEnv();
    for (let i = 0; i < 8; i++) await row("developer.denied", 60 + i, { userId: dev.id });
    await row("developer.denied", 25 * 60, { userId: dev.id });
    let h = await healthReport(await as(dev), now);
    expect(count(h, "denied")).toBe(8);
    expect(item(h, "denied")).toMatchObject({ severity: "info" });
    await row("developer.denied", 120, { userId: dev.id });
    await row("developer.denied", 121, { userId: dev.id });
    h = await healthReport(await as(dev), now);
    expect(h.items.filter((i) => i.id === "denied")).toHaveLength(1);
    expect(item(h, "denied")).toMatchObject({ severity: "look" });
    expect(item(h, "denied")!.summary.vars.n).toBe(10);
  });

  it("more than 20 failed sign-ins in 24 hours is a look-at check with who/what/todo; 20 or fewer stay information", async () => {
    healthyEnv();
    for (let i = 0; i < 20; i++) await row("auth.login_failed", 10 + i, { entityId: rec.id });
    let h = await healthReport(await as(dev), now);
    expect(item(h, "failed-sign-ins")).toMatchObject({ severity: "info" });
    await row("auth.login_failed", 5, { entityId: rec.id });
    h = await healthReport(await as(dev), now);
    expect(h.items.filter((i) => i.id === "failed-sign-ins")).toHaveLength(1);
    expect(item(h, "failed-sign-ins")).toMatchObject({ severity: "look" });
    expect(item(h, "failed-sign-ins")!.summary.vars.n).toBe(21);
    expect(item(h, "failed-sign-ins")!.who!.text.length).toBeGreaterThan(0);
  });

  it("work as: one that ran over an hour is mentioned, a young one is not; starts in 24 hours are counted", async () => {
    healthyEnv();
    const longBefore = count(await healthReport(await as(dev), now), "work-as-long");
    const long = await makeSession(dev.id, { setCookie: false });
    const young = await makeSession(dev.id, { setCookie: false });
    const { sha256 } = await import("../support/developer");
    await db.session.update({ where: { tokenHash: sha256(long) }, data: { workAsUserId: rec.id, workAsStartedAt: at(120) } });
    await db.session.update({ where: { tokenHash: sha256(young) }, data: { workAsUserId: rec.id, workAsStartedAt: at(20) } });
    await row("developer.work_as_started", 180, { userId: dev.id, actorType: "DEVELOPER" });
    await row("developer.work_as_started", 240, { userId: dev.id, actorType: "DEVELOPER" });
    const h = await healthReport(await as(dev), now);
    expect(count(h, "work-as-long")).toBe(longBefore + 1);
    expect(Number(item(h, "work-as-long")!.summary.vars.minutes)).toBeGreaterThanOrEqual(120);
    expect(count(h, "work-as-used")).toBe(2);
    expect(item(h, "work-as-used")).toMatchObject({ severity: "info" });
  });

  it("the list of 'not work' names holds every look-and-check action the Developer's code writes (so no new one counts as work by mistake)", () => {
    for (const looking of ["developer.viewed", "developer.viewed_limit", "developer.business_viewed", "developer.inspected", "developer.exported", "developer.downloaded"]) expect(NOT_WORK_ACTIONS, looking).toContain(looking);
    for (const refused of ["developer.denied", "developer.work_as_refused", "developer.endpoint_refused", "settings.update.refused", "user.suspend_failed", "user.reactivate_failed", "user.sign_out_failed"]) expect(NOT_WORK_ACTIONS, refused).toContain(refused);
    for (const note of ["developer.work_as_expired", "developer.work_as_notice", "developer.access_notice", "auth.login_failed_suppressed"]) expect(NOT_WORK_ACTIONS, note).toContain(note);
    // what the Developer does on purpose is work
    for (const work of ["developer.work_as_started", "developer.work_as_ended", "user.suspended", "user.reactivated", "user.signed_out_everywhere"]) expect(NOT_WORK_ACTIONS, work).not.toContain(work);
  });
});

describe("what the server is set up with", () => {
  it("the cron secret: missing is a fix-now card, set is nothing", async () => {
    process.env.NTZS_API_KEY = "ntzs_test_value";
    process.env.NTZS_WEBHOOK_SECRET = "whsec_test_value";
    const user = await as(dev);
    expect(item(await healthReport(user), "cron-secret")).toMatchObject({ severity: "fix", link: null });
    process.env.CRON_SECRET = "cron-test-value";
    expect(ids(await healthReport(user))).not.toContain("cron-secret");
  });

  it("nTZS: switched on without a key is a fix-now card (customers get an error); a key without the webhook secret is a look-at card; off and unset is only information", async () => {
    process.env.CRON_SECRET = "cron-test-value";
    const user = await as(dev);
    await settings({ onlinePayEnabled: true });
    expect(item(await healthReport(user), "ntzs-off")).toMatchObject({ severity: "fix" });
    await settings({ onlinePayEnabled: false });
    let h = await healthReport(user);
    expect(ids(h)).not.toContain("ntzs-off");
    expect(item(h, "ntzs-not-set")).toMatchObject({ severity: "info" });
    process.env.NTZS_API_KEY = "ntzs_test_value";
    h = await healthReport(user);
    expect(item(h, "ntzs-webhook")).toMatchObject({ severity: "look" });
    expect(ids(h)).not.toContain("ntzs-not-set");
    process.env.NTZS_WEBHOOK_SECRET = "whsec_test_value";
    h = await healthReport(user);
    expect(ids(h)).not.toContain("ntzs-webhook");
  });

  it("WhatsApp: recipients without a key are a look-at card ('1 of 2 can be reached'); nobody listed is another; reports off is nothing", async () => {
    healthyEnv();
    const user = await as(dev);
    await settings({ reportEnabled: true, roomReportEnabled: false, reportRecipients: [
      { name: "A", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_TESTA" }, { name: "B", phone: "+255700000002", apiKeyRef: "CALLMEBOT_KEY_TESTB" },
    ] });
    const near = new Date("2041-06-15T03:00:00Z"); // before any report is due
    let h = await healthReport(user, near);
    expect(item(h, "whatsapp-keys")).toMatchObject({ severity: "look" });
    expect(item(h, "whatsapp-keys")!.summary.text).toBe("0 of 2 recipients can be reached.");
    process.env.CALLMEBOT_KEY_TESTA = "secret-a";
    h = await healthReport(user, near);
    expect(item(h, "whatsapp-keys")!.summary.text).toBe("1 of 2 recipients can be reached.");
    process.env.CALLMEBOT_API_KEY = "secret-default";
    expect(ids(await healthReport(user, near))).not.toContain("whatsapp-keys");
    await settings({ reportRecipients: [] });
    expect(item(await healthReport(user, near), "whatsapp-none")).toMatchObject({ severity: "look" });
    await settings({ reportEnabled: false });
    expect(ids(await healthReport(user, near))).not.toContain("whatsapp-none");
  });
});

// ───────────────────────────────────────────── 4. secrets, links and the door ─────────────────────────────────────────────
describe("secrets and links", () => {
  it("no secret value is anywhere in what comes back, whatever is set in the environment", async () => {
    const secrets = {
      NTZS_API_KEY: "ntzs_live_SECRETKEY_111", NTZS_WEBHOOK_SECRET: "whsec_SECRETWEBHOOK_222", NTZS_USER_ID: "ntzs-user-SECRET-333", CRON_SECRET: "cron-SECRETCRON-444",
      CALLMEBOT_API_KEY: "SECRETDEFAULTKEY-555", CALLMEBOT_KEY_TESTA: "SECRETRECIPIENTKEY-666", VERCEL_GIT_COMMIT_SHA: "abcdef0123456789abcdef0123456789abcdef01",
    };
    Object.assign(process.env, secrets, { VERCEL_ENV: "production" });
    await settings({ reportEnabled: true, reportRecipients: [{ name: "A", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_TESTA" }] });
    const user = await as(dev);
    // give the report something to say about every part
    made.deliveries.push((await db.notificationDelivery.create({ data: { purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000009", status: "FAILED", lastError: "key SECRETRECIPIENTKEY-666 rejected" } })).id);
    const everything = JSON.stringify({
      health: await healthReport(user), late: await healthReport(user, new Date("2041-06-15T07:00:00Z")), crashes: await crashData(user), speed: await speedData(user),
    });
    for (const [name, value] of Object.entries(secrets)) {
      if (name === "VERCEL_GIT_COMMIT_SHA") { expect(everything).not.toContain(value); continue; }
      expect(everything, name).not.toContain(value);
    }
    expect(everything).not.toMatch(/SECRET(KEY|WEBHOOK|CRON|DEFAULTKEY|RECIPIENTKEY)|SECRET-333/);
    expect(everything).not.toContain(process.env.DATABASE_URL!);
    expect(everything).not.toMatch(/passwordHash|tokenHash|pinHash|apiKeyRef|argon2/i);
    // the cards that depend on those settings say "set": nothing about cron, nTZS or the default key is wrong
    const h = JSON.parse(everything).health as HealthReport;
    expect(h.items.map((i) => i.id)).not.toEqual(expect.arrayContaining(["cron-secret", "ntzs-off"]));
  });

  it("a card links only to a page this Developer may open (a Developer who lost the right gets the console's own page instead, never a refused one)", async () => {
    healthyEnv();
    await settings({ reportEnabled: true, roomReportEnabled: false, reportRecipients: [{ name: "Boss", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_TESTA" }] });
    const late = new Date("2041-06-15T07:00:00Z");
    const user = await as(dev);
    expect(item(await healthReport(user, late), "report-daily")!.link!.href).toBe("/staff/reports/daily");
    const without = { ...user, permissions: new Set([...user.permissions].filter((p) => p !== "reports.view")) } as CurrentUser;
    const fallback = item(await healthReport(without, late), "report-daily")!.link;
    expect(fallback).not.toBeNull();
    expect(fallback!.href).toContain("/staff/developer#errors");
  });
});

describe("the door", () => {
  it.each([["receptionist", () => rec], ["Boss", () => boss], ["MD", () => md], ["manager", () => mgr], ["Finance", () => fin]])("the %s gets nothing from any health call", async (_n, who) => {
    const user = await as(who());
    for (const call of [() => healthReport(user), () => crashData(user), () => speedData(user)]) {
      const e = await thrownBy(call);
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("a Developer who is working as someone is refused too — the console and the work-as world stay apart", async () => {
    const user = await as(dev);
    const working = { ...user, workAs: { developerId: dev.id, developerName: dev.fullName, startedAt: new Date() } } as unknown as CurrentUser;
    for (const call of [() => healthReport(working), () => crashData(working), () => speedData(working)]) {
      expect(((await thrownBy(call)) as AppError).code).toBe("FORBIDDEN");
    }
  });
});
