import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { cancelCheckIn, checkIn, checkOut, createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { buildRoomReportData } from "@/server/services/room-report-data";
import { checkedInWithin } from "@/server/services/room-sales";
import { staffAlerts } from "@/server/services/staff-alerts";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

// The boss's WhatsApp never leaves the test: what would be sent is kept here.
const sent: { to: string; text: string }[] = [];
vi.mock("@/server/services/messaging", () => ({
  sendMessage: vi.fn(async (req: { to: string; text: string }) => { sent.push({ to: req.to, text: req.text }); return { ok: true }; }),
}));

const TZ = "Africa/Dar_es_Salaam";
const today = () => businessDateOf(new Date());
const signed = <T extends { userId?: string | null }>(a: T) => ({ ...a, userId: a.userId! });
const CHECK_INS = ["reservation.checked_in", "reservation.walk_in"];
const checkInsCounted = () => db.auditLog.count({ where: { action: { in: CHECK_INS } } });
const roomsSoldToday = () => db.reservationRoom.count({ where: checkedInWithin(new Date(Date.now() - 12 * 3_600_000), new Date(Date.now() + 3_600_000)) });

let recipients: unknown;
beforeEach(async () => {
  await resetBusinessData();
  sent.length = 0;
  const s = await db.hotelSettings.findFirstOrThrow();
  recipients ??= s.reportRecipients;
  await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "+255700000001" }] } });
});
afterAll(async () => {
  await db.hotelSettings.updateMany({ data: { reportRecipients: (recipients ?? []) as never } });
});

/** A booking arriving today, with part of it paid in cash, checked in by reception. */
async function checkedInToday(name: string) {
  const dd = await roomType("DOUBLE_DELUXE");
  const desk = await receptionistActor();
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone: "0712 555 010" }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 2) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, desk);
  await recordReservationPayment({ reservationId: r.id, amount: 50_000, accountId: "acct_cash" }, signed(desk));
  await checkIn(r.id, desk);
  return { id: r.id, roomId: dd.rooms[0].id, roomNo: dd.rooms[0].number, desk };
}

describe("cancel a check-in done by mistake (owner, 2026-10-12)", () => {
  it("puts the booking and the room back, keeps the money, drops it from every count — and the right check-in counts once", async () => {
    const { id, roomId, roomNo, desk } = await checkedInToday("Neema Wrong Room");
    const before = await db.reservation.findUniqueOrThrow({ where: { id } });
    expect(before.status).toBe("CHECKED_IN");
    expect(await roomsSoldToday()).toBe(1);
    expect(await checkInsCounted()).toBe(1);
    expect((await buildRoomReportData(today())).perf).toMatchObject({ occupied: 1, newSales: 1 });

    const done = await cancelCheckIn(id, desk, "Checked into the wrong room");
    expect(done).toMatchObject({ reference: before.reference, guest: "Neema Wrong Room", rooms: [roomNo], reason: "Checked into the wrong room", by: desk.label });

    // The booking: waiting again, with everything it had. The room: as it was before, not Occupied.
    const after = await db.reservation.findUniqueOrThrow({ where: { id }, include: { rooms: true, payments: true } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.rooms[0]).toMatchObject({ status: "CONFIRMED", checkedInAt: null, checkedInById: null, roomId });
    expect((await db.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe("AVAILABLE");
    // The money: the payment is still there, the bill and the balance are what they were.
    expect(after.payments.filter((p) => p.status === "POSTED")).toHaveLength(1);
    expect(after).toMatchObject({ paidAmount: 50_000, netAmount: before.netAmount, balanceAmount: before.balanceAmount });
    // The numbers: not sold, not occupied, not a check-in of the desk.
    expect(await roomsSoldToday()).toBe(0);
    expect(await checkInsCounted()).toBe(0);
    const report = await buildRoomReportData(today());
    expect(report.perf).toMatchObject({ occupied: 0, newSales: 0 });

    // The history: the first check-in is kept, marked cancelled, and the cancellation says who, when and why.
    const logs = await db.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } });
    expect(logs.filter((l) => l.action === "reservation.checked_in_voided")).toHaveLength(1);
    const cancelled = logs.find((l) => l.action === "reservation.checkin_cancelled")!;
    expect(cancelled.userId).toBe(desk.userId);
    expect(cancelled.after).toMatchObject({ reason: "Checked into the wrong room", rooms: [roomNo], guest: "Neema Wrong Room", reference: before.reference });
    expect((cancelled.before as { rooms: { checkedInAt: string; checkedInById: string }[] }).rooms[0]).toMatchObject({ checkedInById: desk.userId });

    // The boss: told once, with the facts; managers see it on the bell.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].to).toBe("+255700000001");
    for (const fact of ["Check-in cancelled", "Neema Wrong Room", roomNo, before.reference, desk.label!, "Checked into the wrong room"]) expect(sent[0].text).toContain(fact);
    expect(sent[0].text.length).toBeLessThan(640);
    const bell = await staffAlerts(new Set(["dashboard.manager"]), null);
    expect(bell.filter((a) => a.kind === "checkin_cancelled")).toHaveLength(1);
    expect(await staffAlerts(new Set(["dashboard.front_desk"]), null)).toEqual([]);

    // A second try changes nothing and tells nobody again.
    await expect(cancelCheckIn(id, desk, "again")).rejects.toThrow(/not checked in/i);
    expect(sent).toHaveLength(1);

    // The right check-in, with the normal check-in: counted once, the bill not charged twice.
    await checkIn(id, desk);
    const again = await db.reservation.findUniqueOrThrow({ where: { id } });
    expect(again).toMatchObject({ status: "CHECKED_IN", paidAmount: 50_000, netAmount: before.netAmount, balanceAmount: before.balanceAmount, chargesAmount: before.chargesAmount });
    expect((await db.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe("OCCUPIED");
    expect(await roomsSoldToday()).toBe(1);
    expect(await checkInsCounted()).toBe(1);
    expect((await buildRoomReportData(today())).perf).toMatchObject({ occupied: 1, newSales: 1 });
    expect(await db.roomNight.count({ where: { reservationRoom: { reservationId: id } } })).toBe(2);
  });

  it("a walk-in whose check-in is cancelled is still a booking made, and no longer a check-in", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const desk = await receptionistActor();
    const r = await createReservation({
      sourceCode: "WALK_IN", guest: { fullName: "Juma Walk In", phone: "0712 555 011" }, stay: { kind: "walkIn", nights: 1 },
      rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[1].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, desk);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CHECKED_IN");
    await cancelCheckIn(r.id, desk, "Guest changed their mind before going up");
    expect(await checkInsCounted()).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: r.id, action: "reservation.created" } })).toBe(1);
    expect((await db.room.findUniqueOrThrow({ where: { id: dd.rooms[1].id } })).status).toBe("AVAILABLE");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CONFIRMED");
  });

  it("is refused without a reason, after the guest has checked out, and for a check-in of an earlier day", async () => {
    const { id, desk } = await checkedInToday("Asha Stays");
    await expect(cancelCheckIn(id, desk, "  ")).rejects.toThrow(/why/i);
    expect((await db.reservation.findUniqueOrThrow({ where: { id } })).status).toBe("CHECKED_IN");

    // An earlier day is closed: its reports are written.
    const dd = await roomType("DOUBLE_DELUXE");
    const old = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Old Stay", phone: "0712 555 012" }, stay: { kind: "overnight", arrivalDate: addDays(today(), -1), departureDate: addDays(today(), 2) },
      rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[2].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, await managerActor(), zonedInstant(addDays(today(), -3), 12 * 60, TZ));
    await checkIn(old.id, await managerActor(), null, zonedInstant(addDays(today(), -1), 15 * 60, TZ));
    await expect(cancelCheckIn(old.id, desk, "too late")).rejects.toThrow(/earlier day/i);

    // Checked out: a finished stay.
    await checkOut(id, await managerActor(), { allowBalance: true, overrideReason: "test", earlyReason: "change of plans" });
    await expect(cancelCheckIn(id, desk, "after leaving")).rejects.toThrow(/already checked out/i);
    expect(sent).toHaveLength(0);
  });
});
