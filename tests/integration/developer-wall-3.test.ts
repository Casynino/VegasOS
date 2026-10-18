import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: () => undefined }));
// The Boss's WhatsApp notice: captured, never sent.
vi.mock("@/server/services/report-delivery", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), tellBossSoon: vi.fn() }));

import { db, rawDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { markWorkingAs, sha256 } from "@/server/work-as-session";
import { tellBossSoon } from "@/server/services/report-delivery";
import { endWorkAs, REACTIVATE_REFUSAL, signOutEverywhere, startWorkAs, suspendAccount } from "@/server/services/work-as";
import { changeRoom } from "@/server/services/room-changes";
import { cancelCheckIn, checkIn, createReservation } from "@/server/services/reservations";
import { submitBookingRequest } from "@/server/services/booking-requests";
import { ONLINE_RECORDER_ID } from "@/server/services/online-recorder";
import { addDays, businessDateOf, toDbDate, zonedInstant } from "@/lib/time/business-date";
import { englishT, makeT } from "@/i18n/translate";
import wall3 from "@/i18n/catalog/zh-CN/staff/developer-wall3";
import { cancelCheckInAction, changeRoomAction, createReservationAction } from "@/app/staff/(app)/reservations/actions";
import { convertRequestAction } from "@/app/staff/(app)/booking-requests/actions";
import { createGroupAction } from "@/app/staff/(app)/groups/actions";
import { saveServiceAction } from "@/app/staff/(app)/website/actions";
import { managerActor, resetBusinessData, roomType } from "../support/helpers";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, thrownBy, giveDeveloperRoleHotelWork, takeHotelWorkFromDeveloperRole, type MadeUser } from "../support/developer";

/**
 * THE WALL, THIRD PASS (owner, 2026-10-18). The last review found one critical back door and six smaller holes:
 *   1. a Developer could give "settings.manage" (or "reservations.edit", "dashboard.manager"…) to a harmless role, make an account in it with
 *      a password it chose, and sign in as that account — which is NOT a Developer, so no fence applied. No list of "harmless" rights held
 *      (every one was walked around), so the Developer now cannot create or change accounts, passwords, emails, roles or rights at all
 *      (developer-accounts-off.test.ts);
 *   2. a hotel-initiated move to a dearer room gives the difference away as "hotel compensation": a decision;
 *   3. menu items sent with a booking land on the guest's bill (booking form, website request, group rooms);
 *   4. cancelling a check-in moved an online payment's credit from one person to nobody;
 *   5. a hotel service's price, "chargeable" and price note are the prices guests are shown;
 *   6. suspending and signing people out are kept, but the Boss is now told every time;
 *   7. ending "work as" and its line in the trail are one transaction.
 * Every door is tried as the Developer on its own account AND as the Developer working as someone; the same door still opens for staff.
 */

const TZ = "Africa/Dar_es_Salaam";
const BEER = "mi_beers_heineken";
const SUFFIX = "@wall3.local";
const GOOD = "A fair reason";

let dev: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let rec: MadeUser;
let mgr: MadeUser;
let fin: MadeUser;
let everyone: MadeUser[];
const customRoles: string[] = [];

beforeAll(async () => {
  [dev, boss, md, rec, mgr, fin] = await Promise.all([
    makeUser("DEVELOPER", { fullName: "Dev Wall Three" }), makeUser("OWNER", { fullName: "Boss Wall Three" }), makeUser("ADMIN", { fullName: "MD Wall Three" }),
    makeUser("RECEPTIONIST", { fullName: "Reception Wall Three" }), makeUser("MANAGER", { fullName: "Manager Wall Three" }), makeUser("FINANCE", { fullName: "Finance Wall Three" }),
  ]);
  everyone = [dev, boss, md, rec, mgr, fin];
});
afterAll(async () => {
  browser.reset(); // no work-as left in the browser: removing accounts is exactly what the fence forbids while working as someone
  await rawDb.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
  await resetBusinessData();
  await db.bookingRequest.deleteMany();
  await db.hotelService.deleteMany({ where: { name: { startsWith: "Wall3 " } } });
  await db.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
  for (const code of customRoles) {
    await db.user.deleteMany({ where: { role: { code } } });
    await db.rolePermission.deleteMany({ where: { role: { code } } });
    await db.role.deleteMany({ where: { code } });
  }
  await removeMadeUsers();
});
beforeEach(async () => {
  vi.mocked(tellBossSoon).mockClear();
  browser.reset();
  await rawDb.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
  await rawDb.user.updateMany({ where: { id: { in: everyone.map((u) => u.id) } }, data: { isActive: true, mustChangePassword: false } });
});

// ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

const today = () => businessDateOf(new Date());
const at = (days: number, hour: number) => zonedInstant(addDays(today(), days), hour * 60, TZ);
const afterOf = (row: { after: unknown }) => (row.after ?? {}) as Record<string, unknown>;
async function refusal(run: () => Promise<unknown>): Promise<AppError> {
  const e = await thrownBy(run);
  expect(e, "an error was expected").toBeInstanceOf(AppError);
  return e as AppError;
}
const formOf = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

// ── signing in, for the actions ──
/** Sign in as this person (a fresh browser holding a real session cookie). */
async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id, { createdMinAgo: 1, seenMinAgo: 0 });
}
/** The Developer signed in — on its own account, or already working as `target` (written to the session row, as startWorkAs does). */
async function devAs(target: MadeUser | null = null): Promise<string> {
  browser.reset();
  const token = await makeSession(dev.id, { createdMinAgo: 1, seenMinAgo: 0 });
  if (target) await rawDb.session.update({ where: { tokenHash: sha256(token) }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - 60_000) } });
  return sha256(token);
}
const me = async () => {
  const u = await getCurrentUser();
  if (!u) throw new Error("not signed in");
  return u;
};
const label = (who: MadeUser | null) => (who ? `Developer as ${who.role}` : "Developer");
/** The acting person of the CURRENT request, built the way the actions build it (the rights are the session's own, work-as mark included). */
async function actorOfSession(copyRights = false) {
  const u = await me();
  return { userId: u.id, label: u.fullName, role: u.roleName, permissions: (copyRights ? new Set(u.permissions) : u.permissions) as ReadonlySet<string> };
}

// ── what a test compares: the hotel's records, not the audit trail ──
async function snapshot() {
  const [reservations, rooms, charges, assignments, orders, guests, groups, requests, payments, services, translations] = await Promise.all([
    db.reservation.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, netAmount: true, balanceAmount: true, paidAmount: true, discountAmount: true } }),
    db.reservationRoom.findMany({ orderBy: { id: "asc" }, select: { id: true, roomId: true, status: true, ratePerNight: true } }),
    db.reservationCharge.aggregate({ _count: true, _sum: { amount: true } }),
    db.roomAssignment.count(),
    db.restaurantOrder.count(),
    db.guest.count(),
    db.bookingGroup.count(),
    db.bookingRequest.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, reservationId: true } }),
    db.payment.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, creditedToId: true } }),
    db.hotelService.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, price: true, isChargeable: true, priceNote: true } }),
    db.hotelServiceTranslation.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, priceNote: true } }),
  ]);
  return JSON.stringify({ reservations, rooms, charges, assignments, orders, guests, groups, requests, payments, services, translations });
}
const deniedBy = (u: MadeUser) => db.auditLog.count({ where: { userId: u.id, action: "developer.denied" } });
const deniedAll = () => db.auditLog.count({ where: { action: "developer.denied" } });

type Res = { ok: boolean; code?: string; error?: string };

/** The Developer's attempt — on its own account (`who` = null) or working as `who`: refused (FORBIDDEN), nothing written, one refusal entry under its identity. */
async function developerRefused(name: string, who: MadeUser | null, run: () => Promise<Res>) {
  await devAs(who);
  const [before, denied] = [await snapshot(), await deniedBy(dev)];
  const res = await run();
  const tag = `${name} [${label(who)}]`;
  expect(res.ok, `${tag}: should be refused (${res.error ?? "it worked"})`).toBe(false);
  expect(res.code, `${tag}: ${res.error}`).toBe("FORBIDDEN");
  expect(await snapshot(), `${tag}: nothing may change`).toBe(before);
  expect(await deniedBy(dev), `${tag}: one refusal entry`).toBe(denied + 1);
  const row = await db.auditLog.findFirstOrThrow({ where: { userId: dev.id, action: "developer.denied" }, orderBy: { createdAt: "desc" } });
  expect(row, tag).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER" });
  if (who) expect(row.actorLabel, tag).toBe(`${dev.fullName} (Developer) as ${who.fullName} (${(await db.user.findUniqueOrThrow({ where: { id: who.id }, include: { role: true } })).role.name})`);
  else expect(row.actorLabel, tag).toBe(dev.fullName);
}
/** Someone who may decide: it works, and the Developer's refusal log did not grow. */
async function decided(name: string, who: MadeUser, run: () => Promise<Res>) {
  await as(who);
  const denied = await deniedAll();
  const res = await run();
  expect(res.ok, `${name} (${who.role}): ${res.error ?? ""}`).toBe(true);
  expect(await deniedAll(), name).toBe(denied);
}
/** A service called with a Developer's rights: FORBIDDEN, whatever else the actor was given. */
const refusedByService = async (run: () => Promise<unknown>) => {
  const e = await refusal(run);
  expect(e.code).toBe("FORBIDDEN");
  return e;
};

// ═════════════════════════════════════ 1. the words ═════════════════════════════════════
// (The accounts the Developer may or may not manage are no longer decided here: the Developer cannot create or change accounts at all —
// see developer-accounts-off.test.ts.)
describe("the Chinese words for the re-activation refusal and the Boss's notices are in the wall-3 catalog", () => {
  it("every one is Chinese, with the same placeholders as the English", () => {
    for (const key of [
      REACTIVATE_REFUSAL,
      "{developer} (Developer) suspended {person} ({role}) at {time}. Reason: {reason}. You can switch the account back on in Staff & roles.",
      "{developer} (Developer) signed {person} ({role}) out of every phone and computer at {time}. They can sign straight back in.",
    ]) expect(wall3[key], key).toMatch(/[\u4e00-\u9fff]/);
    for (const [en, zh] of Object.entries(wall3)) expect([...zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), en).toEqual([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
  });
});

// ═════════════════════════════════════ 2. a hotel move to a dearer room ═════════════════════════════════════
describe("a room move the hotel makes to a dearer room is a decision (it gives the difference away as 'hotel compensation')", () => {
  beforeEach(async () => {
    await resetBusinessData();
    await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate(today()), userId: rec.id, startedAt: new Date(Date.now() - 3_600_000) } });
  });
  /** Double Deluxe (many rooms) is the cheap type, Executive Suite the dear one, Standard the cheapest. */
  async function types() {
    const get = (code: string) => db.roomType.findUniqueOrThrow({ where: { code }, include: { rooms: { orderBy: { number: "asc" } } } });
    const [cheap, dear, cheapest] = await Promise.all([get("DOUBLE_DELUXE"), get("EXECUTIVE_SUITE"), get("STANDARD")]);
    expect(dear.baseRate, "the dear type costs more than the cheap one").toBeGreaterThan(cheap.baseRate);
    expect(cheapest.baseRate, "the cheapest type costs less").toBeLessThan(cheap.baseRate);
    return { cheap, dear, cheapest };
  }
  /** A booking in a cheap (or the dear) room — waiting to arrive, or checked in. */
  async function stay(roomIndex: number, inHouse: boolean, kind: "cheap" | "dear" = "cheap") {
    const { cheap, dear } = await types();
    const type = kind === "cheap" ? cheap : dear;
    const m = await managerActor();
    const from = inHouse ? -1 : 5;
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: `Mover ${roomIndex}${inHouse ? "h" : "w"}${kind}`, phone: `07130${kind === "cheap" ? 1 : 2}${roomIndex}${inHouse ? 1 : 2}0` },
      stay: { kind: "overnight", arrivalDate: addDays(today(), from), departureDate: addDays(today(), from + 3) },
      rooms: [{ roomTypeId: type.id, roomId: type.rooms[roomIndex].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, m, at(from, 12));
    if (inHouse) await checkIn(r.id, m, null, at(from, 15));
    const full = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true } });
    return { id: full.id, rrId: full.rooms[0].id };
  }
  const moveTo = (s: { id: string; rrId: string }, toRoomId: string, source: "HOTEL" | "CUSTOMER" = "HOTEL") =>
    changeRoomAction({ reservationId: s.id, reservationRoomId: s.rrId, toRoomId, source, reasonCode: source === "HOTEL" ? "AC_PROBLEM" : null, ...(source === "HOTEL" ? { note: "AC stopped" } : {}) });

  it("before check-in and in the hotel: refused for the Developer (own account, and working as Reception / a Manager); staff still do it, and the compensation is recorded", async () => {
    const { dear } = await types();
    for (const inHouse of [false, true]) {
      const s = await stay(inHouse ? 1 : 0, inHouse);
      for (const who of [null, rec, mgr]) {
        await developerRefused(`hotel move to a dearer room (${inHouse ? "in the hotel" : "before check-in"})`, who, () => moveTo(s, dear.rooms[0].id));
      }
      expect(await db.roomAssignment.count({ where: { reservationRoomId: s.rrId } })).toBe(0);
      await decided("hotel move to a dearer room", inHouse ? mgr : rec, () => moveTo(s, dear.rooms[inHouse ? 1 : 2].id));
      const move = await db.roomAssignment.findFirstOrThrow({ where: { reservationRoomId: s.rrId } });
      expect(move.compensation, "the difference is given away as compensation").toBeGreaterThan(0);
      expect(move.charged).toBe(0);
    }
  });

  it("not decisions, so still open to the Developer: a hotel move to a room of the same price, or to a cheaper one (nothing is given away)", async () => {
    const { cheap, cheapest } = await types();
    const s = await stay(3, false);
    await devAs(null);
    const same = await moveTo(s, cheap.rooms[4].id);
    expect(same.ok, same.ok ? "" : same.error).toBe(true);
    expect((await db.roomAssignment.findFirstOrThrow({ where: { reservationRoomId: s.rrId } })).compensation).toBe(0);
    // From the dear room to the cheapest: the price already agreed stays; the difference is negative, nobody gets anything.
    const d = await stay(2, false, "dear");
    await devAs(rec);
    const down = await moveTo(d, cheapest.rooms[0].id);
    expect(down.ok, down.ok ? "" : down.error).toBe(true);
    expect((await db.roomAssignment.findFirstOrThrow({ where: { reservationRoomId: d.rrId } })).compensation).toBe(0);
    expect(await deniedAll(), "no refusal was written").toBe(0);
  });

  it("the service refuses on its own — also for rights given on purpose, marked as working as someone, and a copy of them", async () => {
    const { dear } = await types();
    const s = await stay(5, false);
    const before = await snapshot();
    const input = { reservationRoomId: s.rrId, toRoomId: dear.rooms[4].id, source: "HOTEL" as const, reasonCode: "AC_PROBLEM", note: "AC stopped" };
    const mine = await managerActor();
    const rights = [...(mine.permissions ?? [])];
    await devAs(null);
    await refusedByService(async () => changeRoom(input, { userId: dev.id, label: dev.fullName, permissions: new Set([...rights, "developer.access"]) }));
    await refusedByService(async () => changeRoom(input, { userId: mgr.id, label: mgr.fullName, permissions: markWorkingAs(new Set(rights)) }));
    await devAs(mgr);
    await refusedByService(async () => changeRoom(input, await actorOfSession(true))); // a copy loses the mark; the request still says no
    expect(await snapshot()).toBe(before);
    browser.reset();
    await changeRoom(input, mine); // the manager's own actor, no session working as anyone: goes through
    expect((await db.roomAssignment.findFirstOrThrow({ where: { reservationRoomId: s.rrId } })).compensation).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════ 3. food and drinks sent with a booking ═════════════════════════════════════
describe("menu items sent with a booking land on the guest's bill: never by the Developer — booking form, website request, group rooms", () => {
  let n = 0;
  let k = 0;
  beforeEach(async () => {
    k = 0;
    await resetBusinessData();
    await db.bookingRequest.deleteMany();
    await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate(today()), userId: rec.id, startedAt: new Date(Date.now() - 3_600_000) } });
  });
  const phone = () => `07140${String(100000 + n++).slice(1)}`;
  const menuCharges = () => db.reservationCharge.findMany({ where: { menuItemId: BEER } });

  async function bookingInput(over: Record<string, unknown> = {}) {
    const t = await roomType("DOUBLE_DELUXE");
    return {
      sourceCode: "PHONE", stay: { kind: "overnight" as const, arrivalDate: addDays(today(), 12), departureDate: addDays(today(), 13) },
      guest: { fullName: `Pre Orderer ${n}`, phone: phone() }, rooms: [{ roomTypeId: t.id, roomId: t.rooms[k++].id, adults: 1, children: 0 }],
      menuItems: [{ menuItemId: BEER, quantity: 2 }], ...over,
    };
  }

  it("the booking form: refused for the Developer (own account, working as Reception / a Manager), nothing made; Reception and a Manager still book with a pre-order", async () => {
    for (const who of [null, rec, mgr]) {
      const input = await bookingInput();
      await developerRefused("a booking with a pre-order", who, async (): Promise<Res> => createReservationAction(input) as never);
    }
    expect(await db.reservation.count()).toBe(0);
    // Without menu items the Developer books as before.
    await devAs(null);
    expect((await createReservationAction(await bookingInput({ menuItems: null }))).ok).toBe(true);
    expect(await db.reservation.count()).toBe(1);
    for (const who of [rec, mgr]) {
      const input = await bookingInput();
      await decided("a booking with a pre-order", who, async () => createReservationAction(input) as never);
    }
    const charges = await menuCharges();
    expect(charges).toHaveLength(2);
    expect(charges[0].description).toMatch(/\(pre-order\)/);
  });

  it("a website request being confirmed: refused for the Developer, the request stays open; Reception confirms it with the pre-order", async () => {
    const t = await roomType("DOUBLE_DELUXE");
    const sub = await submitBookingRequest(
      { checkIn: addDays(today(), 8), checkOut: addDays(today(), 10), typeSlug: "double-deluxe", rooms: 1, adults: 2, children: 0 },
      { fullName: "Web Guest", phone: phone() }, null,
    );
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: sub.reference } });
    const form = () => formOf({
      id: req.id, checkIn: addDays(today(), 8), checkOut: addDays(today(), 10), roomTypeId: t.id, roomCount: "1", adults: "2", children: "0",
      menuItems: JSON.stringify([{ menuItemId: BEER, quantity: 3 }]),
    });
    for (const who of [null, rec, mgr]) await developerRefused("confirming a request with a pre-order", who, () => convertRequestAction(null, form()) as never);
    expect((await db.bookingRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("NEW");
    await as(rec);
    const denied = await deniedAll();
    const to = await redirectOf(() => convertRequestAction(null, form()));
    expect(to, "Reception is sent to the new reservation").toMatch(/\/staff\/reservations\//);
    expect(await deniedAll()).toBe(denied);
    expect((await db.bookingRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CONVERTED");
    expect(await menuCharges()).toHaveLength(1);
  });

  it("a group: rooms that pay their own bill with menu items are refused for the Developer; the same group without them is still fine; a Manager books them with the items", async () => {
    const t = await roomType("DOUBLE_DELUXE");
    const group = (menuItems: { menuItemId: string; quantity: number }[] | null) => ({
      name: "Wedding party", type: "FAMILY" as const, contact: { fullName: "Neema Host", phone: phone() }, sourceCode: "PHONE", billing: "COMBINED" as const,
      arrivalDate: addDays(today(), 30), departureDate: addDays(today(), 32),
      rooms: [{ roomTypeId: t.id, adults: 1, children: 0, ownBill: true, menuItems }],
    });
    for (const who of [null, rec, mgr]) await developerRefused("a group with a pre-order", who, () => createGroupAction(group([{ menuItemId: BEER, quantity: 2 }])) as never);
    expect(await db.bookingGroup.count()).toBe(0);
    await devAs(null);
    expect((await createGroupAction(group(null))).ok, "no menu items: allowed as before").toBe(true);
    await decided("a group with a pre-order", mgr, async () => createGroupAction(group([{ menuItemId: BEER, quantity: 2 }])) as never);
    expect(await menuCharges()).toHaveLength(1);
  });
});

// ═════════════════════════════════════ 4. cancelling a check-in ═════════════════════════════════════
describe("cancelling a check-in: the Developer never moves an online payment's credit away from the person it was counted for", () => {
  let n = 0;
  beforeEach(async () => {
    await resetBusinessData();
    await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate(today()), userId: rec.id, startedAt: new Date(Date.now() - 3_600_000) } });
  });
  /** A booking for today with a guest's online (nTZS) payment, checked in by Reception — so the payment is credited to her. */
  async function checkedInWithOnlinePayment() {
    const t = await roomType("DOUBLE_DELUXE");
    const m = await managerActor();
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: `Online Payer ${n}`, phone: `0715100${String(100 + n)}` },
      stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 1) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[n++].id, adults: 1, children: 0 }],
    }, m);
    const method = await db.paymentMethod.findUniqueOrThrow({ where: { code: "MOBILE_MONEY" } });
    const account = await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } });
    const paid = await db.payment.create({
      data: { amount: 50_000, methodId: method.id, accountId: account.id, receivedAt: new Date(), businessDate: toDbDate(today()), reservationId: r.id, recordedById: ONLINE_RECORDER_ID },
    });
    await as(rec);
    await checkIn(r.id, await actorOfSession(), null, new Date());
    const credited = await db.payment.findUniqueOrThrow({ where: { id: paid.id } });
    expect(credited.creditedToId, "Reception was credited at check-in").toBe(rec.id);
    return { id: r.id, paid: paid.id, creditedAt: credited.creditedAt };
  }
  const credit = async (id: string) => (await db.payment.findUniqueOrThrow({ where: { id } })).creditedToId;

  it("a Developer cancelling it — on its own account, as a Manager, as Reception, or through a copy of the rights — leaves the credit with Reception; a Manager cancelling un-credits it as before", async () => {
    for (const who of [null, mgr, rec] as const) {
      const s = await checkedInWithOnlinePayment();
      await devAs(who);
      const res = await cancelCheckInAction({ reservationId: s.id, reason: "Wrong guest at the desk" });
      expect(res.ok, `${label(who)}: ${res.ok ? "" : res.error}`).toBe(true);
      expect((await db.reservation.findUniqueOrThrow({ where: { id: s.id } })).status, label(who)).toBe("CONFIRMED");
      expect(await credit(s.paid), `${label(who)}: the credit stays where it was`).toBe(rec.id);
      expect((await db.payment.findUniqueOrThrow({ where: { id: s.paid } })).creditedAt, label(who)).toEqual(s.creditedAt);
    }
    // The service, with a copy of the rights (the mark is lost; the request itself says it is a work-as).
    const copy = await checkedInWithOnlinePayment();
    await devAs(mgr);
    await cancelCheckIn(copy.id, await actorOfSession(true), "Wrong guest at the desk");
    expect(await credit(copy.paid)).toBe(rec.id);
    // Staff, unchanged: the credit goes back to nobody, for the right check-in to count it.
    const staff = await checkedInWithOnlinePayment();
    await as(mgr);
    expect((await cancelCheckInAction({ reservationId: staff.id, reason: "Wrong guest at the desk" })).ok).toBe(true);
    expect(await credit(staff.paid)).toBeNull();
  });
});

// ═════════════════════════════════════ 5. the services of the hotel's website ═════════════════════════════════════
describe("a hotel service's price, 'chargeable' and price note are the prices guests are shown: not the Developer's", () => {
  const service = (over: Record<string, string> = {}) => formOf({
    name: "Wall3 Laundry", description: "Washed and folded", category: "CONVENIENCE", icon: "BrushCleaning", isActive: "on", isPublic: "on", price: "", priceNote: "", ...over,
  });
  async function made(over: Record<string, string> = {}) {
    await as(md);
    expect((await saveServiceAction(null, service(over))).ok).toBe(true);
    return db.hotelService.findFirstOrThrow({ where: { name: over.name ?? "Wall3 Laundry" } });
  }
  beforeEach(async () => {
    await db.hotelService.deleteMany({ where: { name: { startsWith: "Wall3 " } } });
  });

  it("changing the price, switching 'chargeable' on or off, or changing the price note (English or Chinese): refused for the Developer, own account and working as the MD; nothing written", async () => {
    const s = await made({ isChargeable: "on", price: "5000", priceNote: "per kilo", zh_name: "洗衣", zh_description: "", zh_priceNote: "每公斤" });
    const withId = (over: Record<string, string>) => service({ id: s.id, isChargeable: "on", price: "5000", priceNote: "per kilo", zh_name: "洗衣", zh_description: "", zh_priceNote: "每公斤", ...over });
    for (const who of [null, md] as const) {
      await developerRefused("a new price", who, () => saveServiceAction(null, withId({ price: "500" })) as never);
      await developerRefused("a free service", who, () => saveServiceAction(null, withId({ isChargeable: "" })) as never);
      await developerRefused("a price note", who, () => saveServiceAction(null, withId({ priceNote: "free today" })) as never);
      await developerRefused("a Chinese price note", who, () => saveServiceAction(null, withId({ zh_priceNote: "今日免费" })) as never);
      await developerRefused("a price removed", who, () => saveServiceAction(null, withId({ price: "" })) as never);
    }
    // A new service with a price is a price too; one without any is not.
    await developerRefused("a new service with a price", null, () => saveServiceAction(null, service({ name: "Wall3 New Priced", isChargeable: "on", price: "9000" })) as never);
    expect(await db.hotelService.count({ where: { name: "Wall3 New Priced" } })).toBe(0);
  });

  it("its name, description, icon and visibility stay open to the Developer; a save that leaves the three price fields as they are works", async () => {
    const s = await made({ isChargeable: "on", price: "5000", priceNote: "per kilo", zh_name: "洗衣", zh_description: "", zh_priceNote: "每公斤" });
    await devAs(null);
    const keep = { id: s.id, isChargeable: "on", price: "5000", priceNote: "per kilo", zh_name: "洗衣", zh_description: "", zh_priceNote: "每公斤" };
    const res = await saveServiceAction(null, service({ ...keep, name: "Wall3 Laundry & Ironing", description: "Washed, folded and ironed", isPublic: "" }));
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(await db.hotelService.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ name: "Wall3 Laundry & Ironing", price: 5000, isChargeable: true, priceNote: "per kilo", isPublic: false });
    // Working as the MD it is the same.
    await devAs(md);
    expect((await saveServiceAction(null, service({ ...keep, name: "Wall3 Laundry Plus", description: "More" }))).ok).toBe(true);
    // A new service with no price at all.
    await devAs(null);
    expect((await saveServiceAction(null, service({ name: "Wall3 Quiet Room Service" }))).ok).toBe(true);
  });

  it("the Boss and the MD still set prices, exactly as before", async () => {
    const s = await made({ isChargeable: "on", price: "5000", priceNote: "per kilo" });
    for (const who of [md, boss]) {
      await decided("a new price", who, async () => saveServiceAction(null, service({ id: s.id, isChargeable: "on", price: who === md ? "6000" : "7000", priceNote: "per kilo, ironed" })) as never);
    }
    expect(await db.hotelService.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ price: 7000, priceNote: "per kilo, ironed" });
  });
});

// ═════════════════════════════════════ 6. suspending and signing out: the Boss is told ═════════════════════════════════════
describe("suspend and sign out everywhere stay — and the Boss is told on WhatsApp every time, and how the telling went is written down", () => {
  const noticeRows = () => db.auditLog.findMany({ where: { action: "developer.access_notice" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const sent = () => vi.mocked(tellBossSoon).mock.calls;
  type Sent = ReturnType<typeof sent>[number];
  const textOf = (call: Sent, t: Parameters<Sent[0]>[0] = englishT) => call[0](t, { timezone: TZ } as never);

  it("suspending: one notice — who, whom, when and why, and the Boss's remedy — and the follow-up writes how it went, under the Developer's name", async () => {
    await devAs(null);
    const before = (await noticeRows()).length;
    await suspendAccount(await me(), rec.id, { reason: "Phone was stolen in town", confirm: "CONFIRM" });
    expect((await db.user.findUniqueOrThrow({ where: { id: rec.id } })).isActive).toBe(false);
    expect(sent()).toHaveLength(1);
    expect(textOf(sent()[0])).toMatch(new RegExp(`^${dev.fullName} \\(Developer\\) suspended ${rec.fullName} \\(Receptionist\\) at \\d\\d:\\d\\d\\. Reason: Phone was stolen in town\\. You can switch the account back on in Staff & roles\\.$`));
    // The telling is over: two people were meant to be told, one was.
    await sent()[0][1]!({ recipients: 2, told: 1, failed: 1 } as never);
    const rows = (await noticeRows()).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: dev.fullName, entityType: "User", entityId: rec.id });
    expect(afterOf(rows[0])).toEqual({ what: "suspended", targetName: rec.fullName, targetRole: "Receptionist", recipients: 2, told: 1, failed: 1 });
    // Said in Chinese for a Chinese reader.
    const zh = makeT("zh-CN", { ...wall3, Receptionist: "前台" });
    const text = textOf(sent()[0], zh);
    expect(text).toContain("停用");
    expect(text).toContain("Phone was stolen in town");
    expect(text).toContain("前台");
    expect(text).not.toMatch(/suspended|switch the account/);
  });

  it("signing out everywhere: one notice, and its follow-up", async () => {
    await makeSession(fin.id, { setCookie: false });
    await devAs(null);
    const before = (await noticeRows()).length;
    const out = await signOutEverywhere(await me(), fin.id);
    expect(out.sessionsEnded).toBe(1);
    expect(sent()).toHaveLength(1);
    expect(textOf(sent()[0])).toMatch(new RegExp(`^${dev.fullName} \\(Developer\\) signed ${fin.fullName} \\(Finance\\) out of every phone and computer at \\d\\d:\\d\\d\\. They can sign straight back in\\.$`));
    await sent()[0][1]!({ recipients: 0, told: 0, failed: 0 } as never);
    const rows = (await noticeRows()).slice(before);
    expect(afterOf(rows[0])).toEqual({ what: "signed_out_everywhere", targetName: fin.fullName, targetRole: "Finance", recipients: 0, told: 0, failed: 0 });
    expect(rows[0]).toMatchObject({ userId: dev.id, entityId: fin.id });
    const zh = textOf(sent()[0], makeT("zh-CN", { ...wall3, Finance: "财务" }));
    expect(zh).toContain("所有手机和电脑");
    expect(zh).toContain("财务");
  });

  it("every one is told: a second suspension and a second sign-out each send their own notice", async () => {
    await devAs(null);
    const d = await me();
    await suspendAccount(d, rec.id, { reason: GOOD, confirm: "CONFIRM" });
    await suspendAccount(d, mgr.id, { reason: GOOD, confirm: "CONFIRM" });
    await signOutEverywhere(d, fin.id);
    await signOutEverywhere(d, fin.id);
    expect(sent()).toHaveLength(4);
  });

  it("a refused or failed attempt tells nobody: the Boss's account, a missing CONFIRM, a short reason, an account already off, a Developer, working as someone, and a staff member", async () => {
    await devAs(null);
    const d = await me();
    await refusal(() => suspendAccount(d, boss.id, { reason: GOOD, confirm: "CONFIRM" }));
    await refusal(() => suspendAccount(d, rec.id, { reason: GOOD, confirm: "confirm" }));
    await refusal(() => suspendAccount(d, rec.id, { reason: "no", confirm: "CONFIRM" }));
    await refusal(() => signOutEverywhere(d, boss.id));
    await rawDb.user.update({ where: { id: mgr.id }, data: { isActive: false } });
    await refusal(() => suspendAccount(d, mgr.id, { reason: GOOD, confirm: "CONFIRM" }));
    await refusal(() => suspendAccount(d, dev.id, { reason: GOOD, confirm: "CONFIRM" }));
    await devAs(rec);
    const working = await me();
    await refusal(() => suspendAccount(working, fin.id, { reason: GOOD, confirm: "CONFIRM" }));
    await refusal(() => signOutEverywhere(working, fin.id));
    await as(md);
    await refusal(async () => suspendAccount(await me(), fin.id, { reason: GOOD, confirm: "CONFIRM" }));
    expect(sent()).toHaveLength(0);
  });
});

// ═════════════════════════════════════ 7. ending work-as ═════════════════════════════════════
describe("ending 'work as': the end and its line in the trail are one transaction", () => {
  const ended = () => db.auditLog.findMany({ where: { action: "developer.work_as_ended", userId: dev.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

  it("Stop clears the session and writes ONE line under the Developer, naming the person and the minutes", async () => {
    const hash = await devAs(null);
    await startWorkAs(await me(), rec.id);
    expect((await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).workAsUserId).toBe(rec.id);
    const before = (await ended()).length;
    await endWorkAs(await me());
    expect(await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).toMatchObject({ workAsUserId: null, workAsStartedAt: null });
    const rows = (await ended()).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", actorLabel: dev.fullName, entityType: "User", entityId: rec.id });
    expect(afterOf(rows[0])).toMatchObject({ targetName: rec.fullName, targetRole: "Receptionist" });
    // Stopping when nothing is on: nothing is written.
    await endWorkAs(await me());
    expect((await ended()).slice(before)).toHaveLength(1);
  });

  it("when the line cannot be written the end does not happen either — the Developer is still working as the person, and Stop works the next time", async () => {
    const hash = await devAs(null);
    await startWorkAs(await me(), rec.id);
    const before = (await ended()).length;
    const real = await import("@/server/audit");
    const realAudit = real.audit;
    const spy = vi.spyOn(real, "audit").mockImplementation(async (tx, actor, entry) => {
      if (entry.action === "developer.work_as_ended") throw new Error("audit trail down");
      return realAudit(tx, actor, entry);
    });
    let err: unknown;
    try {
      err = await thrownBy(async () => endWorkAs(await me()));
    } finally {
      spy.mockRestore();
    }
    expect(err).toBeInstanceOf(Error);
    expect((await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).workAsUserId, "still working as the person: an end is never left without its line").toBe(rec.id);
    expect((await ended()).slice(before)).toHaveLength(0);
    await endWorkAs(await me());
    expect((await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).workAsUserId).toBeNull();
    expect((await ended()).slice(before)).toHaveLength(1);
  });

  it("two Stops at the same moment make one line", async () => {
    await devAs(null);
    await startWorkAs(await me(), rec.id);
    const user = await me();
    const before = (await ended()).length;
    await Promise.all([endWorkAs(user), endWorkAs(user)]);
    expect((await ended()).slice(before)).toHaveLength(1);
  });
});

// The Developer role does not hold the hotel's-work rights any more (they come only through Work as); these tests prove the fences hold even if it did.
beforeAll(async () => { await giveDeveloperRoleHotelWork(); });
afterAll(async () => { await takeHotelWorkFromDeveloperRole(); });
