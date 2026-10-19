/* eslint-disable @typescript-eslint/no-unused-vars -- helpers and imports of the working-as tests that were removed on 2026-10-19 (full access while working as someone); kept for the own-account cases */
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

import { db, rawDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { markWorkingAs, sha256 } from "@/server/work-as-session";
import { checkIn, createReservation } from "@/server/services/reservations";
import { addRoomToGroup, cancelGroup, checkInGroup, checkOutGroup, createGroupBooking, finalizeGroup, invoiceGroupRooms, recordGroupPayment, setReservationGroup, updateGroup } from "@/server/services/groups";
import { savePaymentAccount, setOpeningBalance } from "@/server/services/payment-accounts";
import { postMovement } from "@/server/services/finance";
import { generateRotation, setSchedule, startShift, swapShifts } from "@/server/services/shifts";
import { createRestaurantOrder } from "@/server/services/restaurant";
import { takeChargeOfOrder } from "@/server/services/waiter-work";
import { ONLINE_RECORDER_ID } from "@/server/services/online-recorder";
import { DEVELOPER_LOCKED_SETTINGS } from "@/lib/permissions";
import { addDays, businessDateOf, toDbDate, zonedInstant } from "@/lib/time/business-date";
import {
  addGroupRoomAction, cancelGroupAction, createGroupAction, finalizeGroupAction, groupCheckInAction, groupCheckOutAction, groupInvoiceAction, groupPaymentAction, updateGroupAction,
} from "@/app/staff/(app)/groups/actions";
import {
  postMovementAction, recordCashCountAction, reverseMovementAction, reviewCashCountAction, savePaymentAccountAction, setOpeningBalanceAction,
} from "@/app/staff/(app)/finance/accounts/actions";
import { makePeriodReportAction, sendStaffReportAction } from "@/app/staff/(app)/reports/staff/actions";
import { makeShiftReportAction, sendShiftReportAction } from "@/app/staff/(app)/shifts/[id]/report/actions";
import {
  closeShiftAsManagerAction, endShiftAction, setScheduleAction, startShiftAction, swapShiftsAction,
} from "@/app/staff/(app)/shifts/actions";
import { closeWaiterShiftAction, endWaiterShiftAction, startWaiterShiftAction } from "@/app/staff/(app)/restaurant/waiter-actions";
import { updateSettingsAction } from "@/app/staff/(app)/settings/actions";
import StartShiftPage from "@/app/staff/(app)/start-shift/page";
import { ManagerCloseShift, ShiftControls } from "@/components/staff/shift-controls";
import { formatRecipientLine } from "@/lib/report-recipients";
import { managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, thrownBy, giveDeveloperRoleHotelWork, takeHotelWorkFromDeveloperRole, type MadeUser } from "../support/developer";

/**
 * THE MONEY WALL, SECOND PASS (owner, 2026-10-17). The first review found holes the first wall left: payment accounts and opening balances,
 * the GROUP versions of the booking decisions, the reports sent to the Boss again, the settings that shape payment terms, a payment credited to
 * the person worked as at check-in, and a person's shift started / closed from their dashboard.
 *
 * Every door is tried as the Developer on its own account AND as the Developer working as someone who holds the right (the MD, a manager,
 * reception, a waiter): refused on the server, nothing written, one "developer.denied" entry under the Developer's own identity. The same door
 * still opens for the Boss, the MD, a manager and reception, exactly as before.
 */

const TZ = "Africa/Dar_es_Salaam";
const BEER = "mi_beers_heineken";

let dev: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let fin: MadeUser;
let rec: MadeUser;
let rec2: MadeUser;
let mgr: MadeUser;
let waiter: MadeUser;
let everyone: MadeUser[];

beforeAll(async () => {
  [dev, boss, md, fin, rec, rec2, mgr, waiter] = await Promise.all([
    makeUser("DEVELOPER", { fullName: "Dev Wall Two" }), makeUser("OWNER", { fullName: "Boss Wall Two" }), makeUser("ADMIN", { fullName: "MD Wall Two" }),
    makeUser("FINANCE", { fullName: "Finance Wall Two" }), makeUser("RECEPTIONIST", { fullName: "Reception Wall Two" }), makeUser("RECEPTIONIST", { fullName: "Reception Second" }),
    makeUser("MANAGER", { fullName: "Manager Wall Two" }), makeUser("RESTAURANT", { fullName: "Waiter Wall Two" }),
  ]);
  everyone = [dev, boss, md, fin, rec, rec2, mgr, waiter];
});
afterAll(async () => {
  browser.reset(); // no work-as left in the browser: removing accounts is exactly what the fence forbids while working as someone
  await rawDb.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
  await resetBusinessData(); // shifts, payments and bookings point at these accounts
  await db.$executeRawUnsafe(`TRUNCATE "ledger_entries", "cash_counts", "staff_reports", "shift_reports" CASCADE`);
  await db.moneyAccount.deleteMany({ where: { name: { startsWith: "Wall Two " } } });
  await db.moneyAccount.update({ where: { code: "NTZS" }, data: { openingBalance: 0 } });
  await removeMadeUsers();
});
beforeEach(async () => {
  await resetBusinessData();
  await db.$executeRawUnsafe(`TRUNCATE "ledger_entries", "cash_counts", "staff_reports", "shift_reports" CASCADE`);
  await db.moneyAccount.deleteMany({ where: { name: { startsWith: "Wall Two " } } });
  await db.moneyAccount.update({ where: { code: "NTZS" }, data: { openingBalance: 0 } });
  browser.reset();
  await rawDb.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
  // Reception works inside an open shift of its own.
  await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate(today()), userId: rec.id, startedAt: new Date(Date.now() - 3_600_000) } });
});

// ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

const today = () => businessDateOf(new Date());
const at = (days: number, hour: number) => zonedInstant(addDays(today(), days), hour * 60, TZ);

/** Sign in as this person (a fresh browser holding a real session cookie). */
async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id, { createdMinAgo: 1, seenMinAgo: 0 });
}
/** The Developer signed in — on its own account, or already working as `target` (written to the session row, as startWorkAs does). */
async function devAs(target: MadeUser | null = null) {
  browser.reset();
  const token = await makeSession(dev.id, { createdMinAgo: 1, seenMinAgo: 0 });
  if (target) await rawDb.session.update({ where: { tokenHash: sha256(token) }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - 60_000) } });
}
const label = (who: MadeUser | null) => (who ? `Developer as ${who.role}` : "Developer");

/** The acting person as a service sees them: their id and the rights of their role in the database right now (plus any given on purpose). */
async function actorOf(u: MadeUser, extraRights: string[] = []) {
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, role: row.role.name, permissions: new Set([...row.role.permissions.map((p) => p.permission.code), ...extraRights]) as ReadonlySet<string> };
}
/** The acting person of the CURRENT request, built the way the actions build it (the rights are the session's own, work-as mark included). */
async function actorOfSession(copyRights = false) {
  const u = await getCurrentUser();
  if (!u) throw new Error("not signed in");
  return { userId: u.id, label: u.fullName, role: u.roleName, permissions: (copyRights ? new Set(u.permissions) : u.permissions) as ReadonlySet<string> };
}

/** Everything that holds money, what is owed, where guests pay, or a person's shift — as one comparable text. */
async function snapshot() {
  const [accounts, groups, reservations, rooms, invoices, items, payments, ledger, counts, shifts, report, settings, staffReports] = await Promise.all([
    db.moneyAccount.findMany({ orderBy: { id: "asc" } }),
    db.bookingGroup.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, notes: true, billing: true, paymentTermDays: true, corporateCustomerId: true, contactGuestId: true, finalizedAt: true, finalInvoiceId: true, status: true } }),
    db.reservation.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, billTo: true, corporateCustomerId: true, paymentTermDays: true, netAmount: true, discountAmount: true, paidAmount: true, balanceAmount: true, companyBilledAmount: true, groupId: true } }),
    db.reservationRoom.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, ratePerNight: true, discountPerNight: true } }),
    db.invoice.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, netAmount: true, balanceAmount: true } }),
    db.invoiceItem.count(),
    db.payment.aggregate({ _count: true, _sum: { amount: true } }),
    db.ledgerEntry.count(),
    db.cashCount.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true } }),
    db.actualShift.findMany({ orderBy: { id: "asc" }, select: { id: true, userId: true, department: true, endedAt: true, closedById: true } }),
    db.shiftReport.count(),
    db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } }),
    db.staffReport.count(),
  ]);
  const schedule = await db.shiftSchedule.findMany({ orderBy: { businessDate: "asc" }, select: { businessDate: true, scheduledUserId: true } });
  return JSON.stringify({ accounts, groups, reservations, rooms, invoices, items, payments, ledger, counts, shifts, report, settings, staffReports, schedule });
}
const deniedBy = (u: MadeUser) => db.auditLog.count({ where: { userId: u.id, action: "developer.denied" } });
const deniedAll = () => db.auditLog.count({ where: { action: "developer.denied" } });

type Res = { ok: boolean; code?: string; error?: string };

/**
 * The Developer's attempt — on its own account (`who` = null) or working as `who`: refused (FORBIDDEN), nothing written, and (when `logged`)
 * exactly one "developer.denied" entry under its own identity.
 */
async function developerRefused(name: string, who: MadeUser | null, run: () => Promise<Res>, opts: { logged?: boolean; says?: RegExp } = {}) {
  await devAs(who);
  const [before, denied] = [await snapshot(), await deniedBy(dev)];
  const res = await run();
  const tag = `${name} [${label(who)}]`;
  expect(res.ok, `${tag}: should be refused (${res.error ?? "it worked"})`).toBe(false);
  expect(res.code, `${tag}: ${res.error}`).toBe("FORBIDDEN");
  if (opts.says) expect(res.error, tag).toMatch(opts.says);
  expect(await snapshot(), `${tag}: nothing may change`).toBe(before);
  expect(await deniedBy(dev), `${tag}: one refusal entry`).toBe(denied + ((opts.logged ?? true) ? 1 : 0));
  if (opts.logged ?? true) {
    const row = await db.auditLog.findFirstOrThrow({ where: { userId: dev.id, action: "developer.denied" }, orderBy: { createdAt: "desc" } });
    expect(row, tag).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER" });
    // Working as someone, the entry says as whom; on its own account it is just the Developer.
    if (who) expect(row.actorLabel, tag).toBe(`${dev.fullName} (Developer) as ${who.fullName} (${(await db.user.findUniqueOrThrow({ where: { id: who.id }, include: { role: true } })).role.name})`);
    else expect(row.actorLabel, tag).toBe(dev.fullName);
  }
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
  const e = await thrownBy(run);
  expect(e, "an error was expected").toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe("FORBIDDEN");
  return e as AppError;
};
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

// ───────────────────────────────────────────── fixtures ─────────────────────────────────────────────

/** A company-billed group staying now (arrived yesterday, leaves today): two rooms, checked in, nothing paid. */
async function companyGroup() {
  const company = await db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", paymentTermDays: 30 } });
  const [dd, st] = await Promise.all([roomType("DOUBLE_DELUXE"), roomType("STANDARD")]);
  const mgrActor = await managerActor();
  const g = await createGroupBooking({
    name: "ABC Company", type: "COMPANY", corporateCustomerId: company.id, contact: { fullName: "Asha Director", phone: "0713000001" },
    sourceCode: "CORPORATE", billing: "COMBINED", arrivalDate: addDays(today(), -1), departureDate: today(),
    rooms: [{ roomTypeId: dd.id, guest: { fullName: "Peter Employee" }, adults: 1, children: 0 }, { roomTypeId: st.id, guest: { fullName: "Sarah Employee" }, adults: 1, children: 0 }],
  }, mgrActor, at(-1, 12));
  await checkInGroup(g.id, mgrActor, null, at(-1, 15));
  const rooms = await db.reservation.findMany({ where: { groupId: g.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return { g, company, mgrActor, ids: rooms.map((r) => r.id) };
}
/** The same group with every room checked out, the running group bill open (a draft), ready to be made final. */
async function readyToFinalize() {
  const x = await companyGroup();
  await checkOutGroup(x.g.id, x.mgrActor, x.ids, {}, new Date());
  return x;
}

const futureDates = () => ({ arrivalDate: addDays(today(), 30), departureDate: addDays(today(), 32) });
/** A group booking as the group form sends it: every room pays its own bill, no company, no terms, no discount (the plain, allowed kind). */
async function plainGroupInput(over: Record<string, unknown> = {}, roomOver: Record<string, unknown> = {}) {
  const st = await roomType("DOUBLE_DELUXE");
  return {
    name: "Wedding party", type: "FAMILY" as const, contact: { fullName: "Neema Host", phone: "0714000009" }, sourceCode: "PHONE", billing: "COMBINED" as const, ...futureDates(),
    rooms: [{ roomTypeId: st.id, adults: 1, children: 0, ownBill: true, ...roomOver }], ...over,
  };
}

// ───────────────────────────────────── 1. payment accounts and opening balances ─────────────────────────────────────
describe("payment accounts, opening balances and the cash books", () => {
  const newAccount = () => form({ name: "Wall Two Exim Bank", kind: "BANK", accountNumber: "0200", holderName: "VEGAS", acceptsPayments: "on", isActive: "on" });
  const opening = async () => form({ accountId: (await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } })).id, amount: "6500", reason: "Real money in the wallet from before the clean start" });

  it("adding or editing a payment account: refused for the Developer (own account, and working as the MD / Finance / the Boss's roles), the MD and the Boss still do it", async () => {
    for (const who of [null]) {
      await developerRefused("add a payment account", who, () => savePaymentAccountAction(null, newAccount()));
    }
    expect(await db.moneyAccount.count({ where: { name: { startsWith: "Wall Two " } } })).toBe(0);
    await decided("add a payment account", md, () => savePaymentAccountAction(null, newAccount()));
    const made = await db.moneyAccount.findFirstOrThrow({ where: { name: "Wall Two Exim Bank" } });
    // Editing an existing account (its number, who may use it): the same door.
    const edit = () => savePaymentAccountAction(null, form({ id: made.id, name: "Wall Two Exim Bank", kind: "BANK", accountNumber: "9999-EVIL", acceptsPayments: "on", isActive: "on" }));
    for (const who of [null]) await developerRefused("edit a payment account", who, edit);
    expect((await db.moneyAccount.findUniqueOrThrow({ where: { id: made.id } })).accountNumber).toBe("0200");
    await decided("edit a payment account", boss, edit);
    expect((await db.moneyAccount.findUniqueOrThrow({ where: { id: made.id } })).accountNumber).toBe("9999-EVIL");
  });

  it("an opening balance: refused for the Developer (own account, working as the MD / Finance), done by the Boss and the MD with its audit line", async () => {
    for (const who of [null]) await developerRefused("set an opening balance", who, async () => setOpeningBalanceAction(null, await opening()));
    expect((await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } })).openingBalance).toBe(0);
    expect(await db.auditLog.count({ where: { action: "payment_account.opening_balance_set" } })).toBe(0);
    await decided("set an opening balance", boss, async () => setOpeningBalanceAction(null, await opening()));
    expect((await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } })).openingBalance).toBe(6_500);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "payment_account.opening_balance_set" } });
    expect(log).toMatchObject({ userId: boss.id, actorType: "STAFF" });
  });

  it("the ledger and the cash counts: refused for the Developer and for the roles it works as, allowed for the Boss", async () => {
    const cash = await db.moneyAccount.findFirstOrThrow({ where: { acceptsPayments: true, isActive: true }, orderBy: { sortOrder: "asc" } });
    const movement = () => postMovementAction(null, form({ kind: "OWNER_CONTRIBUTION", amount: "5000", accountId: cash.id, description: "Owner puts money in" }));
    for (const who of [null]) await developerRefused("post to the ledger", who, movement);
    await decided("post to the ledger", boss, movement);
    const entry = await db.ledgerEntry.findFirstOrThrow();
    for (const who of [null]) await developerRefused("reverse a ledger line", who, () => reverseMovementAction({ id: entry.id, reason: "A mistake in the amount" }));
    expect((await db.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe("POSTED");

    // A count of the cash is money too: the Developer never records one (and that refusal is written down).
    const count = () => recordCashCountAction(null, form({ accountId: cash.id, counted: "123", note: "Counted by me" }));
    for (const who of [null]) await developerRefused("record a cash count", who, count);
    expect(await db.cashCount.count()).toBe(0);
    await decided("record a cash count", boss, count);
    const open = await db.cashCount.findFirstOrThrow({ where: { status: "OPEN" } });
    for (const who of [null]) await developerRefused("accept a cash count", who, () => reviewCashCountAction({ id: open.id, postCorrection: true, note: "Fine" }));
    expect((await db.cashCount.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("OPEN");
    await decided("accept a cash count", boss, () => reviewCashCountAction({ id: open.id, postCorrection: false, note: "Fine" }));
  });

});

// ───────────────────────────────────── 2. groups ─────────────────────────────────────
describe("group bookings: the Developer decides no money, the Boss and reception still do", () => {
  it("adding a room to a group: a discount or a room the group pays for is refused; an own-bill room without a discount is allowed", async () => {
    const { g } = await companyGroup();
    const dd = await roomType("DOUBLE_DELUXE");
    const room = (over: Record<string, unknown> = {}) => ({ groupId: g.id, roomTypeId: dd.id, adults: 1, children: 0, ...futureDates(), ...over });
    for (const who of [null]) {
      await developerRefused("add a discounted room", who, () => addGroupRoomAction(room({ ownBill: true, discountPerNight: 1_000 }) as never));
      await developerRefused("add a room the group pays for", who, () => addGroupRoomAction(room() as never));
    }
    await devAs(null);
    expect((await addGroupRoomAction(room({ ownBill: true, guest: { fullName: "Own Payer" } }) as never)).ok).toBe(true);
    await decided("add a room the group pays for", rec, () => addGroupRoomAction(room({ guest: { fullName: "Group Payer" } }) as never));
    await decided("add a discounted room", boss, () => addGroupRoomAction(room({ ownBill: true, discountPerNight: 1_000, guest: { fullName: "Discounted" } }) as never));
  });

  it("the group's invoices, payments, cancellation and final bill: refused, also for the roles that hold check-out, and the group stays as it was", async () => {
    const { g, ids } = await readyToFinalize();
    for (const who of [null]) {
      await developerRefused("invoice the group's rooms", who, () => groupInvoiceAction({ groupId: g.id, reservationIds: ids, mode: "COMBINED" }));
      await developerRefused("record a group payment", who, () => groupPaymentAction({ groupId: g.id, amount: 1_000, accountId: "acct_cash" }));
      await developerRefused("cancel the group", who, () => cancelGroupAction({ groupId: g.id, reason: "Changed their mind" }));
    }
    // The final invoice: the Developer holds check-out (reception's right), so this is a decision gate — refused even as reception.
    for (const who of [null]) await developerRefused("make the final group invoice", who, () => finalizeGroupAction({ groupId: g.id }));
    expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: g.id } })).finalizedAt).toBeNull();

    // Reception makes the final invoice, exactly as before; the Boss takes the payment.
    await decided("make the final group invoice", rec, () => finalizeGroupAction({ groupId: g.id }));
    expect((await db.bookingGroup.findUniqueOrThrow({ where: { id: g.id } })).finalizedAt).not.toBeNull();
    await decided("record a group payment", boss, () => groupPaymentAction({ groupId: g.id, amount: 1_000, accountId: "acct_cash" }));
    expect(await db.payment.count()).toBe(1);
  });

  it("checking a group in works for the Developer as reception; checking out the rooms the group pays for does not (it makes the group's invoice)", async () => {
    const { g, ids } = await companyGroup();
    // The group was checked in already; use a second group to see the Developer check in.
    void g;
    const dd = await roomType("DOUBLE_DELUXE");
    const mgrA = await managerActor();
    const second = await createGroupBooking({
      name: "Second party", type: "FAMILY", contact: { fullName: "Second Host", phone: "0714000010" }, sourceCode: "PHONE", billing: "COMBINED",
      arrivalDate: today(), departureDate: addDays(today(), 1), rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[4].id, adults: 1, children: 0, ownBill: true }],
    }, mgrA);
    await devAs(rec);
    const arrived = await groupCheckInAction({ groupId: second.id });
    expect(arrived.ok, arrived.ok ? "" : arrived.error).toBe(true);
    expect(JSON.stringify(arrived.ok ? arrived.data : null)).toContain("Checked in");
    expect((await db.reservation.findFirstOrThrow({ where: { groupId: second.id } })).status).toBe("CHECKED_IN");

    for (const who of [null]) {
      await developerRefused("check out the rooms the group pays for", who, () => groupCheckOutAction({ groupId: g.id, reservationIds: ids }));
    }
    expect((await db.reservation.findMany({ where: { id: { in: ids } } })).every((r) => r.status === "CHECKED_IN")).toBe(true);
    expect(await db.invoice.count()).toBe(0);
    await decided("check out the group's rooms", rec, () => groupCheckOutAction({ groupId: g.id, reservationIds: ids }));
    expect((await db.invoice.count({ where: { groupId: g.id } }))).toBe(1);
  });

});

// ───────────────────────────────────── 3. the reports sent to the Boss ─────────────────────────────────────
describe("reports that go to the Boss: the Developer neither makes nor resends them", () => {
  it("the weekly / monthly report: making it and sending it again are refused (own account, working as the MD / a manager); the MD and the Boss do both", async () => {
    for (const who of [null]) {
      await developerRefused("make the weekly report", who, () => makePeriodReportAction({ kind: "WEEK" }));
      await developerRefused("make the monthly report", who, () => makePeriodReportAction({ kind: "MONTH" }));
      await developerRefused("send the weekly report again", who, () => sendStaffReportAction({ reportId: "not-a-report", force: true }));
    }
    expect(await db.staffReport.count()).toBe(0);
    await decided("make the weekly report", md, () => makePeriodReportAction({ kind: "WEEK" }));
    const made = await db.staffReport.findFirst();
    if (made) await decided("send the weekly report again", boss, () => sendStaffReportAction({ reportId: made.id, force: true }));
  });

  it("a shift report: making it and sending it again are refused for the Developer; a manager still does both", async () => {
    const shift = await db.actualShift.create({
      data: { department: "RECEPTION", businessDate: toDbDate(today()), userId: rec2.id, startedAt: new Date(Date.now() - 7_200_000), endedAt: new Date(Date.now() - 3_600_000) },
    });
    for (const who of [null]) {
      await developerRefused("make a shift report", who, () => makeShiftReportAction({ shiftId: shift.id }));
      await developerRefused("send a shift report again", who, () => sendShiftReportAction({ reportId: "not-a-report", force: true }));
    }
    expect(await db.shiftReport.count()).toBe(0);
    await decided("make a shift report", mgr, () => makeShiftReportAction({ shiftId: shift.id }));
    expect(await db.shiftReport.count()).toBe(1);
  });
});

// ───────────────────────────────────── 4. settings that shape payment terms ─────────────────────────────────────
describe("the settings the Developer cannot change now include the payment terms, the hold rules and the business day", () => {
  it("lists every money-shaping field of the settings form", () => {
    for (const key of ["invoiceDefaultDueDays", "unpaidHoldHours", "noShowCutoffMinutes", "noShowAutoRelease", "businessDayStartMinutes"]) {
      expect(DEVELOPER_LOCKED_SETTINGS, key).toContain(key);
    }
  });

  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  /** The settings form exactly as the browser would send it for what is stored right now, with edits on top. */
  async function settingsForm(edits: Record<string, string> = {}) {
    const s = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
    const breakfast = await db.hotelService.findUnique({ where: { code: "BREAKFAST" } });
    const text: Record<string, string | null> = {
      hotelName: s.hotelName, tagline: s.tagline, addressLine: s.addressLine, postalAddress: s.postalAddress, city: s.city, country: s.country, phone: s.phone, email: s.email,
      website: s.website, whatsapp: s.whatsapp, mapUrl: s.mapUrl, bankName: s.bankName, bankAccountName: s.bankAccountName, bankAccountNumber: s.bankAccountNumber, bankBranch: s.bankBranch,
      bankSwift: s.bankSwift, mobileMoneyName: s.mobileMoneyName, mobileMoneyNumber: s.mobileMoneyNumber, mobileMoneyAccountName: s.mobileMoneyAccountName, invoiceTerms: s.invoiceTerms,
      thankYouMessage: s.thankYouMessage, thankYouSignoff: s.thankYouSignoff, thankYouPromoTitle: s.thankYouPromoTitle, thankYouPromoText: s.thankYouPromoText, thankYouRebookText: s.thankYouRebookText,
      instagramUrl: s.instagramUrl, facebookUrl: s.facebookUrl, tiktokUrl: s.tiktokUrl, taxName: s.taxName, wifiNetwork: s.wifiNetwork, wifiPassword: s.wifiPassword,
      receptionHours: s.receptionHours, breakfastLocation: s.breakfastLocation, breakfastNote: s.breakfastNote, restaurantHours: s.restaurantHours, barHours: s.barHours,
      taxRatePercent: s.taxRatePercent?.toString() ?? null, financeAuthorizationLimit: s.financeAuthorizationLimit?.toString() ?? null, orderPrepMinutes: s.orderPrepMinutes?.toString() ?? null,
      airportTransferPrice: s.airportTransferPrice?.toString() ?? null,
    };
    const f: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(text)) f[k] = v ?? "";
    Object.assign(f, {
      businessDayStart: hhmm(s.businessDayStartMinutes), standardCheckIn: hhmm(s.standardCheckInMinutes), checkout: hhmm(s.checkoutMinutes), lateArrival: hhmm(s.lateArrivalMinutes),
      breakfastStart: hhmm(s.breakfastStartMinutes), breakfastEnd: hhmm(s.breakfastEndMinutes), noShowCutoff: hhmm(s.noShowCutoffMinutes),
      expenseApprovalThreshold: String(s.expenseApprovalThreshold), invoiceDefaultDueDays: String(s.invoiceDefaultDueDays), maxAdvanceBookingDays: String(s.maxAdvanceBookingDays),
      lateCheckoutFee: String(s.lateCheckoutFee), roomServiceFee: String(s.roomServiceFee), unpaidHoldHours: String(s.unpaidHoldHours),
      earlyDeparturePolicy: s.earlyDeparturePolicy, occupiedRoomService: s.occupiedRoomService, dateChangeExcessPolicy: s.dateChangeExcessPolicy, noShowPolicy: s.noShowPolicy,
      reportRecipients: (s.reportRecipients as { name?: string; phone: string; apiKeyRef?: string | null; lang?: string | null }[]).map(formatRecipientLine).join("\n"),
    });
    const notify = (s.guestNotifications ?? {}) as Record<string, boolean>;
    const ticked: Record<string, boolean> = {
      purchaseApproverMustDiffer: s.purchaseApproverMustDiffer, taxIncludedInRates: s.taxIncludedInRates, reportEnabled: s.reportEnabled, shiftReportEnabled: s.shiftReportEnabled,
      publicBookingEnabled: s.publicBookingEnabled, breakfastIncluded: !!breakfast && breakfast.isActive && breakfast.isPublic, noShowAutoRelease: s.noShowAutoRelease,
      dateChangePayNow: s.dateChangePayNow, notifyBookingCreated: !!notify.bookingCreated, notifyCheckIn: !!notify.checkIn, notifyCheckOut: !!notify.checkOut, notifyOrders: !!notify.orders,
      publicOrderingEnabled: s.publicOrderingEnabled, ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [`breakfastDay${d}`, s.breakfastDays.includes(d)])),
    };
    for (const [k, on] of Object.entries(ticked)) f[k] = on ? "on" : null;
    Object.assign(f, edits);
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (v !== null) fd.append(k, v);
    return fd;
  }

  it("a changed payment term (or hold rule, or business day) is refused for the Developer and for the MD it works as; the same save from the MD goes through", async () => {
    const s = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
    for (const who of [null]) {
      await developerRefused("change the invoice due days", who, async () => updateSettingsAction(null, await settingsForm({ invoiceDefaultDueDays: String(s.invoiceDefaultDueDays + 30), tagline: "Sneaky tagline" })));
      await developerRefused("change how long an unpaid booking is held", who, async () => updateSettingsAction(null, await settingsForm({ unpaidHoldHours: String(s.unpaidHoldHours + 48) })));
      await developerRefused("change the business day start", who, async () => updateSettingsAction(null, await settingsForm({ businessDayStart: "05:00" })));
    }
    // A save that leaves them as they are works for the Developer (non-money settings stay its own).
    await devAs(md);
    const kept = await updateSettingsAction(null, await settingsForm({ wifiNetwork: "dev-wifi-wall-two", reason: "Tidying the guest wifi" }));
    expect(kept.ok, kept.ok ? "" : kept.error).toBe(true);
    await decided("change the invoice due days", md, async () => updateSettingsAction(null, await settingsForm({ invoiceDefaultDueDays: String(s.invoiceDefaultDueDays + 30) })));
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).invoiceDefaultDueDays).toBe(s.invoiceDefaultDueDays + 30);
    await db.hotelSettings.update({ where: { id: 1 }, data: { invoiceDefaultDueDays: s.invoiceDefaultDueDays, wifiNetwork: s.wifiNetwork } });
  });
});

// ───────────────────────────────────── 5. a payment credited to the person worked as ─────────────────────────────────────
describe("check-in: an online payment is credited to the person who checks the guest in — never to a Developer, never to the person it worked as", () => {
  let n = 0;
  /** A booking for tonight with a guest's online (nTZS) payment waiting for check-in. */
  async function onlinePaidStay() {
    const t = await roomType("DOUBLE_DELUXE");
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: `Online Payer ${n}`, phone: `0715000${String(100 + n)}` },
      stay: { kind: "overnight", arrivalDate: addDays(today(), -1), departureDate: addDays(today(), 1) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[n++].id, adults: 1, children: 0 }],
    }, await managerActor(), at(-1, 12));
    const method = await db.paymentMethod.findUniqueOrThrow({ where: { code: "MOBILE_MONEY" } });
    const account = await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } });
    const paid = await db.payment.create({
      data: { amount: 50_000, methodId: method.id, accountId: account.id, receivedAt: at(-1, 13), businessDate: toDbDate(addDays(today(), -1)), reservationId: r.id, recordedById: ONLINE_RECORDER_ID },
    });
    return { id: r.id, paid };
  }
  const credit = async (id: string) => (await db.payment.findUniqueOrThrow({ where: { id } })).creditedToId;

  it("reception credits it to themselves (as before); a Developer working as reception — marked rights or a copy — and the Developer alone leave it uncredited", async () => {
    // Staff, unchanged: the receptionist who checks the guest in is credited.
    const staff = await onlinePaidStay();
    await as(rec);
    await checkIn(staff.id, await actorOfSession(), null, at(-1, 15));
    expect(await credit(staff.paid.id)).toBe(rec.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: staff.paid.id } })).creditedAt).toBeTruthy();

    // The Developer working as that receptionist: the check-in is done, the payment is NOT credited to her.
    for (const copy of [false, true]) {
      const s = await onlinePaidStay();
      await devAs(rec);
      await checkIn(s.id, await actorOfSession(copy), null, at(-1, 15));
      expect((await db.reservation.findUniqueOrThrow({ where: { id: s.id } })).status, `copy=${copy}`).toBe("CHECKED_IN");
      expect(await credit(s.paid.id), `copy=${copy}`).toBeNull();
      expect((await db.payment.findUniqueOrThrow({ where: { id: s.paid.id } })).creditedAt).toBeNull();
      // The audit line of the check-in does not claim a credit.
      const line = await db.auditLog.findFirstOrThrow({ where: { action: "reservation.checked_in", entityId: s.id } });
      expect(line.after).not.toHaveProperty("onlinePaymentsCredited");
    }
    // The Developer on its own account.
    const alone = await onlinePaidStay();
    await devAs(null);
    await checkIn(alone.id, await actorOfSession(), null, at(-1, 15));
    expect(await credit(alone.paid.id)).toBeNull();
    expect((await db.reservation.findUniqueOrThrow({ where: { id: alone.id } })).status).toBe("CHECKED_IN");
  });
});

// ───────────────────────────────────── 6. shifts ─────────────────────────────────────
// The Developer role does not hold the hotel's-work rights any more (they come only through Work as); these tests prove the fences hold even if it did.
beforeAll(async () => { await giveDeveloperRoleHotelWork(); });
afterAll(async () => { await takeHotelWorkFromDeveloperRole(); });
