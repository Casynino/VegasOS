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
import { AppError } from "@/server/errors";
import { markWorkingAs, sha256 } from "@/server/work-as-session";
import { checkIn, checkOut, createReservation } from "@/server/services/reservations";
import { billCompanyNow } from "@/server/services/company-billing";
import { saveOrderSounds } from "@/server/services/restaurant";
import { setHotelQrSettings } from "@/server/services/booking-qr";
import { quickAddCompanyAction } from "@/app/staff/(app)/corporate/actions";
import { saveExpenseItemAction } from "@/app/staff/(app)/expenses/actions";
import { toDbDate, businessDateOf } from "@/lib/time/business-date";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, giveDeveloperRoleHotelWork, takeHotelWorkFromDeveloperRole, type MadeUser } from "../support/developer";

/**
 * THE INTEGRATION PASS (owner, 2026-10-17): the doors the second money review found that no fixer owned. Each one is tried as the Developer on
 * its own account AND as the Developer working as someone who holds the right, then done by the person who may decide:
 * a company created with payment terms, a booking a company pays, the check-out / "bill the company" that issues the company's invoice,
 * the restaurant's "payments wait for a person to confirm" switch, the Hotel QR "pay at the hotel" switch, and an expense type's default amount.
 */

let dev: MadeUser;
let md: MadeUser;
let rec: MadeUser;
let everyone: MadeUser[];

beforeAll(async () => {
  [dev, md, rec] = await Promise.all([
    makeUser("DEVELOPER", { fullName: "Dev Integration" }), makeUser("ADMIN", { fullName: "MD Integration" }), makeUser("RECEPTIONIST", { fullName: "Reception Integration" }),
  ]);
  everyone = [dev, md, rec];
});
afterAll(async () => {
  browser.reset();
  await rawDb.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
  await resetBusinessData();
  await db.corporateCustomer.deleteMany({ where: { companyName: { startsWith: "Integration " } } });
  await db.expenseItem.deleteMany({ where: { name: { startsWith: "Integration " } } });
  await removeMadeUsers();
});
beforeEach(async () => {
  await resetBusinessData();
  await db.corporateCustomer.deleteMany({ where: { companyName: { startsWith: "Integration " } } });
  await db.expenseItem.deleteMany({ where: { name: { startsWith: "Integration " } } });
  await db.hotelSettings.update({ where: { id: 1 }, data: { orderPaymentConfirm: false, hotelQrPayAtHotel: false, hotelQrEnabled: true } });
  browser.reset();
  await rawDb.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
  await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate(businessDateOf(new Date())), userId: rec.id, startedAt: new Date(Date.now() - 3_600_000) } });
});

/** Sign in as this person. */
async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id, { createdMinAgo: 1, seenMinAgo: 0 });
}
/** The Developer signed in — on its own account, or already working as `target`. */
async function devAs(target: MadeUser | null = null) {
  browser.reset();
  const token = await makeSession(dev.id, { createdMinAgo: 1, seenMinAgo: 0 });
  if (target) await rawDb.session.update({ where: { tokenHash: sha256(token) }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - 60_000) } });
}
/** The acting person as a service sees them: their id and the rights of their role in the database right now. */
async function actorOf(u: MadeUser) {
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, role: row.role.name, permissions: new Set(row.role.permissions.map((p) => p.permission.code)) as ReadonlySet<string> };
}
const refused = async (run: () => Promise<unknown>) => {
  const e = await thrownBy(run);
  expect(e, "an error was expected").toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe("FORBIDDEN");
};
const deniedBy = (u: MadeUser) => db.auditLog.count({ where: { userId: u.id, action: "developer.denied" } });

const BOOKED = eat("2026-10-05T10:00:00");
const ARRIVE = eat("2026-10-10T15:00:00");
const LEAVE = eat("2026-10-12T10:00:00");

/** A company-billed stay, checked in, made by a manager (the Developer cannot make one). */
async function companyStay() {
  const company = await db.corporateCustomer.create({ data: { companyName: "Integration Company Ltd", paymentTermDays: 30 } });
  const dd = await roomType("DOUBLE_DELUXE");
  const mgr = await managerActor();
  const r = await createReservation({
    sourceCode: "CORPORATE", guest: { fullName: "John Michael" }, corporateCustomerId: company.id, billing: { billTo: "COMPANY" },
    stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" },
    rooms: [{ roomTypeId: dd.id, adults: 1, children: 0, discountPerNight: 0 }],
  }, mgr, BOOKED);
  await checkIn(r.id, mgr, null, ARRIVE);
  return { company, id: r.id, mgr };
}

describe("a company: its payment terms are what it owes", () => {
  const input = { companyName: "Integration Safari Co", paymentTermDays: 90, employees: [] };

  it("quick-adding a company is refused for the Developer (own account, working as reception) and still done by reception", async () => {
    for (const who of [null, rec]) {
      await devAs(who);
      const before = await deniedBy(dev);
      const res = await quickAddCompanyAction(input);
      expect(res, who ? "working as reception" : "own account").toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await db.corporateCustomer.count({ where: { companyName: input.companyName } })).toBe(0);
      expect(await deniedBy(dev)).toBe(before + 1);
    }
    await as(rec);
    const ok = await quickAddCompanyAction(input);
    expect(ok.ok).toBe(true);
    expect((await db.corporateCustomer.findFirstOrThrow({ where: { companyName: input.companyName } })).paymentTermDays).toBe(90);
  });

  it("a booking the company pays is refused for the Developer (also with a copied or marked set of rights); a booking the guest pays is not", async () => {
    const company = await db.corporateCustomer.create({ data: { companyName: "Integration Booking Co", paymentTermDays: 30 } });
    const dd = await roomType("DOUBLE_DELUXE");
    const book = (actor: Awaited<ReturnType<typeof actorOf>>, corp: boolean) => createReservation({
      sourceCode: "CORPORATE", guest: { fullName: corp ? "Company Guest" : "Own Guest" }, corporateCustomerId: corp ? company.id : null, billing: corp ? { billTo: "COMPANY", paymentTermDays: 60 } : null,
      stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" },
      rooms: [{ roomTypeId: dd.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, actor, BOOKED);

    const devActor = await actorOf(dev);
    await refused(() => book(devActor, true));
    const marked = { ...(await actorOf(md)), permissions: markWorkingAs(new Set((await actorOf(md)).permissions)) };
    await refused(() => book(marked, true));
    await devAs(md);
    await refused(async () => book(await actorOf(md), true)); // the request itself says the MD's rights are the Developer's
    expect(await db.reservation.count()).toBe(0);

    browser.reset();
    // The same booking by the MD (no Developer around) works, with the company's terms; the Developer's own guest-paid booking works too.
    const made = await book(await actorOf(md), true);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: made.id } })).paymentTermDays).toBe(60);
    await book(devActor, false);
    expect(await db.reservation.count()).toBe(2);
  });

  it("the check-out and 'bill the company' that issue the company's invoice are refused for the Developer (nothing issued); a manager still does both", async () => {
    const x = await companyStay();
    const devActor = await actorOf(dev);
    await refused(() => checkOut(x.id, devActor, {}, LEAVE));
    await refused(() => billCompanyNow(x.id, devActor));
    expect((await db.reservation.findUniqueOrThrow({ where: { id: x.id } })).status).toBe("CHECKED_IN");
    expect(await db.invoice.count()).toBe(0);

    await devAs(md);
    await refused(async () => billCompanyNow(x.id, await actorOf(md)));
    expect(await db.invoice.count()).toBe(0);

    browser.reset();
    const out = await checkOut(x.id, x.mgr, {}, LEAVE);
    expect(out.invoice?.number).toMatch(/^INV-/);
    expect(await db.invoice.count()).toBe(1);
  });
});

describe("switches that decide how guests pay", () => {
  const sounds = { orderSoundsEnabled: true, orderSoundVolume: 60, newOrderSound: "bell", readyOrderSound: "chime", orderPaymentConfirm: false };

  it("the restaurant sounds can be changed by the Developer; whether payments wait for a person to confirm cannot", async () => {
    const devActor = await actorOf(dev);
    await saveOrderSounds({ ...sounds, orderSoundVolume: 30 }, devActor); // a sound: allowed
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).orderSoundVolume).toBe(30);
    await refused(() => saveOrderSounds({ ...sounds, orderSoundVolume: 30, orderPaymentConfirm: true }, devActor));
    await devAs(md);
    await refused(async () => saveOrderSounds({ ...sounds, orderPaymentConfirm: true }, await actorOf(md)));
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).orderPaymentConfirm).toBe(false);

    browser.reset();
    await saveOrderSounds({ ...sounds, orderPaymentConfirm: true }, await actorOf(md));
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).orderPaymentConfirm).toBe(true);
    // Leaving it as it is (true) is not a change: the Developer's save of the sounds goes through.
    await saveOrderSounds({ ...sounds, orderSoundVolume: 50, orderPaymentConfirm: true }, devActor);
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).orderSoundVolume).toBe(50);
  });

  it("the Hotel QR can be switched on and off by the Developer; 'pay at the hotel' (a room held without payment) cannot be changed", async () => {
    const devActor = await actorOf(dev);
    await setHotelQrSettings({ enabled: false }, devActor);
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).hotelQrEnabled).toBe(false);
    await refused(() => setHotelQrSettings({ payAtHotel: true }, devActor));
    await refused(() => setHotelQrSettings({ enabled: true, payAtHotel: true }, devActor));
    await devAs(md);
    await refused(async () => setHotelQrSettings({ payAtHotel: true }, await actorOf(md)));
    expect(await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ hotelQrEnabled: false, hotelQrPayAtHotel: false });

    browser.reset();
    await setHotelQrSettings({ payAtHotel: true }, await actorOf(md));
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).hotelQrPayAtHotel).toBe(true);
    await setHotelQrSettings({ enabled: true, payAtHotel: true }, devActor); // payAtHotel unchanged: allowed
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).hotelQrEnabled).toBe(true);
  });
});

describe("an expense type sets the payee and amount that expenses start from", () => {
  it("adding one is refused for the Developer (own account, working as the MD); the MD does it", async () => {
    const category = await db.expenseCategory.findFirstOrThrow({ orderBy: { code: "asc" } });
    const item = { name: "Integration Generator fuel", categoryId: category.id, frequency: "MONTHLY" as const, defaultPayee: "Fuel Station", defaultAmount: 250_000, isActive: true };
    for (const who of [null, md]) {
      await devAs(who);
      expect(await saveExpenseItemAction(item), who ? "working as the MD" : "own account").toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await db.expenseItem.count({ where: { name: item.name } })).toBe(0);
    }
    await as(md);
    expect((await saveExpenseItemAction(item)).ok).toBe(true);
    expect((await db.expenseItem.findFirstOrThrow({ where: { name: item.name } })).defaultAmount).toBe(250_000);
  });
});

// The Developer role does not hold the hotel's-work rights any more (they come only through Work as); these tests prove the fences hold even if it did.
beforeAll(async () => { await giveDeveloperRoleHotelWork(); });
afterAll(async () => { await takeHotelWorkFromDeveloperRole(); });
