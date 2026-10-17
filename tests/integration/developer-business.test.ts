import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The cookie jar and the redirect are built here, with nothing imported: the mock of next/headers must not pull in the database client
// (the client reads the session cookie, so a mock that imports it would wait for itself).
const h = vi.hoisted(() => {
  class Redirected extends Error { constructor(public readonly url: string) { super(`NEXT_REDIRECT ${url}`); } }
  return { cookies: new Map<string, string>(), headers: new Headers({ "user-agent": "vitest", "x-forwarded-for": "41.7.7.7" }), Redirected };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => { h.cookies.set(name, value); },
    delete: (name: string) => { h.cookies.delete(name); },
  }),
  headers: async () => h.headers,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new h.Redirected(url); } }));

import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { createReservation } from "@/server/services/reservations";
import { recordReservationPayment, reversePayment } from "@/server/services/payments";
import { auditActionWords, auditToday, queryAuditTrail } from "@/server/services/audit-trail";
import { getSettings } from "@/server/settings";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { staffHome } from "@/lib/staff-home";
import { toDbDate } from "@/lib/time/business-date";
import { makeT } from "@/i18n/translate";
import {
  BUSINESS_LIMIT, BUSINESS_TABS, BUSINESS_VIEW_ACTION, businessCustomers, businessMoney, businessRestaurant, businessStays, businessStores,
  noteBusinessView, parseBusinessTab, type BusinessViewer, type CustomerRow, type ExpenseRow, type LowStockRow, type MovementRow, type OrderRow, type PaymentRow, type StayRow,
} from "@/server/services/developer-business";
import {
  CustomersTable, ExpensesTable, LowStockTable, MovementsTable, OrdersTable, PaymentsTable, StaysTable,
} from "@/app/staff/(app)/developer/business/business-tables";
import DeveloperBusinessPage from "@/app/staff/(app)/developer/business/page";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";
import { makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * BUSINESS — "look, don't touch" (owner, 2026-10-17), proven against a real database:
 *   - only the Developer account may read it (the Boss, the MD, a manager, Finance… are all refused, by every function);
 *   - every table holds at most 30 rows, newest first, with the figures the system keeps — in full (TZS 703,000), dates in the hotel's time zone;
 *   - nothing personal beyond a name and a phone number, no account number, no way to change anything.
 */

const TAG = randomUUID().slice(0, 6);
const NOW = eat("2026-10-05T10:00:00");
const SESSION_COOKIE = "vlh_session";
const N = BUSINESS_LIMIT + 2; // two more than a table shows

let dev: MadeUser, boss: MadeUser, md: MadeUser, mgr: MadeUser, fin: MadeUser, rec: MadeUser;
const t = makeT("en", null);

const asViewer = (role: keyof typeof DEFAULT_ROLES, u: MadeUser, over: Partial<BusinessViewer> = {}): BusinessViewer => ({
  id: u.id, fullName: u.fullName, actorType: role === "DEVELOPER" ? "DEVELOPER" : "STAFF", permissions: new Set(DEFAULT_ROLES[role].permissions) as BusinessViewer["permissions"], ...over,
});
let DEV: BusinessViewer;

/** Sign the fake browser in as this person (a real session row, its cookie in the jar). */
async function signIn(u: MadeUser) {
  h.cookies.clear();
  h.cookies.set(SESSION_COOKIE, await makeSession(u.id, { setCookie: false }));
}
async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try { await run(); return null; } catch (e) { if (e instanceof h.Redirected) return e.url; throw e; }
}

// ───────────────────────────────────────────── the data ─────────────────────────────────────────────
const reservationIds: string[] = [];
let reversedPaymentId = "";
const SECRET_EMAIL = `secret-${TAG}@guest.test`;
const SECRET_ID = `ID-SECRET-${TAG}`;
const SECRET_ACCOUNT = `ACC-SECRET-${TAG}`;
let cashAccountId = "";
let cashAccountNumber: string | null = null;

beforeAll(async () => {
  await resetBusinessData();
  dev = await makeUser("DEVELOPER", { fullName: `Dev Biz ${TAG}` });
  boss = await makeUser("OWNER", { fullName: `Boss Biz ${TAG}` });
  md = await makeUser("ADMIN", { fullName: `MD Biz ${TAG}` });
  mgr = await makeUser("MANAGER", { fullName: `Manager Biz ${TAG}` });
  fin = await makeUser("FINANCE", { fullName: `Finance Biz ${TAG}` });
  rec = await makeUser("RECEPTIONIST", { fullName: `Asha Biz ${TAG}` });
  DEV = asViewer("DEVELOPER", dev);

  const actor = await managerActor();
  const type = await roomType("DOUBLE_DELUXE");
  const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
  cashAccountId = cash.accountId!;
  const account = await db.moneyAccount.findUniqueOrThrow({ where: { id: cashAccountId } });
  cashAccountNumber = account.accountNumber;
  await db.moneyAccount.update({ where: { id: cashAccountId }, data: { accountNumber: SECRET_ACCOUNT } });

  // 32 bookings, one night each on its own day, made one after the other (so "newest first" is the last made).
  for (let i = 1; i <= N; i++) {
    const day = String(i).padStart(2, "0");
    const arrival = i <= 31 ? `2027-01-${day}` : "2027-02-01";
    const departure = i <= 30 ? `2027-01-${String(i + 1).padStart(2, "0")}` : i === 31 ? "2027-02-01" : "2027-02-02";
    const r = await createReservation(
      { sourceCode: "PHONE", guest: { fullName: `Biz Guest ${String(i).padStart(2, "0")}`, phone: `07${String(10_000_000 + i)}` }, stay: { kind: "overnight", arrivalDate: arrival, departureDate: departure }, rooms: [{ roomTypeId: type.id, adults: 1, children: 0 }] },
      actor, NOW,
    );
    reservationIds.push(r.id);
  }
  // A payment on 31 of them (so there are more than a table shows), one of them reversed afterwards.
  for (let i = 0; i < N - 1; i++) {
    const p = await recordReservationPayment({ reservationId: reservationIds[i], amount: 1_000 + i, methodId: cash.id }, actor);
    if (i === 3) { reversedPaymentId = p.id; await reversePayment(p.id, "Typed the wrong amount", actor); }
  }
  // Personal details a Developer must NOT be shown here.
  const last = await db.reservation.findUniqueOrThrow({ where: { id: reservationIds[N - 1] }, select: { guestId: true } });
  await db.guest.update({ where: { id: last.guestId }, data: { email: SECRET_EMAIL, idNumber: SECRET_ID, idType: "PASSPORT" } });
  // A customer a manager removed (not listed), and a guest who has stayed (a checked-out booking: "last stay").
  await db.guest.create({ data: { fullName: `Removed Customer ${TAG}`, phone: "0799000999", deletedAt: new Date(Date.now() + 60_000), createdAt: new Date(Date.now() + 60_000) } });
  await db.reservation.update({ where: { id: reservationIds[N - 1] }, data: { status: "CHECKED_OUT" } });

  // 32 expenses (one voided), 32 restaurant orders (one on a room's bill), 32 stock movements, and four items to tell apart.
  const category = await db.expenseCategory.findFirstOrThrow({ orderBy: { code: "asc" } });
  const base = Date.now();
  for (let i = 1; i <= N; i++) {
    await db.expense.create({
      data: {
        number: `EXP-BIZ-${TAG}-${String(i).padStart(2, "0")}`, categoryId: category.id, amount: 10_000 + i, businessDate: toDbDate("2026-10-05"), spentAt: new Date(base + i * 60_000),
        description: `Biz expense ${String(i).padStart(2, "0")}`, createdById: boss.id, paymentMethodId: cash.id, accountId: cashAccountId,
        status: i === 5 ? "VOIDED" : "RECORDED", ...(i === 5 ? { voidedAt: new Date(), voidReason: "Entered twice" } : {}),
      },
    });
    await db.restaurantOrder.create({
      data: {
        number: `ORD-BIZ-${TAG}-${String(i).padStart(2, "0")}`, type: i === 7 ? "ROOM_SERVICE" : "DINE_IN", settlement: i === 7 ? "ROOM" : "PAY_NOW", foodSubtotal: 20_000 + i, drinksSubtotal: 0, total: 20_000 + i,
        businessDate: toDbDate("2026-10-05"), createdAt: new Date(base + i * 60_000), tableLabel: i === 7 ? null : `Table ${i}`, roomNumber: i === 7 ? "204" : null,
        paidAmount: i === 7 ? 0 : 20_000 + i, paymentStatus: i === 7 ? "UNPAID" : "PAID",
      },
    });
  }
  const dept = await db.inventoryDepartment.findFirstOrThrow({ where: { id: "invdep_restaurant" } });
  const cat = await db.inventoryCategory.findFirstOrThrow();
  const item = (name: string, quantity: number, minStock: number | null, isActive = true) =>
    db.inventoryItem.create({ data: { name: `${name} ${TAG}`, categoryId: cat.id, departmentId: dept.id, unit: "KG", quantity, minStock, isActive } });
  const flour = await item("Biz Flour", 1, 5); // below its minimum
  await item("Biz Beans", 2, 5); // below its minimum (listed first: by name)
  await item("Biz Rice", 10, 5); // fine
  await item("Biz Salt", 1, null); // no minimum set
  await item("Biz Old", 0, 5, false); // below, but no longer used
  for (let i = 1; i <= N; i++) {
    await db.inventoryMovement.create({
      data: { itemId: flour.id, kind: "USE", reason: "KITCHEN_USAGE", change: -i, unit: "KG", status: i === 4 ? "PENDING" : "POSTED", recordedById: rec.id, recordedAt: new Date(base + i * 60_000) },
    });
  }
}, 600_000);

afterAll(async () => {
  if (cashAccountId) await db.moneyAccount.update({ where: { id: cashAccountId }, data: { accountNumber: cashAccountNumber } });
  // This file's own rows (bookings, payments, expenses, orders, stock, the audit entries) all go — the rows made by the accounts first.
  await resetBusinessData();
  await removeMadeUsers();
});
beforeEach(() => h.cookies.clear());

const sorted = <T,>(rows: T[], by: (r: T) => number) => rows.every((r, i) => i === 0 || by(rows[i - 1]) >= by(r));

// ───────────────────────────────────────────── 1. who may read it ─────────────────────────────────────────────
describe("only the Developer account may read Business", () => {
  const readers: [string, (v: BusinessViewer) => Promise<unknown>][] = [
    ["stays", businessStays], ["money", businessMoney], ["restaurant", businessRestaurant], ["stores", businessStores], ["customers", businessCustomers],
  ];

  it("the Developer reads every table", async () => {
    for (const [name, read] of readers) expect(await thrownBy(() => read(DEV)), name).toBeNull();
  });

  it("every function refuses the Boss, the MD, a manager, Finance, Reception and the rest — whatever they hold", async () => {
    const people: [keyof typeof DEFAULT_ROLES, MadeUser][] = [["OWNER", boss], ["ADMIN", md], ["MANAGER", mgr], ["FINANCE", fin], ["RECEPTIONIST", rec]];
    for (const [role, u] of people) {
      for (const [name, read] of readers) {
        const e = await thrownBy(() => read(asViewer(role, u)));
        expect(e, `${role} → ${name}`).toBeInstanceOf(AppError);
        expect((e as AppError).code, `${role} → ${name}`).toBe("FORBIDDEN");
      }
    }
    for (const role of ["ACCOUNTANT", "RESTAURANT", "KITCHEN", "DRIVER"] as const) {
      expect(await thrownBy(() => businessMoney(asViewer(role, rec))), role).toBeInstanceOf(AppError);
    }
    // even every right in the system, as a staff account, does not open it
    const everything = { ...asViewer("OWNER", boss), permissions: new Set([...DEFAULT_ROLES.OWNER.permissions, ...DEFAULT_ROLES.ADMIN.permissions, "developer.access"]) as BusinessViewer["permissions"] };
    for (const [name, read] of readers) expect(await thrownBy(() => read(everything)), name).toBeInstanceOf(AppError);
  });

  it("a Developer working as someone (it holds that person's rights, not developer.access) is refused too", async () => {
    const working = asViewer("DEVELOPER", dev, { permissions: new Set(DEFAULT_ROLES.RECEPTIONIST.permissions) as BusinessViewer["permissions"] });
    for (const [name, read] of readers) expect(await thrownBy(() => read(working)), name).toBeInstanceOf(AppError);
  });

  it("nobody at all, and a made-up viewer, get nothing", async () => {
    for (const [name, read] of readers) {
      expect(await thrownBy(() => read(null as unknown as BusinessViewer)), name).toBeTruthy();
      expect(await thrownBy(() => read({ actorType: "DEVELOPER", permissions: new Set() } as unknown as BusinessViewer)), name).toBeInstanceOf(AppError);
    }
  });

  it("the page: the Boss and the MD are sent to 'no access'; a Developer working as someone goes to that person's own home; nobody signed in goes to the sign-in", async () => {
    const page = () => DeveloperBusinessPage({ searchParams: Promise.resolve({}), params: Promise.resolve({}) } as never);
    for (const u of [boss, md, mgr, fin, rec]) {
      await signIn(u);
      expect(await redirectOf(page), u.fullName).toBe("/staff/forbidden");
    }
    h.cookies.clear();
    expect(await redirectOf(page)).toBe("/staff/login");
    await signIn(dev);
    expect(await redirectOf(page)).toBeNull();
    // working as Reception: the console is closed — to Reception's own home
    await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    const recHome = staffHome(new Set(DEFAULT_ROLES.RECEPTIONIST.permissions));
    expect(await redirectOf(page)).toBe(recHome);
    // (the fence refuses writes to sessions while the request is working as someone: sign the browser out first)
    h.cookies.clear();
    await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: null, workAsStartedAt: null } });
  });
});

// ───────────────────────────────────────────── 2. bounded, newest first ─────────────────────────────────────────────
describe("every table holds at most 30 rows, newest first", () => {
  it("stays: 30 of the 32 bookings, the last made first", async () => {
    const rows = await businessStays(DEV);
    expect(BUSINESS_LIMIT).toBe(30);
    expect(rows).toHaveLength(30);
    expect(rows[0].guest).toBe(`Biz Guest ${N}`);
    expect(rows[29].guest).toBe("Biz Guest 03");
    expect(sorted(rows, (r) => r.createdAt.getTime())).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(30);
  });

  it("money: 30 payments and 30 expenses, each newest first", async () => {
    const { payments, expenses } = await businessMoney(DEV);
    expect(payments).toHaveLength(30);
    expect(expenses).toHaveLength(30);
    expect(sorted(payments, (p) => p.at.getTime())).toBe(true);
    expect(sorted(expenses, (e) => e.at.getTime())).toBe(true);
    expect(expenses[0].description).toBe(`Biz expense ${N}`);
    expect(expenses[29].description).toBe("Biz expense 03");
  });

  it("restaurant: 30 orders, the last made first", async () => {
    const rows = await businessRestaurant(DEV);
    expect(rows).toHaveLength(30);
    expect(rows[0].number).toBe(`ORD-BIZ-${TAG}-${N}`);
    expect(sorted(rows, (r) => r.at.getTime())).toBe(true);
  });

  it("stores: 30 stock movements, newest first; the items below their minimum are listed by name", async () => {
    const { movements, belowMinimum } = await businessStores(DEV);
    expect(movements).toHaveLength(30);
    expect(sorted(movements, (m) => m.at.getTime())).toBe(true);
    expect(movements[0].change).toBe(-N);
    // below the item's OWN minimum, still in use: Flour (1 < 5) and Beans (2 < 5) — not Rice (10), not Salt (no minimum), not Old (switched off)
    expect(belowMinimum.map((i) => i.item)).toEqual([`Biz Beans ${TAG}`, `Biz Flour ${TAG}`]);
    expect(belowMinimum[0]).toMatchObject({ quantity: 2, minimum: 5, unit: "KG", department: expect.any(String) });
  });

  it("customers: 30, the latest made first, a removed customer left out", async () => {
    const rows = await businessCustomers(DEV);
    expect(rows).toHaveLength(30);
    expect(rows[0].name).toBe(`Biz Guest ${N}`);
    expect(rows.some((r) => r.name.startsWith("Removed Customer"))).toBe(false);
    expect(rows.every((r) => r.name.length > 0)).toBe(true);
  });

  it("the tab in the address: one of the five, otherwise the first", () => {
    expect([...BUSINESS_TABS]).toEqual(["stays", "money", "restaurant", "stores", "customers"]);
    expect(parseBusinessTab("money")).toBe("money");
    expect(parseBusinessTab("CUSTOMERS")).toBe("customers");
    expect(parseBusinessTab(["stores", "x"])).toBe("stores");
    for (const bad of [undefined, "", "users", "../etc", "constructor", "__proto__"]) expect(parseBusinessTab(bad), String(bad)).toBe("stays");
  });
});

// ───────────────────────────────────────────── 3. what each row says ─────────────────────────────────────────────
describe("what the rows say", () => {
  it("a stay: its code, the guest, the room number, the dates, the status and the folio the system keeps", async () => {
    const rows = await businessStays(DEV);
    const row = rows.find((r) => r.guest === "Biz Guest 10")!;
    expect(row.reference).toMatch(/^VLH-[A-Z0-9]{6}$/);
    expect(row.rooms).toHaveLength(1);
    expect(row.rooms[0]).toMatch(/^\d+$/);
    expect(row.arrival).toBe("2027-01-10");
    expect(row.departure).toBe("2027-01-11");
    const booking = await db.reservation.findUniqueOrThrow({ where: { id: reservationIds[9] } });
    expect(row).toMatchObject({ status: booking.status, total: booking.netAmount, paid: booking.paidAmount, balance: booking.balanceAmount });
    expect(row.paid).toBe(1_009);
    expect(row.balance).toBe(row.total - 1_009);
    for (const n of [row.total, row.paid, row.balance]) expect(Number.isInteger(n)).toBe(true);
  });

  it("a payment: what it was for, the amount, the method and the account's name (never its number), who recorded it, and a reversal is flagged", async () => {
    const { payments } = await businessMoney(DEV);
    const last = payments[0];
    expect(last).toMatchObject({ kind: "PAYMENT", amount: 1_000 + (N - 2), method: expect.any(String), account: expect.any(String), recordedBy: expect.any(String), reversed: false });
    expect(last.forWhat).toMatch(/^VLH-/);
    const reversed = payments.find((p) => p.id === reversedPaymentId)!;
    expect(reversed).toMatchObject({ reversed: true, reversalReason: "Typed the wrong amount" });
    expect(payments.filter((p) => p.reversed)).toHaveLength(1);
    expect(JSON.stringify(payments)).not.toContain(SECRET_ACCOUNT);
  });

  it("an expense: its words, the category, the payee field, who recorded it; a voided one is flagged", async () => {
    const { expenses } = await businessMoney(DEV);
    const voided = expenses.find((e) => e.description === "Biz expense 05")!;
    expect(voided).toMatchObject({ voided: true, status: "VOIDED", amount: 10_005, recordedBy: boss.fullName });
    expect(expenses.filter((e) => e.voided)).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ voided: false, status: "RECORDED", amount: 10_000 + N, number: `EXP-BIZ-${TAG}-${N}` });
    expect(typeof expenses[0].category).toBe("string");
    expect(JSON.stringify(expenses)).not.toContain(SECRET_ACCOUNT);
  });

  it("a restaurant order: the number, the place, the state, the total and what was paid; a room's bill is told apart from unpaid", async () => {
    const rows = await businessRestaurant(DEV);
    expect(rows[0]).toMatchObject({ number: `ORD-BIZ-${TAG}-${N}`, table: `Table ${N}`, status: "PENDING", total: 20_000 + N, paid: 20_000 + N, paymentStatus: "PAID", settlement: "PAY_NOW" });
    const room = rows.find((r) => r.number.endsWith("-07"))!;
    expect(room).toMatchObject({ room: "204", table: null, type: "ROOM_SERVICE", settlement: "ROOM", paid: 0 });
  });

  it("a stock movement: the item, its department, what happened, the signed change and who recorded it", async () => {
    const { movements } = await businessStores(DEV);
    const pending = movements.find((m) => m.change === -4)!;
    expect(pending).toMatchObject({ item: `Biz Flour ${TAG}`, kind: "USE", reason: "KITCHEN_USAGE", unit: "KG", status: "PENDING", recordedBy: rec.fullName });
    expect(pending.department).toEqual(expect.any(String));
  });

  it("a customer: name, code and phone; the latest stay only when they have stayed — and nothing else personal", async () => {
    const rows = await businessCustomers(DEV);
    const stayed = rows.find((r) => r.name === `Biz Guest ${N}`)!;
    expect(stayed.phone).toBe(`+255${String(710_000_000 + N)}`);
    expect(stayed.reference).toMatch(/^G-/);
    expect(stayed.lastStay).toEqual({ arrival: "2027-02-01", departure: "2027-02-02" });
    const notYet = rows.find((r) => r.name === "Biz Guest 10")!;
    expect(notYet.lastStay).toBeNull();
    const text = JSON.stringify(rows);
    for (const secret of [SECRET_EMAIL, SECRET_ID, "PASSPORT"]) expect(text).not.toContain(secret);
    expect(Object.keys(stayed).sort()).toEqual(["id", "lastStay", "name", "phone", "reference", "vip"]);
  });

  it("no row of any table carries an e-mail address, an ID number, an account number or a password", async () => {
    const all = JSON.stringify([await businessStays(DEV), await businessMoney(DEV), await businessRestaurant(DEV), await businessStores(DEV), await businessCustomers(DEV)]);
    for (const secret of [SECRET_EMAIL, SECRET_ID, SECRET_ACCOUNT]) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/passwordHash|idNumber|accountNumber|"email"/);
  });
});

// ───────────────────────────────────────────── 4. how they are drawn ─────────────────────────────────────────────
describe("how the tables are drawn", () => {
  const stay = (over: Partial<StayRow> = {}): StayRow => ({ id: "s1", reference: "VLH-AAAAAA", guest: "Anna Moshi", rooms: ["101", "102"], arrival: "2026-10-10", departure: "2026-10-12", status: "CONFIRMED", total: 703_000, paid: 100_000, balance: 603_000, createdAt: new Date(), ...over });
  const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({ id: "p1", at: new Date("2026-03-15T21:30:00Z"), kind: "PAYMENT", forWhat: "VLH-AAAAAA", amount: 1_234_567, method: "Cash", account: "Cash", reference: null, recordedBy: "Asha", reversed: false, reversalReason: null, ...over });
  const expense = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({ id: "e1", number: "EXP-1", at: new Date("2026-03-15T09:00:00Z"), category: "Utilities", description: "Water bill", payee: "DAWASA", amount: 2_500_000, method: "Cash", account: "Cash", recordedBy: "Neema", status: "APPROVED", voided: false, ...over });
  const order = (over: Partial<OrderRow> = {}): OrderRow => ({ id: "o1", number: "ORD-1", at: new Date("2026-03-15T09:00:00Z"), type: "DINE_IN", table: "Table 3", room: null, status: "PREPARING", settlement: "PAY_NOW", total: 45_000, paid: 45_000, paymentStatus: "PAID", ...over });
  const movement = (over: Partial<MovementRow> = {}): MovementRow => ({ id: "m1", at: new Date("2026-03-15T09:00:00Z"), item: "Beef", department: "Kitchen", kind: "USE", reason: "KITCHEN_USAGE", change: -2.5, unit: "KG", status: "POSTED", recordedBy: "Chef", ...over });
  const low = (): LowStockRow => ({ id: "l1", item: "Flour", department: "Kitchen", quantity: 1, minimum: 5, unit: "KG" });
  const customer = (): CustomerRow => ({ id: "c1", reference: "G-AAAAAA", name: "Anna Moshi", phone: "+255710000001", vip: true, lastStay: { arrival: "2026-10-10", departure: "2026-10-12" } });

  const draw = () => [
    renderToStaticMarkup(createElement(StaysTable, { rows: [stay()], t })),
    renderToStaticMarkup(createElement(PaymentsTable, { rows: [payment(), payment({ id: "p2", reversed: true, kind: "REFUND" })], t, timezone: "Africa/Dar_es_Salaam" })),
    renderToStaticMarkup(createElement(ExpensesTable, { rows: [expense(), expense({ id: "e2", voided: true, status: "VOIDED" })], t, timezone: "Africa/Dar_es_Salaam" })),
    renderToStaticMarkup(createElement(OrdersTable, { rows: [order(), order({ id: "o2", settlement: "ROOM", paid: 0, paymentStatus: "UNPAID", table: null, room: "204", type: "ROOM_SERVICE" })], t, timezone: "Africa/Dar_es_Salaam" })),
    renderToStaticMarkup(createElement(MovementsTable, { rows: [movement()], t, timezone: "Africa/Dar_es_Salaam" })),
    renderToStaticMarkup(createElement(LowStockTable, { rows: [low()], t })),
    renderToStaticMarkup(createElement(CustomersTable, { rows: [customer()], t })),
  ];

  it("amounts are in full — TZS 703,000, never 703k", () => {
    const [stays, payments, expenses, orders] = draw();
    expect(stays).toContain("TZS 703,000");
    expect(stays).toContain("TZS 603,000");
    expect(payments).toContain("TZS 1,234,567");
    expect(expenses).toContain("TZS 2,500,000");
    expect(orders).toContain("TZS 45,000");
    for (const html of draw()) expect(html).not.toMatch(/\b\d+(\.\d+)?[kKmM]\b(?![a-z])/);
  });

  it("dates are the hotel's time zone: 21:30 UTC is 00:30 the next morning in Dar es Salaam", () => {
    const [, payments] = draw();
    expect(payments).toContain("16 Mar, 00:30");
    const inLondon = renderToStaticMarkup(createElement(PaymentsTable, { rows: [payment()], t, timezone: "Europe/London" }));
    expect(inLondon).toContain("15 Mar, 21:30");
    const [stays] = draw();
    expect(stays).toContain("10/10/26"); // the stay's dates, as the person reads them
    expect(stays).toContain("12/10/26");
  });

  it("on a phone each table becomes small cards: data-stack, and a label on every cell", () => {
    for (const html of draw()) {
      expect(html).toContain("data-stack");
      const cells = html.match(/<td\b[^>]*>/g) ?? [];
      expect(cells.length).toBeGreaterThan(0);
      for (const c of cells) expect(c, c).toMatch(/data-label="[^"]+"/);
    }
  });

  it("reversed, voided and refunded lines are flagged; a room's bill is not shown as unpaid", () => {
    const [, payments, expenses, orders] = draw();
    expect(payments).toContain("Reversed");
    expect(payments).toContain("Refund");
    expect(payments).toContain("Posted");
    expect(expenses).toContain("Voided");
    expect(orders).toContain("On the room bill");
    expect(orders).toContain("Room 204");
  });

  it("a change in stock is signed and in its own unit; a customer shows a name, a phone and the last stay", () => {
    const [, , , , movements, lowStock, customers] = draw();
    expect(movements).toContain("−2.5 kg");
    expect(lowStock).toContain("1 kg");
    expect(lowStock).toContain("5 kg");
    expect(customers).toContain("+255710000001");
    expect(customers).toContain("Anna Moshi");
    expect(customers).toContain("VIP");
  });

  it("empty tables say so in words", () => {
    const html = renderToStaticMarkup(createElement(StaysTable, { rows: [], t }));
    expect(html).toContain("There are no bookings yet.");
    expect(html).not.toContain("<table");
  });

  it("there is nothing to change: no button, form, input, link or script in any table", () => {
    for (const html of draw()) {
      for (const tag of ["<button", "<form", "<input", "<textarea", "<select", "<a ", "<script", "contenteditable", "onclick", "href="]) expect(html.toLowerCase(), tag).not.toContain(tag);
      expect(html).not.toMatch(/\b(delete|remove|edit|restore|undo|save)\b/i);
    }
  });
});

// ───────────────────────────────────────────── 4b. the whole page ─────────────────────────────────────────────
describe("the whole page, one tab at a time", () => {
  const page = async (tab?: string) => {
    await signIn(dev);
    const element = await DeveloperBusinessPage({ searchParams: Promise.resolve(tab ? { tab } : {}), params: Promise.resolve({}) } as never);
    return renderToStaticMarkup(element as never);
  };

  it("the title, the 'Look, don't touch' box with its link to Work as, and the five tabs — the chosen one marked", async () => {
    const html = await page("money");
    expect(html).toContain("Business");
    expect(html).toContain("A look at the business data");
    expect(html).toContain("Look, don&#x27;t touch");
    expect(html).toMatch(/recorded in the audit log/);
    for (const k of BUSINESS_TABS) expect(html).toContain(`href="/staff/developer/business?tab=${k}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/staff\/developer\/business\?tab=money"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/staff\/developer\/business\?tab=money"/);
    expect(html).toMatch(/href="\/staff\/developer\/access"[^>]*>Work as</);
  });

  it("each tab shows its own tables with the latest rows", async () => {
    const stays = await page("stays");
    expect(stays).toContain(`Biz Guest ${N}`);
    expect(stays).toContain("VLH-");
    const money = await page("money");
    for (const w of ["Payments", "Expenses", `Biz expense ${N}`, "Reversed", "Voided"]) expect(money, w).toContain(w);
    const restaurant = await page("restaurant");
    expect(restaurant).toContain(`ORD-BIZ-${TAG}-${N}`);
    expect(restaurant).toContain("On the room bill");
    const stores = await page("stores");
    for (const w of ["Stock movements", "Items below their minimum", `Biz Flour ${TAG}`, `Biz Beans ${TAG}`]) expect(stores, w).toContain(w);
    const customers = await page("customers");
    expect(customers).toContain(`Biz Guest ${N}`);
    expect(customers).toContain(`+255${String(710_000_000 + N)}`);
    expect(customers).not.toContain("Removed Customer");
  });

  it("an unknown tab shows Stays; nothing on any tab can be pressed, and every link stays inside the console", async () => {
    expect(await page("nonsense")).toContain(`Biz Guest ${N}`);
    for (const tab of BUSINESS_TABS) {
      const html = await page(tab);
      for (const tag of ["<button", "<form", "<input", "<textarea", "<select", "contenteditable", "onclick"]) expect(html.toLowerCase(), `${tab} ${tag}`).not.toContain(tag);
      for (const m of html.matchAll(/href="([^"]+)"/g)) expect(m[1], `${tab} ${m[1]}`).toMatch(/^\/staff\/developer\/(business|access)/);
      for (const secret of [SECRET_EMAIL, SECRET_ID, SECRET_ACCOUNT]) expect(html).not.toContain(secret);
    }
  });
});

// ───────────────────────────────────────────── 5. read-only, in the code ─────────────────────────────────────────────
describe("read-only: no way to change a record", () => {
  const service = readFileSync("src/server/services/developer-business.ts", "utf8");
  const page = readFileSync("src/app/staff/(app)/developer/business/page.tsx", "utf8");
  const tables = readFileSync("src/app/staff/(app)/developer/business/business-tables.tsx", "utf8");

  it("the service reads only: no create, update, upsert, delete or SQL; the one write is the visit's audit entry", () => {
    expect(service).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(service).not.toMatch(/\$(executeRaw|queryRaw|transaction)/);
    expect(service.match(/\baudit\(/g)).toHaveLength(1);
    expect(service).toMatch(/take: BUSINESS_LIMIT/);
    expect((service.match(/\.findMany\(/g) ?? []).length).toBe((service.match(/take: BUSINESS_LIMIT/g) ?? []).length);
  });

  it("every function checks the caller again", () => {
    const fns = [...service.matchAll(/export async function (business\w+)\(/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(["businessCustomers", "businessMoney", "businessRestaurant", "businessStays", "businessStores"]);
    expect((service.match(/assertConsoleAccess\(viewer\)/g) ?? []).length).toBe(fns.length);
  });

  it("the page and the tables hold no form, no server action and no link to anything but the console", () => {
    for (const src of [page, tables]) {
      expect(src).not.toMatch(/use server|<form|<button|<input|<textarea|<select/);
      for (const m of src.matchAll(/href=(?:\{`|")([^`"]+)/g)) expect(m[1], m[1]).toMatch(/^\/staff\/developer\//);
    }
  });
});

// ───────────────────────────────────────────── 6. the visit is written down ─────────────────────────────────────────────
describe("each visit to a tab is written to the audit trail", () => {
  const mine = (tab?: string) => db.auditLog.findMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION, ...(tab ? { entityId: tab } : {}) }, orderBy: { createdAt: "asc" } });
  // The earlier tests opened the page (each opening wrote a visit): start these from a clean diary (the one maintenance path, inside a transaction).
  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('vegas.audit_maintenance', 'on', true)`);
      await tx.auditLog.deleteMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION } });
    });
  });

  it("the Developer's look at a tab is one entry — once in 10 minutes for the same tab, again for another tab or later", async () => {
    const t0 = new Date();
    expect(await noteBusinessView(DEV, "customers", { now: t0, ipAddress: "41.2.2.2" })).toBe("logged");
    expect(await noteBusinessView(DEV, "customers", { now: new Date(t0.getTime() + 5 * 60_000) })).toBe("repeat");
    expect(await noteBusinessView(DEV, "money", { now: t0 })).toBe("logged");
    expect(await mine("customers")).toHaveLength(1);
    const [row] = await mine("customers");
    expect(row).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", entityType: "Business", entityId: "customers", ipAddress: "41.2.2.2", actorLabel: dev.fullName });
    expect(row.after).toEqual({ tab: "customers" });
    // 11 minutes later the first look is outside the 10-minute window: the same tab is written again
    expect(await noteBusinessView(DEV, "customers", { now: new Date(t0.getTime() + 11 * 60_000) })).toBe("logged");
    expect(await mine("customers")).toHaveLength(2);
  });

  it("a staff account's look is never written as a Developer's (and the service has refused it before this)", async () => {
    const before = await db.auditLog.count({ where: { action: BUSINESS_VIEW_ACTION } });
    expect(await noteBusinessView(asViewer("OWNER", boss), "money")).toBe("not-developer");
    expect(await db.auditLog.count({ where: { action: BUSINESS_VIEW_ACTION } })).toBe(before);
  });

  it("the visit has plain words in the audit trail, and shows under 'Developer actions'", async () => {
    expect(auditActionWords(BUSINESS_VIEW_ACTION)).toBe("looked at the business data");
    expect(await noteBusinessView(DEV, "stores")).toBe("logged");
    const { timezone } = await getSettings();
    const today = auditToday(timezone);
    const page = await queryAuditTrail(DEV, { actor: "DEVELOPER", userId: dev.id, action: "business_viewed", module: "Business", from: today, to: today, page: 1 });
    expect(page.rows.length).toBeGreaterThan(0);
    for (const r of page.rows) expect(r).toMatchObject({ actorType: "DEVELOPER", ok: true, entityType: "Business" });
  });

  it("opening the page as the Developer writes the visit, and opening it again at once does not write another", async () => {
    await signIn(dev);
    const open = () => DeveloperBusinessPage({ searchParams: Promise.resolve({ tab: "restaurant" }), params: Promise.resolve({}) } as never);
    await open();
    const first = await mine("restaurant");
    expect(first).toHaveLength(1);
    await open();
    expect(await mine("restaurant")).toHaveLength(1);
  });
});
