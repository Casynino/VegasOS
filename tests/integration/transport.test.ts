import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import {
  adjustTripPrice, chargeTripToRoom, confirmTrip, createTransportRequest, payTripDirect, recordDriver, saveTransportService, setTripStatus, transportReport,
} from "@/server/services/transport";
import { profitLoss } from "@/server/services/reporting";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(async () => {
  await resetBusinessData();
  await db.$executeRawUnsafe(`TRUNCATE "transport_trips" CASCADE`);
  await db.transportService.update({ where: { code: "AIRPORT_PICKUP" }, data: { price: 40_000, isActive: true, isPublic: true } });
  // The meeting packages as shipped (a test edits them).
  await db.transportServiceOption.deleteMany({ where: { serviceId: "trsvc_meeting" } });
  await db.transportServiceOption.createMany({ data: [
    { id: "trsopt_meeting_short", serviceId: "trsvc_meeting", name: "Short trip", description: "Nearby, a few hours", price: 30_000, sortOrder: 10 },
    { id: "trsopt_meeting_half", serviceId: "trsvc_meeting", name: "Half day", description: "Across the city, up to half a day", price: 50_000, sortOrder: 20 },
    { id: "trsopt_meeting_full", serviceId: "trsvc_meeting", name: "Full day", description: "Long distance or the whole day", price: 100_000, sortOrder: 30 },
  ] });
  await db.transportService.update({ where: { code: "MEETING" }, data: { price: 30_000 } });
});

const TZ = "Africa/Dar_es_Salaam";
const today = () => businessDateOf(new Date());
const svc = (code: string) => db.transportService.findUniqueOrThrow({ where: { code } });
const admin = async () => ({ ...(await managerActor()), permissions: new Set(ALL_PERMISSIONS) as ReadonlySet<string> });

async function inHouse() {
  const dd = await roomType("DOUBLE_DELUXE");
  const t = today();
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "John Smith", phone: "+255 712 000 111" }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 2, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(t, -1), 12 * 60, TZ));
  await checkIn(r.id, await managerActor(), null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}

describe("guest transport", () => {
  it("website request: no account, phone required, flight & bags for a pickup, PENDING with a TRN reference and a price snapshot", async () => {
    const pickup = await svc("AIRPORT_PICKUP");
    const base = { serviceId: pickup.id, passengerName: "John Smith", passengerPhone: "+255 700 000 001", date: addDays(today(), 3), time: "18:30", airport: "Julius Nyerere International Airport (DAR)", flightNumber: "TK603", passengers: 2, bags: 4 };
    await expect(createTransportRequest({ ...base, passengerPhone: "12" }, { source: "WEBSITE" })).rejects.toThrow(/phone number/);
    await expect(createTransportRequest({ ...base, flightNumber: "" }, { source: "WEBSITE" })).rejects.toThrow(/flight number/);
    await expect(createTransportRequest({ ...base, bags: null }, { source: "WEBSITE" })).rejects.toThrow(/bags/);
    const trip = await createTransportRequest(base, { source: "WEBSITE" });
    expect(trip).toMatchObject({ status: "REQUESTED", source: "WEBSITE", charge: 40_000, standardPrice: 40_000, bags: 4, passengers: 2, flightNumber: "TK603", destination: "Vegas Luxury Hotel" });
    expect(trip.reference).toMatch(/^TRN-\d{4}-00001$/);
    const next = await createTransportRequest(base, { source: "WEBSITE" });
    expect(next.reference).toMatch(/-00002$/);

    // Admin changes the price: old requests keep theirs, new ones use the new price.
    await saveTransportService({ id: pickup.id, name: pickup.name, price: 45_000, isActive: true, isPublic: true }, await admin());
    expect((await db.transportTrip.findUniqueOrThrow({ where: { id: trip.id } })).charge).toBe(40_000);
    expect((await createTransportRequest(base, { source: "WEBSITE" })).charge).toBe(45_000);
    await expect(saveTransportService({ id: pickup.id, name: pickup.name, price: 1, isActive: true, isPublic: true }, await receptionistActor())).rejects.toThrow(/manager or admin/);
  });

  it("a website booking number is linked only when the phone matches that booking", async () => {
    const r = await inHouse();
    const pickup = await svc("AIRPORT_PICKUP");
    const base = { serviceId: pickup.id, passengerName: "Someone", date: addDays(today(), 2), time: "10:00", airport: "DAR", flightNumber: "KQ1", passengers: 1, bags: 1, reservationRef: r.reference.toLowerCase() };
    expect((await createTransportRequest({ ...base, passengerPhone: "+255 799 999 999" }, { source: "WEBSITE" })).reservationId).toBeNull();
    expect((await createTransportRequest({ ...base, passengerPhone: "0712 000 111" }, { source: "WEBSITE" })).reservationId).toBe(r.id);
  });

  it("reception: confirm → driver → complete → pay directly into an account; transport income once; only a manager cancels or changes a price", async () => {
    const recep = await receptionistActor();
    const mgr = await managerActor();
    const meeting = await db.transportService.findUniqueOrThrow({ where: { code: "MEETING" }, include: { options: { orderBy: { price: "asc" } } } });
    expect(meeting.options.map((o) => o.price)).toEqual([30_000, 50_000, 100_000]);
    const req = { serviceId: meeting.id, passengerName: "Walk-in Client", passengerPhone: "+255 755 123 456", date: today(), time: "10:00", destination: "Mlimani City", passengers: 3 };
    await expect(createTransportRequest(req, { source: "STAFF", actor: recep })).rejects.toThrow(/package/);
    const trip = await createTransportRequest({ ...req, optionId: meeting.options[1].id }, { source: "STAFF", actor: recep });
    expect(trip).toMatchObject({ status: "REQUESTED", charge: 50_000, standardPrice: 50_000, priceOption: "Half day", type: "HOTEL_TRANSFER" });

    // A manager changes the packages any time; this trip keeps its package and price.
    await saveTransportService({ id: meeting.id, name: meeting.name, price: 0, isActive: true, isPublic: true,
      options: meeting.options.map((o) => ({ id: o.id, name: o.name, description: o.description, price: o.price + 5_000 })) }, mgr);
    const edited = await db.transportService.findUniqueOrThrow({ where: { id: meeting.id }, include: { options: true } });
    expect(edited.price).toBe(35_000);
    expect(edited.options.map((o) => o.price).sort((a, b) => a - b)).toEqual([35_000, 55_000, 105_000]);
    expect((await db.transportTrip.findUniqueOrThrow({ where: { id: trip.id } })).charge).toBe(50_000);
    await confirmTrip(trip.id, recep);
    await recordDriver(trip.id, { driverName: "Hamisi", driverPhone: "+255 713 000 000", vehicleName: "Toyota Noah", vehiclePlate: "t 123 abc" }, recep);
    await expect(recordDriver(trip.id, { driverName: "Other" }, recep)).rejects.toThrow(/manager/);
    await expect(setTripStatus(trip.id, "CANCELLED", recep, "changed plans")).rejects.toThrow(/manager/);
    await expect(adjustTripPrice(trip.id, 25_000, "Corporate guest", recep)).rejects.toThrow(/manager/);
    await adjustTripPrice(trip.id, 25_000, "Corporate guest", mgr);
    await expect(payTripDirect(trip.id, { accountId: "acct_bank" }, recep)).rejects.toThrow(/Complete the trip/);
    await setTripStatus(trip.id, "EN_ROUTE", recep);
    await setTripStatus(trip.id, "COMPLETED", recep);
    await payTripDirect(trip.id, { accountId: "acct_bank", reference: "CRDB-77" }, recep);
    await expect(chargeTripToRoom(trip.id, recep, null)).rejects.toThrow(/already on a bill or paid/);

    const t = await db.transportTrip.findUniqueOrThrow({ where: { id: trip.id }, include: { sales: true } });
    expect(t).toMatchObject({ charge: 25_000, standardPrice: 50_000, priceReason: "Corporate guest", driverName: "Hamisi", vehiclePlate: "T 123 ABC" });
    expect(t.confirmedById).toBe(recep.userId);
    expect(t.sales).toHaveLength(1);
    expect(t.sales[0]).toMatchObject({ kind: "TRANSPORT", amount: 25_000, accountId: "acct_bank" });
    const pl = await profitLoss({ from: today(), to: today() });
    expect(pl.revenue.transport).toBe(25_000);
    expect(await db.auditLog.count({ where: { entityType: "TransportTrip", entityId: trip.id } })).toBeGreaterThanOrEqual(6);
  });

  it("guest in the hotel: drop-off → room bill; paying the room bill later does not count the transport again", async () => {
    const r = await inHouse();
    const recep = await receptionistActor();
    const drop = await svc("AIRPORT_DROPOFF");
    const trip = await createTransportRequest({ serviceId: drop.id, reservationId: r.id, passengerName: "John Smith", passengerPhone: "+255 712 000 111", date: today(), time: "08:00", airport: "Julius Nyerere International Airport (DAR)", passengers: 2, bags: 4 }, { source: "STAFF", actor: recep });
    expect(trip.reservationId).toBe(r.id);
    expect(trip.roomNumber).toBeTruthy();
    await confirmTrip(trip.id, recep);
    await setTripStatus(trip.id, "COMPLETED", recep);
    await chargeTripToRoom(trip.id, recep);
    const charge = await db.reservationCharge.findFirstOrThrow({ where: { reservationId: r.id, category: "TRANSPORT" } });
    expect(charge).toMatchObject({ amount: 40_000, kind: "TRANSPORT" });
    const before = await profitLoss({ from: today(), to: today() });
    expect(before.revenue.transport).toBe(40_000);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    await recordReservationPayment({ reservationId: r.id, amount: after.balanceAmount, accountId: "acct_cash" }, await managerActor());
    expect((await profitLoss({ from: today(), to: today() })).revenue.transport).toBe(40_000);

    const rep = await transportReport(today(), today());
    expect(rep).toMatchObject({ revenue: 40_000, onRooms: 40_000, paidDirect: 0, completed: 1 });
  });

  it("an airport pickup can exist before check-in and go on the booking once completed; no-show and cancel keep the history", async () => {
    const dd = await roomType("TWIN");
    const arrival = addDays(today(), 5);
    const r = await createReservation({ sourceCode: "PHONE", guest: { fullName: "Arriving Guest", phone: "+255 700 222 333" }, stay: { kind: "overnight", arrivalDate: arrival, departureDate: addDays(arrival, 2) },
      rooms: [{ roomTypeId: dd.id, adults: 1, children: 0, discountPerNight: 0 }] }, await receptionistActor());
    const recep = await receptionistActor();
    const pickup = await svc("AIRPORT_PICKUP");
    const trip = await createTransportRequest({ serviceId: pickup.id, reservationId: r.id, passengerName: "Arriving Guest", passengerPhone: "+255 700 222 333", date: arrival, time: "18:30", airport: "DAR", flightNumber: "TK603", passengers: 1, bags: 2 }, { source: "STAFF", actor: recep });
    await confirmTrip(trip.id, recep);
    await setTripStatus(trip.id, "COMPLETED", recep);
    await chargeTripToRoom(trip.id, recep);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBeGreaterThanOrEqual(40_000);

    const other = await createTransportRequest({ serviceId: pickup.id, passengerName: "Nobody", passengerPhone: "+255 700 555 666", date: arrival, time: "20:00", airport: "DAR", flightNumber: "XX1", passengers: 1, bags: 0 }, { source: "STAFF", actor: recep });
    await confirmTrip(other.id, recep);
    await setTripStatus(other.id, "NO_SHOW", recep, "Not on the flight");
    await expect(setTripStatus(other.id, "COMPLETED", recep)).rejects.toThrow();
    expect((await db.transportTrip.findUniqueOrThrow({ where: { id: other.id } })).cancelReason).toBe("Not on the flight");
  });
});
