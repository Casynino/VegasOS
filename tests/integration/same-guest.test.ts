import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { assignAndCheckIn, checkIn, createReservation } from "@/server/services/reservations";
import { sameName } from "@/server/services/guests";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const ARR = "2026-11-10", DEP = "2026-11-12";
const NOW = eat("2026-11-10T14:00:00");

/** A desk booking for tonight; `sameGuest: false` is what the desk screens send until staff confirm. */
async function book(fullName: string, phone: string, extra: { sameGuest?: boolean; checkInNow?: boolean } = {}, dates = { arrivalDate: ARR, departureDate: DEP }) {
  const mgr = await managerActor();
  const st = await roomType("STANDARD");
  const r = await createReservation({
    sourceCode: "WALK_IN", guest: { fullName, phone }, stay: { kind: "overnight", ...dates },
    rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }], ...extra,
  }, mgr, NOW);
  return db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { guest: true, rooms: { include: { room: true } } } });
}

describe("one guest, one room", () => {
  it("names: the same person written two ways, never two different people", () => {
    expect(sameName("Juma Ally", "juma  ally")).toBe(true);
    expect(sameName("Juma Ally", "Ally Juma")).toBe(true);
    expect(sameName("Juma Ally", "Juma Ally Hassan")).toBe(true);
    expect(sameName("Neema Mushi", "Nema Mushi")).toBe(true);
    expect(sameName("Juma Ally", "Peter Kimaro")).toBe(false);
    expect(sameName("Juma Ally", "Juma Hassan")).toBe(false);
    expect(sameName("", "Juma")).toBe(false);
  });

  it("another name on a phone number we know is another customer — nobody is renamed", async () => {
    const a = await book("Neema Mushi", "0715 000 222");
    const b = await book("Peter Kimaro", "0715 000 222", { sameGuest: false });
    expect(b.guestId).not.toBe(a.guestId);
    expect(b.guest.fullName).toBe("Peter Kimaro");
    expect((await db.guest.findUniqueOrThrow({ where: { id: a.guestId } })).fullName).toBe("Neema Mushi");
    // The same name with that number again is the customer already on file, not a third one.
    const c = await book("Peter Kimaro", "0715 000 222", { sameGuest: false }, { arrivalDate: "2026-11-20", departureDate: "2026-11-21" });
    expect(c.guestId).toBe(b.guestId);
  });

  it("a guest who is in a room cannot be put in a second room unless the desk says it is the same person", async () => {
    const a = await book("Neema Mushi", "0715 000 222", { checkInNow: true });
    const room = a.rooms[0].room!.number;
    await expect(book("Neema Mushi", "0715 000 222", { sameGuest: false, checkInNow: true })).rejects.toMatchObject({
      code: "CONFLICT", fieldErrors: { sameGuest: room }, message: `Neema Mushi is already checked in to room ${room}.`,
    });
    expect(await db.reservation.count()).toBe(1);
    const b = await book("Neema Mushi", "0715 000 222", { sameGuest: true, checkInNow: true });
    expect(b.guestId).toBe(a.guestId);
    expect(b.rooms[0].room!.number).not.toBe(room);
  });

  it("checking in a booking: the same guest already in a room is asked about, and named", async () => {
    const mgr = await managerActor();
    const a = await book("Neema Mushi", "0715 000 222", { checkInNow: true });
    const b = await book("Neema Mushi", "0715 000 222"); // booked earlier, before the rule
    await expect(checkIn(b.id, mgr, null, NOW, { sameGuest: false })).rejects.toMatchObject({ code: "CONFLICT", fieldErrors: { sameGuest: a.rooms[0].room!.number } });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: b.id } })).status).not.toBe("CHECKED_IN");
    await checkIn(b.id, mgr, null, NOW, { sameGuest: true });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CHECKED_IN");
  });

  it("a different name typed at check-in on a shared customer becomes that guest's own customer", async () => {
    const mgr = await managerActor();
    const a = await book("Neema Mushi", "0715 000 222", { checkInNow: true });
    const b = await book("Neema Mushi", "0715 000 222");
    expect(b.guestId).toBe(a.guestId);
    await assignAndCheckIn(b.id, { guest: { fullName: "Peter Kimaro", phone: "0715 000 222", idType: "NIDA" }, sameGuest: false }, mgr, NOW);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: b.id }, include: { guest: true } });
    expect(after.status).toBe("CHECKED_IN");
    expect(after.guestId).not.toBe(a.guestId);
    expect(after.guest.fullName).toBe("Peter Kimaro");
    const first = await db.reservation.findUniqueOrThrow({ where: { id: a.id }, include: { guest: true } });
    expect(first.guest.fullName).toBe("Neema Mushi");
  });
});
