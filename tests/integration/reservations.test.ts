import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  cancelReservation, changeDiscount, checkIn, checkOut, createReservation, markNoShow,
} from "@/server/services/reservations";
import { recordReservationPayment, reversePayment } from "@/server/services/payments";
import { AppError } from "@/server/errors";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType, websiteActor } from "../support/helpers";

// All scenarios run on a fixed "now" in October 2026 so dates are deterministic.
const NOW = eat("2026-10-05T10:00:00");
const guest = { fullName: "Test Guest", phone: "0710 000 001" };

beforeEach(resetBusinessData);

describe("reservation engine", () => {
  it("website booking: real reservation, per-night discount, room-night ledger", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const r = await createReservation(
      {
        sourceCode: "WEBSITE", guest,
        stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" },
        rooms: [{ roomTypeId: dd.id, adults: 2, children: 0 }],
      },
      websiteActor, NOW,
    );
    expect(r.reference).toMatch(/^VLH-[A-Z0-9]{6}$/);
    expect(r.source.code).toBe("WEBSITE");
    expect(r.status).toBe("RESERVED");
    expect(r.grossAmount).toBe(160_000);
    expect(r.discountAmount).toBe(40_000);
    expect(r.netAmount).toBe(120_000);
    expect(r.paidAmount).toBe(0);
    expect(r.balanceAmount).toBe(120_000);
    const nights = await db.roomNight.findMany({ where: { reservationRoom: { reservationId: r.id } }, orderBy: { businessDate: "asc" } });
    expect(nights.map((n) => n.businessDate.toISOString().slice(0, 10))).toEqual(["2026-10-10", "2026-10-11"]);
    expect(nights.every((n) => n.netAmount === 60_000)).toBe(true);
    // Guest phone normalised to international format.
    expect(r.guest.phone).toBe("+255710000001");
  });

  it("three rooms receive three discounts", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const room = { roomTypeId: dd.id, adults: 1, children: 0, discountPerNight: 20_000 };
    const r = await createReservation(
      { sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" }, rooms: [room, room, room] },
      await receptionistActor(), NOW,
    );
    expect(r.rooms).toHaveLength(3);
    expect(new Set(r.rooms.map((x) => x.roomId)).size).toBe(3);
    expect(r.discountAmount).toBe(60_000);
    expect(r.netAmount).toBe(180_000);
  });

  it("two simultaneous bookings for the same room: exactly one succeeds", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const room204 = dd.rooms.find((r) => r.number === "204")!;
    const book = (name: string, actorPromise: ReturnType<typeof receptionistActor> | Promise<typeof websiteActor>, source: string) =>
      actorPromise.then((actor) =>
        createReservation(
          {
            sourceCode: source, guest: { fullName: name },
            stay: { kind: "overnight", arrivalDate: "2026-10-20", departureDate: "2026-10-22" },
            rooms: [{ roomTypeId: dd.id, roomId: room204.id, adults: 1, children: 0 }],
          },
          actor, NOW,
        ),
      );
    const results = await Promise.allSettled([
      book("Website Customer", Promise.resolve(websiteActor), "WEBSITE"),
      book("Phone Customer", receptionistActor(), "PHONE"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(AppError);
    expect((failed[0].reason as AppError).code).toBe("UNAVAILABLE");
    expect(await db.reservationRoom.count({ where: { roomId: room204.id } })).toBe(1);
  });

  it("race for the last room of a type (Twin has one room): one wins, one is told it is full", async () => {
    const twin = await roomType("TWIN");
    const attempt = () =>
      createReservation(
        { sourceCode: "WEBSITE", guest, stay: { kind: "overnight", arrivalDate: "2026-11-01", departureDate: "2026-11-02" }, rooms: [{ roomTypeId: twin.id, adults: 1, children: 0 }] },
        websiteActor, NOW,
      );
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected") as PromiseRejectedResult[]) {
      expect((r.reason as AppError).message).toMatch(/fully booked/);
    }
  });

  it("the database constraint itself rejects overlapping stays", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const room = dd.rooms[0];
    const r = await createReservation(
      { sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" }, rooms: [{ roomTypeId: dd.id, roomId: room.id, adults: 1, children: 0 }] },
      await receptionistActor(), NOW,
    );
    const rr = r.rooms[0];
    await expect(
      db.reservationRoom.create({
        data: {
          reservationId: r.id, roomId: room.id, roomTypeId: dd.id, status: "CONFIRMED",
          startAt: rr.startAt, endAt: rr.endAt, arrivalDate: rr.arrivalDate, departureDate: rr.departureDate,
          nights: 2, ratePerNight: 80_000, grossAmount: 160_000, discountAmount: 0, netAmount: 160_000,
        },
      }),
    ).rejects.toThrow();
  });

  it("same-day turnover is allowed (11:00 checkout, 14:00 check-in)", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const room = dd.rooms[0];
    const actor = await receptionistActor();
    const make = (a: string, d: string) =>
      createReservation({ sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: a, departureDate: d }, rooms: [{ roomTypeId: dd.id, roomId: room.id, adults: 1, children: 0 }] }, actor, NOW);
    await make("2026-10-10", "2026-10-12");
    await expect(make("2026-10-12", "2026-10-13")).resolves.toBeTruthy();
    await expect(make("2026-10-11", "2026-10-13")).rejects.toThrow(/no longer available/);
  });

  it("discounts: none by default, up to 20,000 off per night for anyone, audited", async () => {
    const ex = await roomType("EXECUTIVE");
    const input = {
      sourceCode: "PHONE", guest,
      stay: { kind: "overnight" as const, arrivalDate: "2026-10-10", departureDate: "2026-10-11" },
      rooms: [{ roomTypeId: ex.id, adults: 1, children: 0, discountPerNight: 30_000, discountReason: "Loyal guest" }],
    };
    await expect(createReservation(input, await receptionistActor(), NOW)).rejects.toThrow(/most off a room/);
    await expect(createReservation(input, await managerActor(), NOW)).rejects.toThrow(/most off a room/);

    const none = await createReservation({ ...input, rooms: [{ ...input.rooms[0], discountPerNight: 0 }] }, await receptionistActor(), NOW);
    expect(none.netAmount).toBe(100_000);
    expect(await db.auditLog.count({ where: { action: "reservation.discount_changed", entityId: none.id } })).toBe(0);

    const r = await createReservation({ ...input, stay: { ...input.stay, arrivalDate: "2026-10-12", departureDate: "2026-10-13" }, rooms: [{ ...input.rooms[0], discountPerNight: 15_000, discountReason: "" }] }, await receptionistActor(), NOW);
    expect(r.netAmount).toBe(85_000);
    expect(await db.auditLog.count({ where: { action: "reservation.discount_changed", entityId: r.id } })).toBe(1);
    await expect(changeDiscount(r.rooms[0].id, 25_000, "", await managerActor())).rejects.toThrow(/most off a room/);
    await changeDiscount(r.rooms[0].id, 20_000, "Long stay", await receptionistActor());
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(80_000);
  });

  it("walk-in paid at the desk: booking, check-in and payment in one step", async () => {
    const st = await roomType("STANDARD");
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    const r = await createReservation(
      { sourceCode: "WALK_IN", guest, stay: { kind: "walkIn", nights: 2 }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0, discountPerNight: 0 }], payment: { amount: 120_000, methodId: cash.id } },
      await receptionistActor(), eat("2026-10-05T15:00:00"),
    );
    expect(r.status).toBe("CHECKED_IN");
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.paidAmount).toBe(120_000);
    expect(after.balanceAmount).toBe(0);
    // Overpaying is refused and nothing is saved.
    await expect(createReservation(
      { sourceCode: "WALK_IN", guest, stay: { kind: "walkIn", nights: 1 }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0, discountPerNight: 0 }], payment: { amount: 999_000, methodId: cash.id } },
      await receptionistActor(), eat("2026-10-05T15:00:00"),
    )).rejects.toThrow(/more than the balance/);
  });

  it("walk-in with room service: room + items + payment saved together", async () => {
    const st = await roomType("STANDARD");
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    const r = await createReservation(
      {
        sourceCode: "WALK_IN", guest, stay: { kind: "walkIn", nights: 1 }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0, discountPerNight: 10_000 }],
        charges: [{ type: "ROOM_SERVICE", item: "Dinner", qty: 2, unitPrice: 15_000 }],
        payment: { amount: 50_000 + 30_000, methodId: cash.id },
      },
      await receptionistActor(), eat("2026-10-05T15:00:00"),
    );
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.chargesAmount).toBe(30_000);
    expect(after.netAmount).toBe(80_000);
    expect(after.balanceAmount).toBe(0);
  });

  it("short time: 25% off the room, no extra discount, at most 7 hours", async () => {
    const st = await roomType("STANDARD");
    const base = { sourceCode: "PHONE", guest, rooms: [{ roomTypeId: st.id, adults: 1, children: 0, discountPerNight: 20_000 }] };
    const r = await createReservation(
      { ...base, stay: { kind: "dayUse", startAt: eat("2026-10-20T22:00:00"), endAt: eat("2026-10-21T03:00:00") } },
      await receptionistActor(), NOW,
    );
    expect(r.rooms[0].isDayUse).toBe(true);
    expect(r.rooms[0].ratePerNight).toBe(45_000);
    expect(r.rooms[0].discountPerNight).toBe(0);
    expect(r.netAmount).toBe(45_000);
    await expect(createReservation(
      { ...base, stay: { kind: "dayUse", startAt: eat("2026-10-22T10:00:00"), endAt: eat("2026-10-22T18:00:00") } },
      await receptionistActor(), NOW,
    )).rejects.toThrow(/at most 7 hours/);
  });

  it("walk-in at 18:30 is checked in immediately with 11:00 checkout next morning", async () => {
    const st = await roomType("STANDARD");
    const r = await createReservation(
      { sourceCode: "WALK_IN", guest, stay: { kind: "walkIn", nights: 1 }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }] },
      await receptionistActor(), eat("2026-10-05T18:30:00"),
    );
    expect(r.status).toBe("CHECKED_IN");
    expect(r.rooms[0].isLateArrival).toBe(true);
    expect(r.rooms[0].endAt.toISOString()).toBe("2026-10-06T08:00:00.000Z");
    expect((await db.room.findUniqueOrThrow({ where: { id: r.rooms[0].roomId } })).status).toBe("OCCUPIED");
  });

  it("check-in → payment → check-out → room goes to DIRTY, never straight to available", async () => {
    const ex = await roomType("EXECUTIVE");
    const actor = await receptionistActor();
    const r = await createReservation(
      { sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-05", departureDate: "2026-10-07" }, rooms: [{ roomTypeId: ex.id, adults: 1, children: 0, discountPerNight: 20_000 }] },
      actor, NOW,
    );
    await checkIn(r.id, actor, null, eat("2026-10-05T15:00:00"));
    const roomId = r.rooms[0].roomId;
    expect((await db.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe("OCCUPIED");

    // Checkout with an unpaid balance is refused unless explicitly accepted.
    await expect(checkOut(r.id, actor, {}, eat("2026-10-07T10:30:00"))).rejects.toThrow(/still owes/);

    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    await expect(recordReservationPayment({ reservationId: r.id, amount: 999_999, methodId: cash.id }, actor)).rejects.toThrow(/more than the balance/);
    await recordReservationPayment({ reservationId: r.id, amount: 100_000, methodId: cash.id }, actor);
    await recordReservationPayment({ reservationId: r.id, amount: 60_000, methodId: cash.id }, actor);
    const paid = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(paid.paidAmount).toBe(160_000);
    expect(paid.balanceAmount).toBe(0);

    await checkOut(r.id, actor, {}, eat("2026-10-07T10:30:00"));
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("CHECKED_OUT");
    expect((await db.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe("DIRTY");
  });

  it("early departure stops charging unused nights", async () => {
    const ex = await roomType("EXECUTIVE");
    const actor = await receptionistActor();
    const r = await createReservation(
      { sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-05", departureDate: "2026-10-09" }, rooms: [{ roomTypeId: ex.id, adults: 1, children: 0, discountPerNight: 20_000 }] },
      actor, NOW,
    );
    expect(r.netAmount).toBe(4 * 80_000);
    await checkIn(r.id, actor, null, eat("2026-10-05T15:00:00"));
    await expect(checkOut(r.id, actor, { allowBalance: true }, eat("2026-10-07T09:00:00"))).rejects.toThrow(/early departure/);
    // Receptionists cannot leave with an unpaid balance; a manager can override.
    await expect(checkOut(r.id, actor, { allowBalance: true, earlyReason: "Change of plans" }, eat("2026-10-07T09:00:00"))).rejects.toThrow(/only a manager/i);
    await checkOut(r.id, await managerActor(), { allowBalance: true, earlyReason: "Change of plans", overrideReason: "Settles by transfer" }, eat("2026-10-07T09:00:00"));
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.netAmount).toBe(2 * 80_000); // default policy: charge nights used only
    expect(await db.roomNight.count({ where: { reservationRoom: { reservationId: r.id } } })).toBe(2);
  });

  it("early departure policy can charge one extra night as a separate folio line", async () => {
    await db.hotelSettings.update({ where: { id: 1 }, data: { earlyDeparturePolicy: "CHARGE_ONE_EXTRA_NIGHT" } });
    try {
      const ex = await roomType("EXECUTIVE");
      const mgr = await managerActor();
      const r = await createReservation(
        { sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-05", departureDate: "2026-10-09" }, rooms: [{ roomTypeId: ex.id, adults: 1, children: 0, discountPerNight: 20_000 }] },
        mgr, NOW,
      );
      await checkIn(r.id, mgr, null, eat("2026-10-05T15:00:00"));
      await checkOut(r.id, mgr, { allowBalance: true, earlyReason: "Emergency", overrideReason: "Manager approved" }, eat("2026-10-07T09:00:00"));
      const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true } });
      expect(after.netAmount).toBe(3 * 80_000);
      expect(after.charges[0].category).toBe("EARLY_DEPARTURE");
      expect(await db.roomNight.count({ where: { reservationRoom: { reservationId: r.id } } })).toBe(2); // occupancy stays true
    } finally {
      await db.hotelSettings.update({ where: { id: 1 }, data: { earlyDeparturePolicy: "CHARGE_USED_NIGHTS" } });
    }
  });

  it("payment reversal restores the balance; only managers can reverse", async () => {
    const st = await roomType("STANDARD");
    const actor = await receptionistActor();
    const r = await createReservation(
      { sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0, discountPerNight: 20_000 }] },
      actor, NOW,
    );
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    const p = await recordReservationPayment({ reservationId: r.id, amount: 40_000, methodId: cash.id }, actor);
    await expect(reversePayment(p.id, "Wrong amount", actor)).rejects.toThrow(/Only a manager/);
    await reversePayment(p.id, "Wrong amount", await managerActor());
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.paidAmount).toBe(0);
    expect(after.balanceAmount).toBe(40_000);
    expect(await db.payment.count({ where: { id: p.id } })).toBe(1); // never deleted
  });

  it("cancellation frees the room and removes revenue; history is kept", async () => {
    const twin = await roomType("TWIN");
    const actor = await managerActor();
    const input = { sourceCode: "PHONE", guest, stay: { kind: "overnight" as const, arrivalDate: "2026-10-10", departureDate: "2026-10-11" }, rooms: [{ roomTypeId: twin.id, adults: 1, children: 0 }] };
    const r = await createReservation(input, actor, NOW);
    await expect(cancelReservation(r.id, actor, " ")).rejects.toThrow(/reason/);
    await cancelReservation(r.id, actor, "Guest changed plans");
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.netAmount).toBe(0);
    expect(await db.roomNight.count({ where: { reservationRoom: { reservationId: r.id } } })).toBe(0);
    await expect(createReservation(input, actor, NOW)).resolves.toBeTruthy(); // room free again
  });

  it("no-show only on/after the arrival date", async () => {
    const st = await roomType("STANDARD");
    const actor = await managerActor();
    const r = await createReservation(
      { sourceCode: "BOOKING_COM", guest, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }] },
      actor, NOW,
    );
    await expect(markNoShow(r.id, actor, eat("2026-10-09T12:00:00"))).rejects.toThrow(/on or after/);
    await markNoShow(r.id, actor, eat("2026-10-11T02:00:00")); // still business date 10 Oct
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("NO_SHOW");
  });

  it("rejects stays over capacity and arrivals in the past", async () => {
    const st = await roomType("STANDARD"); // 1 adult max
    const actor = await receptionistActor();
    await expect(
      createReservation({ sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" }, rooms: [{ roomTypeId: st.id, adults: 2, children: 0 }] }, actor, NOW),
    ).rejects.toThrow(/fits up to 1 adult/);
    await expect(
      createReservation({ sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-01", departureDate: "2026-10-02" }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }] }, actor, NOW),
    ).rejects.toThrow(/past/);
  });

  it("maintenance blocks remove a room from availability", async () => {
    const twin = await roomType("TWIN");
    await db.roomBlock.create({ data: { roomId: twin.rooms[0].id, type: "MAINTENANCE", startDate: new Date("2026-10-09T00:00:00Z") } });
    await expect(
      createReservation({ sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" }, rooms: [{ roomTypeId: twin.id, adults: 1, children: 0 }] }, await managerActor(), NOW),
    ).rejects.toThrow(/fully booked/);
  });
});
