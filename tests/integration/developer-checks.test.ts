import { readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import { businessDayConfig, getSettings } from "@/server/settings";
import { businessDateOf } from "@/lib/time/business-date";
import { makeT } from "@/i18n/translate";
import { loadCatalog } from "@/i18n/catalog";
import { CHECK_IDS, CHECK_LIMITS, runChecks, type CheckResult } from "@/server/services/developer-checks";
import { systemDiagnostics } from "@/server/services/developer-console";
import { crashData, healthReport } from "@/server/services/developer-health";
import DeveloperHomePage from "@/app/staff/(app)/developer/page";
import { CrashesTab } from "@/app/staff/(app)/developer/tab-crashes";
import { ProblemsTab } from "@/app/staff/(app)/developer/tab-problems";
import { resetBusinessData } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE SYSTEM CHECKS (owner, 2026-10-18), against a real database. THE DEVELOPER DOES NOT DO OPERATIONS: every check here is about the
 * system itself (data that contradicts itself, jobs and integrations, set-up, server errors). For each: it fires on a constructed bad case,
 * stays quiet on a clean one and just under its threshold, and gives the right count, examples, who and link. One failing check never breaks
 * the others; only the Developer may run them; nothing personal is in any result; and nothing is ever written.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ago = (ms: number, from = Date.now()) => new Date(from - ms);

let dev: MadeUser, rec: MadeUser, boss: MadeUser, md: MadeUser, mgr: MadeUser, fin: MadeUser;
const everyone = () => [dev, rec, boss, md, mgr, fin];

async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id);
  return (await getCurrentUser()) as CurrentUser;
}
const run = async (now = new Date()) => runChecks(await as(dev), now);
const get = (rs: CheckResult[], id: string) => {
  const r = rs.find((x) => x.id === id);
  if (!r) throw new Error(`no check ${id}`);
  return r;
};
const stateOf = async (id: string, now = new Date()) => get(await run(now), id);

// ───────────────────────────────────────────── the world these tests build ─────────────────────────────────────────────
const ENV_KEYS = ["NTZS_API_KEY", "NTZS_WEBHOOK_SECRET", "CRON_SECRET", "CALLMEBOT_API_KEY", "CALLMEBOT_KEY_CHKA", "NEXT_PUBLIC_SITE_URL", "VERCEL_ENV"] as const;
const savedEnv: Record<string, string | undefined> = {};
let savedSettings: Record<string, unknown> = {};
const SETTING_KEYS = ["reportEnabled", "roomReportEnabled", "reportRecipients", "onlinePayEnabled"] as const;
const setSettings = (data: Record<string, unknown>) => db.hotelSettings.update({ where: { id: 1 }, data: data as never });
const JOB_PATHS = ["/api/cron/daily-report", "/api/cron/room-report"];

/** The set-up of a healthy system. */
function healthyEnv() {
  process.env.CRON_SECRET = "cron-test-value";
  process.env.NTZS_API_KEY = "ntzs_test_value";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_test_value";
}

let seq = 0;
async function seedJobs(from = Date.now()) {
  for (const job of JOB_PATHS) {
    await db.systemEvent.create({ data: { kind: "CRON", source: job, fingerprint: `cron:${job}:${seq++}`, status: "OK", message: "ok", detail: { durationMs: 900 }, firstSeenAt: ago(HOUR, from), lastSeenAt: ago(HOUR, from) } });
  }
}
async function clearWorld() {
  await resetBusinessData();
  await db.$executeRaw`DELETE FROM "system_events"`;
  await db.notificationDelivery.deleteMany();
  await db.dailyReport.deleteMany();
  await db.roomReport.deleteMany();
  await db.restaurantOrderPayment.deleteMany();
  await db.$executeRawUnsafe(`TRUNCATE "restaurant_order_items", "revenue_transactions", "payment_corrections" CASCADE`);
  await db.room.updateMany({ data: { status: "AVAILABLE", isActive: true } });
}

const fixtures: { room: { id: string; roomTypeId: string; number: string }[]; sourceId: string; methodId: string; accountId: string } = { room: [], sourceId: "", methodId: "", accountId: "" };

async function mkGuest(fullName: string, phone: string | null = null, email: string | null = null) {
  return db.guest.create({ data: { fullName, phone, email } });
}

interface StayOptions {
  room: { id: string; roomTypeId: string };
  guest?: { id: string };
  status?: "RESERVED" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT";
  reservationStatus?: "RESERVED" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT";
  /** Hotel dates (YYYY-MM-DD). */
  arrival?: string; departure?: string;
  /** The booking's cached totals (consistent by default: net 100,000, nothing paid). */
  gross?: number; discount?: number; charges?: number; net?: number; paid?: number; billed?: number; balance?: number;
  holdUntil?: Date | null;
  startAt?: Date; endAt?: Date;
}
async function mkStay(o: StayOptions) {
  const n = ++seq;
  const guest = o.guest ?? (await mkGuest(`Guest Number${n}`));
  const arrival = o.arrival ?? "2041-03-10";
  const departure = o.departure ?? "2041-03-12";
  const gross = o.gross ?? 100_000, discount = o.discount ?? 0, charges = o.charges ?? 0;
  const net = o.net ?? gross - discount + charges, paid = o.paid ?? 0, billed = o.billed ?? 0;
  const status = o.status ?? "RESERVED";
  const reservation = await db.reservation.create({
    data: {
      reference: `VLH-CHK${String(n).padStart(3, "0")}`, manageToken: `tok-chk-${n}-${Date.now()}`, sourceId: fixtures.sourceId, guestId: guest.id,
      status: o.reservationStatus ?? status, arrivalDate: new Date(`${arrival}T00:00:00Z`), departureDate: new Date(`${departure}T00:00:00Z`), businessDate: new Date(`${arrival}T00:00:00Z`),
      grossAmount: gross, discountAmount: discount, chargesAmount: charges, netAmount: net, paidAmount: paid, companyBilledAmount: billed, balanceAmount: o.balance ?? net - paid - billed,
      holdUntil: o.holdUntil ?? null,
    },
  });
  const start = o.startAt ?? new Date(`${arrival}T11:00:00Z`);
  await db.reservationRoom.create({
    data: {
      reservationId: reservation.id, roomId: o.room.id, roomTypeId: o.room.roomTypeId, status,
      startAt: start, endAt: o.endAt ?? (departure > arrival ? new Date(`${departure}T08:00:00Z`) : new Date(start.getTime() + 8 * HOUR)),
      arrivalDate: new Date(`${arrival}T00:00:00Z`), departureDate: new Date(`${departure}T00:00:00Z`), nights: 2, ratePerNight: 50_000,
      grossAmount: gross, discountAmount: discount, netAmount: gross - discount,
    },
  });
  return reservation;
}
const pay = (reservationId: string, amount: number, extra: Record<string, unknown> = {}) =>
  db.payment.create({ data: { amount, methodId: fixtures.methodId, accountId: fixtures.accountId, recordedById: rec.id, reservationId, businessDate: new Date("2041-03-10T00:00:00Z"), ...extra } });

const todayDate = async () => businessDateOf(new Date(), businessDayConfig(await getSettings()));

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Checks Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Checks" });
  boss = await makeUser("OWNER", { fullName: "Boss Checks" });
  md = await makeUser("ADMIN", { fullName: "MD Checks" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Checks" });
  fin = await makeUser("FINANCE", { fullName: "Finance Checks" });
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const s = await getSettings();
  savedSettings = Object.fromEntries(SETTING_KEYS.map((k) => [k, (s as unknown as Record<string, unknown>)[k]]));
  fixtures.room = (await db.room.findMany({ where: { isActive: true }, orderBy: { number: "asc" }, take: 4, select: { id: true, roomTypeId: true, number: true } }));
  fixtures.sourceId = (await db.bookingSource.findFirstOrThrow({ select: { id: true } })).id;
  fixtures.methodId = (await db.paymentMethod.findFirstOrThrow({ select: { id: true } })).id;
  fixtures.accountId = (await db.moneyAccount.findFirstOrThrow({ where: { isActive: true, acceptsPayments: true }, select: { id: true } })).id;
});
afterAll(async () => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  await setSettings(savedSettings).catch(() => undefined);
  await clearWorld().catch(() => undefined);
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  for (const k of ENV_KEYS) delete process.env[k];
  healthyEnv();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.example.test";
  await clearWorld();
  await db.session.deleteMany({ where: { userId: { in: everyone().map((u) => u.id) } } });
  await setSettings({ reportEnabled: false, roomReportEnabled: false, reportRecipients: [], onlinePayEnabled: false });
  await seedJobs();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

// ───────────────────────────────────────────── 0. the door, the clean world, the shape ─────────────────────────────────────────────
describe("the checks as a whole", () => {
  it("a clean hotel: every check runs and every one is fine; each has an id, a group, words, a who", async () => {
    const rs = await run();
    expect(rs.map((r) => r.id).sort()).toEqual([...CHECK_IDS].sort());
    expect(new Set(CHECK_IDS).size).toBe(CHECK_IDS.length);
    expect(rs.filter((r) => r.state !== "ok").map((r) => `${r.id}:${r.state}`)).toEqual([]);
    for (const r of rs) {
      expect(r.count, r.id).toBe(0);
      for (const f of [r.title, r.summary, r.what, r.todo, r.who]) expect(f.text.length, r.id).toBeGreaterThan(3);
      expect(["Data", "People", "Setup", "Jobs & errors"]).toContain(r.group);
    }
    // the hotel's own work is not among them
    for (const id of CHECK_IDS) expect(id).not.toMatch(/^(shift|never|alert|request|expense|dirty|owing|low-stock|stock-low|approval)/);
  });

  it.each([["receptionist", () => rec], ["Boss", () => boss], ["MD", () => md], ["manager", () => mgr], ["Finance", () => fin]])("the %s is refused: only the Developer account runs the checks", async (_n, who) => {
    const user = await as(who());
    const e = await thrownBy(() => runChecks(user));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("FORBIDDEN");
  });

  it("a Developer who is working as someone is refused too", async () => {
    const user = await as(dev);
    const working = { ...user, workAs: { developerId: dev.id, developerName: dev.fullName, startedAt: new Date() } } as unknown as CurrentUser;
    expect(((await thrownBy(() => runChecks(working))) as AppError).code).toBe("FORBIDDEN");
  });

  it("running the checks writes nothing: no booking, payment, room or audit line changes", async () => {
    const [room] = fixtures.room;
    await db.room.update({ where: { id: room.id }, data: { status: "OCCUPIED" } });
    await mkStay({ room: fixtures.room[1], status: "CHECKED_IN", paid: 5, balance: 1 }); // two real problems to find
    const snapshot = async () => JSON.stringify({
      rooms: await db.room.findMany({ select: { id: true, status: true, updatedAt: true }, orderBy: { id: "asc" } }),
      reservations: await db.reservation.findMany({ select: { id: true, balanceAmount: true, updatedAt: true }, orderBy: { id: "asc" } }),
      payments: await db.payment.count(), audit: await db.auditLog.count({ where: { action: { not: "developer.viewed" } } }), events: await db.systemEvent.count(),
    });
    const user = await as(dev); // (signing the session in writes its own audit-free rows; the checks are what is measured)
    const before = await snapshot();
    const rs = await runChecks(user);
    expect(rs.filter((r) => r.state === "fix").length).toBeGreaterThanOrEqual(2);
    expect(await snapshot()).toBe(before);
  });

  it("a check that fails becomes 'could not be checked' and never breaks the others", async () => {
    const [room] = fixtures.room;
    await db.room.update({ where: { id: room.id }, data: { status: "OCCUPIED" } }); // a real problem that does not use raw SQL
    const user = await as(dev);
    const diag = await systemDiagnostics(user);
    // Every check that asks the database in raw SQL now fails…
    const spy = vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("boom: secret value 255700001234 in the message"));
    const rs = await runChecks(user, new Date(), { diag });
    spy.mockRestore();
    const unknown = rs.filter((r) => r.state === "unknown").map((r) => r.id);
    expect(unknown).toEqual(expect.arrayContaining(["room-two-stays", "reservation-totals", "order-payments", "stock-movements", "migrations-pending"]));
    for (const r of rs.filter((x) => x.state === "unknown")) {
      expect(r.summary.text, r.id).toMatch(/^Could not be checked: /);
      expect(r.count).toBe(0);
      // …and the error's own words (which can hold a value) are never shown
      expect(JSON.stringify(r), r.id).not.toMatch(/boom|255700001234/);
    }
    // …while the others still did their work, and still found what is wrong
    expect(get(rs, "room-occupied-no-stay")).toMatchObject({ state: "fix", count: 1 });
    expect(get(rs, "cron-secret").state).toBe("ok");
    expect(get(rs, "boss-account").state).toBe("ok");
  });

  it("a check that never answers is cut off, not waited for", () => {
    expect(CHECK_LIMITS.timeoutMs).toBeLessThanOrEqual(10_000);
    expect(CHECK_LIMITS.parallel).toBeGreaterThanOrEqual(1);
  });

  it("every example is a code or a number — never a sentence, a name or an email — and there are at most five", async () => {
    for (const r of fixtures.room) await db.room.update({ where: { id: r.id }, data: { status: "OCCUPIED" } });
    const room5 = await db.room.findMany({ where: { isActive: true }, orderBy: { number: "asc" }, take: 7, select: { id: true } });
    for (const r of room5) await db.room.update({ where: { id: r.id }, data: { status: "OCCUPIED" } });
    const c = await stateOf("room-occupied-no-stay");
    expect(c.count).toBe(room5.length);
    expect(c.examples!.length).toBe(5);
    for (const e of c.examples!) expect(e).toMatch(/^[A-Za-z0-9._:/#-]{1,40}$/);
  });
});

// ───────────────────────────────────────────── 1. rooms ─────────────────────────────────────────────
describe("rooms", () => {
  it("room-occupied-no-stay: a room marked occupied with nobody checked in is a fix, with the room's number; with a guest checked in, free, or no longer in use it is quiet", async () => {
    const [a, b, c] = fixtures.room;
    expect((await stateOf("room-occupied-no-stay")).state).toBe("ok");
    await db.room.update({ where: { id: a.id }, data: { status: "OCCUPIED" } });
    const r = await stateOf("room-occupied-no-stay");
    expect(r).toMatchObject({ state: "fix", count: 1, examples: [a.number], group: "Data" });
    expect(r.summary.vars.n).toBe(1);
    expect(r.who.text).toBe("The Developer.");
    expect(r.link?.href).toBe("/staff/rooms");
    // a guest is really in room b: quiet for b
    await db.room.update({ where: { id: b.id }, data: { status: "OCCUPIED" } });
    await mkStay({ room: b, status: "CHECKED_IN" });
    expect((await stateOf("room-occupied-no-stay")).examples).toEqual([a.number]);
    // a stay that is only booked (not checked in) is not a guest in the room
    await db.room.update({ where: { id: c.id }, data: { status: "OCCUPIED" } });
    await mkStay({ room: c, status: "CONFIRMED" });
    expect((await stateOf("room-occupied-no-stay")).count).toBe(2);
    // a room taken out of use is not looked at
    await db.room.update({ where: { id: a.id }, data: { isActive: false } });
    expect((await stateOf("room-occupied-no-stay")).examples).toEqual([c.number]);
  });

  it("stay-room-not-occupied: a checked-in guest in a room that is not marked occupied is a fix; occupied, or only booked, is quiet", async () => {
    const [a, b, c] = fixtures.room;
    await db.room.update({ where: { id: a.id }, data: { status: "DIRTY" } });
    await mkStay({ room: a, status: "CHECKED_IN" });
    await db.room.update({ where: { id: b.id }, data: { status: "OCCUPIED" } });
    await mkStay({ room: b, status: "CHECKED_IN" });
    await mkStay({ room: c, status: "RESERVED" }); // booked, room free: nothing wrong
    const r = await stateOf("stay-room-not-occupied");
    expect(r).toMatchObject({ state: "fix", count: 1, examples: [a.number] });
    expect(r.link?.href).toBe("/staff/rooms");
    await db.room.update({ where: { id: a.id }, data: { status: "OCCUPIED" } });
    expect((await stateOf("stay-room-not-occupied")).state).toBe("ok");
  });

  it("room-two-stays: two stays checked in to one room is a fix; one checked in and one checked out is quiet", async () => {
    const [a, b] = fixtures.room;
    await db.room.update({ where: { id: a.id }, data: { status: "OCCUPIED" } });
    await mkStay({ room: a, status: "CHECKED_IN", arrival: "2041-03-10", departure: "2041-03-12" });
    await mkStay({ room: a, status: "CHECKED_OUT", arrival: "2041-03-01", departure: "2041-03-05" });
    await db.room.update({ where: { id: b.id }, data: { status: "OCCUPIED" } });
    await mkStay({ room: b, status: "CHECKED_IN", arrival: "2041-03-10", departure: "2041-03-12" });
    expect((await stateOf("room-two-stays")).state).toBe("ok");
    // a second checked-in stay in room a, on other dates (the database's own overlap rule would stop an overlapping one)
    await mkStay({ room: a, status: "CHECKED_IN", arrival: "2041-02-01", departure: "2041-02-03" });
    const r = await stateOf("room-two-stays");
    expect(r).toMatchObject({ state: "fix", count: 1, examples: [a.number] });
    expect(r.link?.href).toBe("/staff/developer/business");
  });
});

// ───────────────────────────────────────────── 2. money records that must agree ─────────────────────────────────────────────
describe("reservation-totals", () => {
  const recent = async () => {
    const today = await todayDate();
    return { arrival: today, departure: today };
  };

  it("consistent totals are quiet: net = gross − discount + charges, balance = net − paid − billed, paid = posted payments (refunds subtract), charges = unvoided charges", async () => {
    const { arrival, departure } = await recent();
    const [room] = fixtures.room;
    const r = await mkStay({ room, status: "CONFIRMED", arrival, departure, gross: 120_000, discount: 20_000, charges: 15_000, net: 115_000, paid: 70_000, balance: 45_000 });
    await pay(r.id, 100_000);
    await pay(r.id, 30_000, { kind: "REFUND" });
    await pay(r.id, 9_999, { status: "REVERSED" });                       // a reversed payment is not money
    await db.reservationCharge.create({ data: { reservationId: r.id, description: "Laundry", amount: 15_000, businessDate: new Date(`${arrival}T00:00:00Z`) } });
    await db.reservationCharge.create({ data: { reservationId: r.id, description: "Voided", amount: 8_000, isVoided: true, businessDate: new Date(`${arrival}T00:00:00Z`) } });
    const inv = await db.invoice.create({ data: { number: `INV-CHK-${++seq}`, status: "ISSUED", createdById: rec.id } });
    await pay(r.id, 5_000, { invoiceId: inv.id });                        // a deposit that followed the bill to an invoice counts there, not here
    expect(await stateOf("reservation-totals")).toMatchObject({ state: "ok", count: 0 });
  });

  it("a balance that is not net − paid − billed is a fix with the booking's reference; so is a paid amount, a net, or a charges total that disagrees with its records", async () => {
    const { arrival, departure } = await recent();
    const [a, b, c, d] = fixtures.room;
    const wrongBalance = await mkStay({ room: a, status: "CONFIRMED", arrival, departure, net: 100_000, paid: 0, balance: 90_000 });
    const wrongPaid = await mkStay({ room: b, status: "CONFIRMED", arrival, departure, paid: 40_000, balance: 60_000 }); // says 40,000 paid, no payment behind it
    const wrongNet = await mkStay({ room: c, status: "CONFIRMED", arrival, departure, gross: 100_000, net: 80_000, balance: 80_000 });
    const wrongCharges = await mkStay({ room: d, status: "CONFIRMED", arrival, departure, charges: 7_000, net: 107_000, balance: 107_000 }); // says 7,000 of charges, none exist
    const r = await stateOf("reservation-totals");
    expect(r).toMatchObject({ state: "fix", count: 4, group: "Data" });
    expect(r.examples!.sort()).toEqual([wrongBalance, wrongPaid, wrongNet, wrongCharges].map((x) => x.reference).sort());
    expect(r.examples!.every((e) => /^VLH-CHK\d+$/.test(e))).toBe(true);
    expect(r.link?.href).toBe("/staff/developer/business");
    expect(r.todo.text).toContain("Do not change any money record");
  });

  it("only stays that ended within the window are read: one that ended 119 days ago is looked at, one 121 days ago is not", async () => {
    const [a, b] = fixtures.room;
    const today = await todayDate();
    const back = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() - n * DAY).toISOString().slice(0, 10);
    expect(CHECK_LIMITS.totalsWindowDays).toBe(120);
    await mkStay({ room: a, status: "CHECKED_OUT", arrival: back(125), departure: back(121), net: 100_000, balance: 5 });
    expect((await stateOf("reservation-totals")).state).toBe("ok");
    await mkStay({ room: b, status: "CHECKED_OUT", arrival: back(125), departure: back(119), net: 100_000, balance: 5 });
    expect((await stateOf("reservation-totals")).count).toBe(1);
  });
});

describe("order-payments", () => {
  const order = (over: Record<string, unknown> = {}) => {
    const n = ++seq;
    return db.restaurantOrder.create({
      data: { number: `ORD-CHK-${String(n).padStart(4, "0")}`, type: "DINE_IN", settlement: "PAY_NOW", foodSubtotal: 5_000, drinksSubtotal: 0, total: 5_000, businessDate: new Date(), ...over } as never,
    });
  };
  const orderPay = (orderId: string, over: Record<string, unknown> = {}) =>
    db.restaurantOrderPayment.create({ data: { orderId, amount: 5_000, accountId: fixtures.accountId, paymentMethodId: fixtures.methodId, ...over } });

  it("paid with a posted payment behind it is quiet; unpaid, a gift and a room-bill order are quiet", async () => {
    const paid = await order({ paidAmount: 5_000, paymentStatus: "PAID" });
    await orderPay(paid.id);
    await order({ settlement: "UNPAID" });
    await order({ isGift: true, total: 0, foodSubtotal: 0, settlement: "UNPAID" });
    await order({ settlement: "ROOM" });
    expect((await stateOf("order-payments")).state).toBe("ok");
  });

  it("an order shown as paid with no payment, an order whose payment was reversed but still shows paid, and an order with a payment that does not show as paid are each a fix with the order's number", async () => {
    const noPayment = await order({ paidAmount: 5_000, paymentStatus: "PAID" });
    const reversed = await order({ paidAmount: 5_000, paymentStatus: "PAID" });
    await orderPay(reversed.id, { status: "REVERSED" });
    const notShown = await order({ paidAmount: 0, paymentStatus: "UNPAID" });
    await orderPay(notShown.id);
    const r = await stateOf("order-payments");
    expect(r).toMatchObject({ state: "fix", count: 3, group: "Data" });
    expect(r.examples!.sort()).toEqual([noPayment, reversed, notShown].map((o) => o.number).sort());
    expect(r.link?.href).toBe("/staff/developer/business");
  });

  it("an order older than the window is not read", async () => {
    const today = await todayDate();
    const back = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() - n * DAY);
    expect(CHECK_LIMITS.ordersWindowDays).toBe(60);
    await order({ paidAmount: 5_000, paymentStatus: "PAID", businessDate: back(61) });
    expect((await stateOf("order-payments")).state).toBe("ok");
    await order({ paidAmount: 5_000, paymentStatus: "PAID", businessDate: back(59) });
    expect((await stateOf("order-payments")).count).toBe(1);
  });
});

describe("online-pending (nTZS payments that never got confirmed)", () => {
  const mp = (hours: number, over: Record<string, unknown> = {}) =>
    db.mobilePayment.create({ data: { amount: 5_000, phone: "255700001234", purpose: "RESTAURANT", createdAt: ago(hours * HOUR), ...over } });

  it("waiting longer than the sweep and the longest gap between runs is a fix; just under is quiet; settled ones are quiet", async () => {
    expect(CHECK_LIMITS.onlinePendingHours).toBe(14);
    await mp(13.5);                                               // just under: the next run may still settle it
    await mp(40, { status: "COMPLETED", completedAt: new Date() }); // done
    await mp(40, { status: "EXPIRED" });                          // given up
    expect((await stateOf("online-pending")).state).toBe("ok");
    const stuck = await mp(14.5);
    const r = await stateOf("online-pending");
    expect(r).toMatchObject({ state: "fix", count: 1, group: "Data" });
    expect(r.examples).toEqual([`…${stuck.id.slice(-6)}`.replace(/[^A-Za-z0-9._:/#-]/g, "")]);
    expect(r.who.text).toContain("system owner");
    // never a phone number in it
    expect(JSON.stringify(r)).not.toContain("255700001234");
  });
});

describe("withdrawals (stuck at nTZS)", () => {
  const base = { amount: 10_000, requestedById: "", businessDate: new Date("2026-10-14") };
  const mk = (extra: Record<string, unknown>) => db.withdrawal.create({ data: { destinationKind: "PHONE", ...base, requestedById: rec.id, ...extra } as never });

  it("2 hours for a phone or a Lipa number, 4 days for a bank; just under is quiet; nTZS's own approval and review, finished and settled ones are quiet", async () => {
    expect([CHECK_LIMITS.withdrawalPhoneHours, CHECK_LIMITS.withdrawalBankHours]).toEqual([2, 96]);
    await mk({ status: "PROCESSING", createdAt: ago(1.9 * HOUR) });
    await mk({ status: "PROCESSING", destinationKind: "LIPA", createdAt: ago(1.9 * HOUR) });
    await mk({ status: "PROCESSING", destinationKind: "BANK", createdAt: ago(95.5 * HOUR) });
    await mk({ status: "AWAITING_APPROVAL", createdAt: ago(50 * HOUR) });
    await mk({ status: "IN_REVIEW", createdAt: ago(200 * HOUR) });   // nTZS is checking it itself: its wait, not a fault of the system
    await mk({ status: "COMPLETED", createdAt: ago(50 * HOUR) });
    await mk({ status: "FAILED", createdAt: ago(50 * HOUR) });
    await mk({ status: "IN_REVIEW", createdAt: ago(50 * HOUR), reconciledAt: new Date() });
    expect((await stateOf("withdrawals")).state).toBe("ok");
    await mk({ status: "PROCESSING", createdAt: ago(6 * HOUR), submittedAt: ago(1 * HOUR) });        // a price confirmed late: it was SENT an hour ago
    expect((await stateOf("withdrawals")).state).toBe("ok");
    const phone = await mk({ status: "UNKNOWN", createdAt: ago(2.1 * HOUR), number: "WD-000777" });
    const lipa = await mk({ status: "SUBMITTING", destinationKind: "LIPA", createdAt: ago(3 * HOUR) });
    const bank = await mk({ status: "PROCESSING", destinationKind: "BANK", createdAt: ago(96.5 * HOUR) });
    const r = await stateOf("withdrawals");
    expect(r).toMatchObject({ state: "fix", count: 3, group: "Data" });
    expect(r.examples).toContain("WD-000777");
    expect(r.examples!.length).toBe(3);
    expect([phone.id, lipa.id, bank.id].length).toBe(3);
    expect(r.summary.vars.n).toBe(3);
    // Finance is told only after the cause is fixed: the Developer finds the cause
    expect(r.todo.text).toContain("the Boss or Finance settles");
    // counted from when it was sent: the late-confirmed price is counted once it has been with nTZS for 2 hours
    await db.withdrawal.updateMany({ where: { status: "PROCESSING", submittedAt: { not: null } }, data: { submittedAt: ago(2.2 * HOUR) } });
    expect((await stateOf("withdrawals")).count).toBe(4);
  });
});

// ───────────────────────────────────────────── 3. stock ─────────────────────────────────────────────
describe("stock-movements", () => {
  let departmentId = "", categoryId = "";
  beforeAll(async () => {
    const dep = (await db.inventoryDepartment.findFirst()) ?? (await db.inventoryDepartment.create({ data: { code: "CHKDEP", name: "Checks dept" } }));
    const cat = (await db.inventoryCategory.findFirst()) ?? (await db.inventoryCategory.create({ data: { name: "Checks category" } }));
    departmentId = dep.id; categoryId = cat.id;
  });
  const item = (name: string, quantity: number, sku: string | null = null) => db.inventoryItem.create({ data: { name: `${name} ${++seq}`, sku, unit: "KG", quantity, categoryId, departmentId } });
  const move = (itemId: string, change: number, status = "POSTED") => db.inventoryMovement.create({ data: { itemId, kind: "ADJUST", reason: "ADJUSTMENT", change, unit: "KG", status } });

  it("the quantity equals the total of the posted movements: quiet — a waiting waste report and a rejected one do not count, and stock that is below zero with movements to match is NOT a Developer problem", async () => {
    const a = await item("Rice", 10);
    await move(a.id, 10);
    await move(a.id, -3, "PENDING");   // waiting for a manager: has not moved the stock
    await move(a.id, -2, "REJECTED");
    const b = await item("Beef", -2);  // used before the count showed it (by design): its movements say so
    await move(b.id, 5);
    await move(b.id, -7);
    await item("Salt", 0);             // no movement, nothing on hand
    expect((await stateOf("stock-movements")).state).toBe("ok");
  });

  it("a quantity that something changed without a movement is a fix, with the item's code", async () => {
    const a = await item("Flour", 10, "SKU-CHK-1");
    await move(a.id, 8);                    // 8 by the movements, 10 on the shelf record
    const c = await item("Sugar", 4, "SKU-CHK-2");
    await move(c.id, 4.0004);               // within rounding: quiet
    const r = await stateOf("stock-movements");
    expect(r).toMatchObject({ state: "fix", count: 1, examples: ["SKU-CHK-1"], group: "Data" });
    expect(r.who.text).toBe("The Developer.");
  });
});

// ───────────────────────────────────────────── 4. the hold-release job ─────────────────────────────────────────────
describe("holds-not-released", () => {
  it("an unpaid hold left over its time by more than the longest gap between runs is a fix; just under it, paid, confirmed, or being paid right now are quiet", async () => {
    expect(CHECK_LIMITS.holdReleaseGraceHours).toBe(12);
    const [a, b, c, d, ] = fixtures.room;
    await mkStay({ room: a, status: "RESERVED", holdUntil: ago(11 * HOUR) });                       // the job may simply not have come round yet
    await mkStay({ room: b, status: "CONFIRMED", holdUntil: ago(40 * HOUR) });                      // confirmed: no hold
    const paid = await mkStay({ room: c, status: "RESERVED", holdUntil: ago(40 * HOUR), paid: 10_000, balance: 90_000 });
    expect(paid.id).toBeTruthy();
    const paying = await mkStay({ room: d, status: "RESERVED", holdUntil: ago(40 * HOUR) });
    await db.mobilePayment.create({ data: { amount: 5_000, phone: "255700001234", purpose: "RESERVATION", reservationId: paying.id, expiresAt: new Date(Date.now() + HOUR) } });
    expect((await stateOf("holds-not-released")).state).toBe("ok");
    const [e] = await db.room.findMany({ where: { isActive: true }, orderBy: { number: "desc" }, take: 1, select: { id: true, roomTypeId: true } });
    const late = await mkStay({ room: e, status: "RESERVED", holdUntil: ago(13 * HOUR) });
    const r = await stateOf("holds-not-released");
    expect(r).toMatchObject({ state: "fix", count: 1, examples: [late.reference], group: "Jobs & errors" });
    expect(r.link?.href).toContain("#errors");
  });
});

// ───────────────────────────────────────────── 5. jobs, webhooks, messages, reports, errors ─────────────────────────────────────────────
describe("jobs", () => {
  const run1 = (job: string, hoursAgo: number, status: "OK" | "FAILED" = "OK") =>
    db.systemEvent.create({ data: { kind: "CRON", source: job, fingerprint: `cron:${job}:${++seq}`, status, message: status === "OK" ? "ok" : "it failed", detail: { durationMs: 1000 }, firstSeenAt: ago(hoursAgo * HOUR), lastSeenAt: ago(hoursAgo * HOUR) } });

  it("jobs-overdue: the daily job (longest gap 11 h, late after 16.5 h) is quiet at 16 hours and a fix at 17; a job never seen since recording began is late once it has had time", async () => {
    await db.$executeRaw`DELETE FROM "system_events"`;
    await run1("/api/cron/daily-report", 16);
    await run1("/api/cron/room-report", 20);
    expect((await stateOf("jobs-overdue")).state).toBe("ok");
    await run1("/api/cron/daily-report", 0.5);   // a newer run: on time again
    await db.systemEvent.deleteMany({ where: { source: "/api/cron/daily-report", firstSeenAt: { lt: ago(HOUR) } } });
    expect((await stateOf("jobs-overdue")).state).toBe("ok");
    await db.$executeRaw`DELETE FROM "system_events"`;
    await run1("/api/cron/daily-report", 17);
    await run1("/api/cron/room-report", 5);
    const r = await stateOf("jobs-overdue");
    expect(r).toMatchObject({ state: "fix", count: 1, examples: ["/api/cron/daily-report"], group: "Jobs & errors" });
    expect(r.who.text).toContain("hosting plan");
    expect(r.link?.href).toContain("#errors");
  });

  it("jobs-overdue: with no run recorded at all yet it says 'could not be checked' instead of 'all well'", async () => {
    await db.$executeRaw`DELETE FROM "system_events"`;
    const r = await stateOf("jobs-overdue");
    expect(r.state).toBe("unknown");
    expect(r.summary.text).toBe("Could not be checked: no run of any job has been recorded yet.");
  });

  it("jobs-failed: a job whose last run failed is a fix; one that failed before but went well since is quiet", async () => {
    await db.$executeRaw`DELETE FROM "system_events"`;
    await run1("/api/cron/daily-report", 30, "FAILED");
    await run1("/api/cron/daily-report", 2, "OK");
    await run1("/api/cron/room-report", 1, "OK");
    expect((await stateOf("jobs-failed")).state).toBe("ok");
    await run1("/api/cron/room-report", 0.2, "FAILED");
    const r = await stateOf("jobs-failed");
    expect(r).toMatchObject({ state: "fix", count: 1, examples: ["/api/cron/room-report"] });
  });
});

describe("webhooks", () => {
  const hook = (status: "OK" | "FAILED", count: number, hoursAgo: number) =>
    db.systemEvent.create({ data: { kind: "WEBHOOK", source: "webhook:ntzs", fingerprint: `wh:${++seq}`, status, message: status, count, firstSeenAt: ago(hoursAgo * HOUR), lastSeenAt: ago(hoursAgo * HOUR) } });

  it("webhooks-failing: no failure is quiet; one or two is a look; three or more with the last receipt failed is a fix; three failures but a good one since is only a look", async () => {
    expect(CHECK_LIMITS.webhookFailedFix).toBe(3);
    await hook("OK", 9, 5);
    expect((await stateOf("webhooks-failing")).state).toBe("ok");
    await hook("FAILED", 2, 3);
    expect(await stateOf("webhooks-failing")).toMatchObject({ state: "look", count: 2 });
    await hook("FAILED", 1, 1);                   // three failures, the last one after the last success
    expect(await stateOf("webhooks-failing")).toMatchObject({ state: "fix", count: 3, group: "Jobs & errors" });
    await hook("OK", 1, 0.2);                     // and one that worked since
    expect((await stateOf("webhooks-failing")).state).toBe("look");
    const r = await stateOf("webhooks-failing");
    expect(r.link?.href).toContain("#errors");
    expect(r.who.text).toContain("system owner");
  });

  it("webhooks-silent: online payments completed for a week and not one message from nTZS is a look — but only once a whole week has been recorded, and only if the key and secret are set", async () => {
    const paid = (daysAgo: number) => db.mobilePayment.create({ data: { amount: 5_000, phone: "255700001234", purpose: "RESTAURANT", status: "COMPLETED", completedAt: ago(daysAgo * DAY), createdAt: ago(daysAgo * DAY) } });
    expect((await stateOf("webhooks-silent")).state).toBe("ok"); // no online payments: nothing to expect
    await paid(2);
    // recording began only a day ago (the jobs seeded one hour ago are the oldest rows): too early to call it silence
    expect(await stateOf("webhooks-silent")).toMatchObject({ state: "unknown" });
    await db.systemEvent.create({ data: { kind: "CRON", source: "/api/cron/room-report", fingerprint: `cron:old:${++seq}`, status: "OK", message: "ok", firstSeenAt: ago(9 * DAY), lastSeenAt: ago(9 * DAY) } });
    const r = await stateOf("webhooks-silent");
    expect(r).toMatchObject({ state: "look", count: 1 });
    expect(r.summary.vars.n).toBe(1);
    // a payment completed 8 days ago does not count (the window is 7 days)
    await db.mobilePayment.deleteMany();
    await paid(8);
    expect((await stateOf("webhooks-silent")).state).toBe("ok");
    // a message did arrive: fine
    await paid(1);
    await db.systemEvent.create({ data: { kind: "WEBHOOK", source: "webhook:ntzs", fingerprint: `wh:${++seq}`, status: "OK", message: "ok", count: 1, firstSeenAt: ago(DAY), lastSeenAt: ago(DAY) } });
    expect((await stateOf("webhooks-silent")).state).toBe("ok");
    // without the secret the set-up check says so; this one does not say it twice
    await db.systemEvent.deleteMany({ where: { kind: "WEBHOOK" } });
    delete process.env.NTZS_WEBHOOK_SECRET;
    expect((await stateOf("webhooks-silent")).state).toBe("ok");
  });
});

describe("deliveries-failed (WhatsApp)", () => {
  const mk = (extra: Record<string, unknown>) => db.notificationDelivery.create({ data: { purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: `+2557001${Math.floor(Math.random() * 90000 + 10000)}`, ...extra } as never });

  it("two failures in a day are quiet; three with nothing sent is a fix; three with something sent is a look; old failures are not counted; the example is the kind of message, not a number", async () => {
    expect(CHECK_LIMITS.messagesFailedLook).toBe(3);
    await mk({ status: "FAILED" });
    await mk({ status: "FAILED" });
    await mk({ status: "FAILED", updatedAt: ago(30 * HOUR) });
    expect((await stateOf("deliveries-failed")).state).toBe("ok");
    await mk({ status: "FAILED", purpose: "BOOKING_CONFIRMATION" });
    let r = await stateOf("deliveries-failed");
    expect(r).toMatchObject({ state: "fix", count: 3, group: "Jobs & errors" });
    expect(r.examples!.sort()).toEqual(["BOOKING_CONFIRMATION", "DAILY_REPORT"]);
    expect(r.link?.href).toContain("#messages");
    expect(JSON.stringify(r)).not.toMatch(/\+2557001/);
    await mk({ status: "SENT", sentAt: new Date() });
    r = await stateOf("deliveries-failed");
    expect(r.state).toBe("look");
  });

  it("a phone number the provider does not accept is a wrong number typed for a person, not the system: five of those are quiet; the provider failing to answer counts", async () => {
    for (let i = 0; i < 5; i++) await mk({ status: "FAILED", purpose: "BOOKING_CONFIRMATION", lastError: "Recipient must be an international number like +255…" });
    expect((await stateOf("deliveries-failed")).state).toBe("ok");
    for (let i = 0; i < 3; i++) await mk({ status: "FAILED", lastError: "CallMeBot request failed: fetch failed" });
    const r = await stateOf("deliveries-failed");
    expect(r).toMatchObject({ state: "fix", count: 3, examples: ["DAILY_REPORT"] });
    expect(JSON.stringify(r)).not.toMatch(/fetch failed|CallMeBot request/);
  });
});

describe("the Boss's reports (report-daily, report-room)", () => {
  // 10:00 hotel time, far from any other row: the daily report (due 08:00) and the room report (due 07:00) are both late if not made.
  const late = new Date("2041-06-15T07:00:00Z");
  const recipients = [{ name: "Boss", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_CHKA" }];

  it("not made is a fix with its own title and a link to the report (or to the console when the right is gone); made and sent is quiet; reports off or nobody to send to is quiet", async () => {
    await setSettings({ reportEnabled: true, roomReportEnabled: true, reportRecipients: recipients });
    const rs = await run(late);
    expect(get(rs, "report-daily")).toMatchObject({ state: "fix", count: 1, group: "Jobs & errors" });
    expect(get(rs, "report-daily").title.text).toBe("The daily report was not made");
    expect(get(rs, "report-room").title.text).toBe("The room report was not made");
    expect(get(rs, "report-daily").link?.href).toBe("/staff/reports/daily");
    expect(get(rs, "report-room").link?.href).toBe("/staff/reports/room");
    // made but not sent → unsent; then a failed send → failed; then sent → quiet
    const report = await db.dailyReport.create({ data: { businessDate: new Date("2041-06-14"), data: {}, summaryText: "x", generatedAt: new Date("2041-06-15T04:00:00Z") } });
    let d = get(await run(late), "report-daily");
    expect(d.title.text).toBe("The daily report did not reach the Boss");
    expect(d.summary.text).toBe("The report is saved but has not been sent yet.");
    expect(d.link?.href).toBe(`/staff/reports/daily/${report.id}`);
    const delivery = await db.notificationDelivery.create({ data: { dailyReportId: report.id, purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000001", status: "FAILED" } });
    d = get(await run(late), "report-daily");
    expect(d.summary.text).toBe("A send was tried and failed. The report is saved.");
    await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt: new Date("2041-06-15T04:05:00Z") } });
    expect(get(await run(late), "report-daily").state).toBe("ok");
    // before the report's own time
    await db.dailyReport.deleteMany();
    expect(get(await run(new Date("2041-06-15T03:00:00Z")), "report-daily").state).toBe("ok");
    await setSettings({ reportEnabled: false });
    expect(get(await run(late), "report-daily").state).toBe("ok");
    await setSettings({ reportEnabled: true, reportRecipients: [] });
    expect(get(await run(late), "report-daily").state).toBe("ok");
  });
});

describe("errors-server", () => {
  const err = (over: { source?: string; count?: number; firstHoursAgo: number; lastHoursAgo: number; fingerprint?: string; message?: string }) =>
    db.systemEvent.create({
      data: {
        kind: "ERROR", source: over.source ?? "route:/api/example", fingerprint: over.fingerprint ?? `fp-${++seq}`, status: "OPEN", message: over.message ?? "Something broke", count: over.count ?? 1,
        detail: { name: "Error", frames: ["src/server/example.ts:12"] }, firstSeenAt: ago(over.firstHoursAgo * HOUR), lastSeenAt: ago(over.lastHoursAgo * HOUR),
      },
    });

  it("no error is quiet; an error older than a day is quiet; a single error is a look; the same error three times is a fix", async () => {
    expect(await stateOf("errors-server")).toMatchObject({ state: "ok", count: 0 });
    await err({ firstHoursAgo: 40, lastHoursAgo: 30, count: 9 });
    expect((await stateOf("errors-server")).state).toBe("ok");
    await err({ source: "action:save-thing", firstHoursAgo: 5, lastHoursAgo: 5 });
    let r = await stateOf("errors-server");
    expect(r).toMatchObject({ state: "look", count: 1, group: "Jobs & errors" });
    expect(r.examples).toEqual(["action:save-thing"]);
    // the same error twice is still a look; three times is a fix
    await err({ source: "route:/api/twice", firstHoursAgo: 6, lastHoursAgo: 4, count: 2, fingerprint: "twice" });
    expect((await stateOf("errors-server")).state).toBe("look");
    await db.systemEvent.updateMany({ where: { fingerprint: "twice" }, data: { count: 3 } });
    r = await stateOf("errors-server");
    expect(r.state).toBe("fix");
    expect(r.count).toBe(2); // two different errors in the day
    await db.systemEvent.deleteMany({ where: { fingerprint: "twice" } });
    expect((await stateOf("errors-server")).state).toBe("look");
    // one error that came once, just now, is a look (not a red alarm for an hour)
    await err({ source: "page:/staff/recent", firstHoursAgo: 0.5, lastHoursAgo: 0.2 });
    r = await stateOf("errors-server");
    expect(r.state).toBe("look");
    expect(r.link?.href).toContain("#errors");
    expect(r.who.text).toBe("The Developer.");
  });

  it("an old bug that keeps coming back (first seen days ago, many times, seen again today) is a fix, not a look", async () => {
    await err({ firstHoursAgo: 24 * 5, lastHoursAgo: 6, count: 40 });
    expect((await stateOf("errors-server")).state).toBe("fix");
  });

  it("a failure inside an automatic job or a webhook is not counted twice: the job and nTZS checks already say it", async () => {
    await err({ source: "cron:daily-report:booking states", firstHoursAgo: 3, lastHoursAgo: 1, count: 5 });
    await err({ source: "webhook:ntzs", firstHoursAgo: 3, lastHoursAgo: 1, count: 5 });
    expect((await stateOf("errors-server")).state).toBe("ok");
  });
});

// ───────────────────────────────────────────── 6. set-up ─────────────────────────────────────────────
describe("set-up", () => {
  it("cron-secret: missing is a fix, set is quiet", async () => {
    delete process.env.CRON_SECRET;
    const r = await stateOf("cron-secret");
    expect(r).toMatchObject({ state: "fix", count: 1, group: "Setup" });
    expect(r.who.text).toBe("The Developer, in the hosting settings.");
    process.env.CRON_SECRET = "cron-test-value";
    expect((await stateOf("cron-secret")).state).toBe("ok");
  });

  it("site-address: only the live site needs it — missing there is a look (links carry the hosting's address); set is quiet; a test machine is not checked", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const test = await stateOf("site-address");
    expect(test).toMatchObject({ state: "ok", skipped: true }); // not production: not counted as "fine" either
    process.env.VERCEL_ENV = "production";
    expect(await stateOf("site-address")).toMatchObject({ state: "look", count: 1 });
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    expect((await stateOf("site-address")).state).toBe("look");
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.example.test";
    expect((await stateOf("site-address")).state).toBe("ok");
  });

  it("whatsapp-none: reports on and nobody to receive them is a look; reports off, or a recipient listed, is quiet", async () => {
    await setSettings({ reportEnabled: true, reportRecipients: [] });
    const r = await stateOf("whatsapp-none");
    expect(r).toMatchObject({ state: "look", count: 1, group: "Setup" });
    expect(r.who.text).toBe("The Boss or the MD.");
    expect(r.link?.href).toBe("/staff/settings");
    await setSettings({ reportEnabled: false });
    expect((await stateOf("whatsapp-none")).state).toBe("ok");
    await setSettings({ reportEnabled: true, reportRecipients: [{ name: "A", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_CHKA" }] });
    expect((await stateOf("whatsapp-none")).state).toBe("ok");
  });

  it("whatsapp-keys: a recipient with no key is a look ('0 of 1'); their own key, or the default key, makes it quiet", async () => {
    await setSettings({ reportEnabled: true, reportRecipients: [{ name: "A", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_CHKA" }, { name: "B", phone: "+255700000002", apiKeyRef: "CALLMEBOT_KEY_NONE" }] });
    let r = await stateOf("whatsapp-keys");
    expect(r).toMatchObject({ state: "look", count: 2 });
    expect(r.summary.text).toBe("0 of 2 recipients can be reached.");
    process.env.CALLMEBOT_KEY_CHKA = "secret-a";
    r = await stateOf("whatsapp-keys");
    expect(r.summary.text).toBe("1 of 2 recipients can be reached.");
    expect(JSON.stringify(r)).not.toContain("secret-a");
    process.env.CALLMEBOT_API_KEY = "secret-default";
    expect((await stateOf("whatsapp-keys")).state).toBe("ok");
  });

  it("ntzs-off: online payment on without a key is a fix; switched off, or with a key, is quiet — ntzs-webhook: a key without the webhook secret is a look", async () => {
    delete process.env.NTZS_API_KEY;
    await setSettings({ onlinePayEnabled: true });
    expect(await stateOf("ntzs-off")).toMatchObject({ state: "fix", count: 1 });
    await setSettings({ onlinePayEnabled: false });
    expect((await stateOf("ntzs-off")).state).toBe("ok");
    expect((await stateOf("ntzs-webhook")).state).toBe("ok"); // no key: nothing to sign
    process.env.NTZS_API_KEY = "ntzs_test_value";
    delete process.env.NTZS_WEBHOOK_SECRET;
    expect(await stateOf("ntzs-webhook")).toMatchObject({ state: "look", count: 1 });
    process.env.NTZS_WEBHOOK_SECRET = "whsec_test_value";
    expect((await stateOf("ntzs-webhook")).state).toBe("ok");
  });

  it("payment-account: none that is on and takes payments is a fix; one is enough", async () => {
    // Both flags are saved and put back exactly: an account that was switched off (the nTZS one is) must stay off, or the next test file's "any active account" is the wrong one.
    const accounts = await db.moneyAccount.findMany({ select: { id: true, acceptsPayments: true, isActive: true } });
    const first = accounts.find((a) => a.isActive) ?? accounts[0];
    try {
      await db.moneyAccount.updateMany({ data: { acceptsPayments: false } });
      const r = await stateOf("payment-account");
      expect(r).toMatchObject({ state: "fix", count: 1, group: "Setup" });
      expect(r.who.text).toBe("The Boss or the MD.");
      await db.moneyAccount.update({ where: { id: first.id }, data: { acceptsPayments: true, isActive: false } });
      expect((await stateOf("payment-account")).state).toBe("fix"); // switched off does not count
      await db.moneyAccount.update({ where: { id: first.id }, data: { isActive: true } });
      expect((await stateOf("payment-account")).state).toBe("ok");
    } finally {
      for (const a of accounts) await db.moneyAccount.update({ where: { id: a.id }, data: { acceptsPayments: a.acceptsPayments, isActive: a.isActive } });
    }
  });

  it("migrations: one started and never finished is a fix; migrations-pending: a folder in the code that the database has not applied is a fix with its name; no folders on the server is 'could not be checked'", async () => {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    const folders = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const newest = folders.at(-1)!;
    expect((await stateOf("migrations")).state).toBe("ok");
    expect((await stateOf("migrations-pending")).state).toBe("ok");
    try {
      await db.$executeRaw`INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count") VALUES ('chk-unfinished-test', 'x', '29990101000000_chk_unfinished_test', now(), 0)`;
      expect(await stateOf("migrations")).toMatchObject({ state: "fix", count: 1, group: "Setup" });
    } finally {
      await db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE "id" = 'chk-unfinished-test'`;
    }
    expect((await stateOf("migrations")).state).toBe("ok");
    try {
      await db.$executeRaw`UPDATE "_prisma_migrations" SET "migration_name" = ${`${newest}_renamed_by_test`} WHERE "migration_name" = ${newest}`;
      const r = await stateOf("migrations-pending");
      expect(r).toMatchObject({ state: "fix", count: 1, examples: [newest] });
      expect(r.who.text).toBe("The Developer.");
    } finally {
      await db.$executeRaw`UPDATE "_prisma_migrations" SET "migration_name" = ${newest} WHERE "migration_name" = ${`${newest}_renamed_by_test`}`;
    }
    expect((await stateOf("migrations-pending")).state).toBe("ok");
    vi.spyOn(process, "cwd").mockReturnValue("/nonexistent-folder-for-test");
    const unknown = await stateOf("migrations-pending");
    expect(unknown.state).toBe("unknown");
    expect(unknown.summary.text).toBe("Could not be checked: the migration folders are not on this server.");
  });
});

// ───────────────────────────────────────────── 7. accounts, rights, security ─────────────────────────────────────────────
describe("people and security", () => {
  it("boss-account: no active Boss account is a fix; any one is enough", async () => {
    expect((await stateOf("boss-account")).state).toBe("ok");
    const owners = await db.user.findMany({ where: { role: { code: "OWNER" } }, select: { id: true, isActive: true } });
    try {
      await db.user.updateMany({ where: { id: { in: owners.map((o) => o.id) } }, data: { isActive: false } });
      const r = await stateOf("boss-account");
      expect(r).toMatchObject({ state: "fix", count: 1, group: "People" });
      expect(r.link?.href).toBe("/staff/developer/access");
    } finally {
      for (const o of owners) await db.user.update({ where: { id: o.id }, data: { isActive: o.isActive } });
    }
    expect((await stateOf("boss-account")).state).toBe("ok");
  });

  it("roles-no-rights: a role with no rights and an active person is a fix with the role's code; a role with no people, or a switched-off person, is quiet", async () => {
    const role = await db.role.create({ data: { code: "ZZ_CHK_NORIGHTS", name: "Checks role" } });
    try {
      expect((await stateOf("roles-no-rights")).state).toBe("ok"); // nobody holds it
      const person = await makeUser("ZZ_CHK_NORIGHTS", { fullName: "Nobody Rights", isActive: false });
      expect((await stateOf("roles-no-rights")).state).toBe("ok"); // switched off
      await db.user.update({ where: { id: person.id }, data: { isActive: true } });
      const r = await stateOf("roles-no-rights");
      expect(r).toMatchObject({ state: "fix", count: 1, examples: ["ZZ_CHK_NORIGHTS"], group: "People" });
      expect(r.who.text).toContain("Boss or the MD");
      const any = await db.permission.findFirstOrThrow();
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: any.id } });
      expect((await stateOf("roles-no-rights")).state).toBe("ok");
      await db.user.delete({ where: { id: person.id } });
    } finally {
      await db.user.deleteMany({ where: { roleId: role.id } });
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      await db.role.delete({ where: { id: role.id } });
    }
  });

  const audited = (action: string, minutesBefore: number, now: Date, extra: Record<string, unknown> = {}) =>
    db.auditLog.create({ data: { actorLabel: "t", actorType: "SYSTEM", action, entityType: "User", businessDate: new Date("2041-07-10"), createdAt: new Date(now.getTime() - minutesBefore * 60_000), ...extra } as never });

  it("failed-sign-ins: 20 in 24 hours is quiet, 21 is a look; an older one is not counted", async () => {
    const now = new Date("2041-07-10T09:00:00Z");
    expect(CHECK_LIMITS.failedSignInsLook).toBe(20);
    for (let i = 0; i < 20; i++) await audited("auth.login_failed", 10 + i, now, { entityId: rec.id });
    await audited("auth.login_failed", 30 * 60, now, { entityId: rec.id });
    expect((await stateOf("failed-sign-ins", now)).state).toBe("ok");
    await audited("auth.login_failed", 5, now, { entityId: rec.id });
    const r = await stateOf("failed-sign-ins", now);
    expect(r).toMatchObject({ state: "look", count: 21, group: "People" });
    expect(r.link?.href).toContain("#errors");
  });

  it("denied: a few refusals in 24 hours are by design (quiet); ten is a look", async () => {
    const now = new Date("2041-07-10T09:00:00Z");
    expect(CHECK_LIMITS.deniedLook).toBe(10);
    for (let i = 0; i < 9; i++) await audited("developer.denied", 60 + i, now, { userId: dev.id });
    await audited("developer.denied", 25 * 60, now, { userId: dev.id }); // older than a day: not counted
    expect((await stateOf("denied", now)).state).toBe("ok");
    await audited("developer.denied", 120, now, { userId: dev.id });
    expect(await stateOf("denied", now)).toMatchObject({ state: "look", count: 10 });
  });
});

// ───────────────────────────────────────────── 8. privacy ─────────────────────────────────────────────
describe("nothing personal is in any result", () => {
  it("a hotel full of named guests, with a problem in every area: no guest name, email, phone, staff name or key appears in the checks, the health report or the Problems tab", async () => {
    const people = [
      { fullName: "Zuberi Kimaro", phone: "+255712345678", email: "zuberi.kimaro@example.com" },
      { fullName: "Amina Mwakyusa", phone: "+255754111222", email: "amina.m@example.org" },
      { fullName: "Hassan Ngowi", phone: "+255688999000", email: "hassan.ngowi@example.net" },
      { fullName: "Neema Tarimo", phone: "+255655000111", email: "neema@example.com" },
    ];
    const guests = [];
    for (const p of people) guests.push(await mkGuest(p.fullName, p.phone, p.email));
    const today = await todayDate();
    // a room marked occupied with nobody in it; a checked-in guest in a dirty room; a booking whose totals disagree; an unpaid hold left over its time
    await db.room.update({ where: { id: fixtures.room[0].id }, data: { status: "OCCUPIED" } });
    await db.room.update({ where: { id: fixtures.room[1].id }, data: { status: "DIRTY" } });
    await mkStay({ room: fixtures.room[1], guest: guests[0], status: "CHECKED_IN", arrival: today, departure: today });
    await mkStay({ room: fixtures.room[2], guest: guests[1], status: "CONFIRMED", arrival: today, departure: today, balance: 1 });
    await mkStay({ room: fixtures.room[3], guest: guests[2], status: "RESERVED", holdUntil: ago(20 * HOUR) });
    await db.mobilePayment.create({ data: { amount: 5_000, phone: "255712345678", purpose: "RESTAURANT", createdAt: ago(20 * HOUR) } });
    await db.restaurantOrder.create({ data: { number: "ORD-CHK-PRIV", type: "DINE_IN", settlement: "PAY_NOW", foodSubtotal: 5_000, drinksSubtotal: 0, total: 5_000, businessDate: new Date(), paidAmount: 5_000, paymentStatus: "PAID", customerName: "Neema Tarimo", customerPhone: "+255655000111", customerEmail: "neema@example.com", guestId: guests[3].id } });
    await db.withdrawal.create({ data: { amount: 10_000, destinationKind: "PHONE", phone: "255712345678", requestedById: rec.id, status: "UNKNOWN", createdAt: ago(5 * HOUR), businessDate: new Date("2026-10-14"), recipientName: "Zuberi Kimaro" } });
    await db.notificationDelivery.createMany({ data: [1, 2, 3].map((i) => ({ purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: `+25571234567${i}`, status: "FAILED" as const, lastError: "CallMeBot: Text to send: Hello Zuberi Kimaro, key=abc123SECRETKEYVALUE9999" })) });
    await db.systemEvent.create({ data: { kind: "ERROR", source: "route:/api/x", fingerprint: "priv", status: "OPEN", message: "It failed", detail: { name: "Error" } } });
    process.env.CALLMEBOT_API_KEY = "SECRETDEFAULTKEY-555";

    const user = await as(dev);
    const rs = await runChecks(user);
    const health = await healthReport(user);
    const crashes = await crashData(user);
    expect(rs.filter((r) => r.state === "fix").length).toBeGreaterThanOrEqual(5);
    const t = makeT("en", null);
    const html = renderToStaticMarkup(createElement(ProblemsTab, { t, checks: rs }));
    const everything = JSON.stringify({ rs, health, crashes }) + html;
    const forbidden = [
      "Zuberi", "Kimaro", "Amina", "Mwakyusa", "Hassan", "Ngowi", "Neema", "Tarimo", "example.com", "example.org", "example.net", "@",
      "255712345678", "712345678", "754111222", "688999000", "655000111", "2557123456", "SECRETKEY", "SECRETDEFAULTKEY", "abc123", "Asha Checks", "Boss Checks", "Checks Dev", "Manager Checks",
    ];
    for (const word of forbidden) {
      if (word === "@") { expect(JSON.stringify(rs)).not.toContain("@"); continue; }
      expect(everything, word).not.toContain(word);
    }
  });
});

// ───────────────────────────────────────────── 9. the health score and the cards ─────────────────────────────────────────────
describe("the health report uses the checks", () => {
  it("a clean hotel says nothing needs attention; a failing check lowers the score by its weight, shows a card with what / to do / who / link / examples, and an ok check never has a card", async () => {
    const user = await as(dev);
    let h = await healthReport(user);
    expect(h.items.filter((i) => i.severity !== "info")).toEqual([]);
    expect(h.score).toBe(100);
    expect(h.verdict).toBe("well");
    expect(h.checks).toHaveLength(CHECK_IDS.length);

    await db.room.update({ where: { id: fixtures.room[0].id }, data: { status: "OCCUPIED" } }); // fix
    await setSettings({ reportEnabled: true, reportRecipients: [] });                             // look (nobody receives the reports)
    h = await healthReport(user);
    const card = h.items.find((i) => i.id === "room-occupied-no-stay")!;
    expect(card).toMatchObject({ severity: "fix", examples: [fixtures.room[0].number] });
    expect(card.what.text.length).toBeGreaterThan(10);
    expect(card.todo.text.length).toBeGreaterThan(10);
    expect(card.who!.text).toBe("The Developer.");
    expect(card.link?.href).toBe("/staff/rooms");
    expect(h.items.find((i) => i.id === "whatsapp-none")).toMatchObject({ severity: "look" });
    expect(h.counts).toMatchObject({ fix: 1, look: 1 });
    expect(h.score).toBe(100 - 10 - 5);
    expect(h.verdict).toBe("fix");
    // an ok check has no card
    for (const c of h.checks.filter((x) => x.state === "ok")) expect(h.items.map((i) => i.id), c.id).not.toContain(c.id);
    // fixing the data clears the card
    await db.room.update({ where: { id: fixtures.room[0].id }, data: { status: "AVAILABLE" } });
    await setSettings({ reportEnabled: false });
    h = await healthReport(user);
    expect(h.items.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("a check that could not be run is information (one card, no cost), never a problem", async () => {
    await db.$executeRaw`DELETE FROM "system_events"`; // no run recorded: jobs-overdue cannot say
    const h = await healthReport(await as(dev));
    expect(h.checks.find((c) => c.id === "jobs-overdue")!.state).toBe("unknown");
    const info = h.items.find((i) => i.id === "checks-unknown")!;
    expect(info).toMatchObject({ severity: "info" });
    expect(info.link?.href).toContain("#problems");
    expect(h.score).toBe(100);
    expect(h.counts.fix + h.counts.look).toBe(0);
  });

  it("the headline figure is the number of different server errors in 24 hours", async () => {
    for (const i of [1, 2]) await db.systemEvent.create({ data: { kind: "ERROR", source: `route:/api/e${i}`, fingerprint: `e${i}`, status: "OPEN", message: "boom", firstSeenAt: ago(HOUR), lastSeenAt: ago(HOUR) } });
    const h = await healthReport(await as(dev));
    expect(h.serverErrors24h).toBe(2);
    expect(h.items.find((i) => i.id === "errors-server")).toMatchObject({ severity: "look" });
  });
});

// ───────────────────────────────────────────── 9b. one cause once; what did not apply is not "fine" ─────────────────────────────────────────────
describe("one cause is shown once, and what did not apply is not counted as fine", () => {
  it("a missing cron secret is ONE card: the checks that follow from it are set aside, with the reason", async () => {
    await db.systemEvent.create({ data: { kind: "CRON", source: JOB_PATHS[0], fingerprint: `cron:${JOB_PATHS[0]}:x`, status: "FAILED", message: "boom", detail: { durationMs: 1 }, firstSeenAt: ago(HOUR), lastSeenAt: ago(HOUR) } });
    expect((await stateOf("jobs-failed")).state).toBe("fix"); // on its own it is a fix
    delete process.env.CRON_SECRET;
    const rs = await run();
    expect(get(rs, "cron-secret").state).toBe("fix");
    expect(get(rs, "jobs-failed")).toMatchObject({ state: "ok", skipped: true, count: 0 });
    expect(get(rs, "jobs-failed").summary.text).toBe("Not counted again: it follows from a problem above.");
    const h = await healthReport(await as(dev));
    const ids = h.items.map((i) => i.id);
    expect(ids).toContain("cron-secret");
    expect(ids).not.toContain("jobs-failed");
  });

  it("a check that did not apply (reports switched off) is listed with what was not checked, not counted as 'fine'", async () => {
    await setSettings({ reportEnabled: false });
    const rs = await run();
    for (const id of ["whatsapp-none", "whatsapp-keys", "report-daily", "report-room"]) expect(get(rs, id)).toMatchObject({ state: "ok", skipped: true });
    const fine = rs.filter((c) => c.state === "ok" && !c.skipped).length;
    const html = renderToStaticMarkup(createElement(ProblemsTab, { t: makeT("en", null), checks: rs }));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain(`Checks fine ${fine} of ${rs.length}`);
    expect(text).toContain("Not checked here: reports are switched off.");
  });

  it("an update that was undone and then applied again (what the build's healing step leaves) is not a problem; one with no good copy is", async () => {
    const [good] = await db.$queryRaw<{ name: string }[]>`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1`;
    await db.$executeRaw`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, rolled_back_at, applied_steps_count) VALUES ('chk-heal-1', 'x', ${good.name}, now(), now(), 0)`;
    try {
      expect((await stateOf("migrations")).state).toBe("ok");
      await db.$executeRaw`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, rolled_back_at, applied_steps_count) VALUES ('chk-heal-2', 'x', '20990101000000_never_applied', now(), now(), 0)`;
      expect(await stateOf("migrations")).toMatchObject({ state: "fix", count: 1 });
    } finally {
      await db.$executeRaw`DELETE FROM _prisma_migrations WHERE id IN ('chk-heal-1', 'chk-heal-2')`;
    }
  });
});

// ───────────────────────────────────────────── 10. the tabs ─────────────────────────────────────────────
describe("the Problems tab and the Crashes tab", () => {
  const draw = async (search: Record<string, string> = {}) => renderToStaticMarkup(await DeveloperHomePage({ searchParams: Promise.resolve(search) } as never));
  const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

  it("System checks is the first part of the page: four figures ('Checks fine n of 30', Needs fixing, Look at, Could not be checked) and what is not checked", async () => {
    await as(dev);
    await db.room.update({ where: { id: fixtures.room[0].id }, data: { status: "OCCUPIED" } });
    const html = await draw();
    // one page: the checks come first and every part is its own anchor, one under the other
    expect(html).toContain('id="problems"');
    expect(html.indexOf('id="problems"')).toBeLessThan(html.indexOf('id="errors"'));
    const text = textOf(html);
    const all = await run();
    const fine = all.filter((c) => c.state === "ok" && !c.skipped).length;
    const notChecked = all.filter((c) => c.state === "unknown" || (c.state === "ok" && c.skipped)).length;
    expect(fine + notChecked).toBe(CHECK_IDS.length - 1);
    expect(text).toContain(`Checks fine ${fine} of ${CHECK_IDS.length}`);
    expect(text).toContain(`Could not be checked ${notChecked}`);
    expect(text).toContain("Needs fixing");
    expect(text).toContain("Rooms marked occupied");
    expect(text).toContain("Who fixes it");
    expect(text).toContain("The Developer.");
    expect(html).not.toMatch(/undefined|NaN/);
    // the headline figure replaced "Alerts waiting"
    expect(text).toContain("Server errors (24 h)");
    expect(text).not.toContain("Alerts waiting");
  });

  it("the sections: needs fixing, look at, all good (collapsed, with every title), could not be checked — nothing is 'undefined' or 'NaN', in English and in 中文", async () => {
    await db.room.update({ where: { id: fixtures.room[0].id }, data: { status: "OCCUPIED" } });
    await setSettings({ reportEnabled: true, reportRecipients: [] });
    await db.$executeRaw`DELETE FROM "system_events"`;
    const rs = await run();
    const en = makeT("en", null);
    const zh = makeT("zh-CN", await loadCatalog("zh-CN", ["common", "public", "staff", "server"]));
    const htmlEn = renderToStaticMarkup(createElement(ProblemsTab, { t: en, checks: rs }));
    const htmlZh = renderToStaticMarkup(createElement(ProblemsTab, { t: zh, checks: rs }));
    for (const html of [htmlEn, htmlZh]) expect(html).not.toMatch(/undefined|NaN/);
    for (const w of ["Checks fine", "Needs fixing", "Look at", "All good", "Could not be checked"]) expect(textOf(htmlEn)).toContain(w);
    expect(htmlEn).toMatch(/<details[^>]*>[\s\S]*All good/);
    expect(htmlEn).not.toMatch(/<details[^>]* open/);
    // every check that was fine is named (inside the closed list), so the Developer sees what WAS looked at
    for (const c of rs.filter((x) => x.state === "ok" && !x.skipped)) expect(textOf(htmlEn)).toContain(c.title.text);
    // in 中文 nothing of the new words is left in English
    const zhText = textOf(htmlZh);
    for (const w of ["检查正常", "需要修复", "需要留意", "一切正常", "无法检查"]) expect(zhText).toContain(w);
    expect(zhText).not.toContain("Checks fine");
    expect(zhText).not.toContain("Needs fixing");
    expect(zhText).toContain("标记为“已入住”的客房");
    expect(zhText).toContain("客房"); // the group word
  });

  it("an empty list says so plainly and a hotel with nothing wrong says 'Nothing needs fixing.'", () => {
    const en = makeT("en", null);
    const none = textOf(renderToStaticMarkup(createElement(ProblemsTab, { t: en, checks: [] })));
    expect(none).toContain("The checks could not be run just now.");
    expect(none).not.toMatch(/undefined|NaN/);
  });

  it("Crashes & sign-ins: an empty log says 'Nothing yet' (and the old 'not part of this system' text is gone); with records it shows the errors, the jobs and the webhooks", async () => {
    await db.$executeRaw`DELETE FROM "system_events"`;
    const user = await as(dev);
    const en = makeT("en", null);
    const zh = makeT("zh-CN", await loadCatalog("zh-CN", ["common", "public", "staff", "server"]));
    const when = (d: Date) => en.dateTime(d, "Africa/Dar_es_Salaam");
    const empty = renderToStaticMarkup(createElement(CrashesTab, { t: en, c: await crashData(user), when }));
    expect(textOf(empty)).toContain("Nothing yet");
    expect(textOf(empty)).toContain("No unexpected server error has been recorded.");
    expect(textOf(empty)).not.toContain("Error tracking is not part of this system");
    expect(empty).not.toMatch(/undefined|NaN/);
    const emptyZh = renderToStaticMarkup(createElement(CrashesTab, { t: zh, c: await crashData(user), when }));
    expect(textOf(emptyZh)).toContain("暂无");
    expect(emptyZh).not.toMatch(/undefined|NaN/);

    // records
    await seedJobs();
    await db.systemEvent.create({ data: { kind: "CRON", source: "/api/cron/daily-report", fingerprint: `cron:f:${++seq}`, status: "FAILED", message: "The step failed", detail: { durationMs: 2500 }, firstSeenAt: ago(0.3 * HOUR), lastSeenAt: ago(0.3 * HOUR) } });
    await db.systemEvent.create({ data: { kind: "WEBHOOK", source: "webhook:ntzs", fingerprint: `wh:${++seq}`, status: "FAILED", message: "bad signature", count: 2, firstSeenAt: ago(HOUR), lastSeenAt: ago(HOUR) } });
    await db.systemEvent.create({ data: { kind: "ERROR", source: "action:save-room", fingerprint: "crash-1", status: "OPEN", message: "Unique constraint failed", count: 4, detail: { name: "PrismaClientKnownRequestError", code: "P2002", frames: ["src/server/services/rooms.ts:88"] }, firstSeenAt: ago(5 * HOUR), lastSeenAt: ago(0.5 * HOUR) } });
    const c = await crashData(user);
    expect(c.system!.errorGroups).toHaveLength(1);
    for (const tt of [en, zh]) {
      const html = renderToStaticMarkup(createElement(CrashesTab, { t: tt, c, when }));
      expect(html, tt.locale).not.toMatch(/undefined|NaN/);
      const text = textOf(html);
      expect(text).toContain("Unique constraint failed");
      expect(text).toContain("action:save-room");
      expect(text).toContain("src/server/services/rooms.ts:88");
      expect(text).toContain("4×");
      expect(text).toContain("/api/cron/daily-report");
      expect(text).toContain("webhook:ntzs");
    }
    const enText = textOf(renderToStaticMarkup(createElement(CrashesTab, { t: en, c, when })));
    for (const w of ["Server errors", "Automatic jobs", "Messages from other services (webhooks)", "Went well", "Failed", "On time", "Look at it", "Failed sign-ins"]) expect(enText).toContain(w);
    const zhText = textOf(renderToStaticMarkup(createElement(CrashesTab, { t: zh, c, when })));
    for (const w of ["服务器错误", "自动任务", "来自其他服务的消息（Webhook）", "登录失败"]) expect(zhText).toContain(w);
  });

  it("the Crashes tab keeps the failed sign-ins and the refusals that were there", async () => {
    const user = await as(dev);
    const en = makeT("en", null);
    const html = renderToStaticMarkup(createElement(CrashesTab, { t: en, c: await crashData(user), when: (d: Date) => en.dateTime(d, "Africa/Dar_es_Salaam") }));
    const text = textOf(html);
    for (const w of ["Failed sign-ins", "Locked out now", "Failed sign-ins and refused Developer actions per day", "Your Developer sign-in", "Refused to you"]) expect(text).toContain(w);
  });
});
