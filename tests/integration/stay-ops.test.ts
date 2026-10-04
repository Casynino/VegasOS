import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  approveLateCheckout, checkIn, checkInWithDetails, createReservation, extendStay, previewExtension, reassignRoom,
} from "@/server/services/reservations";
import { createInvoiceForReservation, issueInvoice } from "@/server/services/invoices";
import { chargeTripToRoom, confirmTrip, createTransportRequest, recordDriver, requestTransportForReservation, setTripStatus } from "@/server/services/transport";
import { createServiceRequest, updateServiceRequest } from "@/server/services/requests";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";
import { ALL_PERMISSIONS } from "@/lib/permissions";

beforeEach(async () => {
  await resetBusinessData();
  await db.transportTrip.deleteMany();
  await db.serviceRequest.deleteMany();
  await db.roomAssignment.deleteMany();
  await db.vehicle.deleteMany();
});
const NOW = eat("2026-10-05T10:00:00");
const guest = { fullName: "Stay Guest", phone: "0711000002" };

async function inHouse(code = "DOUBLE_DELUXE", arrival = "2026-10-05", departure = "2026-10-06", roomNumber?: string) {
  const t = await roomType(code);
  const mgr = await managerActor();
  const roomId = roomNumber ? t.rooms.find((r) => r.number === roomNumber)!.id : undefined;
  const r = await createReservation({ sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: arrival, departureDate: departure },
    rooms: [{ roomTypeId: t.id, roomId, adults: 1, children: 0, discountPerNight: 20_000 }] }, mgr, NOW);
  return r;
}

describe("stay operations", () => {
  it("extends a stay in the same room and bills the extra nights, with invoice adjustment lines", async () => {
    const mgr = await managerActor();
    const r = await inHouse();
    const inv = await createInvoiceForReservation(r.id, mgr);
    await issueInvoice(inv.id, mgr);
    const rr = r.rooms[0];
    const preview = await previewExtension(rr.id, "2026-10-08");
    expect(preview).toMatchObject({ extraNights: 2, netPerNight: 60_000, extraAmount: 120_000, currentRoomAvailable: true });
    await extendStay(rr.id, "2026-10-08", mgr);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.netAmount).toBe(180_000);
    expect(fromDb(after.departureDate)).toBe("2026-10-08");
    const i = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
    expect(i.items).toHaveLength(2); // original line kept + adjustment line
    expect(i.items[0].netAmount).toBe(60_000);
    expect(i.items[1].netAmount).toBe(120_000);
    expect(i.netAmount).toBe(180_000);
  });

  it("when the room is taken for the extension, suggests rooms and can move the guest", async () => {
    const mgr = await managerActor();
    const a = await inHouse("DOUBLE_DELUXE", "2026-10-05", "2026-10-06", "204");
    await inHouse("DOUBLE_DELUXE", "2026-10-06", "2026-10-07", "204"); // next guest in 204
    const p = await previewExtension(a.rooms[0].id, "2026-10-07");
    expect(p.currentRoomAvailable).toBe(false);
    expect(p.alternatives.length).toBeGreaterThan(0);
    await expect(extendStay(a.rooms[0].id, "2026-10-07", mgr)).rejects.toThrow(/not available for the requested extension/);
    await extendStay(a.rooms[0].id, "2026-10-07", mgr, { moveToRoomId: p.alternatives[0].id });
    const moved = await db.reservationRoom.findUniqueOrThrow({ where: { id: a.rooms[0].id }, include: { assignments: true } });
    expect(moved.roomId).toBe(p.alternatives[0].id);
    expect(moved.assignments).toHaveLength(1); // history kept
  });

  it("a guest in the hotel whose room is booked next moves with everything to a free room — a dearer one too — and the new nights cost that room's price", async () => {
    const mgr = await managerActor();
    const a = await inHouse("DOUBLE_DELUXE", "2026-10-05", "2026-10-06", "204");
    await checkIn(a.id, mgr, null, eat("2026-10-05T15:00:00"));
    await inHouse("DOUBLE_DELUXE", "2026-10-06", "2026-10-08", "204"); // the next guest in 204
    const p = await previewExtension(a.rooms[0].id, "2026-10-08");
    expect(p.currentRoomAvailable).toBe(false);
    // Same type first; every alternative priced for the 2 new nights.
    expect(p.alternatives[0].sameType).toBe(true);
    const dearer = p.alternatives.find((x) => !x.sameType && x.perNight > p.netPerNight)!;
    expect(dearer).toBeTruthy();
    expect(dearer.extraAmount).toBe(2 * dearer.perNight);
    await extendStay(a.rooms[0].id, "2026-10-08", mgr, { moveToRoomId: dearer.id });
    const rr = await db.reservationRoom.findUniqueOrThrow({ where: { id: a.rooms[0].id } });
    expect(rr).toMatchObject({ roomId: dearer.id, status: "CHECKED_IN" });
    expect(rr.departureDate.toISOString().slice(0, 10)).toBe("2026-10-08");
    // The same booking and account: the night already booked keeps its price, the new nights are the new room's.
    const res = await db.reservation.findUniqueOrThrow({ where: { id: a.id } });
    expect(res.netAmount).toBe(60_000 + dearer.extraAmount);
  });

  it("room change keeps history and can charge an upgrade difference", async () => {
    const mgr = await managerActor();
    const r = await inHouse("DOUBLE_DELUXE", "2026-10-05", "2026-10-07");
    const suite = await roomType("EXECUTIVE_SUITE");
    await reassignRoom(r.rooms[0].id, suite.rooms[0].id, mgr, "Guest asked for more space", { chargeDifference: true });
    const res = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true, rooms: { include: { assignments: true } } } });
    expect(res.rooms[0].assignments[0]).toMatchObject({ reason: "Guest asked for more space", priceDifference: 80_000 });
    expect(res.charges[0]).toMatchObject({ category: "ROOM_UPGRADE", amount: 80_000 });
    expect(res.netAmount).toBe(2 * 60_000 + 80_000);
  });

  it("late checkout extends today's checkout and charges the configured fee", async () => {
    const mgr = await managerActor();
    const r = await inHouse("EXECUTIVE", "2026-10-05", "2026-10-06");
    await checkIn(r.id, mgr, null, eat("2026-10-05T15:00:00"));
    await approveLateCheckout(r.rooms[0].id, { until: "14:00", fee: 25_000, note: "Flight at 18:00" }, mgr);
    const rr = await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } });
    expect(rr.endAt.toISOString()).toBe("2026-10-06T11:00:00.000Z");
    const res = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(res.netAmount).toBe(80_000 + 25_000);
    // Next guest arriving at 14:00 in the same room blocks a later late-checkout.
    await inHouse("EXECUTIVE", "2026-10-06", "2026-10-07", (await db.room.findUniqueOrThrow({ where: { id: rr.roomId } })).number);
    await expect(approveLateCheckout(r.rooms[0].id, { until: "16:00", fee: 0 }, mgr)).rejects.toThrow(/booked for another guest/);
  });

  it("check-in wizard requires ID verification and fills missing guest details", async () => {
    const recep = await receptionistActor();
    const r = await inHouse();
    await expect(checkInWithDetails(r.id, { guest: { fullName: "Stay Guest" }, checklist: {} }, recep)).rejects.toThrow(/Verify the guest/);
    await checkInWithDetails(r.id, { guest: { fullName: "Stay Guest", idType: "PASSPORT", idNumber: "AB123456", nationality: "Kenyan" }, checklist: { guestVerified: true, keyIssued: true } }, recep, eat("2026-10-05T15:00:00"));
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { guest: true } });
    expect(after.status).toBe("CHECKED_IN");
    expect(after.guest.idNumber).toBe("AB123456");
    expect((after.welcomeChecklist as { keyIssued: boolean }).keyIssued).toBe(true);
  });
});

describe("transport & requests", () => {
  it("website airport pickup → confirm → driver → driver progresses own trip → added to the room once", async () => {
    const mgr = { ...(await managerActor()), permissions: new Set(ALL_PERMISSIONS) as ReadonlySet<string> };
    const r = await inHouse();
    const trip = await requestTransportForReservation({ reservationId: r.id, flightNumber: "tc 101", arrivalDate: "2026-10-05", arrivalTime: "08:30", passengers: 2 });
    expect(trip).toMatchObject({ status: "REQUESTED", type: "AIRPORT_PICKUP", flightNumber: "TC 101", passengers: 2, charge: 40_000, standardPrice: 40_000 });
    expect(trip.reference).toMatch(/^TRN-2026-\d{5}$/);
    const driverRole = await db.role.findUniqueOrThrow({ where: { code: "DRIVER" } });
    const driver = await db.user.create({ data: { email: `drv${Date.now()}@test.local`, fullName: "Driver D", passwordHash: "x", roleId: driverRole.id } });
    const van = await db.vehicle.create({ data: { name: "Van", plateNumber: `T${Date.now() % 100000} ABC`, capacity: 1 } });
    await expect(recordDriver(trip.id, { driverId: driver.id }, mgr)).rejects.toThrow(/Confirm the request first/);
    await confirmTrip(trip.id, mgr);
    await expect(recordDriver(trip.id, { driverId: driver.id, vehicleId: van.id }, mgr)).rejects.toThrow(/seats 1/);
    await db.vehicle.update({ where: { id: van.id }, data: { capacity: 7 } });
    await recordDriver(trip.id, { driverId: driver.id, vehicleId: van.id }, mgr);
    const drv = { userId: driver.id, label: "Driver D", permissions: new Set(["transport.driver"]) as ReadonlySet<string> };
    await expect(setTripStatus(trip.id, "CANCELLED", drv, "x")).rejects.toThrow(/cannot change/);
    await setTripStatus(trip.id, "EN_ROUTE", drv);
    await setTripStatus(trip.id, "PICKED_UP", drv);
    await setTripStatus(trip.id, "COMPLETED", drv);
    await chargeTripToRoom(trip.id, mgr);
    await expect(chargeTripToRoom(trip.id, mgr)).rejects.toThrow(/already on a bill/);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(60_000 + 40_000);
    const custom = await db.transportService.findUniqueOrThrow({ where: { code: "CUSTOM" } });
    const other = await createTransportRequest({ serviceId: custom.id, passengerName: "X Guest", passengerPhone: "+255700111222", date: "2026-10-06", time: "10:00", destination: "Mlimani City", passengers: 1 }, { source: "STAFF", actor: mgr });
    expect(other).toMatchObject({ status: "REQUESTED", charge: 100_000, pickupLocation: "Vegas Luxury Hotel" });
  });

  it("service request lifecycle", async () => {
    const recep = await receptionistActor();
    const r = await inHouse();
    const req = await createServiceRequest({ reservationId: r.id, type: "MAINTENANCE", priority: "HIGH", description: "AC not cooling" }, { ...recep, userId: recep.userId! });
    expect(req.status).toBe("NEW");
    expect(await db.shiftHandoverNote.count({ where: { kind: "MAINTENANCE" } })).toBe(1);
    await updateServiceRequest(req.id, { assignedToId: recep.userId! }, { ...recep, userId: recep.userId! });
    await updateServiceRequest(req.id, { status: "COMPLETED" }, { ...recep, userId: recep.userId! });
    await expect(updateServiceRequest(req.id, { status: "IN_PROGRESS" }, { ...recep, userId: recep.userId! })).rejects.toThrow();
  });
});

function fromDb(d: Date) { return d.toISOString().slice(0, 10); }
