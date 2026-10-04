import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { addReservationCharge, recordReservationPayment } from "@/server/services/payments";
import { roomControl } from "@/server/services/room-control";
import { guestStayBill, stayBill } from "@/server/services/stay-bill";
import { ensureGuestToken } from "@/server/services/guest-comms";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);
const TZ = "Africa/Dar_es_Salaam";

describe("room control page", () => {
  it("an occupied room: the guest, the live bill by section, payments, balance and the timeline", async () => {
    const mgr = await managerActor();
    const dd = await roomType("DOUBLE_DELUXE");
    const t = businessDateOf(new Date());
    const room = dd.rooms[0];
    await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Nino Test", phone: "0715 111 999" }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
      rooms: [{ roomTypeId: dd.id, roomId: room.id, adults: 2, children: 0, discountPerNight: 0 }],
    }, mgr, zonedInstant(addDays(t, -1), 12 * 60, TZ));
    await checkIn(r.id, mgr, null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
    await addReservationCharge({ reservationId: r.id, description: "Dinner", amount: 30_000, category: "RESTAURANT" }, mgr);
    await addReservationCharge({ reservationId: r.id, description: "2 × Safari", amount: 8_000, category: "BAR" }, mgr);
    await recordReservationPayment({ reservationId: r.id, amount: 50_000, accountId: "acct_cash" }, mgr);

    const c = (await roomControl(room.id, t))!;
    expect(c.live).toMatch(/OCCUPIED|DUE_OUT|OVERDUE/);
    expect(c.stay).toMatchObject({ reference: r.reference, inHouse: true, nights: 2, adults: 2, guest: { fullName: "Nino Test" } });
    expect(c.bill!.sections.map((s) => [s.name, s.total])).toEqual([["Restaurant", 30_000], ["Bar", 8_000]]);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(c.bill).toMatchObject({ total: after.netAmount, paid: 50_000, balance: after.balanceAmount, payer: null });
    expect(c.bill!.accommodation).toMatchObject({ nights: 2, rate: dd.baseRate });
    const kinds = c.timeline.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["in", "charge", "payment"]));
  });

  it("a free room shows its own state — no guest, no bill", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const room = dd.rooms[dd.rooms.length - 1];
    await db.room.update({ where: { id: room.id }, data: { status: "DIRTY" } });
    const c = (await roomControl(room.id, businessDateOf(new Date())))!;
    expect(c).toMatchObject({ live: "DIRTY", stay: null, bill: null, orders: [] });
    expect(c.room.roomType.baseRate).toBe(dd.baseRate);
  });
  it("the room bill: nights, everything added to the room, payments and the balance — the guest can open theirs", async () => {
    const mgr = await managerActor();
    const dd = await roomType("DOUBLE_DELUXE");
    const t = businessDateOf(new Date());
    const room = dd.rooms[1];
    await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Bill Guest", phone: "0715 222 111" }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
      rooms: [{ roomTypeId: dd.id, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgr, zonedInstant(addDays(t, -1), 12 * 60, TZ));
    await checkIn(r.id, mgr, null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
    await addReservationCharge({ reservationId: r.id, description: "Dinner", amount: 25_000, category: "RESTAURANT" }, mgr);
    await addReservationCharge({ reservationId: r.id, description: "Laundry", amount: 7_000, category: "LAUNDRY" }, mgr);
    await recordReservationPayment({ reservationId: r.id, amount: 40_000, accountId: "acct_cash" }, mgr);

    const b = (await stayBill(r.id))!;
    const now = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(b.rooms).toMatchObject([{ number: room.number, nights: 2, rate: dd.baseRate, gross: 2 * dd.baseRate }]);
    expect(b.charges.map((c) => [c.section, c.amount])).toEqual([["Restaurant", 25_000], ["Services & extras", 7_000]]);
    expect(b.payments).toMatchObject([{ amount: 40_000, refund: false }]);
    expect(b.totals).toMatchObject({ total: now.netAmount, paid: 40_000, balance: now.balanceAmount, charges: 32_000 });

    const token = await ensureGuestToken(db, r.id);
    expect((await guestStayBill({ guestToken: token }))?.id).toBe(r.id);
    await db.reservation.update({ where: { id: r.id }, data: { billTo: "COMPANY" } });
    expect(await guestStayBill({ guestToken: token })).toBeNull(); // a company's bill is not shown to the guest
  });
});
