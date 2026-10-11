import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { cancelReservation, checkIn, checkOut, createReservation } from "@/server/services/reservations";
import { changeRoomStatus } from "@/server/services/rooms";
import { buildGuestList, buildHousekeepingList, getDailyListCopy, listDailyListCopies, saveDailyListCopy } from "@/server/services/daily-lists";
import { guestTotals, housekeepingTotals } from "@/lib/daily-lists";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/** The room-status service wants the permissions set, always present on these actors. */
const withPerms = <A extends { permissions?: ReadonlySet<string> }>(a: A) => ({ ...a, permissions: a.permissions! });

const BOOKED = eat("2026-10-01T10:00:00");
const NOW = eat("2026-10-11T08:00:00"); // the business day of 11 October, before check-out time
const TODAY = "2026-10-11";

beforeEach(async () => {
  await resetBusinessData();
  await db.roomAssignment.deleteMany();
  await db.bookingRequest.deleteMany();
  await db.hotelService.updateMany({ where: { code: "BREAKFAST" }, data: { isActive: true, isPublic: true } });
  await db.hotelSettings.update({ where: { id: 1 }, data: { occupiedRoomService: "DAILY" } });
});
afterAll(async () => {
  await db.hotelService.updateMany({ where: { code: "BREAKFAST" }, data: { isActive: true, isPublic: true } });
  await db.hotelSettings.update({ where: { id: 1 }, data: { occupiedRoomService: "DAILY" } });
});

const room = async (number: string) => (await roomType("DOUBLE_DELUXE")).rooms.find((r) => r.number === number)!;

async function book(number: string, arrivalDate: string, departureDate: string, o: { name?: string; phone?: string; adults?: number; children?: number; requests?: string } = {}) {
  const t = await roomType("DOUBLE_DELUXE");
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: o.name ?? `Guest ${number}`, phone: o.phone ?? `0712000${number}` }, status: "CONFIRMED", specialRequests: o.requests,
    stay: { kind: "overnight", arrivalDate, departureDate },
    rooms: [{ roomTypeId: t.id, roomId: t.rooms.find((r) => r.number === number)!.id, adults: o.adults ?? 1, children: o.children ?? 0 }],
  }, await managerActor(), BOOKED);
}
const arrive = async (id: string, date: string) => checkIn(id, await receptionistActor(), null, eat(`${date}T15:00:00`));

/**
 * The hotel on the morning of 11 October:
 *  103 — a family staying on (9 → 13 Oct, 2 adults + 1 child)
 *  104 — a guest leaving today (10 → 11 Oct)
 *  105 — checked out yesterday, not yet cleaned
 *  106 — a booking for tomorrow (nobody there)
 *  107 — a booking arriving today, not yet checked in
 *  203 — a cancelled booking
 *  204 — under maintenance
 *  102 — the meeting room, with a meeting in progress
 */
async function hotel() {
  const mgr = await managerActor();
  const family = await book("103", "2026-10-09", "2026-10-13", { name: "Amina Juma", adults: 2, children: 1, requests: "Extra pillow" });
  await arrive(family.id, "2026-10-09");
  const leaving = await book("104", "2026-10-10", "2026-10-11", { name: "Peter Mushi" });
  await arrive(leaving.id, "2026-10-10");
  const gone = await book("105", "2026-10-09", "2026-10-10", { name: "Gone Guest" });
  await arrive(gone.id, "2026-10-09");
  await checkOut(gone.id, mgr, { allowBalance: true, overrideReason: "Paid by the company later" }, eat("2026-10-10T09:30:00"));
  await book("106", "2026-10-12", "2026-10-14", { name: "Tomorrow Guest" });
  await book("107", "2026-10-11", "2026-10-12", { name: "Tonight Guest" });
  const cancelled = await book("203", "2026-10-10", "2026-10-12", { name: "Cancelled Guest" });
  await cancelReservation(cancelled.id, mgr, "Plans changed");
  await changeRoomStatus((await room("204")).id, "MAINTENANCE", withPerms(mgr), "AC broken");

  const meeting = await roomType("MEETING_ROOM");
  const m = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "Meeting Contact", phone: "0712000102" }, companyName: "ABC Company",
    stay: { kind: "meeting", startAt: eat("2026-10-11T07:30:00"), endAt: eat("2026-10-11T12:00:00") },
    rooms: [{ roomTypeId: meeting.id, adults: 8, children: 0 }],
  }, mgr, BOOKED);
  await checkIn(m.id, mgr, null, eat("2026-10-11T07:30:00"));
  return { family, leaving };
}

describe("in-house guest & breakfast list", () => {
  it("lists only guests who are checked in now — rooms and people counted apart", async () => {
    await hotel();
    const list = await buildGuestList(NOW);

    expect(list.date).toBe(TODAY);
    expect(list.rows.map((r) => r.room)).toEqual(["103", "104"]);
    expect(guestTotals(list.rows)).toMatchObject({ rooms: 2, guests: 4, adults: 3, children: 1, leaving: 1 });

    // A multi-night stay, on its third morning: still one row, with its own dates.
    expect(list.rows[0]).toMatchObject({
      room: "103", name: "Amina Juma", adults: 2, children: 1, arrival: "2026-10-09", leavesOn: "2026-10-13", nights: 4,
      shortTime: false, stay: "IN_HOUSE", breakfast: "INCLUDED", request: "Extra pillow", bookingRooms: 1,
    });
    // Leaving today: still in the hotel, so still on the list — and marked.
    expect(list.rows[1]).toMatchObject({ room: "104", name: "Peter Mushi", stay: "DUE_TODAY", leavesOn: TODAY });
  });

  it("leaves out the meeting room, future, checked-out and cancelled bookings — and anything private", async () => {
    await hotel();
    const list = await buildGuestList(NOW);
    const text = JSON.stringify(list);
    for (const name of ["Meeting Contact", "Gone Guest", "Tomorrow Guest", "Tonight Guest", "Cancelled Guest"]) expect(text).not.toContain(name);
    expect(list.rows.some((r) => r.room === "102")).toBe(false);
    // No phone number, no money.
    expect(text).not.toContain("0712000");
    expect(Object.keys(list.rows[0])).not.toEqual(expect.arrayContaining(["phone"]));
    expect(text).not.toMatch(/amount|balance|idNumber/i);
  });

  it("never invents breakfast: without the hotel's breakfast service it says not recorded", async () => {
    await hotel();
    expect((await buildGuestList(NOW)).rows.every((r) => r.breakfast === "INCLUDED")).toBe(true);

    await db.hotelService.updateMany({ where: { code: "BREAKFAST" }, data: { isActive: false } });
    const list = await buildGuestList(NOW);
    expect(list.breakfastService).toBe(false);
    expect(list.rows.every((r) => r.breakfast === "NOT_RECORDED")).toBe(true);
    expect(guestTotals(list.rows)).toMatchObject({ breakfastRooms: 0, breakfastGuests: 0, unknownRooms: 2, unknownGuests: 4 });
  });

  it("a guest who checks out drops off the next list", async () => {
    const { leaving } = await hotel();
    await checkOut(leaving.id, await managerActor(), { allowBalance: true, overrideReason: "Paid by the company later" }, eat("2026-10-11T08:30:00"));
    const list = await buildGuestList(eat("2026-10-11T08:31:00"));
    expect(list.rows.map((r) => r.room)).toEqual(["103"]);
    expect(guestTotals(list.rows)).toMatchObject({ rooms: 1, guests: 3 });
  });

  it("one booking in two rooms is two rooms; the other names go on the first only", async () => {
    const t = await roomType("DOUBLE_DELUXE");
    const pick = (n: string) => t.rooms.find((r) => r.number === n)!.id;
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Team Leader", phone: "0712999001" }, status: "CONFIRMED",
      stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" },
      rooms: [{ roomTypeId: t.id, roomId: pick("305"), adults: 2, children: 0 }, { roomTypeId: t.id, roomId: pick("306"), adults: 1, children: 0 }],
    }, await managerActor(), BOOKED);
    await arrive(r.id, "2026-10-10");
    const list = await buildGuestList(NOW);
    expect(list.rows.map((x) => [x.room, x.bookingRooms, x.adults])).toEqual([["305", 2, 2], ["306", 2, 1]]);
    expect(guestTotals(list.rows)).toMatchObject({ rooms: 2, guests: 3 });
  });

  it("an empty hotel gives an empty list", async () => {
    const list = await buildGuestList(NOW);
    expect(list.rows).toEqual([]);
    expect(guestTotals(list.rows)).toMatchObject({ rooms: 0, guests: 0 });
  });
});

describe("daily housekeeping checklist", () => {
  it("lists every guest room once, in the right part — and never the meeting room", async () => {
    await hotel();
    const list = await buildHousekeepingList(NOW);
    const guestRooms = await db.room.count({ where: { isActive: true, roomType: { category: "GUEST_ROOM" } } });

    expect(list.date).toBe(TODAY);
    expect(list.rows).toHaveLength(guestRooms);
    expect(new Set(list.rows.map((r) => r.room)).size).toBe(guestRooms);
    expect(list.rows.some((r) => r.room === "102")).toBe(false);

    const of = (n: string) => list.rows.find((r) => r.room === n)!;
    // The guest is staying on: an occupied room, not a full clean.
    expect(of("103")).toMatchObject({ group: "OCCUPIED", status: "OCCUPIED", stay: "IN_HOUSE", leavesOn: "2026-10-13" });
    // Leaves today: cleaned after they go.
    expect(of("104")).toMatchObject({ group: "CHECKOUT", status: "OCCUPIED", stay: "DUE_TODAY" });
    // Checked out yesterday and not cleaned yet.
    expect(of("105")).toMatchObject({ group: "CHECKOUT", status: "DIRTY", stay: null });
    // Clean rooms — a booking for tomorrow, a cancelled booking, a guest still to arrive today — are ready, not work.
    expect(of("106")).toMatchObject({ group: "READY", arrivalToday: false });
    expect(of("203")).toMatchObject({ group: "READY" });
    expect(of("107")).toMatchObject({ group: "READY", arrivalToday: true });
    // Closed: needs attention, with the reason, and never ready.
    expect(of("204")).toMatchObject({ group: "ATTENTION", status: "MAINTENANCE", reason: "AC broken" });

    expect(housekeepingTotals(list)).toMatchObject({
      listed: guestRooms, checkout: 2, waiting: 1, inProgress: 0, occupied: 1, occupiedService: 1, attention: 1, ready: guestRooms - 4, toClean: 3,
    });
  });

  it("puts the room a guest arrives into today at the top of the check-out cleaning", async () => {
    await hotel();
    await db.room.update({ where: { id: (await room("107")).id }, data: { status: "DIRTY" } });
    const list = await buildHousekeepingList(NOW);
    expect(list.rows.filter((r) => r.group === "CHECKOUT").map((r) => r.room)).toEqual(["107", "105", "104"]);
  });

  it("follows the hotel's rule for occupied rooms", async () => {
    await hotel();
    await db.hotelSettings.update({ where: { id: 1 }, data: { occupiedRoomService: "ON_REQUEST" } });
    let list = await buildHousekeepingList(NOW);
    expect(list.occupiedService).toBe("ON_REQUEST");
    expect(housekeepingTotals(list)).toMatchObject({ occupied: 1, occupiedService: 0, toClean: 2 });

    // The guest asks for cleaning: now the room is work.
    await db.serviceRequest.create({ data: { roomId: (await room("103")).id, type: "CLEANING", description: "Please clean before noon", businessDate: new Date(`${TODAY}T00:00:00Z`) } });
    list = await buildHousekeepingList(NOW);
    expect(list.rows.find((r) => r.room === "103")).toMatchObject({ group: "OCCUPIED", request: "Please clean before noon" });
    expect(housekeepingTotals(list)).toMatchObject({ occupiedService: 1, toClean: 3 });
  });

  it("a room is ready again only when the system says so", async () => {
    await hotel();
    const mgr = await managerActor();
    const id = (await room("105")).id;
    await changeRoomStatus(id, "CLEANING", withPerms(mgr));
    expect((await buildHousekeepingList(NOW)).rows.find((r) => r.room === "105")).toMatchObject({ group: "CHECKOUT", status: "CLEANING" });
    await changeRoomStatus(id, "READY", withPerms(mgr));
    expect((await buildHousekeepingList(NOW)).rows.find((r) => r.room === "105")).toMatchObject({ group: "READY", status: "READY" });
    expect(await db.roomStatusHistory.count({ where: { roomId: id, toStatus: { in: ["CLEANING", "READY"] } } })).toBe(2);
  });

  it("a closure planned for today keeps a clean room off the ready part", async () => {
    const r = await room("205");
    await db.roomBlock.create({ data: { roomId: r.id, type: "OUT_OF_SERVICE", startDate: new Date("2026-10-10T00:00:00Z"), endDate: new Date("2026-10-14T00:00:00Z"), reason: "Renovation" } });
    const row = (await buildHousekeepingList(NOW)).rows.find((x) => x.room === "205")!;
    expect(row).toMatchObject({ group: "ATTENTION", closure: "OUT_OF_SERVICE", reason: "Renovation", closedUntil: "2026-10-14" });
  });
});

describe("printed copies", () => {
  const printer = async () => {
    const u = await db.user.findUniqueOrThrow({ where: { email: "asha@vegas.test" }, include: { role: true } });
    return { id: u.id, fullName: u.fullName, roleName: u.role.name };
  };

  it("numbers each print of the day, keeps it exactly as printed, and changes no room", async () => {
    await hotel();
    const who = await printer();
    const before = await db.room.findMany({ select: { id: true, status: true }, orderBy: { number: "asc" } });

    const first = await saveDailyListCopy("HOUSEKEEPING", who, null, NOW);
    expect(first).toMatchObject({ kind: "HOUSEKEEPING", date: TODAY, copyNo: 1, generatedAt: NOW.toISOString(), generatedBy: `${who.fullName} (${who.roleName})` });
    // Printing is reading: every room is as it was.
    expect(await db.room.findMany({ select: { id: true, status: true }, orderBy: { number: "asc" } })).toEqual(before);

    // The hotel moves on: room 105 is cleaned and released.
    await changeRoomStatus((await room("105")).id, "READY", withPerms(await managerActor()));
    const later = eat("2026-10-11T11:00:00");
    const second = await saveDailyListCopy("HOUSEKEEPING", who, null, later);
    expect(second.copyNo).toBe(2);
    expect(second.data.kind === "HOUSEKEEPING" && second.data.rows.find((r) => r.room === "105")?.group).toBe("READY");

    // The first copy still says what was printed, with its own time.
    const kept = await getDailyListCopy(first.id);
    expect(kept).toMatchObject({ copyNo: 1, generatedAt: NOW.toISOString() });
    expect(kept!.data).toEqual(first.data);
    expect(kept!.data.kind === "HOUSEKEEPING" && kept!.data.rows.find((r) => r.room === "105")?.group).toBe("CHECKOUT");

    expect((await listDailyListCopies(TODAY, "HOUSEKEEPING")).map((c) => c.copyNo)).toEqual([2, 1]);
    expect(await listDailyListCopies(TODAY, "GUESTS")).toEqual([]);
    expect(await listDailyListCopies("2026-10-10", "HOUSEKEEPING")).toEqual([]);
    expect(await db.auditLog.count({ where: { action: "daily_list.printed", userId: who.id } })).toBe(2);
  });

  it("the two lists are numbered apart, and two prints at the same moment both get a number", async () => {
    await hotel();
    const who = await printer();
    const [a, b, g] = await Promise.all([
      saveDailyListCopy("GUESTS", who, null, NOW), saveDailyListCopy("GUESTS", who, null, NOW), saveDailyListCopy("HOUSEKEEPING", who, null, NOW),
    ]);
    expect([a.copyNo, b.copyNo].sort()).toEqual([1, 2]);
    expect(g.copyNo).toBe(1);
    expect(a.data.kind === "GUESTS" && a.data.rows.map((r) => r.room)).toEqual(["103", "104"]);
    expect(await getDailyListCopy("nothing-here")).toBeNull();
  });
});
