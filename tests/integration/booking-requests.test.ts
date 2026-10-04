import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  convertRequest, logContact, relinkCustomer, requestStats, setRequestStatus, submitBookingRequest,
} from "@/server/services/booking-requests";
import { businessDateOf, addDays } from "@/lib/time/business-date";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { resetBusinessData } from "../support/helpers";

beforeEach(async () => {
  await resetBusinessData();
  await db.bookingRequest.deleteMany();
  await db.transportTrip.deleteMany();
});

async function staff(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) as ReadonlySet<string> };
}
const today = () => businessDateOf(new Date());
const sel = (overrides: Partial<{ checkIn: string; checkOut: string; typeSlug: string; rooms: number; adults: number; children: number }> = {}) => ({
  checkIn: addDays(today(), 3), checkOut: addDays(today(), 5), typeSlug: "double-deluxe", rooms: 1, adults: 2, children: 0, ...overrides,
});

describe("website booking requests", () => {
  it("submission creates a NEW request — not a reservation — with a server-side estimate", async () => {
    const r = await submitBookingRequest(sel(), { fullName: "John Michael", phone: "0712 111 222", expectedArrivalTime: "17:30", specialRequests: "Airport pickup" }, "1.2.3.4");
    expect(r.reference).toMatch(/^VLH-REQ-[A-Z0-9]{5}$/);
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference }, include: { source: true } });
    expect(req).toMatchObject({ status: "NEW", expectedArrivalTime: "17:30", estimatedNet: 120_000, phone: "+255712111222" });
    expect(req.source.code).toBe("WEBSITE");
    expect(await db.reservation.count()).toBe(0);
    expect(await db.roomNight.count()).toBe(0); // no inventory held
  });

  it("matches returning customers by phone instead of duplicating; staff can split a wrong match", async () => {
    const a = await submitBookingRequest(sel(), { fullName: "John Michael", phone: "0712111222" }, null);
    const b = await submitBookingRequest(sel(), { fullName: "J. Michael", phone: "+255 712 111 222" }, null);
    const [ra, rb] = await Promise.all([a, b].map((x) => db.bookingRequest.findUniqueOrThrow({ where: { reference: x.reference } })));
    expect(ra.guestId).toBe(rb.guestId);
    expect(await db.guest.count()).toBe(1);
    await relinkCustomer(rb.id, "NEW", await staff("asha@vegas.test"));
    expect(await db.guest.count()).toBe(2);
  });

  it("contact log → convert re-checks availability, prices, links the reservation, and raises transport", async () => {
    const recep = await staff("asha@vegas.test");
    const r = await submitBookingRequest(sel(), { fullName: "Jane Doe", phone: "0755999888", expectedArrivalTime: "18:00" }, null, {
      flightNumber: "kq484", arrivalDate: addDays(today(), 3), arrivalTime: "15:10", passengers: 2,
    });
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference } });
    await logContact(req.id, { note: "Called at 10:30. Confirmed arrival 18:00." }, recep);
    expect((await db.bookingRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CONTACTED");

    const res = await convertRequest(req.id, { checkIn: sel().checkIn, checkOut: sel().checkOut, roomTypeId: req.roomTypeId, roomCount: 1, adults: 2, children: 0 }, recep);
    // Not paid yet: pending, the room held for the hold time (payment confirms it).
    expect(res).toMatchObject({ status: "RESERVED", netAmount: 120_000, eta: "18:00" });
    expect(res.holdUntil).not.toBeNull();
    expect(res.source.code).toBe("WEBSITE");
    const after = await db.bookingRequest.findUniqueOrThrow({ where: { id: req.id }, include: { events: true } });
    expect(after).toMatchObject({ status: "CONVERTED", reservationId: res.id, handledById: recep.userId });
    expect(after.events.map((e) => e.type)).toEqual(expect.arrayContaining(["SUBMITTED", "CONTACTED", "CONVERTED"]));
    expect(await db.transportTrip.count({ where: { reservationId: res.id, flightNumber: "KQ484" } })).toBe(1);
    await expect(convertRequest(req.id, { checkIn: sel().checkIn, checkOut: sel().checkOut, roomTypeId: req.roomTypeId, roomCount: 1, adults: 2, children: 0 }, recep)).rejects.toThrow(/cannot be converted/);
  });

  it("two staff converting the same request at once create exactly one reservation", async () => {
    const r = await submitBookingRequest(sel(), { fullName: "Race Test", phone: "0700000001" }, null);
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference } });
    const input = { checkIn: sel().checkIn, checkOut: sel().checkOut, roomTypeId: req.roomTypeId, roomCount: 1, adults: 2, children: 0 };
    const results = await Promise.allSettled([convertRequest(req.id, input, await staff("asha@vegas.test")), convertRequest(req.id, input, await staff("neema@vegas.test"))]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.reservation.count()).toBe(1);
  });

  it("conversion fails cleanly when the room type sold out meanwhile", async () => {
    const r = await submitBookingRequest(sel({ typeSlug: "twin" }), { fullName: "Late Guest", phone: "0700000002" }, null);
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference } });
    const other = await submitBookingRequest(sel({ typeSlug: "twin" }), { fullName: "Early Guest", phone: "0700000003" }, null);
    const oreq = await db.bookingRequest.findUniqueOrThrow({ where: { reference: other.reference } });
    const mgr = { ...(await staff("manager@vegas.test")), permissions: new Set(ALL_PERMISSIONS) as ReadonlySet<string> };
    const input = (id: string) => ({ checkIn: sel().checkIn, checkOut: sel().checkOut, roomTypeId: id, roomCount: 1, adults: 2, children: 0 });
    await convertRequest(oreq.id, input(oreq.roomTypeId), mgr);
    await expect(convertRequest(req.id, input(req.roomTypeId), mgr)).rejects.toThrow(/fully booked/);
    expect((await db.bookingRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("NEW");
  });

  it("reject needs a reason; stats count conversion rate", async () => {
    const recep = await staff("asha@vegas.test");
    const r = await submitBookingRequest(sel(), { fullName: "No Answer", phone: "0700000004" }, null);
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference } });
    await expect(setRequestStatus(req.id, "REJECTED", recep, "")).rejects.toThrow(/reason/);
    await setRequestStatus(req.id, "REJECTED", recep, "Customer unreachable after 3 calls");
    const s = await requestStats(today(), today());
    expect(s).toMatchObject({ total: 1, rejected: 1, converted: 0, conversionRate: 0 });
  });

  it("staff can log a WhatsApp request into the same queue, assigned to themselves", async () => {
    const recep = await staff("asha@vegas.test");
    const r = await submitBookingRequest(sel(), { fullName: "Whats App", phone: "0755 000 111" }, null, null, { sourceCode: "WHATSAPP", actor: recep });
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { id: r.id }, include: { source: true, events: true } });
    expect(req.source.code).toBe("WHATSAPP");
    expect(req.assignedToId).toBe(recep.userId);
    expect(req.events[0]).toMatchObject({ type: "SUBMITTED", actorId: recep.userId });
    await expect(submitBookingRequest(sel(), { fullName: "X", phone: "0755000112" }, null, null, { sourceCode: "NOPE", actor: recep })).rejects.toThrow(/source/);
  });
});
