import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { changeMeeting, checkIn, checkOut, createReservation, cancelReservation } from "@/server/services/reservations";
import { addReservationCharge, recordReservationPayment } from "@/server/services/payments";
import { findAvailableRooms } from "@/server/services/availability";
import { meetingRoomStats, occupancy, revenue } from "@/server/services/reporting";
import { getLedger } from "@/server/services/finance";
import { incomeRows } from "@/server/services/income";
import { convertRequest, meetingAvailability, submitMeetingRequest } from "@/server/services/booking-requests";
import { changeRoomStatus } from "@/server/services/rooms";
import { businessDateOf } from "@/lib/time/business-date";
import { overnightStay } from "@/lib/time/stay";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

const DAY = "2026-12-10";
const NOW = eat("2026-12-01T10:00:00");
const at = (hm: string) => eat(`${DAY}T${hm}:00`);

beforeEach(async () => {
  await resetBusinessData();
  // Tests change the price; put the seeded one back.
  await db.roomType.update({ where: { code: "MEETING_ROOM" }, data: { baseRate: 100_000 } });
});

async function meetingType() {
  return roomType("MEETING_ROOM");
}
async function bookMeeting(start: string, end: string, extra: { company?: string; attendees?: number } = {}) {
  const t = await meetingType();
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: "John Contact", phone: "0712000102" }, companyName: extra.company ?? "ABC Company",
    stay: { kind: "meeting", startAt: at(start), endAt: at(end) },
    rooms: [{ roomTypeId: t.id, adults: extra.attendees ?? 8, children: 0 }],
    specialRequests: "Projector",
  }, await managerActor(), NOW);
}

describe("Meeting Room 102 — room inventory booked by time", () => {
  it("is room 102, type Meeting Room, TZS 100,000, available — and not a guest room", async () => {
    const t = await meetingType();
    expect(t).toMatchObject({ name: "Meeting Room", category: "MEETING_ROOM", baseRate: 100_000, isActive: true });
    expect(t.rooms.map((r) => r.number)).toEqual(["102"]);
    expect(t.rooms[0]).toMatchObject({ isActive: true, status: "AVAILABLE" });
    // Overnight searches never offer it; guest-room occupancy still counts 31 rooms.
    const night = overnightStay({ arrivalDate: DAY, departureDate: "2026-12-11" });
    expect((await findAvailableRooms({ stay: night })).some((r) => r.number === "102")).toBe(false);
    expect((await occupancy({ from: DAY, to: DAY })).sellableNights).toBe(31);
  });

  it("books by time with the full details, and blocks overlapping times (end time is free again)", async () => {
    const r = await bookMeeting("09:00", "13:00");
    expect(r).toMatchObject({ kind: "MEETING", companyName: "ABC Company", adults: 8, specialRequests: "Projector", netAmount: 100_000 });
    expect(r.rooms[0]).toMatchObject({ isDayUse: true, nights: 0, ratePerNight: 100_000 });
    expect(r.rooms[0].room.number).toBe("102");
    await expect(bookMeeting("11:00", "15:00")).rejects.toThrow(/already booked/);
    const after = await bookMeeting("13:00", "16:00");
    expect(after.rooms[0].room.number).toBe("102");
    // The website check sees the same thing.
    await expect(meetingAvailability({ date: DAY, start: "10:00", end: "12:00" })).resolves.toMatchObject({ available: false, booked: ["09:00–13:00", "13:00–16:00"] });
    await expect(meetingAvailability({ date: DAY, start: "16:00", end: "18:00" })).resolves.toMatchObject({ available: true, price: 100_000 });
  });

  it("keeps meeting and guest rooms apart, and respects the room's capacity", async () => {
    const t = await meetingType();
    const dd = await roomType("DOUBLE_DELUXE");
    const mgr = await managerActor();
    await expect(createReservation({ sourceCode: "PHONE", guest: { fullName: "X" }, stay: { kind: "overnight", arrivalDate: DAY, departureDate: "2026-12-11" }, rooms: [{ roomTypeId: t.id, adults: 2, children: 0 }] }, mgr, NOW)).rejects.toThrow(/booked by time/);
    await expect(createReservation({ sourceCode: "PHONE", guest: { fullName: "X" }, stay: { kind: "meeting", startAt: at("09:00"), endAt: at("11:00") }, rooms: [{ roomTypeId: dd.id, adults: 2, children: 0 }] }, mgr, NOW)).rejects.toThrow(/guest room/);
    await expect(bookMeeting("09:00", "11:00", { attendees: t.maxAdults + 1 })).rejects.toThrow(/holds up to/);
    await expect(bookMeeting("13:00", "12:00")).rejects.toThrow(/end after it starts/);
  });

  it("cannot be booked while under maintenance", async () => {
    const t = await meetingType();
    await changeRoomStatus(t.rooms[0].id, "MAINTENANCE", { ...(await managerActor()), permissions: (await managerActor()).permissions! }, "Projector repair");
    // Blocks start on the real hotel day and run open-ended, so any future time is blocked.
    await expect(bookMeeting("09:00", "11:00")).rejects.toThrow(/already booked|no longer available/);
  });

  it("start → in use, folio extras, payment by account, complete → available; revenue is Meeting Room, not rooms", async () => {
    const mgr = await managerActor();
    const r = await bookMeeting("09:00", "13:00");
    await checkIn(r.id, mgr, null, at("08:50"));
    const started = await db.reservationRoom.findFirstOrThrow({ where: { reservationId: r.id }, include: { room: true } });
    expect(started).toMatchObject({ status: "CHECKED_IN", checkedInById: mgr.userId });
    expect(started.room.status).toBe("OCCUPIED");

    await addReservationCharge({ reservationId: r.id, description: "Lunch", amount: 60_000, category: "RESTAURANT" }, mgr);
    await addReservationCharge({ reservationId: r.id, description: "Soft drinks", amount: 40_000, category: "BAR" }, mgr);
    const folio = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(folio.netAmount).toBe(200_000);
    await recordReservationPayment({ reservationId: r.id, amount: 200_000, accountId: "acct_cash" }, mgr);

    await checkOut(r.id, mgr, {}, at("13:05"));
    const done = await db.reservationRoom.findFirstOrThrow({ where: { reservationId: r.id }, include: { room: true } });
    expect(done).toMatchObject({ status: "CHECKED_OUT", checkedOutById: mgr.userId });
    expect(done.room.status).toBe("AVAILABLE");
    // Running over does not move the booked end into the next booking's time.
    expect(done.endAt.getTime()).toBe(at("13:00").getTime());
    expect(done.checkedOutAt?.getTime()).toBe(at("13:05").getTime());

    const rev = await revenue({ from: DAY, to: DAY });
    expect(rev.meeting).toBe(100_000);
    expect(rev.rooms.net).toBe(0);
    // Extras are dated the hotel day they were added (today), on the same bill.
    const now = businessDateOf(new Date());
    const extras = await revenue({ from: now, to: now });
    expect([extras.restaurant, extras.bar]).toEqual([60_000, 40_000]);
    expect((await occupancy({ from: DAY, to: DAY })).roomNights).toBe(0);

    const ledger = await getLedger({ from: DAY, to: DAY, view: "income" });
    expect(ledger.rows.filter((x) => x.source === "MEETING").map((x) => x.income)).toEqual([100_000]);
    const today = businessDateOf(new Date());
    const income = await incomeRows(today, today);
    expect(income.find((x) => x.reservationId === r.id)).toMatchObject({ source: "MEETING", amount: 200_000, who: "ABC Company" });

    const stats = await meetingRoomStats({ from: DAY, to: DAY });
    expect(stats).toMatchObject({ bookings: 1, completed: 1, cancelled: 0, revenue: 100_000 });
    expect(stats.utilisation).toBeGreaterThan(0);
  });

  it("keeps the booked price when the price changes; new bookings get the new price", async () => {
    const r = await bookMeeting("09:00", "11:00");
    await db.roomType.update({ where: { code: "MEETING_ROOM" }, data: { baseRate: 120_000 } });
    const later = await bookMeeting("14:00", "16:00");
    expect(later.netAmount).toBe(120_000);
    // Moving the old booking re-checks the time but keeps its price.
    await changeMeeting(r.id, { startAt: at("11:00"), endAt: at("13:00"), attendees: 10 }, await managerActor(), NOW);
    const moved = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: { include: { nightsLedger: true } } } });
    expect(moved.netAmount).toBe(100_000);
    expect(moved.adults).toBe(10);
    expect(moved.rooms[0].nightsLedger.map((n) => n.netAmount)).toEqual([100_000]);
    await expect(changeMeeting(r.id, { startAt: at("13:30"), endAt: at("15:00") }, await managerActor(), NOW)).rejects.toThrow(/booked or blocked/);
  });

  it("a website meeting request becomes a normal meeting reservation", async () => {
    const req = await submitMeetingRequest({ date: DAY, start: "09:00", end: "12:00", attendees: 8, fullName: "Web Customer", companyName: "XYZ Ltd", phone: "0755000102", requirements: "Tea break" }, null);
    expect(req.price).toBe(100_000);
    const r = await convertRequest(req.id, { checkIn: DAY, checkOut: DAY, roomTypeId: (await meetingType()).id, roomCount: 1, adults: 8, children: 0 }, { ...(await managerActor()), userId: (await managerActor()).userId! } as never);
    expect(r).toMatchObject({ kind: "MEETING", companyName: "XYZ Ltd", netAmount: 100_000, adults: 8 });
    await expect(submitMeetingRequest({ date: DAY, start: "10:00", end: "11:00", attendees: 2, fullName: "Late", phone: "0755000999" }, null)).rejects.toThrow(/already booked/);
  });

  it("cancelled meetings free the time and show in the meeting room figures", async () => {
    const mgr = await managerActor();
    const r = await bookMeeting("09:00", "13:00");
    await cancelReservation(r.id, mgr, "Client postponed");
    await expect(bookMeeting("10:00", "12:00")).resolves.toBeTruthy();
    expect(await meetingRoomStats({ from: DAY, to: DAY })).toMatchObject({ bookings: 1, cancelled: 1, completed: 0 });
  });
});
