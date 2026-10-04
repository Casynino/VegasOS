import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, checkOut, createReservation } from "@/server/services/reservations";
import { addOrderItems, createRestaurantOrder, stayCustomer } from "@/server/services/restaurant";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor, receptionistActor, resetBusinessData, roomType, waiterActor } from "../support/helpers";

/**
 * The owner's rule (2026-10-04): no active CHECKED-IN room = a normal restaurant customer; an active checked-in
 * room = a hotel guest, so room billing (and room service) can be available — always for their own room, checked on
 * the server whatever the screen sends.
 */
const TZ = "Africa/Dar_es_Salaam";
const BEER = "mi_beers_safari";
const today = () => businessDateOf(new Date());

beforeEach(async () => {
  await resetBusinessData();
  await db.$executeRawUnsafe(`TRUNCATE "restaurant_orders" CASCADE`);
  await db.menuItem.updateMany({ where: { id: BEER }, data: { isAvailable: true, isActive: true } });
});

async function stay(name: string, phone: string | null, opts: { checkedIn?: boolean; arrival?: number; roomIndex?: number } = {}) {
  const dd = await roomType("DOUBLE_DELUXE");
  const t = today();
  const from = addDays(t, opts.arrival ?? -1);
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, ...(phone ? { phone } : {}) }, stay: { kind: "overnight", arrivalDate: from, departureDate: addDays(from, 3) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[opts.roomIndex ?? 0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(t, -2), 12 * 60, TZ));
  if (opts.checkedIn ?? true) await checkIn(r.id, await managerActor(), null, zonedInstant(from, 15 * 60, TZ));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}
const beer = { menuItemId: BEER, quantity: 1 };

describe("no active checked-in room = a normal restaurant customer", () => {
  it("a waiter cannot send room service or a room bill to a room that is not the customer's — whatever room id is sent", async () => {
    const john = await stay("John Room", "0712 300 301");
    const waiter = await waiterActor();
    // A walk-in (Sarah) — not staying: neither room service nor a room bill on John's room.
    for (const settlement of ["ROOM", "UNPAID"] as const) {
      await expect(createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: john.id, settlement, items: [beer] }, waiter, new Date(), { customerPhone: "0712 300 999" })).rejects.toThrow(/not this customer's/);
    }
    await expect(createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_1", reservationId: john.id, settlement: "ROOM", items: [beer] }, waiter, new Date(), { customerPhone: "0712 300 999" })).rejects.toThrow(/not this customer's/);
    // With no customer named at all, the room never counts as theirs.
    await expect(createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: john.id, settlement: "ROOM", items: [beer] }, waiter)).rejects.toThrow(/phone number first/);
    // John himself: fine.
    expect(await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: john.id, settlement: "ROOM", items: [beer] }, waiter, new Date(), { customerPhone: "0712 300 301" })).toMatchObject({ settlement: "ROOM", guestId: john.guestId });
  });

  it("a waiter's unknown number never becomes a staying guest's (that would open their room)", async () => {
    const noPhone = await stay("No Phone Guest", null);
    const waiter = await waiterActor();
    await expect(createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_2", reservationId: noPhone.id, settlement: "ROOM", items: [beer] }, waiter, new Date(), { customerPhone: "0712 400 401" })).rejects.toThrow(/not this customer's/);
    expect((await db.guest.findUniqueOrThrow({ where: { id: noPhone.guestId } })).phone).toBeNull();
  });

  it("a future booking or a checked-out stay is not a hotel guest: no room bill, no link", async () => {
    const future = await stay("Future Guest", "0712 500 501", { checkedIn: false, arrival: 3, roomIndex: 1 });
    const recep = await receptionistActor();
    await expect(createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: future.id, settlement: "ROOM", items: [beer] }, recep)).rejects.toThrow(/not checked in/);
    await expect(createRestaurantOrder({ type: "DINE_IN", reservationId: future.id, settlement: "UNPAID", items: [beer] }, recep)).rejects.toThrow(/not checked in/);
  });

  it("reception orders for the staying guest it picks; it cannot put someone else's food on that room — only a manager can, saying why", async () => {
    const john = await stay("John Reception", "0712 600 601");
    const recep = await receptionistActor();
    // Picking John's room with nobody else named: the order is John's.
    expect(await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: john.id, settlement: "ROOM", items: [beer] }, recep)).toMatchObject({ guestId: john.guestId, settlement: "ROOM" });
    // Another person (a walk-in) on John's room: refused for reception, even with a reason.
    await expect(createRestaurantOrder({ type: "DINE_IN", reservationId: john.id, settlement: "ROOM", reason: "John pays", items: [beer] }, recep, new Date(), { customerPhone: "0712 600 999" })).rejects.toThrow(/not this customer's/);
    const mgr = await managerActor();
    await expect(createRestaurantOrder({ type: "DINE_IN", reservationId: john.id, settlement: "ROOM", items: [beer] }, mgr, new Date(), { customerPhone: "0712 600 999" })).rejects.toThrow(/say why/);
    const o = await createRestaurantOrder({ type: "DINE_IN", reservationId: john.id, settlement: "ROOM", reason: "John pays for his friend", items: [beer] }, mgr, new Date(), { customerPhone: "0712 600 999" });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "restaurant_order.created", entityId: o.id } });
    expect(log.after).toMatchObject({ roomOfAnotherGuest: true, reason: "John pays for his friend", billing: expect.stringContaining("Room"), source: "STAFF_MANUAL" });
  });

  it("after check-out nothing more goes on the room: adding to a room order is refused", async () => {
    const john = await stay("John Leaving", "0712 700 701");
    const waiter = await waiterActor();
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: john.id, settlement: "ROOM", items: [beer] }, waiter, new Date(), { customerPhone: "0712 700 701" });
    await checkOut(john.id, await managerActor(), { allowBalance: true, overrideReason: "test", earlyReason: "Change of plans" });
    await expect(addOrderItems(o.id, [beer], waiter)).rejects.toThrow(/checked out/);
  });
});

describe("room service by the restaurant (owner, 2026-10-04: the restaurant serves the hotel too)", () => {
  const NOT_STAYING = "Room service is for a guest staying in the hotel — pick their room.";

  it("a waiter picks the staying guest from the list: the order is that guest's, to their room, on their bill", async () => {
    const john = await stay("John Picked", "0712 800 801");
    const waiter = await waiterActor();
    const { guestId, phone } = await stayCustomer(john.id, null, null, NOT_STAYING);
    expect(guestId).toBe(john.guestId);
    expect(phone).toBeNull();
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: john.id, settlement: "ROOM", items: [beer] }, waiter, new Date(), { pickedGuestId: guestId });
    expect(o).toMatchObject({ type: "ROOM_SERVICE", settlement: "ROOM", guestId: john.guestId, reservationId: john.id });
  });

  it("a guest with no phone on file gets the one given now — never a number that is someone else's", async () => {
    const quiet = await stay("Quiet Guest", null, { roomIndex: 1 });
    await stay("Other Customer", "0712 800 999", { roomIndex: 2 });
    await expect(stayCustomer(quiet.id, null, "0712 800 999", NOT_STAYING)).rejects.toThrow(/belongs to another customer/);
    const { guestId, phone } = await stayCustomer(quiet.id, null, "0712 800 555", NOT_STAYING);
    const waiter = await waiterActor();
    await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: quiet.id, settlement: "UNPAID", items: [beer] }, waiter, new Date(), { pickedGuestId: guestId, customerPhone: phone });
    expect((await db.guest.findUniqueOrThrow({ where: { id: quiet.guestId } })).phone).toBe("+255712800555");
  });

  it("only for a guest checked in now: a future or checked-out stay is refused", async () => {
    const future = await stay("Future Picked", "0712 810 811", { checkedIn: false, arrival: 3, roomIndex: 1 });
    await expect(stayCustomer(future.id, null, null, NOT_STAYING)).rejects.toThrow(NOT_STAYING);
    await expect(stayCustomer(null, null, null, NOT_STAYING)).rejects.toThrow(NOT_STAYING);
  });

  it("a waiter's dine-in room bill keeps the old rule: only the customer's own room", async () => {
    const john = await stay("John Dine", "0712 820 821");
    const waiter = await waiterActor();
    await expect(createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_3", reservationId: john.id, settlement: "ROOM", items: [beer] }, waiter, new Date(), { customerPhone: "0712 820 999" })).rejects.toThrow(/not this customer's/);
  });
});
