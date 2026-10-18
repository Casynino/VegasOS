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
import { ALIVE_STAGES, BOOKING_STAGES, hotelGlance, LATEST_ROWS, ROOMS_SHOWN, type HotelGlance } from "@/server/services/developer-hotel-glance";
import * as reporting from "@/server/services/reporting";
import { guestMovement } from "@/server/services/reporting";
import { getSettings } from "@/server/settings";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { HotelGlanceTab } from "@/app/staff/(app)/developer/tab-hotel-glance";
import { loadCatalog } from "@/i18n/catalog";
import { makeT } from "@/i18n/translate";
import hotelGlanceCatalog from "@/i18n/catalog/zh-CN/staff/developer-hotel-glance";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE HOTEL PART of the Developer Home ("The business, for awareness"), against a real database: counts and plain words only, read-only,
 * Developer-only; "bookings added" and "in the hotel" are the Boss's own numbers; the hotel's day runs 04:00 → 04:00. The rows are this
 * file's own (a far-away year keeps them apart from every other test file's); every figure is compared with a direct count of them.
 */

const NOW = eat("2043-05-12T12:00:00");
const TODAY = "2043-05-12";
const d = (n: number) => addDays(TODAY, n);
const at = (n: number, time: string) => eat(`${d(n)}T${time}:00`);
const t = makeT("en", null);
const when = (x: Date) => t.dateTime(x, "Africa/Dar_es_Salaam");
const NAME = "Quillfeather"; // every guest of this file carries it: it must appear nowhere in what the part shows
const PHONE_PREFIX = "07129";

let dev: MadeUser, rec: MadeUser, boss: MadeUser, md: MadeUser, mgr: MadeUser, fin: MadeUser;
const ids: Record<string, string> = {};
let g: HotelGlance;
let savedHold: number | null = null;
let qrId = "";

async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id);
  return (await getCurrentUser()) as CurrentUser;
}

const guestRoomWhere = { isActive: true, roomType: { category: "GUEST_ROOM" as const } };
const sourceCount = (list: { code: string; count: number }[] | undefined, code: string) => list?.find((s) => s.code === code)?.count ?? 0;

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Glance Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Glance (Reception)" });
  boss = await makeUser("OWNER", { fullName: "Boss Glance" });
  md = await makeUser("ADMIN", { fullName: "MD Glance" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Glance" });
  fin = await makeUser("FINANCE", { fullName: "Finance Glance" });
  savedHold = (await getSettings()).unpaidHoldHours ?? null;

  await resetBusinessData();
  await db.hotelSettings.update({ where: { id: 1 }, data: { unpaidHoldHours: 0 } });
  const actor = await managerActor();
  const dd = await roomType("DOUBLE_DELUXE");
  const roomId = (n: string) => dd.rooms.find((r) => r.number === n)!.id;
  await db.bookingQrCode.deleteMany({ where: { label: "Glance test QR" } });
  qrId = (await db.bookingQrCode.create({ data: { label: "Glance test QR", token: `glance-test-${Date.now()}-${Math.random().toString(36).slice(2)}` } })).id;

  let n = 0;
  const book = async (key: string, o: { rooms: string[]; source: string; from: number; to: number; made: Date }) => {
    n += 1;
    const r = await createReservation({
      sourceCode: o.source, ...(o.source === "HOTEL_QR" ? { bookingQrId: qrId } : {}),
      guest: { fullName: `Zephyrine ${NAME} ${key}`, phone: `${PHONE_PREFIX}${String(n).padStart(5, "0")}` },
      stay: { kind: "overnight", arrivalDate: d(o.from), departureDate: d(o.to) },
      rooms: o.rooms.map((room) => ({ roomTypeId: dd.id, roomId: roomId(room), adults: 2, children: 0, discountPerNight: 0 })),
    }, actor, o.made);
    ids[key] = r.id;
  };

  // the two oldest (made long ago): outside the 14 days and the 30 days, so only the stages and the total see them
  await book("I", { rooms: ["206"], source: "PHONE", from: 5, to: 6, made: at(-30, "10:00") });
  await book("J", { rooms: ["207"], source: "WEBSITE", from: 6, to: 7, made: at(-35, "10:00") });
  await book("F", { rooms: ["203"], source: "PHONE", from: -38, to: -36, made: at(-40, "10:00") });
  await book("E", { rooms: ["107"], source: "PHONE", from: 2, to: 3, made: at(-20, "10:00") });
  // H is made at 03:30: still the hotel day BEFORE its calendar day (d(-5), not d(-4))
  await book("H", { rooms: ["205"], source: "WALK_IN", from: -4, to: -3, made: at(-4, "03:30") });
  await book("A", { rooms: ["103"], source: "PHONE", from: -1, to: 0, made: at(-3, "10:00") });
  await book("G", { rooms: ["204"], source: "PHONE", from: 1, to: 2, made: at(-2, "11:00") });
  await book("D", { rooms: ["106", "305", "306", "307"], source: "HOTEL_QR", from: 3, to: 4, made: at(-1, "09:00") });
  await book("B", { rooms: ["104"], source: "WALK_IN", from: 0, to: 1, made: at(0, "08:00") });
  await book("C", { rooms: ["105"], source: "WEBSITE", from: 0, to: 2, made: at(0, "09:00") });

  await checkIn(ids.F, actor, null, at(-38, "15:00"));
  await checkOut(ids.F, actor, { allowBalance: true, overrideReason: "Left owing (test)" }, at(-36, "10:00"));
  await checkIn(ids.A, actor, null, at(-1, "15:00"));
  await checkIn(ids.B, actor, null, at(0, "09:00"));
  await db.reservation.update({ where: { id: ids.G }, data: { status: "CANCELLED", cancelledAt: at(-1, "10:00") } });
  await db.reservation.update({ where: { id: ids.H }, data: { status: "NO_SHOW", noShowAt: at(-3, "10:00") } });

  // housekeeping: rooms that are not part of any booking above
  await db.room.updateMany({ where: { number: "301" }, data: { status: "DIRTY" } });
  await db.room.updateMany({ where: { number: "401" }, data: { status: "CLEANING" } });
  await db.room.updateMany({ where: { number: "302" }, data: { status: "MAINTENANCE" } });
  await db.room.updateMany({ where: { number: "402" }, data: { status: "OUT_OF_SERVICE" } });

  // customers: one added 11 days ago, one 60 days ago, one added 5 days ago but removed (a removed customer is not counted)
  await db.guest.create({ data: { fullName: `Customer ${NAME} recent`, createdAt: at(-11, "10:00") } });
  await db.guest.create({ data: { fullName: `Customer ${NAME} old`, createdAt: at(-60, "10:00") } });
  await db.guest.create({ data: { fullName: `Customer ${NAME} removed`, createdAt: at(-5, "10:00"), deletedAt: at(-4, "10:00") } });

  g = await hotelGlance(await as(dev), NOW);
}, 300_000);

afterAll(async () => {
  browser.reset();
  await db.hotelSettings.update({ where: { id: 1 }, data: { unpaidHoldHours: savedHold ?? 0 } }).catch(() => undefined);
  await resetBusinessData().catch(() => undefined);
  await db.bookingQrCode.deleteMany({ where: { label: "Glance test QR" } }).catch(() => undefined);
  await removeMadeUsers();
});

describe("the door: the Developer account only", () => {
  it.each([["receptionist", () => rec], ["Boss", () => boss], ["MD", () => md], ["manager", () => mgr], ["Finance", () => fin]])("the %s is refused", async (_name, who) => {
    const e = await thrownBy(async () => hotelGlance(await as(who()), NOW));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("FORBIDDEN");
  });

  it("a Developer working as someone is shut out too", async () => {
    const user = await as(dev);
    const working = { ...user, workAs: { developerId: dev.id, developerName: dev.fullName, startedAt: new Date() } } as unknown as CurrentUser;
    expect(((await thrownBy(() => hotelGlance(working, NOW))) as AppError).code).toBe("FORBIDDEN");
  });
});

describe("the four cards", () => {
  it("bookings in the system: alive ones out of every booking ever made, equal to a direct count", async () => {
    const stay = { kind: "STAY" as const };
    expect(g.cards.bookings).toEqual({
      alive: await db.reservation.count({ where: { ...stay, status: { in: ALIVE_STAGES } } }),
      ever: await db.reservation.count({ where: stay }),
    });
    expect(g.cards.bookings).toEqual({ alive: 7, ever: 10 }); // A, B, C, D, E, I, J are alive; F left, G cancelled, H no-show
  });

  it("bookings added (7 days) is the Boss's own 'new bookings' — and the 03:30 booking is on the day before", async () => {
    const boss7 = await guestMovement({ from: d(-6), to: TODAY });
    expect(g.cards.added).toEqual({ count: boss7.newBookings, days: 7 });
    expect(boss7.newBookings).toBe(6); // A, B, C, D, G and H (made at 03:30 on d(-4) = hotel day d(-5)); E, F, I and J were made 20 to 40 days ago
    expect(await db.reservation.count({ where: { kind: "STAY", businessDate: { gte: toDbDate(d(-6)), lte: toDbDate(TODAY) } } })).toBe(boss7.newBookings);
  });

  it("rooms with a guest: the occupied guest rooms of all active guest rooms (the meeting room is not counted)", async () => {
    const total = await db.room.count({ where: guestRoomWhere });
    const occupied = await db.room.count({ where: { ...guestRoomWhere, status: "OCCUPIED" } });
    expect(g.cards.rooms).toEqual({ occupied, total, percent: Math.round((occupied / total) * 100) });
    expect(occupied).toBe(2); // A and B
    expect(total).toBeLessThan(await db.room.count({ where: { isActive: true } })); // the meeting room exists and is left out
  });

  it("guests on the books: a count of the customer database, removed ones left out, and how many were added in 30 days", async () => {
    const total = await db.guest.count({ where: { deletedAt: null } });
    expect(g.cards.guests!.total).toBe(total);
    expect(g.cards.guests!.added).toBe(1); // the one added 11 days ago; the 60-day-old and the removed one are not new
  });
});

describe("the charts and lists", () => {
  it("bookings added per day: 14 hotel days; each day equals the Boss's new bookings of that day; the 03:30 booking is on d(-5)", async () => {
    const p = g.addedPerDay!;
    expect(p.days.map((x) => x.date)).toEqual(g.days);
    expect(g.days).toHaveLength(14);
    expect(g.days[13]).toBe(TODAY);
    let total = 0;
    for (const day of p.days) {
      const sum = Object.values(day.bySource).reduce((a, b) => a + b, 0);
      expect(sum, day.date).toBe((await guestMovement({ from: day.date, to: day.date })).newBookings);
      total += sum;
    }
    expect(total).toBe(6); // A, B, C, D, G, H — the 14 days hold no other booking
    const walkIn = p.sources.find((s) => s.code === "WALK_IN")!.id;
    expect(p.days.find((x) => x.date === d(-5))!.bySource[walkIn]).toBe(1); // H, made at 03:30 on d(-4)
    expect(p.days.find((x) => x.date === d(-4))!.bySource[walkIn] ?? 0).toBe(0);
    expect(sourceCount(p.sources, "PHONE")).toBe(2); // A and G
    expect(p.sources.map((s) => s.count)).toEqual([...p.sources.map((s) => s.count)].sort((a, b) => b - a)); // biggest first
  });

  it("where bookings come from: the last 30 hotel days by source, biggest first, plain names, none with 0", () => {
    const s = g.sources!;
    expect(sourceCount(s, "PHONE")).toBe(3); // A, E, G — the 30- and 40-day-old ones are outside the 30 days
    expect(sourceCount(s, "WALK_IN")).toBe(2); // B, H
    expect(sourceCount(s, "WEBSITE")).toBe(1); // C — J was made 35 days ago
    expect(sourceCount(s, "HOTEL_QR")).toBe(1); // D
    expect(s.every((x) => x.count > 0)).toBe(true);
    expect(s.map((x) => x.count)).toEqual([...s.map((x) => x.count)].sort((a, b) => b - a));
    expect(s.map((x) => x.name)).toEqual(expect.arrayContaining(["Phone", "Walk-in", "Website", "Hotel QR"]));
  });

  it("bookings by stage: every stage in order, each equal to a direct count, adding up to every booking ever made", async () => {
    expect(g.stages!.map((x) => x.status)).toEqual(BOOKING_STAGES);
    for (const row of g.stages!) expect(row.count, row.status).toBe(await db.reservation.count({ where: { kind: "STAY", status: row.status } }));
    expect(g.stages!.reduce((a, b) => a + b.count, 0)).toBe(g.cards.bookings!.ever);
    const by = Object.fromEntries(g.stages!.map((x) => [x.status, x.count]));
    expect(by).toMatchObject({ CHECKED_IN: 2, CHECKED_OUT: 1, CANCELLED: 1, NO_SHOW: 1 });
  });

  it("latest bookings: the newest 8, a reference, a stage, at most 3 room numbers and '+n', the dates — and the subtitle's three numbers", async () => {
    const direct = await db.reservation.findMany({ where: { kind: "STAY" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LATEST_ROWS, select: { id: true, reference: true, status: true } });
    expect(g.latest!.map((r) => [r.id, r.reference, r.status])).toEqual(direct.map((r) => [r.id, r.reference, r.status]));
    expect(g.latest).toHaveLength(LATEST_ROWS);
    expect(g.latest!.some((r) => r.id === ids.I || r.id === ids.J)).toBe(false); // the two oldest are cut
    const four = g.latest!.find((r) => r.id === ids.D)!;
    expect(four.rooms).toEqual(["106", "305", "306"]);
    expect(four.rooms).toHaveLength(ROOMS_SHOWN);
    expect(four.roomCount).toBe(4);
    expect(four).toMatchObject({ arrives: d(3), leaves: d(4), status: expect.stringMatching(/INQUIRY|RESERVED|CONFIRMED/) });
    expect(g.latest!.find((r) => r.id === ids.A)).toMatchObject({ status: "CHECKED_IN", rooms: ["103"], roomCount: 1, arrives: d(-1), leaves: d(0) });
    // arriving today = C only (B arrived today and has already checked in, so it is "in the hotel"); in the hotel = A and B (the Boss's inHouse); leaving = A (checked in, due out today)
    const boss = await guestMovement({ from: TODAY, to: TODAY });
    expect(g.movement).toEqual({ arriving: 1, inHouse: boss.inHouse, leaving: 1 });
    expect(boss.inHouse).toBe(2);
  });

  it("rooms right now: four states that add up to every active guest room, equal to a direct count", async () => {
    const rooms = await db.room.findMany({ where: guestRoomWhere, select: { status: true } });
    const count = (list: string[]) => rooms.filter((r) => list.includes(r.status)).length;
    const s = g.roomStates!;
    expect(s).toEqual({
      occupied: count(["OCCUPIED"]), ready: count(["AVAILABLE", "RESERVED", "READY"]), cleaning: count(["DIRTY", "CLEANING"]), outOfService: count(["MAINTENANCE", "OUT_OF_SERVICE"]), total: rooms.length,
    });
    expect(s.occupied + s.ready + s.cleaning + s.outOfService).toBe(s.total);
    expect(s.occupied).toBe(2);
    expect(s.cleaning).toBeGreaterThanOrEqual(2); // 301 (dirty), 401 (cleaning), and the room F left
    expect(s.outOfService).toBe(2); // 302 and 402
  });
});

describe("what it never shows", () => {
  it("no guest name or phone, no amount, no secret in the data or on the page — in English and in Chinese", async () => {
    const json = JSON.stringify(g);
    for (const w of [NAME, PHONE_PREFIX, "passwordHash", "tokenHash", "apiKey", "TZS", "balance", "amount"]) expect(json, w).not.toContain(w);
    const zh = makeT("zh-CN", { ...(await loadCatalog("zh-CN", ["common", "staff", "server"])), ...hotelGlanceCatalog });
    for (const [label, tt] of [["en", t], ["zh", zh]] as const) {
      const html = renderToStaticMarkup(createElement(HotelGlanceTab, { t: tt, g, when }));
      for (const w of [NAME, PHONE_PREFIX, "TZS", "undefined", "NaN", "null"]) expect(html, `${label}: ${w}`).not.toContain(w);
      for (const r of g.latest!) expect(html, `${label}: ${r.reference}`).toContain(r.reference);
    }
  });

  it("the part's code never reads a guest's name, phone, email or any amount", () => {
    const source = readFileSync(path.join(process.cwd(), "src/server/services/developer-hotel-glance.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
    expect(source).not.toMatch(/fullName|\bphone\b|\bemail\b|netAmount|paidAmount|balanceAmount|grossAmount|\bamount\b/);
  });

  it("is read-only: the call changes no row", async () => {
    const counts = async () => [
      await db.reservation.count(), await db.reservationRoom.count(), await db.guest.count(), await db.room.count(), await db.auditLog.count(), await db.payment.count(),
    ];
    const before = await counts();
    await hotelGlance(await as(dev), NOW);
    expect(await counts()).toEqual(before);
  });
});

describe("pages in two languages", () => {
  it("English and 中文: the four cards, the panels and the table are drawn with their words", async () => {
    const zh = makeT("zh-CN", { ...(await loadCatalog("zh-CN", ["common", "staff", "server"])), ...hotelGlanceCatalog });
    const en = renderToStaticMarkup(createElement(HotelGlanceTab, { t, g, when }));
    for (const w of ["Bookings in the system", "Bookings added (7 days)", "Rooms with a guest", "Guests on the books", "Bookings added per day", "Where bookings come from", "Bookings by stage", "Latest bookings", "Rooms right now", "Dirty / being cleaned", "1 arriving today · 2 in the hotel · 1 leaving today"]) expect(en, w).toContain(w);
    const cn = renderToStaticMarkup(createElement(HotelGlanceTab, { t: zh, g, when }));
    for (const w of ["系统中的预订", "新增预订（7 天）", "客户档案中的客人", "每日新增预订", "预订来源", "按阶段分布的预订", "最新预订", "当前客房", "待清洁 / 清洁中", "今日到店 1 · 在店 2 · 今日离店 1"]) expect(cn, w).toContain(w);
  });

  it("every English string the part's code speaks has a Chinese entry", async () => {
    const merged = { ...(await loadCatalog("zh-CN", ["common", "staff", "server"])), ...hotelGlanceCatalog };
    const files = ["src/server/services/developer-hotel-glance.ts", "src/app/staff/(app)/developer/tab-hotel-glance.tsx"];
    const missing: string[] = [];
    for (const f of files) {
      const code = readFileSync(path.join(process.cwd(), f), "utf8");
      for (const m of code.matchAll(/\b(?:t|msg)\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = JSON.parse(`"${m[1]}"`) as string;
        if (!merged[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("a figure that cannot be read", () => {
  it("is left out and the rest still draws, with the plain line in its place", async () => {
    const spy = vi.spyOn(reporting, "guestMovement").mockRejectedValue(new Error("boom"));
    try {
      const broken = await hotelGlance(await as(dev), NOW);
      expect(broken.cards.added).toBeNull();
      expect(broken.movement).toBeNull();
      expect(broken.cards.bookings).not.toBeNull();
      expect(broken.stages).not.toBeNull();
      expect(broken.roomStates).not.toBeNull();
      expect(broken.latest).not.toBeNull();
      const html = renderToStaticMarkup(createElement(HotelGlanceTab, { t, g: broken, when }));
      expect(html).toContain("This could not be read just now.");
      expect(html).toContain("The newest bookings and where each one stands.");
      for (const w of ["undefined", "NaN"]) expect(html).not.toContain(w);
    } finally {
      spy.mockRestore();
    }
  });

  it("when nothing can be read, the page still renders every panel with the plain line", () => {
    const empty: HotelGlance = {
      ...g, cards: { bookings: null, added: null, rooms: null, guests: null }, addedPerDay: null, sources: null, stages: null, latest: null, movement: null, roomStates: null,
    };
    const html = renderToStaticMarkup(createElement(HotelGlanceTab, { t, g: empty, when }));
    expect(html.split("This could not be read just now.").length - 1).toBeGreaterThanOrEqual(8);
    for (const w of ["undefined", "NaN"]) expect(html).not.toContain(w);
  });
});
