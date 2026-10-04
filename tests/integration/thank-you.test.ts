import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation, checkIn, checkOut } from "@/server/services/reservations";
import { addReservationCharge, recordReservationPayment } from "@/server/services/payments";
import { checkInGroup, checkOutGroup, createGroupBooking, getGroup } from "@/server/services/groups";
import { generateThankYouNote, thankYouByToken, thankYouNotes } from "@/server/services/thank-you";
import type { StaySnapshot } from "@/lib/thank-you";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const ARR = "2026-11-10", DEP = "2026-11-12";
const NOW = eat("2026-11-01T10:00:00");

describe("guest thank-you note", () => {
  it("is made at check-out from the finished stay; making it again keeps the earlier version", async () => {
    const mgr = await managerActor();
    const st = await roomType("STANDARD");
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Amina Hassan", phone: "0715000111" }, stay: { kind: "overnight", arrivalDate: ARR, departureDate: DEP },
      rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }],
    }, mgr, NOW);
    await checkIn(r.id, mgr, null, eat("2026-11-10T15:00:00"));
    await addReservationCharge({ reservationId: r.id, description: "Dinner", amount: 30_000, category: "RESTAURANT" }, mgr);
    await addReservationCharge({ reservationId: r.id, description: "2 × Beer", amount: 8_000, category: "BAR" }, mgr);
    await addReservationCharge({ reservationId: r.id, description: "Airport drop-off", amount: 40_000, category: "TRANSPORT" }, mgr);
    await recordReservationPayment({ reservationId: r.id, amount: 120_000 + 78_000, accountId: "acct_cash" }, mgr);
    await checkOut(r.id, mgr, {}, eat("2026-11-12T10:00:00"));

    const notes = await thankYouNotes(r.id);
    expect(notes).toHaveLength(1);
    const snap = notes[0].snapshot as unknown as StaySnapshot;
    expect(snap).toMatchObject({
      guest: { name: "Amina Hassan" }, nights: 2, guests: 1, rooms: [{ type: "Standard Single", nights: 2, rate: 60_000 }],
      charges: { room: 120_000, restaurant: 30_000, bar: 8_000, transport: 40_000, roomService: 0, other: 0 },
      subtotal: 198_000, total: 198_000, paid: 198_000, balance: 0, billedTo: null,
    });
    expect(snap.checkedOutAt).not.toBeNull();
    expect((await thankYouByToken(notes[0].token))?.id).toBe(notes[0].id);

    // Made again only with a reason; version 1 stays.
    await expect(generateThankYouNote(r.id, mgr)).rejects.toThrow(/why/);
    const v2 = await generateThankYouNote(r.id, mgr, "Bar charge corrected");
    expect(v2.version).toBe(2);
    expect((await thankYouNotes(r.id)).map((x) => x.version)).toEqual([2, 1]);
    expect(await db.auditLog.count({ where: { action: { in: ["thank_you.generated", "thank_you.regenerated"] }, entityId: r.id } })).toBe(2);
  });

  it("a group guest's note shows only their own room, settled by the group's company — not the other rooms", async () => {
    const mgr = await managerActor();
    const c = await db.corporateCustomer.create({ data: { companyName: "ABC Company" } });
    const [st, dd] = await Promise.all([roomType("STANDARD"), roomType("DOUBLE_DELUXE")]);
    const g = await createGroupBooking({
      name: "ABC trip", type: "COMPANY", corporateCustomerId: c.id, contact: { fullName: "John Doe" }, sourceCode: "CORPORATE", billing: "COMBINED",
      arrivalDate: ARR, departureDate: DEP,
      rooms: [
        { roomTypeId: st.id, guest: { fullName: "Guest A" }, adults: 1, children: 0 },
        // Guest B stays one night longer, on her own dates.
        { roomTypeId: dd.id, guest: { fullName: "Guest B" }, adults: 1, children: 0, arrivalDate: ARR, departureDate: "2026-11-13" },
      ],
    }, mgr, NOW);
    await checkInGroup(g.id, mgr, null, eat("2026-11-10T15:00:00"));
    const [a, b] = (await getGroup(g.id))!.rooms;
    expect(b.departure).toBe("2026-11-13");
    expect((await getGroup(g.id))!.departure).toBe("2026-11-13");
    await addReservationCharge({ reservationId: b.id, description: "Wine", amount: 50_000, category: "BAR" }, mgr);
    await checkOutGroup(g.id, mgr, [a.id], {}, eat("2026-11-12T10:00:00"));
    const snap = (await thankYouNotes(a.id))[0].snapshot as unknown as StaySnapshot;
    expect(snap).toMatchObject({ total: 120_000, paid: 0, balance: 0, billedTo: { name: "ABC Company", amount: 120_000 }, group: { name: "ABC trip" } });
    expect(snap.charges.bar).toBe(0); // Guest B's wine is not on Guest A's note
  });

  it("group rooms can carry their own food, drinks & extras (pre-ordered on each room's bill)", async () => {
    const mgr = await managerActor();
    const st = await roomType("STANDARD");
    const food = await db.menuItem.findFirstOrThrow({ where: { isActive: true, type: "FOOD", category: { isActive: true } } });
    const g = await createGroupBooking({
      name: "Family trip", type: "FAMILY", contact: { fullName: "Mama" }, sourceCode: "PHONE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
      rooms: [{ roomTypeId: st.id, guest: { fullName: "Kid" }, adults: 1, children: 0, menuItems: [{ menuItemId: food.id, quantity: 2 }], charges: [{ type: "LAUNDRY", item: "Laundry", qty: 1, unitPrice: 5_000 }] }],
    }, mgr, NOW);
    const room = (await getGroup(g.id))!.rooms[0];
    expect(room.total).toBe(120_000 + 2 * food.price + 5_000);
  });
});
