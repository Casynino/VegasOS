import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation, checkIn } from "@/server/services/reservations";
import { guestMessage, guestTimeline, logGuestMessage, placeStayOrder, stayByToken } from "@/server/services/guest-comms";
import { resolveGuest } from "@/server/services/guests";
import { guestEventOn, guestMessageText, internationalPhone, validPhone } from "@/lib/guest-messages";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const ARR = "2026-11-10", DEP = "2026-11-12";
const NOW = eat("2026-11-01T10:00:00");

async function booking(phone = "0715 000 222") {
  const mgr = await managerActor();
  const st = await roomType("STANDARD");
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "Neema Mushi", phone }, stay: { kind: "overnight", arrivalDate: ARR, departureDate: DEP },
    rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }],
  }, mgr, NOW);
  return { mgr, r: await db.reservation.findUniqueOrThrow({ where: { id: r.id } }) };
}

async function menuItems() {
  const [food, drink] = await Promise.all([
    db.menuItem.findFirstOrThrow({ where: { isActive: true, isAvailable: true, type: "FOOD", category: { isActive: true } }, orderBy: { price: "desc" } }),
    db.menuItem.findFirstOrThrow({ where: { isActive: true, isAvailable: true, type: "DRINK", category: { isActive: true } }, orderBy: { price: "asc" } }),
  ]);
  return { food, drink };
}

describe("the guest's stay link", () => {
  it("every booking gets its own unguessable link; the page shows only this booking", async () => {
    const { r } = await booking();
    expect(r.guestToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const stay = await stayByToken(r.guestToken!);
    expect(stay).toMatchObject({ reference: r.reference, guestName: "Neema M.", phone: "+255 7•• ••• 222", arrival: ARR, departure: DEP, canOrder: false, rooms: [{ nights: 2 }] });
    expect(JSON.stringify(stay)).not.toContain(r.id);
    expect(await stayByToken("not-a-real-token-at-all")).toBeNull();
    expect(await stayByToken("../../etc")).toBeNull();
  });

  it("a checked-in guest orders from the link: room service to the kitchen, on the room bill", async () => {
    const { mgr, r } = await booking();
    const { food, drink } = await menuItems();
    await expect(placeStayOrder(r.guestToken!, { items: [{ menuItemId: food.id, quantity: 1 }] }, eat("2026-11-09T20:00:00")))
      .rejects.toThrow(/opens when the guest has checked in/);

    await checkIn(r.id, mgr, null, eat("2026-11-10T15:00:00"));
    const fee = (await db.hotelSettings.findFirstOrThrow()).roomServiceFee;
    const order = await placeStayOrder(r.guestToken!, { items: [{ menuItemId: food.id, quantity: 2 }, { menuItemId: drink.id, quantity: 1 }], notes: "No onions" }, eat("2026-11-10T20:00:00"));
    expect(order).toMatchObject({ type: "ROOM_SERVICE", settlement: "ROOM", source: "GUEST_LINK", createdById: null, notes: "No onions", total: food.price * 2 + drink.price + fee });

    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true } });
    expect(after.charges.reduce((t, c) => t + c.amount, 0)).toBe(food.price * 2 + drink.price + fee);
    expect(after.chargesAmount).toBe(food.price * 2 + drink.price + fee);
    expect((await stayByToken(r.guestToken!))!.orders).toHaveLength(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "restaurant_order.created", entityId: order.id } });
    expect(log).toMatchObject({ userId: null, actorLabel: `Guest (online) · ${r.reference}` });
  });

  it("limits how many orders a link can send in a short time", async () => {
    const { mgr, r } = await booking();
    const { drink } = await menuItems();
    await checkIn(r.id, mgr, null, eat("2026-11-10T15:00:00"));
    for (let i = 0; i < 5; i++) await placeStayOrder(r.guestToken!, { items: [{ menuItemId: drink.id, quantity: 1 }] }, eat(`2026-11-10T20:0${i}:00`));
    await expect(placeStayOrder(r.guestToken!, { items: [{ menuItemId: drink.id, quantity: 1 }] }, eat("2026-11-10T20:06:00"))).rejects.toThrow(/Several orders were sent/);
    // Later it opens again.
    await placeStayOrder(r.guestToken!, { items: [{ menuItemId: drink.id, quantity: 1 }] }, eat("2026-11-10T21:00:00"));
  });
});

describe("messages to the guest", () => {
  it("booking details and welcome carry the booking, the room and the private link", async () => {
    const { mgr, r } = await booking();
    const b = await guestMessage(r.id, "BOOKING_CREATED", "https://hotel.test");
    expect(b.text).toContain("Hello Neema");
    expect(b.text).toContain(`Booking Ref: ${r.reference}`);
    expect(b.guest.phone).toBe("+255715000222");
    expect(b.text).toContain("*YOUR BOOKING*");
    expect(b.text).toContain("Check-in: Tue, 10 Nov 2026 · from 14:00");
    expect(b.text).toContain("Nights: 2");
    expect(b.text).toContain("Guests: 1 adult");
    expect(b.text).toContain("Balance: TZS 120,000");
    expect(b.text).toContain("Status: NOT PAID YET");
    // One secure link to the booking (to see it and pay), not two copies of it.
    const manage = (await db.reservation.findUniqueOrThrow({ where: { id: r.id }, select: { manageToken: true } })).manageToken;
    expect(b.text).toContain(`View your booking & pay by mobile money:\nhttps://hotel.test/booking/${r.reference}?token=${manage}`);
    expect(b.text.split("https://hotel.test/booking/").length).toBe(2);

    await checkIn(r.id, mgr, null, eat("2026-11-10T15:00:00"));
    const rr = await db.reservationRoom.findFirstOrThrow({ where: { reservationId: r.id }, include: { room: true, roomType: true } });
    const w = await guestMessage(r.id, "WELCOME", "https://hotel.test");
    expect(w.text).toContain("You’re checked in.");
    expect(w.text).toContain(`Room: ${rr.room.number}`);
    expect(w.text).toContain("Check-out: Thu, 12 Nov 2026 · by 11:00");
    expect(w.text).toContain(`https://hotel.test/stay/${r.guestToken}`);
  });

  it("every message sent is kept on the guest's history and timeline", async () => {
    const { mgr, r } = await booking();
    await logGuestMessage(db, { guestId: r.guestId, reservationId: r.id, type: "BOOKING_CREATED", channel: "WHATSAPP", to: "+255715000222", body: "Hello" }, mgr);
    const { events, messages } = await guestTimeline(r.guestId);
    expect(messages).toHaveLength(1);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["booking", "message"]));
  });

  it("templates fill in the words in braces and drop empty lines; phones become +255…", () => {
    const v = { name: "Neema Mushi", hotel: "Vegas", ref: "R1", room: "104", checkin: "a", checkout: "b", nights: 2, guests: "1 adult", status: "Reserved", balance: "", link: "L", menu: "M", phone: "P", wifi: "" };
    expect(guestMessageText("Hi {name}\n{balance}\nRef {ref} {unknown}", "", v)).toBe("Hi Neema\nRef R1 {unknown}");
    expect(internationalPhone("0715 000 222")).toBe("+255715000222");
    expect(internationalPhone("+44 7700 900123")).toBe("+447700900123");
    expect(internationalPhone("255715000222")).toBe("+255715000222");
    expect(validPhone("12345")).toBe(false);
    expect(guestEventOn({}, "checkIn")).toBe(true);
    expect(guestEventOn({ checkIn: false }, "checkIn")).toBe(false);
  });
});

describe("one customer, saved once", () => {
  it("the same phone reuses the saved customer — unless staff confirm it is someone else", async () => {
    const { r } = await booking("0715 000 333");
    const again = await db.$transaction((tx) => resolveGuest(tx, { fullName: "Neema M.", phone: "+255715000333" }));
    expect(again).toBe(r.guestId);
    const other = await db.$transaction((tx) => resolveGuest(tx, { fullName: "Neema's sister", phone: "0715000333", createNew: true }));
    expect(other).not.toBe(r.guestId);
    const g = await db.guest.findUniqueOrThrow({ where: { id: r.guestId } });
    expect(g.reference).toMatch(/^G-[0-9A-F]{6}$/);
  });
});
