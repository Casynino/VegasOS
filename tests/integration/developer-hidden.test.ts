import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { businessToday } from "@/server/settings";
import { acceptServiceRequest, createServiceRequest, requestHandlers, updateServiceRequest } from "@/server/services/requests";
import { staffPerformance } from "@/server/services/staff-performance";
import { waitersToAssign } from "@/server/services/restaurant";
import { assignRequest, submitBookingRequest } from "@/server/services/booking-requests";
import { confirmTrip, createTransportRequest, recordDriver } from "@/server/services/transport";
import { isPickableRole, operationalOnly, operationalUser, withoutDeveloper } from "@/server/staff-pickers";
import { addDays } from "@/lib/time/business-date";
import { DEFAULT_ROLES, DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { managerActor as anyManager, resetBusinessData } from "../support/helpers";
import { makeUser, removeMadeUsers, giveDeveloperRoleHotelWork, takeHotelWorkFromDeveloperRole, type MadeUser } from "../support/developer";

/**
 * The Developer account is never offered to other staff (owner, 2026-10-14). It holds nearly every right, so every list that finds
 * people "by what they may do" would list it — guest-request handlers, drivers, waiters, the staff roster, people filters. It is kept
 * out of all of them, and nobody can give it work even by sending its id directly. A normal staff member is still listed everywhere.
 */

let dev: MadeUser;
let rec: MadeUser;
let driver: MadeUser;
let waiter: MadeUser;

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Hidden" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Hidden" });
  driver = await makeUser("DRIVER", { fullName: "Dereva Hidden" });
  waiter = await makeUser("RESTAURANT", { fullName: "Wema Hidden" });
});
afterAll(async () => {
  await removeMadeUsers();
});
beforeEach(async () => {
  await resetBusinessData();
  await db.bookingRequest.deleteMany();
  await db.transportTrip.deleteMany();
});

const manager = async () => { const a = await anyManager(); return { ...a, userId: a.userId!, permissions: a.permissions! }; };
const names = (rows: { fullName?: string; name?: string }[]) => rows.map((r) => r.fullName ?? r.name);
const asDeveloper = () => ({ userId: dev.id, label: dev.fullName, permissions: new Set<string>(DEFAULT_ROLES.DEVELOPER.permissions) as ReadonlySet<string> });
const guestRequest = async () => createServiceRequest({ type: "GENERAL", priority: "NORMAL", description: "Extra pillows please" }, await manager());

describe("the helper", () => {
  it("knows which roles are never offered as a person", () => {
    expect(isPickableRole(DEVELOPER_ROLE_CODE)).toBe(false);
    expect(isPickableRole("SYSTEM_ONLINE")).toBe(false);
    for (const code of ["OWNER", "ADMIN", "MANAGER", "FINANCE", "RECEPTIONIST", "RESTAURANT", "DRIVER"]) expect(isPickableRole(code)).toBe(true);
  });

  it("combines with a filter that already has a role condition — it never replaces it", async () => {
    // The role filter of the caller (drivers only) AND "not the Developer": both apply.
    const found = await db.user.findMany({ where: operationalOnly({ id: { in: [dev.id, rec.id, driver.id] }, role: { code: "DRIVER" } }), select: { id: true } });
    expect(found.map((u) => u.id)).toEqual([driver.id]);
    const notDev = await db.user.findMany({ where: withoutDeveloper({ id: { in: [dev.id, rec.id, driver.id] } }), select: { id: true } });
    expect(notDev.map((u) => u.id).sort()).toEqual([rec.id, driver.id].sort());
    const plain = await db.user.findMany({ where: { id: { in: [dev.id, rec.id] }, ...operationalUser }, select: { id: true } });
    expect(plain.map((u) => u.id)).toEqual([rec.id]);
  });
});

describe("guest requests", () => {
  it("the list of handlers never includes the Developer; a receptionist is still there", async () => {
    // Control: the Developer's role does hold the right the list is built on — only the exclusion keeps it out.
    const holds = await db.user.count({ where: { id: dev.id, role: { permissions: { some: { permission: { code: "requests.manage" } } } } } });
    expect(holds).toBe(1);
    const handlers = await requestHandlers();
    expect(handlers.map((h) => h.id)).not.toContain(dev.id);
    expect(names(handlers)).not.toContain("Dev Hidden");
    expect(handlers.map((h) => h.id)).toContain(rec.id);
  });

  it("a request cannot be assigned to the Developer — not at creation, not later, even with the id sent directly", async () => {
    const mgr = await manager();
    await expect(createServiceRequest({ type: "GENERAL", priority: "NORMAL", description: "Pillows", assignedToId: dev.id }, mgr)).rejects.toThrow(/cannot take guest requests/);
    expect(await db.serviceRequest.count()).toBe(0);

    const req = await guestRequest();
    await expect(updateServiceRequest(req.id, { assignedToId: dev.id }, mgr)).rejects.toThrow(/cannot take guest requests/);
    const after = await db.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after).toMatchObject({ assignedToId: null, status: "NEW" });
  });

  it("the Developer cannot take a request for itself either (nobody else would be told it is taken)", async () => {
    const req = await guestRequest();
    await expect(acceptServiceRequest(req.id, asDeveloper())).rejects.toThrow(/cannot take guest requests/);
    expect(await db.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ assignedToId: null, status: "NEW" });
  });

  it("a normal staff member is still assignable and can accept", async () => {
    const mgr = await manager();
    const req = await guestRequest();
    await updateServiceRequest(req.id, { assignedToId: rec.id }, mgr);
    expect(await db.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ assignedToId: rec.id, status: "ASSIGNED" });
    const accepted = await acceptServiceRequest(req.id, { userId: rec.id, label: rec.fullName });
    expect(accepted.status).toBe("IN_PROGRESS");
  });

  it("an online-payment system account cannot be given a request either", async () => {
    const system = await db.user.findFirst({ where: { role: { code: "SYSTEM_ONLINE" } }, select: { id: true } });
    expect(system).not.toBeNull();
    await expect(updateServiceRequest((await guestRequest()).id, { assignedToId: system!.id }, await manager())).rejects.toThrow(/cannot take guest requests/);
  });
});

describe("drivers", () => {
  // The driver list on the Transport page is this query (the page is a server component; its source is checked below).
  const driverList = (where: object = {}) => db.user.findMany({ where: { ...where, isActive: true, role: { permissions: { some: { permission: { code: "transport.driver" } } } } }, select: { id: true, fullName: true } });

  it("the Developer holds the driver right, but is never listed as a driver; a real driver is", async () => {
    const control = await driverList({ id: { in: [dev.id, driver.id] } });
    expect(control.map((u) => u.id).sort()).toEqual([dev.id, driver.id].sort()); // without the exclusion it WOULD be listed
    const listed = await db.user.findMany({
      where: operationalOnly({ id: { in: [dev.id, driver.id] }, isActive: true, role: { permissions: { some: { permission: { code: "transport.driver" } } } } }),
      select: { id: true },
    });
    expect(listed.map((u) => u.id)).toEqual([driver.id]);
  });

  it("a trip cannot be given to the Developer as its driver, even with the id sent directly", async () => {
    const mgr = await manager();
    const meeting = await db.transportService.findUniqueOrThrow({ where: { code: "MEETING" }, include: { options: { orderBy: { price: "asc" } } } });
    const today = await businessToday();
    const trip = await createTransportRequest(
      { serviceId: meeting.id, optionId: meeting.options[0].id, passengerName: "Walk-in Client", passengerPhone: "+255 755 123 456", date: today, time: "10:00", destination: "Mlimani City", passengers: 2 },
      { source: "STAFF", actor: mgr },
    );
    await confirmTrip(trip.id, mgr);
    await expect(recordDriver(trip.id, { driverId: dev.id }, mgr)).rejects.toThrow(/Choose an active driver/);
    expect(await db.transportTrip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({ driverId: null });
    // A real driver is accepted.
    await recordDriver(trip.id, { driverId: driver.id }, mgr);
    expect((await db.transportTrip.findUniqueOrThrow({ where: { id: trip.id } })).driverId).toBe(driver.id);
  });
});

describe("waiters", () => {
  it("the list of waiters to hand work to never includes the Developer; a waiter is still there", async () => {
    const list = await waitersToAssign();
    expect(list.map((w) => w.id)).not.toContain(dev.id);
    expect(list.map((w) => w.id)).toContain(waiter.id);
  });
});

describe("the staff roster", () => {
  it("the staff performance report lists the people on the team, never the Developer — even one with recorded actions", async () => {
    const today = await businessToday();
    await audit(db, { userId: dev.id, label: dev.fullName }, { action: "test.hidden.dev", entityType: "Test", entityId: "dev" });
    await audit(db, { userId: rec.id, label: rec.fullName }, { action: "test.hidden.rec", entityType: "Test", entityId: "rec" });
    const { people } = await staffPerformance({ from: addDays(today, -1), to: today });
    expect(people.map((p) => p.id)).not.toContain(dev.id);
    expect(names(people)).not.toContain("Dev Hidden");
    const asha = people.find((p) => p.id === rec.id);
    expect(asha).toBeDefined();
    expect(asha!.actions).toBeGreaterThanOrEqual(1);
    // The audit trail itself is untouched: the Developer's entry is there, under its own identity.
    expect(await db.auditLog.count({ where: { userId: dev.id, action: "test.hidden.dev", actorType: "DEVELOPER" } })).toBe(1);
  });
});

describe("booking requests", () => {
  it("a website booking request cannot be assigned to the Developer; staff can still be chosen", async () => {
    const today = await businessToday();
    const r = await submitBookingRequest({ checkIn: addDays(today, 3), checkOut: addDays(today, 5), typeSlug: "double-deluxe", rooms: 1, adults: 2, children: 0 }, { fullName: "Hidden Guest", phone: "0712 777 888" }, null);
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference } });
    const mgr = await manager();
    await expect(assignRequest(req.id, dev.id, mgr)).rejects.toThrow(/active staff member/);
    expect((await db.bookingRequest.findUniqueOrThrow({ where: { id: req.id } })).assignedToId).toBeNull();
    await assignRequest(req.id, rec.id, mgr);
    expect((await db.bookingRequest.findUniqueOrThrow({ where: { id: req.id } })).assignedToId).toBe(rec.id);
  });
});

describe("every staff-facing list uses the helper (source check — the pages are server components)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const lines = (file: string) => readFileSync(path.join(root, file), "utf8").split("\n");
  /** Every `db.user.findMany` line that lists people by what they may do (not a lookup of names for known ids). */
  const pickerLines = (file: string) => lines(file).filter((l) => /user\.findMany\(/.test(l) && !/id: \{ in:/.test(l));

  const cases: [string, number][] = [
    ["src/app/staff/(app)/transport/page.tsx", 1],
    ["src/app/staff/(app)/finance/ledger/page.tsx", 1],
    ["src/app/staff/(app)/finance/history/page.tsx", 1],
    ["src/app/staff/(app)/booking-requests/[id]/request-view.tsx", 1],
    ["src/server/services/staff-performance.ts", 1],
    ["src/server/services/command-center.ts", 1],
  ];
  it.each(cases)("%s", (file, count) => {
    const found = pickerLines(file);
    expect(found).toHaveLength(count);
    for (const l of found) expect(l).toMatch(/operationalOnly\(|withoutDeveloper\(/);
  });

  it("the assignment guards are in place (guest request assignee, booking request, trip driver, restaurant waiters)", () => {
    const text = (f: string) => readFileSync(path.join(root, f), "utf8");
    expect(text("src/server/services/requests.ts")).toMatch(/tx\.user\.findFirst\(\{\s*where: operationalOnly\(/);
    expect(text("src/server/services/booking-requests.ts")).toContain("operationalOnly({ id: userId })");
    expect(text("src/server/services/transport.ts")).toContain("!isPickableRole(d.role.code)");
    expect(text("src/server/services/restaurant.ts")).toMatch(/waitersToAssign[\s\S]{0,300}operationalOnly\(/);
  });
});

// The Developer role does not hold the hotel's-work rights any more (they come only through Work as); these tests prove the fences hold even if it did.
beforeAll(async () => { await giveDeveloperRoleHotelWork(); });
afterAll(async () => { await takeHotelWorkFromDeveloperRole(); });
