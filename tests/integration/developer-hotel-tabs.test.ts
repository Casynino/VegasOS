import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => { void Promise.resolve().then(fn); },
}));

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { checkIn, checkOut, createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { CONSOLE_TABS, parseTab, systemDiagnostics } from "@/server/services/developer-console";
import { hotelData, HOTEL_ROWS } from "@/server/services/developer-hotel";
import { moneyData, MONEY_ROWS, METHOD_GROUPS } from "@/server/services/developer-money";
import { cronHotelTime, messagesData, MESSAGE_ROWS } from "@/server/services/developer-messages";
import { speedData } from "@/server/services/developer-health";
import * as reporting from "@/server/services/reporting";
import { dailyMoney, expenseSummary, guestMovement, occupancy } from "@/server/services/reporting";
import { accountBalances } from "@/server/services/finance";
import { receivablesAging } from "@/server/services/finance-outlook";
import { inHouseBalances } from "@/server/services/guest-balances";
import { getArrivalsSummary, getFrontDeskSnapshot } from "@/server/services/front-desk";
import { reportTroubles } from "@/server/services/report-health";
import { MAX_ATTEMPTS } from "@/server/services/report-delivery";
import { newRequestCount, requestStats } from "@/server/services/booking-requests";
import { onlinePaymentTotals } from "@/server/services/online-payments-admin";
import { BUSINESS_VIEW_ACTION, noteBusinessView } from "@/server/services/developer-business";
import { BarChart } from "@/app/staff/(app)/developer/console-charts";
import { formatTZS } from "@/lib/format";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { getSettings } from "@/server/settings";
import { reportTrouble } from "@/lib/report-trouble";
import DeveloperHomePage from "@/app/staff/(app)/developer/page";
import { HotelTab } from "@/app/staff/(app)/developer/tab-hotel";
import { MoneyTab } from "@/app/staff/(app)/developer/tab-money";
import { MessagesTab } from "@/app/staff/(app)/developer/tab-messages";
import { makeT } from "@/i18n/translate";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, resolveAsync, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE THREE NEW TABS of the Developer home — Hotel, Money, Messages & reports (owner, 2026-10-18), and the "New records per day" chart,
 * against a real database. They are read-only and Developer-only; every figure that the Boss's reports have is the same number as the
 * shared service gives; days are the hotel's (04:00 → 04:00); nothing secret or personal beyond a masked phone and a name is read.
 * Time is passed in (`now`), a far-away year keeps these rows apart from every other test file's.
 */

const NOW = eat("2041-03-10T12:00:00");
const TODAY = "2041-03-10";
const t = makeT("en", null);
const when = (d: Date) => t.dateTime(d, "Africa/Dar_es_Salaam");

let dev: MadeUser, rec: MadeUser, boss: MadeUser, md: MadeUser, mgr: MadeUser, fin: MadeUser;

async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id);
  return (await getCurrentUser()) as CurrentUser;
}

let savedSettings: Record<string, unknown> = {};
const SETTING_KEYS = ["unpaidHoldHours", "reportEnabled", "roomReportEnabled", "reportRecipients", "liveSince"] as const;
const setSettings = (data: Record<string, unknown>) => db.hotelSettings.update({ where: { id: 1 }, data: data as never });

/** Take away every row the earlier test files and this one left in the tables these tabs read. */
async function wipe() {
  await resetBusinessData();
  await db.$executeRawUnsafe(`TRUNCATE "room_reports", "service_requests", "booking_requests", "payment_corrections", "restaurant_order_items", "revenue_transactions" CASCADE`);
  await db.notificationDelivery.deleteMany();
  await db.guestMessage.deleteMany();
}

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Tabs Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Tabs (Reception)" });
  boss = await makeUser("OWNER", { fullName: "Boss Tabs" });
  md = await makeUser("ADMIN", { fullName: "MD Tabs" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Tabs" });
  fin = await makeUser("FINANCE", { fullName: "Finance Tabs" });
  const s = await getSettings();
  savedSettings = Object.fromEntries(SETTING_KEYS.map((k) => [k, (s as unknown as Record<string, unknown>)[k]]));
});
afterAll(async () => {
  browser.reset();
  vi.useRealTimers();
  await setSettings(savedSettings).catch(() => undefined);
  await wipe().catch(() => undefined);
  await db.bookingQrCode.deleteMany({ where: { label: "Tabs test QR" } }).catch(() => undefined);
  await removeMadeUsers();
});

// ───────────────────────────────────────────── 1. only the Developer ─────────────────────────────────────────────
describe("the door: the Developer account only", () => {
  it("the tab list has Problems first and the three tabs after Activity, in this order, and ?tab= finds each", () => {
    expect([...CONSOLE_TABS]).toEqual(["problems", "activity", "hotel", "money", "messages", "speed", "crashes", "settings", "people"]);
    for (const tab of ["problems", "hotel", "money", "messages"]) expect(parseTab(tab)).toBe(tab);
    expect(parseTab("Hotel")).toBe("problems");
  });

  it.each([["receptionist", () => rec], ["Boss", () => boss], ["MD", () => md], ["manager", () => mgr], ["Finance", () => fin]])("the %s is refused by every new function", async (_n, who) => {
    const user = await as(who());
    for (const call of [() => hotelData(user, NOW), () => moneyData(user, NOW), () => messagesData(user, NOW), () => speedData(user, NOW)]) {
      const e = await thrownBy(call);
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("a Developer working as someone is shut out too", async () => {
    const user = await as(dev);
    const working = { ...user, workAs: { developerId: dev.id, developerName: dev.fullName, startedAt: new Date() } } as unknown as CurrentUser;
    for (const call of [() => hotelData(working, NOW), () => moneyData(working, NOW), () => messagesData(working, NOW), () => speedData(working, NOW)]) {
      expect(((await thrownBy(call)) as AppError).code).toBe("FORBIDDEN");
    }
  });
});

// ───────────────────────────────────────────── 2. HOTEL ─────────────────────────────────────────────
describe("the Hotel tab", () => {
  const ids: Record<string, string> = {};
  let hotel: Awaited<ReturnType<typeof hotelData>>;

  beforeAll(async () => {
    await wipe();
    await setSettings({ unpaidHoldHours: 0 });
    const actor = await managerActor();
    const dd = await roomType("DOUBLE_DELUXE");
    const roomId = (n: string) => dd.rooms.find((r) => r.number === n)!.id;
    await db.bookingQrCode.deleteMany({ where: { label: "Tabs test QR" } });
    const qr = await db.bookingQrCode.create({ data: { label: "Tabs test QR", token: `tabs-test-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
    const book = async (key: string, o: { room: string; source: string; from: string; to: string; made: string; guest: string }) => {
      const r = await createReservation({
        sourceCode: o.source, ...(o.source === "HOTEL_QR" ? { bookingQrId: qr.id } : {}), guest: { fullName: o.guest, phone: `07123${String(Object.keys(ids).length).padStart(5, "0")}` }, stay: { kind: "overnight", arrivalDate: o.from, departureDate: o.to },
        rooms: [{ roomTypeId: dd.id, roomId: roomId(o.room), adults: 2, children: 1, discountPerNight: 0 }],
      }, actor, eat(o.made));
      ids[key] = r.id;
      return r;
    };
    await book("A", { room: "103", source: "PHONE", from: "2041-03-09", to: "2041-03-11", made: "2041-03-08T10:00:00", guest: "Guest A Staying" });
    await book("B", { room: "104", source: "WALK_IN", from: "2041-03-09", to: "2041-03-10", made: "2041-03-09T01:00:00", guest: "Guest B Night Owl" });
    await book("C", { room: "105", source: "WEBSITE", from: "2041-03-10", to: "2041-03-12", made: "2041-03-09T09:00:00", guest: "Guest C Morning" });
    await book("D", { room: "106", source: "HOTEL_QR", from: "2041-03-10", to: "2041-03-11", made: "2041-03-10T09:00:00", guest: "Guest D Waiting" });
    await book("E", { room: "107", source: "PHONE", from: "2041-03-08", to: "2041-03-09", made: "2041-03-07T10:00:00", guest: "Guest E Late" });
    await book("G", { room: "203", source: "PHONE", from: "2041-03-08", to: "2041-03-10", made: "2041-03-07T11:00:00", guest: "Guest G Leaving" });
    // check-ins: G on the 8th, A and B on the 9th (B at 03:30 on the 10th — still the hotel day of the 9th), C at 04:30 on the 10th (the new day)
    await checkIn(ids.G, actor, null, eat("2041-03-08T15:00:00"));
    await checkIn(ids.A, actor, null, eat("2041-03-09T15:00:00"));
    await checkIn(ids.B, actor, null, eat("2041-03-10T03:30:00"));
    await checkIn(ids.C, actor, null, eat("2041-03-10T04:30:00"));
    await checkOut(ids.B, actor, { allowBalance: true, overrideReason: "Left owing (test)" }, eat("2041-03-10T10:00:00"));
    // housekeeping
    await db.room.updateMany({ where: { number: "301" }, data: { status: "DIRTY" } });
    await db.room.updateMany({ where: { number: "401" }, data: { status: "CLEANING" } });
    await db.room.updateMany({ where: { number: "302" }, data: { status: "MAINTENANCE" } });
    await db.room.updateMany({ where: { number: "402" }, data: { status: "OUT_OF_SERVICE" } });
    // two reception shifts: one forgotten for 20 hours, one 2 hours old
    await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate("2041-03-09"), userId: rec.id, startedAt: new Date(NOW.getTime() - 20 * 3600_000) } });
    await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate(TODAY), userId: mgr.id, startedAt: new Date(NOW.getTime() - 2 * 3600_000) } });
    // restaurant orders: 12 not served (the oldest 5 hours), one served, one cancelled, one old one outside the 30 days
    const order = (n: number, status: string, minutesAgo: number, extra: Record<string, unknown> = {}) => db.restaurantOrder.create({
      data: {
        number: `ORD-2041-${900 + n}`, type: "DINE_IN", status: status as never, settlement: "PAY_NOW", foodSubtotal: 10_000 * n, drinksSubtotal: 0, total: 10_000 * n,
        businessDate: toDbDate(TODAY), createdAt: new Date(NOW.getTime() - minutesAgo * 60_000), tableLabel: `Table ${n}`, ...extra,
      },
    });
    for (let n = 1; n <= 12; n++) await order(n, n % 2 ? "PENDING" : "READY", 300 - n * 10, n === 1 ? { assignedToId: rec.id } : {});
    await order(13, "DELIVERED", 400);
    await order(14, "CANCELLED", 100);
    await order(15, "PENDING", 90, { businessDate: toDbDate("2041-01-01") });
    // guest requests: 12 open and one finished
    const room = await db.room.findFirstOrThrow({ where: { number: "103" } });
    for (let n = 1; n <= 12; n++) {
      await db.serviceRequest.create({ data: { type: n % 2 ? "TOWELS" : "CLEANING", description: `SECRET-REQUEST-TEXT-${n}`, status: n % 3 === 0 ? "IN_PROGRESS" : "NEW", roomId: room.id, businessDate: toDbDate(TODAY), createdAt: new Date(NOW.getTime() - (200 - n) * 60_000) } });
    }
    await db.serviceRequest.create({ data: { type: "OTHER", description: "done", status: "COMPLETED", businessDate: toDbDate(TODAY) } });
    // a booking request waiting
    const source = await db.bookingSource.findUniqueOrThrow({ where: { code: "WEBSITE" } });
    await db.bookingRequest.create({ data: { reference: "VLH-REQ-T0001", manageToken: "tok-hotel-tabs-1", sourceId: source.id, fullName: "Request Person", phone: "0712000111", checkInDate: toDbDate("2041-03-20"), checkOutDate: toDbDate("2041-03-22"), roomTypeId: dd.id, businessDate: toDbDate(TODAY) } });
    // ...and one that came YESTERDAY and nobody has touched (still NEW): reception's badge counts it, so this card must too
    await db.bookingRequest.create({ data: { reference: "VLH-REQ-T0002", manageToken: "tok-hotel-tabs-2", sourceId: source.id, fullName: "Old Request Person", phone: "0712000222", checkInDate: toDbDate("2041-03-21"), checkOutDate: toDbDate("2041-03-22"), roomTypeId: dd.id, businessDate: toDbDate("2041-03-09") } });
    hotel = await hotelData(await as(dev), NOW);
  }, 300_000);

  it("rooms, guests, arrivals, departures and housekeeping are the front desk's and the Boss's own numbers", async () => {
    const snapshot = await getFrontDeskSnapshot(TODAY);
    expect(hotel.today).toBe(TODAY);
    expect(hotel.days).toHaveLength(14);
    expect(hotel.days[13]).toBe(TODAY);
    expect(hotel.cards.rooms).toEqual({ occupied: snapshot.statusCount.OCCUPIED ?? 0, total: snapshot.totalRooms, percent: Math.round(((snapshot.statusCount.OCCUPIED ?? 0) / snapshot.totalRooms) * 100) });
    expect(hotel.cards.rooms!.occupied).toBe(3);
    const move = await guestMovement({ from: TODAY, to: TODAY });
    expect(hotel.cards.inHouse).toEqual({ people: 9, bookings: move.inHouse });
    expect(move.inHouse).toBe(3);
    expect(hotel.cards.arrivals!.checkedIn).toBe(move.checkIns);
    expect(hotel.cards.departures!.checkedOut).toBe(move.checkOuts);
    const summary = await getArrivalsSummary(TODAY);
    expect(hotel.cards.arrivals!.expected).toBe(summary.expected.length + summary.late.length);
    expect(hotel.cards.arrivals!.expected).toBe(2); // D (today) and E (late)
    expect(hotel.cards.departures!.expected).toBe(snapshot.departures.length);
    expect(hotel.cards.departures!.expected).toBe(1); // G leaves today
    expect(hotel.cards.housekeeping).toEqual({ toClean: snapshot.cleaning.length, outOfService: snapshot.maintenance.length });
    expect(hotel.cards.housekeeping!.outOfService).toBe(2);
    expect(hotel.cards.housekeeping!.toClean).toBeGreaterThanOrEqual(2);
    expect(hotel.roomsByStatus!.reduce((n, r) => n + r.count, 0)).toBe(snapshot.totalRooms);
    expect(hotel.roomsByStatus!.find((r) => r.status === "OCCUPIED")!.count).toBe(3);
  });

  it("occupancy per day is the Boss's occupancy; today's card says it apart from 'rooms with a guest'", async () => {
    const boss14 = await occupancy({ from: hotel.days[0], to: TODAY });
    expect(hotel.occupancyPerDay!.map((d) => [d.date, d.percent])).toEqual(boss14.series.map((s) => [s.date, Math.round(s.occupancy)]));
    expect(hotel.occupancyPerDay!.find((d) => d.date === "2041-03-09")!.nights).toBe(3); // G, A and B slept on the 9th
    const todaySeries = boss14.series.find((s) => s.date === TODAY)!;
    expect(hotel.cards.bossOccupancy).toEqual({ percent: Math.round(todaySeries.occupancy), nights: todaySeries.roomNights, sellable: todaySeries.sellable });
  });

  it("check-ins and check-outs are on the hotel day they happened: 03:30 is the day before, 04:30 the new day — and agree with the room report's counts", async () => {
    const perDay = Object.fromEntries(hotel.movementPerDay!.map((d) => [d.date, d]));
    expect(perDay["2041-03-08"]).toMatchObject({ checkIns: 1, checkOuts: 0 }); // G
    expect(perDay["2041-03-09"]).toMatchObject({ checkIns: 2, checkOuts: 0 }); // A, and B at 03:30 on the 10th
    expect(perDay["2041-03-10"]).toMatchObject({ checkIns: 1, checkOuts: 1 }); // C at 04:30; B out at 10:00
    for (const d of hotel.days) {
      const m = await guestMovement({ from: d, to: d });
      expect([perDay[d].checkIns, perDay[d].checkOuts], d).toEqual([m.checkIns, m.checkOuts]);
    }
    const all = await guestMovement({ from: hotel.days[0], to: TODAY });
    expect(hotel.movementPerDay!.reduce((n, d) => n + d.checkIns, 0)).toBe(all.checkIns);
    expect(hotel.movementPerDay!.reduce((n, d) => n + d.checkOuts, 0)).toBe(all.checkOuts);
  });

  it("new bookings per day are by source, in plain names, and add up to the Boss's 'new bookings' of each day", async () => {
    const b = hotel.bookingsPerDay!;
    const byName = Object.fromEntries(b.sources.map((s) => [s.code, s.count]));
    expect(byName).toEqual({ PHONE: 3, WALK_IN: 1, WEBSITE: 1, HOTEL_QR: 1 });
    expect(b.sources.map((s) => s.name)).toEqual(expect.arrayContaining(["Phone", "Walk-in", "Website", "Hotel QR"]));
    expect(b.sources[0].code).toBe("PHONE"); // the biggest first
    for (const d of b.days) {
      const m = await guestMovement({ from: d.date, to: d.date });
      expect(Object.values(d.bySource).reduce((n, v) => n + v, 0), d.date).toBe(m.newBookings);
    }
    const phone = b.sources.find((s) => s.code === "PHONE")!.id;
    expect(b.days.find((d) => d.date === "2041-03-07")!.bySource[phone]).toBe(2); // E and G, made on the 7th
  });

  it("restaurant orders per day: count and TZS value, cancelled ones left out — the same as the restaurant summary", async () => {
    const day = hotel.ordersPerDay!.find((d) => d.date === TODAY)!;
    const sum = await reporting.restaurantSummary({ from: TODAY, to: TODAY });
    expect(day.orders).toBe(sum.orders);
    expect(day.total).toBe(sum.sales);
    expect(day.orders).toBe(13); // 12 not served + 1 served; the cancelled one is out and the 15th belongs to another day
    expect(day.total).toBe(910_000);
    const all = await reporting.restaurantSummary({ from: hotel.days[0], to: TODAY });
    expect(hotel.ordersPerDay!.reduce((n, d) => n + d.orders, 0)).toBe(all.orders);
  });

  it("open orders: counted from the last 30 days, the oldest wait in minutes, ten rows at most, longest first", () => {
    expect(hotel.cards.orders).toEqual({ open: 12, oldestMinutes: 290 });
    expect(hotel.longestOrders).toHaveLength(HOTEL_ROWS.orders);
    expect(hotel.longestOrders!.map((o) => o.minutes)).toEqual([...hotel.longestOrders!.map((o) => o.minutes)].sort((a, b) => b - a));
    expect(hotel.longestOrders![0]).toMatchObject({ number: "ORD-2041-901", table: "Table 1", waiter: "Asha Tabs", minutes: 290, status: "PENDING" });
    expect(hotel.longestOrders!.every((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED")).toBe(true);
    expect(hotel.longestOrders!.some((o) => o.number === "ORD-2041-915")).toBe(false);
  });

  it("open guest requests: the count, the oldest age, ten rows at most — and the guest's words are never read", () => {
    expect(hotel.cards.requests!.open).toBe(12);
    expect(hotel.cards.requests!.oldestMinutes).toBe(199);
    expect(hotel.openRequests).toHaveLength(HOTEL_ROWS.requests);
    expect(hotel.openRequests![0]).toMatchObject({ room: "103", minutes: 199 });
    expect(JSON.stringify(hotel)).not.toContain("SECRET-REQUEST-TEXT");
  });

  it("booking requests waiting are the reception's own count: a request untouched since yesterday still counts as new", async () => {
    const stats = await requestStats(TODAY, TODAY);
    // the date-limited number is the one that was wrong: it only sees today's request
    expect(stats.new).toBe(1);
    expect(await newRequestCount()).toBe(2);
    expect(hotel.cards.bookingRequests).toEqual({ open: stats.openNow, fresh: await newRequestCount() });
    expect(hotel.cards.bookingRequests).toEqual({ open: 2, fresh: 2 });
    // the card says so: not "None new" in green
    const html = renderToStaticMarkup(createElement(HotelTab, { t, h: hotel, when }));
    expect(html).toContain("2 new");
    expect(html).not.toContain("None new");
  });

  it("the open shifts: who, since when, and the one open over 14 hours is flagged", () => {
    expect(hotel.cards.shifts).toHaveLength(2);
    const long = hotel.cards.shifts!.find((s) => s.long)!;
    expect(long).toMatchObject({ who: "Asha Tabs", hours: 20 });
    expect(hotel.cards.shifts!.find((s) => !s.long)).toMatchObject({ who: "Manager Tabs", hours: 2 });
  });

  it("today's arrivals and departures: guest, rooms and state; late and overdue marked; at most 15 rows with the real total", () => {
    const names = hotel.arrivals!.rows.map((r) => r.guest);
    expect(names).toEqual(expect.arrayContaining(["Guest C Morning", "Guest D Waiting", "Guest E Late"]));
    expect(hotel.arrivals!.rows.find((r) => r.guest === "Guest E Late")).toMatchObject({ late: true, status: expect.stringMatching(/RESERVED|CONFIRMED|INQUIRY/), rooms: ["107"] });
    expect(hotel.arrivals!.rows.find((r) => r.guest === "Guest D Waiting")!.late).toBe(false);
    expect(hotel.arrivals!.rows.find((r) => r.guest === "Guest C Morning")).toMatchObject({ status: "CHECKED_IN", rooms: ["105"] });
    const out = hotel.departures!.rows;
    expect(out.map((r) => r.guest)).toEqual(expect.arrayContaining(["Guest G Leaving", "Guest B Night Owl"]));
    expect(out.find((r) => r.guest === "Guest G Leaving")).toMatchObject({ status: "CHECKED_IN", late: false });
    expect(out.find((r) => r.guest === "Guest B Night Owl")!.status).toBe("CHECKED_OUT");
    expect(hotel.arrivals!.rows.length).toBeLessThanOrEqual(HOTEL_ROWS.movement);
    expect(hotel.arrivals!.total).toBeGreaterThanOrEqual(hotel.arrivals!.rows.length);
  });

  it("nothing in what it returns is a secret, a hash or a guest's phone number", () => {
    const json = JSON.stringify(hotel);
    for (const w of ["passwordHash", "tokenHash", "apiKey", "07123000"]) expect(json).not.toContain(w);
  });

  it("a part that cannot be read is left out and the rest of the tab still draws", async () => {
    const spy = vi.spyOn(reporting, "occupancy").mockRejectedValue(new Error("boom"));
    try {
      const h = await hotelData(await as(dev), NOW);
      expect(h.occupancyPerDay).toBeNull();
      expect(h.cards.bossOccupancy).toBeNull();
      expect(h.movementPerDay).not.toBeNull();
      expect(h.cards.rooms).not.toBeNull();
      const html = renderToStaticMarkup(createElement(HotelTab, { t, h, when }));
      expect(html).toContain("This could not be read just now.");
      expect(html).toContain("Check-ins and check-outs per day");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    } finally { spy.mockRestore(); }
  });

  it("the tab draws: cards, charts with their numbers, tables that stack on a phone", () => {
    const html = renderToStaticMarkup(createElement(HotelTab, { t, h: hotel, when }));
    for (const w of ["Rooms with a guest", "3 of ", "Guests in the house", "Arrivals today", "Departures today", "Housekeeping", "Reception shift", "Restaurant orders open", "Guest requests open", "Online booking requests",
      "Occupancy per day", "Check-ins and check-outs per day", "Restaurant and bar orders per day", "New bookings per day", "Today&#x27;s arrivals", "Longest-open restaurant orders", "Open guest requests", "Rooms by status", "Open over 14 hours"]) {
      expect(html, w).toContain(w);
    }
    expect(html.match(/Show the numbers/g)!.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain("data-stack");
    expect(html).toContain('data-label="Guest"');
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
    expect(html).toContain("TZS 910,000"); // the 13 orders of the day, in full
    expect(html).not.toMatch(/TZS \d+k/);
  });
});

// ───────────────────────────────────────────── 3. MONEY ─────────────────────────────────────────────
describe("the Money tab", () => {
  let money: Awaited<ReturnType<typeof moneyData>>;
  let net1 = 0, net2 = 0;
  const SECRET_ACCOUNT = "ACC-SECRET-77889900";
  let cashAccountId = "", cashAccountNumber: string | null = null;
  const methods: Record<string, { id: string; accountId: string }> = {};

  beforeAll(async () => {
    await wipe();
    await setSettings({ unpaidHoldHours: 0 });
    const actor = await managerActor();
    for (const m of await db.paymentMethod.findMany()) methods[m.code] = { id: m.id, accountId: m.accountId! };
    cashAccountId = methods.CASH.accountId;
    cashAccountNumber = (await db.moneyAccount.findUniqueOrThrow({ where: { id: cashAccountId } })).accountNumber;
    await db.moneyAccount.update({ where: { id: cashAccountId }, data: { accountNumber: SECRET_ACCOUNT } });

    const dd = await roomType("DOUBLE_DELUXE");
    const book = (room: string, from: string, to: string, made: string, guest: string) => createReservation({
      sourceCode: "PHONE", guest: { fullName: guest }, stay: { kind: "overnight", arrivalDate: from, departureDate: to },
      rooms: [{ roomTypeId: dd.id, roomId: dd.rooms.find((r) => r.number === room)!.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, actor, eat(made));
    const r1 = await book("103", "2041-03-09", "2041-03-11", "2041-03-08T10:00:00", "Money Guest One");
    const r2 = await book("104", "2041-03-09", "2041-03-10", "2041-03-08T11:00:00", "Money Guest Two");
    await checkIn(r1.id, actor, null, eat("2041-03-09T15:00:00"));
    await checkIn(r2.id, actor, null, eat("2041-03-09T16:00:00"));
    await checkOut(r2.id, actor, { allowBalance: true, overrideReason: "Left owing (test)" }, eat("2041-03-10T10:00:00")); // left owing its whole bill
    net1 = (await db.reservation.findUniqueOrThrow({ where: { id: r1.id } })).netAmount;
    net2 = (await db.reservation.findUniqueOrThrow({ where: { id: r2.id } })).netAmount;

    // two payments through the service, at the two edges of the hotel day (03:30 on the 10th is still the 9th)
    vi.useFakeTimers({ toFake: ["Date"], now: eat("2041-03-10T03:30:00") });
    await recordReservationPayment({ reservationId: r1.id, amount: 10_000, methodId: methods.CASH.id }, actor);
    vi.setSystemTime(eat("2041-03-10T04:30:00"));
    await recordReservationPayment({ reservationId: r1.id, amount: 20_000, methodId: methods.MOBILE_MONEY.id }, actor);
    vi.useRealTimers();

    const pay = (over: Record<string, unknown>) => db.payment.create({
      data: { kind: "PAYMENT", status: "POSTED", amount: 1_000, methodId: methods.CASH.id, accountId: methods.CASH.accountId, businessDate: toDbDate(TODAY), receivedAt: eat("2041-03-10T09:00:00"), recordedById: rec.id, ...over } as never,
    });
    await pay({ amount: 5_000, methodId: methods.BANK.id, accountId: methods.BANK.accountId, businessDate: toDbDate("2041-03-08"), receivedAt: eat("2041-03-08T12:00:00") });
    await pay({ kind: "REFUND", amount: 2_000, receivedAt: eat("2041-03-10T09:30:00") });
    await pay({ status: "REVERSED", amount: 3_333, reversedAt: eat("2041-03-10T09:40:00"), reversedById: mgr.id, reversalReason: "Typed the wrong amount", reversalBusinessDate: toDbDate(TODAY) });
    // an on-the-spot sale (counted), a voided one (not)
    const category = await db.revenueCategory.findFirstOrThrow({ where: { kind: "RESTAURANT" } });
    const sale = (over: Record<string, unknown>) => db.revenueTransaction.create({
      data: { categoryId: category.id, kind: "RESTAURANT", amount: 7_000, paymentMethodId: methods.CARD.id, accountId: methods.CARD.accountId, businessDate: toDbDate(TODAY), occurredAt: eat("2041-03-10T10:00:00"), recordedById: rec.id, ...over } as never,
    });
    await sale({});
    await sale({ amount: 9_999, isVoided: true, voidedAt: eat("2041-03-10T10:05:00"), voidReason: "Entered twice" });
    // more payments, so the list has more than it shows (15)
    for (let i = 0; i < 20; i++) await pay({ amount: 100 + i, receivedAt: eat("2041-03-07T10:00:00") , businessDate: toDbDate("2041-03-07") });
    // expenses: one waiting for approval
    const cat = await db.expenseCategory.findFirstOrThrow();
    await db.expense.create({ data: { number: "EXP-2041-T1", categoryId: cat.id, amount: 45_000, businessDate: toDbDate(TODAY), spentAt: eat("2041-03-10T08:00:00"), description: "Waiting", createdById: rec.id, paymentMethodId: methods.CASH.id, accountId: methods.CASH.accountId, status: "PENDING_APPROVAL" } });
    // online payments: one waiting, one that needs a person
    const mp = (over: Record<string, unknown>) => db.mobilePayment.create({ data: { amount: 30_000, phone: "255700999888", purpose: "RESERVATION", status: "PENDING", createdAt: eat("2041-03-10T09:00:00"), ...over } as never });
    await mp({});
    await mp({ status: "COMPLETED", attentionAt: eat("2041-03-10T09:10:00"), completedAt: eat("2041-03-10T09:05:00") });
    // withdrawals: 12 in the list; the states that count
    const wd = (n: number, status: string, over: Record<string, unknown> = {}) => db.withdrawal.create({
      data: { amount: 10_000 * n, status, destinationKind: n % 2 ? "PHONE" : "BANK", phone: "255700111222", bankCode: "CRDB", accountNumber: "ACC-WD-5544", requestedById: rec.id, businessDate: toDbDate(TODAY), createdAt: new Date(NOW.getTime() - n * 3600_000), ...over } as never,
    });
    await wd(1, "SUBMITTING"); await wd(2, "PROCESSING"); await wd(3, "UNKNOWN"); await wd(4, "FAILED"); await wd(5, "COMPLETED"); await wd(6, "QUOTED");
    for (let n = 7; n <= 12; n++) await wd(n, "COMPLETED");
    await wd(13, "FAILED", { createdAt: new Date(NOW.getTime() - 40 * 24 * 3600_000) }); // too old to count
    // cancelled and corrected money in the audit trail (twelve; ten are shown)
    for (let i = 1; i <= 12; i++) {
      await db.auditLog.create({ data: { actorLabel: "Neema (Reception)", actorType: "STAFF", action: i % 2 ? "payment.reversed" : "revenue.voided", entityType: "Payment", entityId: `p${i}`, before: { amount: 1000 * i }, after: { reason: `Reason ${i}` }, businessDate: toDbDate(TODAY), createdAt: new Date(NOW.getTime() - i * 60_000) } });
    }
    await db.auditLog.create({ data: { actorLabel: "x", actorType: "STAFF", action: "reservation.checked_in", entityType: "Reservation", entityId: "r", businessDate: toDbDate(TODAY), createdAt: NOW } });
    money = await moneyData(await as(dev), NOW);
  }, 300_000);

  afterAll(async () => {
    vi.useRealTimers();
    if (cashAccountId) await db.moneyAccount.update({ where: { id: cashAccountId }, data: { accountNumber: cashAccountNumber } });
  });

  it("money received is the Boss's own 'received' — today, 7 days and every day — and the methods add up to it", async () => {
    const boss14 = await dailyMoney({ from: money.days[0], to: TODAY });
    expect(money.received!.today).toBe(boss14[13].received);
    expect(money.received!.week).toBe(boss14.slice(-7).reduce((n, d) => n + d.received, 0));
    expect(money.incomePerDay!.map((d) => [d.date, d.income, d.received])).toEqual(boss14.map((d) => [d.date, d.income, d.received]));
    // 03-08: 5,000 bank · 03-09: 10,000 cash (03:30 on the 10th) · 03-10: 20,000 mobile (04:30) − 2,000 cash refund + 7,000 card sale
    const day = Object.fromEntries(money.receivedPerDay!.map((d) => [d.date, d]));
    expect(day["2041-03-08"].byMethod).toEqual({ cash: 0, mobile: 0, bank: 5_000, card: 0, other: 0 });
    expect(day["2041-03-09"].byMethod).toEqual({ cash: 10_000, mobile: 0, bank: 0, card: 0, other: 0 });
    expect(day["2041-03-10"].byMethod).toEqual({ cash: -2_000, mobile: 20_000, bank: 0, card: 7_000, other: 0 });
    expect(money.received!.today).toBe(25_000);
    expect(money.received!.byMethodToday).toEqual({ cash: -2_000, mobile: 20_000, bank: 0, card: 7_000, other: 0 });
    for (const d of money.receivedPerDay!) expect(METHOD_GROUPS.reduce((n, g) => n + d.byMethod[g], 0), d.date).toBe(d.total);
    expect(money.received!.week).toBe(money.receivedPerDay!.slice(-7).reduce((n, d) => n + d.total, 0));
  });

  it("the payment methods' share adds the last 7 days up, biggest first", () => {
    const share = money.methodShare!;
    expect(share.map((s) => s.group)).toEqual([...share].sort((a, b) => b.amount - a.amount).map((s) => s.group));
    expect(share.reduce((n, s) => n + s.amount, 0)).toBe(Object.values(money.received!.byMethodWeek).filter((v) => v > 0).reduce((n, v) => n + v, 0));
    expect(share.every((s) => s.percent >= 0 && s.percent <= 100)).toBe(true);
  });

  it("owed: guests in the house, guests who left owing and the lateness table are the existing figures", async () => {
    const house = await inHouseBalances(TODAY);
    // the figure is the WHOLE booking's balance; the nights-so-far part is the shifts page's own second number
    expect(money.owedInHouse).toEqual({ amount: house.summary.totalOutstanding, soFar: house.summary.totalOwedSoFar, guests: house.summary.owingCount });
    expect(money.owedInHouse!.soFar).toBeLessThanOrEqual(money.owedInHouse!.amount);
    expect(money.owedInHouse!.amount).toBe(net1 - 30_000);
    const snapshot = await getFrontDeskSnapshot(TODAY);
    expect(money.leftOwing).toEqual({ amount: snapshot.unpaidAfterCheckout.amount, guests: snapshot.unpaidAfterCheckout.count });
    expect(money.leftOwing).toEqual({ amount: net2, guests: 1 });
    const aging = await receivablesAging(TODAY);
    expect(money.aging).toEqual({ rows: aging.rows, total: aging.total });
    expect(money.aging!.rows.map((r) => r.bucket)).toEqual(["current", "week", "month", "older"]);
  });

  it("expenses waiting, online payments and withdrawals are counted as the rest of the system counts them", async () => {
    const exp = await expenseSummary({ from: TODAY, to: TODAY });
    expect(money.expensesWaiting).toEqual({ count: exp.pending.count, amount: exp.pending.amount });
    expect(money.expensesWaiting).toEqual({ count: 1, amount: 45_000 });
    const online = await onlinePaymentTotals(addDays(TODAY, -6), TODAY);
    expect(money.online).toEqual({ waiting: online.pending, needPerson: online.attention });
    expect(money.online).toEqual({ waiting: 1, needPerson: 1 });
    expect(money.withdrawals).toEqual({ pending: 2, notConfirmed: 1, failed: 1 }); // the 40-day-old failure is not counted
  });

  it("the tables hold their limit and put the newest first: 15 payments, 10 cancelled/corrected, 10 withdrawals", () => {
    expect(money.payments).toHaveLength(MONEY_ROWS.payments);
    const times = money.payments!.map((p) => p.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(money.payments!.some((p) => p.kind === "SALE" && p.amount === 7_000)).toBe(true);
    expect(money.payments!.some((p) => p.kind === "REFUND" && p.amount === 2_000)).toBe(true);
    expect(money.payments!.find((p) => p.reversed)).toMatchObject({ amount: 3_333 });
    expect(money.payments!.some((p) => p.amount === 9_999)).toBe(false); // the voided sale is not a payment
    expect(money.corrections).toHaveLength(MONEY_ROWS.corrections);
    expect(money.corrections![0]).toMatchObject({ what: "Payment cancelled (reversed)", by: "Neema (Reception)", amount: 1000, reason: "Reason 1" });
    expect(money.corrections!.some((c) => c.what === "Sale cancelled")).toBe(true);
    expect(money.withdrawalList).toHaveLength(MONEY_ROWS.withdrawals);
    expect(money.withdrawalList![0]).toMatchObject({ amount: 10_000, status: "SUBMITTING", destination: "Mobile money" });
    expect(money.withdrawalList!.every((w) => w.status !== "QUOTED")).toBe(true);
  });

  it("the accounts are the system's booked balances, by name and kind", async () => {
    const real = await accountBalances();
    expect(money.accounts!.map((a) => [a.id, a.name, a.kind, a.balance])).toEqual(real.map((a) => [a.id, a.name, a.kind, a.balance]));
  });

  it("no account number, phone number, hash or secret is in what it returns", () => {
    const json = JSON.stringify(money);
    for (const w of [SECRET_ACCOUNT, "255700111222", "255700999888", "ACC-WD-5544", "passwordHash", "tokenHash"]) expect(json, w).not.toContain(w);
  });

  it("a part that cannot be read is left out and the rest still draws", async () => {
    const spy = vi.spyOn(await import("@/server/services/finance"), "accountBalances").mockRejectedValue(new Error("boom"));
    const spy2 = vi.spyOn(await import("@/server/services/finance-outlook"), "receivablesAging").mockRejectedValue(new Error("boom"));
    try {
      const m = await moneyData(await as(dev), NOW);
      expect(m.accounts).toBeNull();
      expect(m.aging).toBeNull();
      expect(m.received).not.toBeNull();
      const html = renderToStaticMarkup(createElement(MoneyTab, { t, m, when }));
      expect(html).toContain("This could not be read just now.");
      expect(html).toContain("Money received per day");
      expect(html).not.toContain("NaN");
    } finally { spy.mockRestore(); spy2.mockRestore(); }
  });

  it("the tab draws: amounts in full, the money-in chart's numbers, tables that stack, 'read-only' said", () => {
    const html = renderToStaticMarkup(createElement(MoneyTab, { t, m: money, when }));
    for (const w of ["Where the money is", "Received today", "TZS 25,000", "Owed by guests in the house", `TZS ${(net1 - 30_000).toLocaleString("en-US")}`, `TZS ${money.owedInHouse!.soFar.toLocaleString("en-US")} for the nights so far`, "whole booking", "Left owing after check-out", `TZS ${net2.toLocaleString("en-US")}`, "Online payments (nTZS)", "Withdrawals", "Expenses waiting", "TZS 45,000",
      "Money received per day", "Income and money received per day", "How the money came in", "What is owed, by how late", "The last payments", "Cancelled and corrected money", "Money accounts", "The last withdrawals", "Show the numbers", "data-stack"]) {
      expect(html, w).toContain(w);
    }
    expect(html).not.toMatch(/TZS \d+k/);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
    expect(html).toContain("−TZS 2,000"); // the refund
  });
});

// ───────────────────────────────────────────── 3b. MONEY: the hotel day, with the real recording code ─────────────────────────────────────────────
describe("a payment's hotel day is the one the recording code gave it", () => {
  it("a payment recorded at 03:30 is the previous day's and one at 04:30 is the new day's — the Money tab and the Boss's dailyMoney agree on both", async () => {
    // (made above: 10,000 cash at 03:30 on the 10th and 20,000 mobile money at 04:30)
    const stored = await db.payment.findMany({ where: { amount: { in: [10_000, 20_000] }, reservation: { isNot: null } }, select: { amount: true, businessDate: true }, orderBy: { amount: "asc" } });
    expect(stored.map((p) => [p.amount, p.businessDate.toISOString().slice(0, 10)])).toEqual([[10_000, "2041-03-09"], [20_000, "2041-03-10"]]);
  });
});

// ───────────────────────────────────────────── 4. MESSAGES & REPORTS ─────────────────────────────────────────────
describe("the Messages & reports tab", () => {
  let msgs: Awaited<ReturnType<typeof messagesData>>;
  const KEY = "ABCDEF1234567890ABCDEF99";
  const BODY = "SECRET-MESSAGE-BODY-xyz";

  beforeAll(async () => {
    await wipe();
    await setSettings({ reportEnabled: true, roomReportEnabled: true, reportRecipients: [{ name: "Boss", phone: "+255700000412", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: null }], liveSince: null });
    const day = (d: string) => toDbDate(d);
    const daily = (d: string, generated: string, automatic = true) => db.dailyReport.create({ data: { businessDate: day(d), data: {}, summaryText: "report text", generatedAt: eat(generated), automatic } });
    // 03-09 (the last closed day): daily made and sent; room made but its send failed
    const d9 = await daily("2041-03-09", "2041-03-10T07:00:00");
    await db.roomReport.create({ data: { businessDate: day("2041-03-09"), data: {}, shareToken: "room-tok-0309", generatedAt: eat("2041-03-10T06:30:00"), automatic: true } });
    await db.notificationDelivery.create({ data: { dailyReportId: d9.id, purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000412", status: "SENT", attempts: 1, sentAt: eat("2041-03-10T07:01:00"), createdAt: eat("2041-03-10T07:00:30"), updatedAt: eat("2041-03-10T07:01:00") } });
    await db.notificationDelivery.create({ data: { dailyReportId: d9.id, purpose: "ROOM_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000412", status: "FAILED", attempts: 2, lastError: `CallMeBot: Invalid apikey=${KEY} for +255700000412`, createdAt: eat("2041-03-10T06:31:00"), updatedAt: eat("2041-03-10T06:32:00") } });
    // 03-08: daily made but never sent; no room report · 03-07 and earlier: nothing
    await daily("2041-03-08", "2041-03-09T07:00:00", false);

    const del = (n: number, status: string, over: Record<string, unknown> = {}) => db.notificationDelivery.create({
      data: { purpose: n % 3 === 0 ? "ARRIVAL_REMINDER" : "SHIFT_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: `+25570000${String(1000 + n)}`, status, attempts: n % 4 === 0 ? MAX_ATTEMPTS : 1,
        lastError: status === "FAILED" ? `CallMeBot request failed: timeout on number 255700001000 token=${KEY}` : null,
        createdAt: new Date(NOW.getTime() - n * 3600_000), updatedAt: new Date(NOW.getTime() - n * 3600_000), sentAt: status === "SENT" ? new Date(NOW.getTime() - n * 3600_000) : null, ...over } as never,
    });
    for (let n = 1; n <= 10; n++) await del(n, "FAILED");
    for (let n = 11; n <= 14; n++) await del(n, "PENDING");
    for (let n = 15; n <= 18; n++) await del(n, "SENT");
    for (let n = 30; n <= 34; n++) await del(n, "FAILED"); // older than a day, still inside the week: 20 failed or waiting in all
    // the hotel day on the chart: 03:30 on the 10th belongs to the 9th, 04:30 to the 10th
    await del(40, "SENT", { createdAt: eat("2041-03-10T03:30:00"), sentAt: eat("2041-03-10T03:30:00"), updatedAt: eat("2041-03-10T03:30:00"), recipient: "+255700004030" });
    await del(41, "SENT", { createdAt: eat("2041-03-10T04:30:00"), sentAt: eat("2041-03-10T04:30:00"), updatedAt: eat("2041-03-10T04:30:00"), recipient: "+255700004130" });
    // guest messages — their words are never read
    const guest = await db.guest.create({ data: { fullName: "Message Guest", phone: "+255711000999" } });
    for (const [status, ago] of [["SENT", 1], ["SENT", 5], ["FAILED", 2], ["SENT", 30]] as const) {
      await db.guestMessage.create({ data: { guestId: guest.id, type: "WELCOME", channel: "WHATSAPP", to: "+255711000999", body: BODY, status, createdAt: new Date(NOW.getTime() - ago * 3600_000) } });
    }
    msgs = await messagesData(await as(dev), NOW);
  }, 300_000);

  it("the last closed day's two reports say what the Boss's home says (the same function), in plain states", async () => {
    const troubles = await reportTroubles(NOW);
    expect(msgs.lastClosed!.date).toBe("2041-03-09");
    expect(msgs.lastClosed!.daily.trouble).toBe(troubles.daily?.kind ?? null);
    expect(msgs.lastClosed!.room.trouble).toBe(troubles.room?.kind ?? null);
    expect(msgs.lastClosed!.daily.state).toBe("ok");
    expect(msgs.lastClosed!.room.state).toBe("failed");
    expect(msgs.lastClosed!.room.trouble).toBe("failed");
  });

  it("the table of closed days: 7 days, newest first; made / sent / not made, version, automatic or by a person", () => {
    const rows = msgs.reportDays!;
    expect(rows.map((r) => r.date)).toEqual(["2041-03-09", "2041-03-08", "2041-03-07", "2041-03-06", "2041-03-05", "2041-03-04", "2041-03-03"]);
    expect(rows[0].daily).toMatchObject({ state: "ok", version: 1, automatic: true });
    expect(rows[0].daily.sentAt!.getTime()).toBe(eat("2041-03-10T07:01:00").getTime());
    expect(rows[0].room).toMatchObject({ state: "failed", automatic: true, sentAt: null });
    expect(rows[1].daily).toMatchObject({ state: "unsent", automatic: false });
    expect(rows[1].room.state).toBe("missing");
    expect(rows[2].daily.state).toBe("missing");
    expect(rows.slice(2).every((r) => r.daily.state === "missing" && r.room.state === "missing")).toBe(true);
    // every state is the pure rule's answer
    const settings = { enabled: true, hasRecipients: true } as const;
    expect(reportTrouble({ ...settings, late: true, report: null })).toBe("missing");
  });

  it("reports switched off, or nobody to receive them, are 'switched off' — not a trouble", async () => {
    await setSettings({ reportEnabled: false });
    const off = await messagesData(await as(dev), NOW);
    expect(off.reportDays!.every((r) => r.daily.state === "off" && r.room.state === "off")).toBe(true);
    await setSettings({ reportEnabled: true, reportRecipients: [] });
    const nobody = await messagesData(await as(dev), NOW);
    expect(nobody.reportDays![0].daily.state).toBe("off");
    await setSettings({ reportRecipients: [{ name: "Boss", phone: "+255700000412", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: null }] });
  });

  it("deliveries in 24 hours: sent, failed and waiting are counted by the rules the health card uses", async () => {
    const diag = await systemDiagnostics(await as(dev), NOW);
    expect(msgs.deliveries24h!.failed).toBe(diag.counts!.failedMessages24h);
    expect(msgs.deliveries24h).toEqual({ sent: await db.notificationDelivery.count({ where: { status: { in: ["SENT", "DELIVERED"] }, sentAt: { gte: new Date(NOW.getTime() - 24 * 3600_000) } } }), failed: msgs.deliveries24h!.failed, waiting: 4 });
    expect(msgs.deliveries24h!.sent).toBe(1 /* the daily report */ + 4 /* 15–18 h ago */ + 2 /* the two edge ones */ + 0);
  });

  it("failed deliveries: those with tries left and those given up (last 7 days)", async () => {
    const week = await db.notificationDelivery.findMany({ where: { status: "FAILED", createdAt: { gte: new Date(NOW.getTime() - 7 * 24 * 3600_000) } }, select: { attempts: true } });
    const gaveUp = week.filter((d) => d.attempts >= MAX_ATTEMPTS).length;
    expect(gaveUp).toBe(3); // numbers 4, 8 and 32 had every try
    expect(msgs.retry).toEqual({ underMax: week.length - gaveUp, atMax: gaveUp });
    expect(week.length).toBe(16); // 10 failed, 5 older failed ones, and the room report's failed send (waiting ones are not "failed")
    expect(msgs.maxAttempts).toBe(MAX_ATTEMPTS);
  });

  it("guest messages in 24 hours come from the guests' own log", () => {
    expect(msgs.guestMessages24h).toEqual({ sent: 2, failed: 1 });
  });

  it("deliveries per day are on the hotel day: 03:30 on the 10th is the 9th, 04:30 is the 10th", async () => {
    expect(msgs.perDay).toHaveLength(14);
    const inDay = (from: string, to: string, status: string[]) => db.notificationDelivery.count({ where: { status: { in: status as never[] }, createdAt: { gte: eat(from), lt: eat(to) } } });
    const nine = msgs.perDay!.find((d) => d.date === "2041-03-09")!;
    const ten = msgs.perDay!.find((d) => d.date === TODAY)!;
    // the hotel day is 04:00 → 04:00 — counted here from the instants themselves, not from the calendar date
    expect(nine.sent).toBe(await inDay("2041-03-09T04:00:00", "2041-03-10T04:00:00", ["SENT", "DELIVERED"]));
    expect(ten.sent).toBe(await inDay("2041-03-10T04:00:00", "2041-03-11T04:00:00", ["SENT", "DELIVERED"]));
    expect(ten.failed).toBe(await inDay("2041-03-10T04:00:00", "2041-03-11T04:00:00", ["FAILED"]));
    expect(nine.failed + ten.failed).toBeGreaterThan(0);
    // the 03:30 delivery is on the 9th, the 04:30 one on the 10th, though both are the 10th on the calendar
    const edge = await db.notificationDelivery.findMany({ where: { recipient: { in: ["+255700004030", "+255700004130"] } }, select: { recipient: true, createdAt: true } });
    expect(edge).toHaveLength(2);
    expect(nine.sent).toBeGreaterThanOrEqual(1);
    expect(ten.sent).toBeGreaterThanOrEqual(1);
    // nothing is lost between the days: the fourteen days add up to every delivery of the window
    const all = msgs.perDay!.reduce((n, d) => n + d.sent + d.failed + d.pending, 0);
    expect(all).toBe(await db.notificationDelivery.count({ where: { createdAt: { gte: eat("2041-02-25T04:00:00") } } }));
  });

  it("deliveries by purpose: reports, shift reports, guest messages (reminders + the log); counts and failures", async () => {
    const weekStart = eat("2041-03-04T04:00:00");
    const by = Object.fromEntries(msgs.byPurpose!.map((p) => [p.key, p]));
    expect(by.DAILY_REPORT).toMatchObject({ count: 1, failed: 0 });
    expect(by.ROOM_REPORT).toMatchObject({ count: 1, failed: 1 });
    expect(by.SHIFT_REPORT.count).toBe(await db.notificationDelivery.count({ where: { purpose: "SHIFT_REPORT", createdAt: { gte: weekStart } } }));
    const reminders = await db.notificationDelivery.count({ where: { purpose: "ARRIVAL_REMINDER", createdAt: { gte: weekStart } } });
    expect(by.GUEST.count).toBe(reminders + 4); // the reminders and the four messages in the guests' log
    expect(by.GUEST.failed).toBe((await db.notificationDelivery.count({ where: { purpose: "ARRIVAL_REMINDER", status: "FAILED", createdAt: { gte: weekStart } } })) + 1);
    const counts = msgs.byPurpose!.map((p) => p.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("failed or waiting deliveries: the newest 15, a phone as its last three digits, only the KIND of trouble (never the provider's words)", () => {
    expect(msgs.problems).toHaveLength(MESSAGE_ROWS.problems);
    const first = msgs.problems![0];
    expect(first.recipient).toMatch(/^•••• \d{3}$/);
    // the provider's reply is not returned at all — not even trimmed
    for (const p of msgs.problems!) expect(Object.keys(p).sort(), p.id).toEqual(["at", "atMax", "attempts", "id", "kind", "purpose", "recipient", "reminder", "status"]);
    const failed = msgs.problems!.find((p) => p.status === "FAILED" && !p.reminder)!;
    expect(failed.kind).toBe("The provider did not answer");
    expect(msgs.problems!.every((p) => ["FAILED", "PENDING"].includes(p.status))).toBe(true);
    expect(msgs.problems!.find((p) => p.status === "PENDING")!.kind).toBe("Not sent yet");
    // "all tries used" means exactly that, and only a failed delivery can have it; fewer tries promises nothing
    expect(msgs.problems!.find((p) => p.attempts >= MAX_ATTEMPTS && !p.reminder)!.atMax).toBe(true);
    expect(msgs.problems!.filter((p) => p.status === "PENDING").every((p) => !p.atMax)).toBe(true);
    const times = msgs.problems!.map((p) => p.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("never returns a message's words, a key or a full phone number", () => {
    const json = JSON.stringify(msgs);
    for (const w of [BODY, KEY, "255700000412", "255700001000", "+255711000999", "report text"]) expect(json, w).not.toContain(w);
  });

  it("a provider reply that echoes the hotel's own message never reaches the data or the page: only the kind of trouble", async () => {
    const secret = "SECRET-ECHOED-WORDS Dear Asha your balance is TZS 45,000";
    const row = await db.notificationDelivery.create({ data: {
      purpose: "SHIFT_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000777", status: "FAILED", attempts: 2,
      lastError: `CallMeBot: Message to: +255700000777 Text to send: ${secret} apikey="${KEY}" APIKey is invalid`,
      createdAt: new Date(NOW.getTime() - 60_000), updatedAt: new Date(NOW.getTime() - 60_000),
    } });
    try {
      const d = await messagesData(await as(dev), NOW);
      const line = d.problems!.find((p) => p.id === row.id)!;
      expect(line).toBeTruthy();
      expect(line.kind).toBe("The provider refused it");
      const html = renderToStaticMarkup(createElement(MessagesTab, { t, d, when }));
      expect(html).toContain("The provider refused it");
      for (const [where, text] of [["data", JSON.stringify(d)], ["markup", html]] as const) {
        for (const w of ["SECRET-ECHOED-WORDS", "Dear Asha", "45,000", "Text to send", "Message to", KEY, "255700000777", "APIKey"]) expect(text, `${where}: ${w}`).not.toContain(w);
      }
    } finally { await db.notificationDelivery.delete({ where: { id: row.id } }); }
  });

  it("an arrival reminder that failed on several runs is ONE line per reservation (each run makes a new row and none is ever tried again)", async () => {
    const mk = (rec: string, resId: string, minutesAgo: number) => db.notificationDelivery.create({ data: {
      purpose: "ARRIVAL_REMINDER", channel: "WHATSAPP_CALLMEBOT", recipient: rec, reservationId: resId, status: "FAILED", attempts: 1, lastError: "CallMeBot: APIKey is invalid",
      createdAt: new Date(NOW.getTime() - minutesAgo * 60_000), updatedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    } });
    const rows = [await mk("+255700005551", "res-rem-1", 10), await mk("+255700005551", "res-rem-1", 20), await mk("+255700005551", "res-rem-1", 30), await mk("+255700005552", "res-rem-2", 40)];
    try {
      const d = await messagesData(await as(dev), NOW);
      const one = d.problems!.filter((p) => p.recipient === "•••• 551");
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ reminder: true, attempts: 3, atMax: false, status: "FAILED", id: rows[0].id });
      const two = d.problems!.filter((p) => p.recipient === "•••• 552");
      expect(two).toHaveLength(1);
      expect(two[0]).toMatchObject({ reminder: true, attempts: 1 });
      expect(d.problems).toHaveLength(MESSAGE_ROWS.problems);
      // a reminder line makes no promise about tries: it carries neither tag
      const html = renderToStaticMarkup(createElement(MessagesTab, { t, d: { ...d, problems: one }, when }));
      const table = html.slice(html.indexOf("Failed or waiting deliveries"), html.indexOf("When the automatic jobs run"));
      expect(table).toContain("•••• 551");
      expect(table).not.toContain("fewer than");
      expect(table).not.toContain("no more automatic tries");
    } finally { await db.notificationDelivery.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }); }
  });

  it("the words say what is true: 'fewer than {max} tries' promises no retry, and the report that was sent is 'Sent', not 'On time'", () => {
    const html = renderToStaticMarkup(createElement(MessagesTab, { t, d: msgs, when }));
    expect(html).toContain(`fewer than ${MAX_ATTEMPTS} tries`);
    expect(html).toContain("no more automatic tries");
    expect(html).toContain("Failed deliveries, 7 days");
    for (const w of ["will be tried again by themselves", "tries left", "given up", "being tried", "On time", "trimmed and cleaned"]) expect(html, w).not.toContain(w);
    expect(msgs.lastClosed!.daily.state).toBe("ok");
    expect(html).toMatch(/Daily report<\/p><p[^>]*>Sent</);
    // a stacked chart's picture says each part of a day, not only the sum
    expect(html).toMatch(/aria-label="Deliveries per day: [^"]*\(Sent \d+/);
  });

  it("lateness is decided from the DUE INSTANT: 06:00 / 07:30 / 09:00 as before, and 02:00 (before the hotel day turns) counts the report due the morning before", async () => {
    // closed day = the 10th (no report was made for it); the room report is due on the 11th at 07:00, the daily report at 08:00
    for (const [at, daily, room] of [["2041-03-11T06:00:00", "waiting", "waiting"], ["2041-03-11T07:30:00", "waiting", "missing"], ["2041-03-11T09:00:00", "missing", "missing"], ["2041-03-12T02:00:00", "missing", "missing"]] as const) {
      const now = eat(at);
      const d = await messagesData(await as(dev), now);
      const troubles = await reportTroubles(now);
      expect(d.lastClosed!.date, at).toBe("2041-03-10");
      expect(d.reportDays![0].daily.state, `${at} daily`).toBe(daily);
      expect(d.reportDays![0].room.state, `${at} room`).toBe(room);
      // the same answer as the Boss's home gives
      expect(d.lastClosed!.daily.trouble, `${at} daily`).toBe(troubles.daily?.kind ?? null);
      expect(d.lastClosed!.room.trouble, `${at} room`).toBe(troubles.room?.kind ?? null);
    }
    // 02:00 on the 10th: the hotel day is still the 9th, so the last closed day is the 8th (made, never sent; no room report), both due the morning of the 9th
    const early = eat("2041-03-10T02:00:00");
    const d = await messagesData(await as(dev), early);
    expect(d.lastClosed!.date).toBe("2041-03-08");
    expect(d.lastClosed!.daily.state).toBe("unsent");
    expect(d.lastClosed!.room.state).toBe("missing");
    const troubles = await reportTroubles(early);
    expect(d.lastClosed!.daily.trouble).toBe(troubles.daily?.kind);
    expect(troubles.daily?.kind).toBe("unsent");
    expect(troubles.room?.kind).toBe("missing");
  });

  it("the automatic jobs' proof is the newest report the job ITSELF made; a hand-made one never replaces it and is shown apart", async () => {
    const day = (d: string) => toDbDate(d);
    const hand = await db.dailyReport.create({ data: { businessDate: day("2041-03-10"), data: {}, summaryText: "made by hand", generatedAt: eat("2041-03-10T11:00:00"), automatic: false } });
    const handRoom = await db.roomReport.create({ data: { businessDate: day("2041-03-10"), data: {}, shareToken: "room-tok-by-hand", generatedAt: eat("2041-03-10T11:05:00"), automatic: false } });
    try {
      const d = await messagesData(await as(dev), NOW);
      const daily = d.jobs!.find((j) => j.path === "/api/cron/daily-report")!;
      const room = d.jobs!.find((j) => j.path === "/api/cron/room-report")!;
      expect(daily.lastMadeAt!.getTime()).toBe(eat("2041-03-10T07:00:00").getTime());
      expect(daily.lastDate).toBe("2041-03-09");
      expect(daily.lastByPerson).toEqual({ at: eat("2041-03-10T11:00:00"), date: "2041-03-10" });
      expect(room.lastMadeAt!.getTime()).toBe(eat("2041-03-10T06:30:00").getTime());
      expect(room.lastByPerson).toEqual({ at: eat("2041-03-10T11:05:00"), date: "2041-03-10" });
      const html = renderToStaticMarkup(createElement(MessagesTab, { t, d, when }));
      expect(html).toContain("Last made by a person");
      // a job that never ran by itself is said so (and a part that cannot be read is not 'never')
      const none = renderToStaticMarkup(createElement(MessagesTab, { t, d: { ...d, jobs: d.jobs!.map((j) => ({ ...j, lastMadeAt: null, lastDate: null })) }, when }));
      expect(none).toContain("Never made by the job");
    } finally {
      await db.dailyReport.delete({ where: { id: hand.id } });
      await db.roomReport.delete({ where: { id: handRoom.id } });
    }
  });

  it("the automatic jobs are read from vercel.json, in hotel time, with the newest report as the proof", () => {
    const file = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    const times = (p: string) => file.crons.filter((c) => c.path === p).map((c) => { const [m, h] = c.schedule.split(" ").map(Number); return `${String((h + 3) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }).sort();
    const daily = msgs.jobs!.find((j) => j.path === "/api/cron/daily-report")!;
    const room = msgs.jobs!.find((j) => j.path === "/api/cron/room-report")!;
    expect(daily.times).toEqual(times("/api/cron/daily-report"));
    expect(daily.times).toEqual(["04:05", "06:15", "07:00", "07:35", "10:00", "21:00", "21:20"]);
    expect(room.times).toEqual(["06:30", "06:50", "08:00"]);
    expect(msgs.jobs).toHaveLength(new Set(file.crons.map((c) => c.path)).size);
    expect(daily.lastMadeAt!.getTime()).toBe(eat("2041-03-10T07:00:00").getTime());
    expect(daily.lastDate).toBe("2041-03-09");
    expect(room.lastMadeAt!.getTime()).toBe(eat("2041-03-10T06:30:00").getTime());
    expect(cronHotelTime("5 1 * * *", "Africa/Dar_es_Salaam")).toBe("04:05");
    expect(cronHotelTime("*/5 * * * *", "Africa/Dar_es_Salaam")).toBeNull();
  });

  it("a part that cannot be read is left out and the rest still draws", async () => {
    const spy = vi.spyOn(await import("@/server/services/report-health"), "reportTroubles").mockRejectedValue(new Error("boom"));
    try {
      const d = await messagesData(await as(dev), NOW);
      expect(d.lastClosed).toBeNull();
      expect(d.reportDays).not.toBeNull();
      expect(d.deliveries24h).not.toBeNull();
      const html = renderToStaticMarkup(createElement(MessagesTab, { t, d, when }));
      expect(html).toContain("Deliveries per day");
      expect(html).not.toContain("undefined");
    } finally { spy.mockRestore(); }
  });

  it("the tab draws: states in plain words, masked phones, the schedule, the numbers table", () => {
    const html = renderToStaticMarkup(createElement(MessagesTab, { t, d: msgs, when }));
    for (const w of ["Is the Boss getting what he should", "WhatsApp deliveries, 24 hours", "Daily report", "Room report", "Sent", "Send failed", "Failed deliveries, 7 days", "Guest messages, 24 hours", "Deliveries per day", "Deliveries by purpose",
      "The last closed days: reports", "Failed or waiting deliveries", "When the automatic jobs run", "04:05 · 06:15 · 07:00 · 07:35 · 10:00 · 21:00 · 21:20", "06:30 · 06:50 · 08:00", "•••• ", "Show the numbers", "data-stack", "Not sent", "Not made"]) {
      expect(html, w).toContain(w);
    }
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("255700000412");
  });
});

// ───────────────────────────────────────────── 5. "New records per day" on Speed & size ─────────────────────────────────────────────
describe("New records per day (Speed & size)", () => {
  it("counts bookings, payments, restaurant orders and audit entries on the hotel day each was made — and a part that fails is left out", async () => {
    await wipe();
    const dd = await roomType("DOUBLE_DELUXE");
    const actor = await managerActor();
    await createReservation({ sourceCode: "PHONE", guest: { fullName: "Growth Guest" }, stay: { kind: "overnight", arrivalDate: "2041-03-12", departureDate: "2041-03-13" }, rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }] }, actor, eat("2041-03-10T03:30:00")); // 03:30 → the 9th
    await createReservation({ sourceCode: "PHONE", guest: { fullName: "Growth Guest Two" }, stay: { kind: "overnight", arrivalDate: "2041-03-12", departureDate: "2041-03-13" }, rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[1].id, adults: 1, children: 0, discountPerNight: 0 }] }, actor, eat("2041-03-10T04:30:00")); // 04:30 → the 10th
    const method = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    for (const [date, n] of [["2041-03-10", 3], ["2041-03-09", 1]] as const) for (let i = 0; i < n; i++) await db.payment.create({ data: { amount: 1_000, methodId: method.id, accountId: method.accountId!, businessDate: toDbDate(date), recordedById: rec.id } });
    await db.auditLog.createMany({ data: [1, 2].map((i) => ({ actorLabel: "x", actorType: "STAFF", action: "test.growth", entityType: "Thing", entityId: `g${i}`, businessDate: toDbDate("2041-03-10") })) });
    const speed = await speedData(await as(dev), NOW);
    const g = Object.fromEntries(speed.growth!.days.map((d) => [d.date, d]));
    expect(speed.growth!.days).toHaveLength(14);
    expect(speed.growth!.dayStart).toBe("04:00");
    expect(g["2041-03-09"]).toMatchObject({ reservations: 1, payments: 1 });
    expect(g["2041-03-10"]).toMatchObject({ reservations: 1, payments: 3 });
    expect(g["2041-03-10"].audit).toBeGreaterThanOrEqual(2);
    expect(g["2041-03-01"]).toEqual({ date: "2041-03-01", reservations: 0, payments: 0, orders: 0, audit: 0 });
    // the page words
    const { SpeedTab } = await import("@/app/staff/(app)/developer/tab-speed");
    const html = renderToStaticMarkup(createElement(SpeedTab, { t, s: speed }));
    expect(html).toContain("New records per day");
    expect(html).toContain("Show the numbers");
    // unlike records are drawn side by side (never stacked into one bar), and the picture says each kind of record of every day
    expect(html).toContain("items-end gap-px");
    expect(html).not.toContain("flex-col-reverse");
    const spoken = html.slice(html.indexOf('aria-label="New records per day:'), html.indexOf('"', html.indexOf('aria-label="New records per day:') + 40));
    expect(spoken).toContain("10 Mar Bookings 1 · Payments 3");
    expect(spoken).toMatch(/Audit entries \d+/);
    expect(renderToStaticMarkup(createElement(SpeedTab, { t, s: { ...speed, growth: null } }))).toContain("This could not be read just now.");
  }, 120_000);
});

// ───────────────────────────────────────────── 6. the page ─────────────────────────────────────────────
describe("the Developer home draws the three parts", () => {
  const draw = async (search: Record<string, string> = {}) => renderToStaticMarkup((await resolveAsync(await DeveloperHomePage({ searchParams: Promise.resolve(search) } as never))) as never);

  it("the jump row lists them in order and each part is on the one page; an empty hotel says 'Nothing yet'", async () => {
    await wipe();
    await as(dev);
    const html = await draw();
    const nav = html.slice(html.indexOf('aria-label="Jump to"'), html.indexOf("</nav>", html.indexOf('aria-label="Jump to"')));
    const at = ["Messages &amp; reports", "Speed &amp; size", "Activity", "Hotel", "Money", "People &amp; my actions", "Settings"].map((w) => nav.indexOf(`>${w}`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const k of ["hotel", "money", "messages"]) { expect(nav).toContain(`href="#${k}"`); expect(html).toContain(`id="${k}"`); }

    for (const text of ["What is happening in the hotel", "Where the money is", "Is the Boss getting what he should"]) expect(html, text).toContain(text);
    expect(html).toContain("Nothing yet");
    expect(html).toContain("Show the numbers");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  }, 120_000);

  it("is read in Chinese by a Chinese-speaking Developer", async () => {
    await db.user.update({ where: { id: dev.id }, data: { preferredLanguage: "zh-CN" } });
    try {
      await as(dev);
      const html = await draw();
      for (const w of ["有客房间", "每日入住与退房", "暂无", "资金在哪里", "资金账户", "老板是否收到了应收到的内容", "每日发送情况"]) expect(html, w).toContain(w);
      expect(html).not.toContain("What is happening in the hotel");
      expect(html).not.toContain("Where the money is");
      expect(html).not.toContain("Is the Boss getting what he should");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    } finally { await db.user.update({ where: { id: dev.id }, data: { preferredLanguage: "en" } }); }
  }, 120_000);

  it("a person who is not the Developer is sent to 'forbidden'", async () => {
    await as(rec);
    expect(await redirectOf(() => draw())).toBe("/staff/forbidden");
  });

  it("each look at Hotel, Money or Messages is written like a look at a Business tab: once in 10 minutes per tab, apart from Business' own tab of the same name", async () => {
    const user = await as(dev);
    const mine = () => db.auditLog.findMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    // a clean diary (the one maintenance path, inside a transaction)
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('vegas.audit_maintenance', 'on', true)`);
      await tx.auditLog.deleteMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION } });
    });
    await draw(); await draw(); // twice: the refresh is not written again
    const rows = await mine();
    expect(rows.map((r) => r.entityId).sort()).toEqual(["home:hotel", "home:messages", "home:money"]);
    for (const r of rows) {
      expect(r).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", entityType: "Business", action: "developer.business_viewed", actorLabel: dev.fullName });
      expect(r.after).toEqual({ tab: r.entityId!.replace("home:", ""), area: "home" });
    }
    // the other parts of the home are not "business data": nothing is written for them (the three above are all there is)
    expect(await mine()).toHaveLength(3);
    // Business' own Money tab is its own entry (it is not swallowed by the home's, and the home's is not swallowed by it)
    expect(await noteBusinessView(user, "money")).toBe("logged");
    expect((await mine()).map((r) => r.entityId).sort()).toEqual(["home:hotel", "home:messages", "home:money", "money"]);
    // the entry never counts as work
    const { NOT_WORK_ACTIONS } = await import("@/server/services/developer-console");
    expect(NOT_WORK_ACTIONS).toContain(BUSINESS_VIEW_ACTION);
  });

  it("a note that cannot be written never blocks the tab", async () => {
    await as(dev);
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('vegas.audit_maintenance', 'on', true)`);
      await tx.auditLog.deleteMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION } });
    });
    const spy = vi.spyOn(db.auditLog, "findFirst").mockRejectedValue(new Error("diary down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const html = await draw();
      expect(html).toContain("Where the money is");
    } finally { spy.mockRestore(); logged.mockRestore(); }
  });
});

// ───────────────────────────────────────────── 7. the charts' words ─────────────────────────────────────────────
describe("a chart's spoken summary and hover text name every part", () => {
  const series = [{ key: "cash", label: "Cash", color: "#111111" }, { key: "mobile", label: "Mobile money", color: "#222222" }];
  const columns = [
    { key: "a", tick: "9 Mar", name: "9 Mar", values: { cash: 10_000, mobile: 20_000 } },
    { key: "b", tick: "10 Mar", name: "10 Mar", values: { cash: -2_000, mobile: 0 } }, // a cash refund and nothing else
    { key: "c", tick: "11 Mar", name: "11 Mar", values: { cash: 0, mobile: 0 } },
  ];

  it("a refund is named, so a day that is only a refund does not read as nothing", () => {
    const html = renderToStaticMarkup(createElement(BarChart, { t, columns, series, caption: "Money received per day", empty: "Nothing", format: formatTZS, negative: "refund" }));
    expect(html).toContain('aria-label="Money received per day: 9 Mar TZS 30,000 (Cash TZS 10,000 · Mobile money TZS 20,000), 10 Mar TZS -2,000 (Cash refund TZS -2,000), 11 Mar TZS 0"');
    expect(html).toContain('title="10 Mar: TZS -2,000 — Cash refund TZS -2,000"');
    expect(html).toContain('title="9 Mar: TZS 30,000 — Cash TZS 10,000 · Mobile money TZS 20,000"');
  });

  it("the Money tab's chart passes the word", () => {
    expect(readFileSync(path.join(process.cwd(), "src/app/staff/(app)/developer/tab-money.tsx"), "utf8")).toMatch(/caption=\{t\("Money received per day"\)\}[^\n]*negative=\{t\("refund"\)\}/);
  });
});
