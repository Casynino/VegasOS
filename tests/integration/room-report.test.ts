import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { checkIn, checkOut, createReservation, extendStay } from "@/server/services/reservations";
import { recordReservationPayment, reversePayment } from "@/server/services/payments";
import { buildRoomReportData, type RoomReportData } from "@/server/services/room-report-data";
import { ensureRoomReport, renderRoomReportText } from "@/server/services/room-report";
import { guestMovement } from "@/server/services/reporting";
import { staffActivity } from "@/server/services/finance";
import { buildDailyDocument } from "@/server/services/daily-document";
import { buildDailyReport } from "@/server/services/daily-report";
import { fitsWhatsApp } from "@/lib/wa-fit";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/**
 * A room sale, a night's room income, a payment and what is still owed are four different things, each on its own
 * hotel day (04:00 → 04:00). Payments are recorded "now", so the hotel's clock is held and moved by hand.
 */
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], now: eat("2026-10-10T09:00:00") }); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  vi.setSystemTime(eat("2026-10-10T09:00:00"));
  await resetBusinessData();
  await db.roomReport.deleteMany({});
});

const D10 = "2026-10-10", D11 = "2026-10-11", D12 = "2026-10-12";
/** Move the hotel's clock to a Dar es Salaam time and return that moment. */
const at = (iso: string) => { const t = eat(iso); vi.setSystemTime(t); return t; };
const cash = () => db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
const rooms = (d: RoomReportData) => d.rooms!;
const LINK = "https://www.vegashoteltz.com/room-report/abcdefghijklmnopqrstuvwx";

let n = 0;
async function booked(name: string, room: string, arrival: string, departure: string) {
  const t = await roomType("DOUBLE_DELUXE");
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone: `07120000${String(++n).padStart(2, "0")}` },
    stay: { kind: "overnight", arrivalDate: arrival, departureDate: departure },
    rooms: [{ roomTypeId: t.id, roomId: t.rooms.find((r) => r.number === room)!.id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), new Date());
}
const pay = async (reservationId: string, amount: number) =>
  recordReservationPayment({ reservationId, amount, methodId: (await cash()).id, reference: "RCPT-1" }, await managerActor());
/** Housekeeping has finished the room: it can be sold again. */
const ready = (room: string) => db.room.updateMany({ where: { number: room }, data: { status: "AVAILABLE" } });

describe("room report — sales, payments and what is owed are kept apart", () => {
  it("a guest who checks in today and pays tomorrow: the sale stays on its day, the payment on its own", async () => {
    const a = await booked("Amina Late", "204", D10, D11);
    const price = a.netAmount;
    expect(price).toBeGreaterThan(0);
    await checkIn(a.id, await receptionistActor(), null, at("2026-10-10T14:00:00"));

    // 10 Oct, as the day closes: one room sold, nothing received, the whole stay owed.
    at("2026-10-10T23:00:00");
    const first = await buildRoomReportData(D10);
    expect(first.perf.newSales).toBe(1);
    expect(first.money.expected).toBe(price);
    expect(rooms(first).sold).toHaveLength(1);
    expect(rooms(first).sold[0]).toMatchObject({ rooms: "204", guest: "Amina Late", total: price, paid: 0, owed: price, status: "UNPAID", walkIn: false });
    expect(rooms(first).received).toMatchObject({ total: 0, today: 0, earlier: 0 });
    expect(rooms(first).payments).toHaveLength(0);
    expect(rooms(first).owed).toBe(price);
    expect(rooms(first).notes).toEqual([]);
    const stored = await ensureRoomReport(D10);

    // 11 Oct 09:00: the guest pays, and is still in the room.
    at("2026-10-11T09:00:00");
    await pay(a.id, price);
    const second = await buildRoomReportData(D11);
    expect(second.perf.newSales).toBe(0);
    expect(second.money.expected).toBe(0); // a late payment is never a new sale
    expect(rooms(second).sold).toHaveLength(0);
    expect(rooms(second).payments).toHaveLength(1);
    expect(rooms(second).payments[0]).toMatchObject({ rooms: "204", guest: "Amina Late", reference: a.reference, soldOn: D10, group: "STAYING", amount: price, refund: false, reversed: false, ref: "RCPT-1" });
    expect(rooms(second).received).toMatchObject({ total: price, today: 0, staying: price, left: 0, advance: 0, earlier: price });
    expect(rooms(second).received.total).toBe(second.money.collected);
    expect(rooms(second).owing).toHaveLength(0);
    expect(rooms(second).owed).toBe(0);

    // Once the guest has left, the same payment reads "earlier sale, guest has left".
    await checkOut(a.id, await receptionistActor(), {}, at("2026-10-11T10:00:00"));
    const left = await buildRoomReportData(D11);
    expect(rooms(left).payments[0]).toMatchObject({ group: "LEFT", soldOn: D10 });
    expect(rooms(left).received).toMatchObject({ total: price, left: price, staying: 0 });
    expect(left.checkouts[0]).toMatchObject({ room: "204", charges: price, paid: price, outstanding: 0 });

    // 10 Oct read again after the payment: still one sale, still nothing received, still owed that day.
    const again = await buildRoomReportData(D10);
    expect(rooms(again).sold[0]).toMatchObject({ total: price, paid: 0, owed: price, status: "UNPAID" });
    expect(rooms(again).received.total).toBe(0);
    expect(rooms(again).owed).toBe(price);
    expect(rooms(again).owing[0]).toMatchObject({ rooms: "204", soldOn: D10, state: "SOLD_TODAY", owed: price, status: "UNPAID" });

    // The report kept for 10 Oct is not rewritten by a later payment.
    const kept = await ensureRoomReport(D10);
    expect(kept.version).toBe(stored.version);
    expect(kept.generatedAt).toEqual(stored.generatedAt);
    expect((kept.data as unknown as RoomReportData).rooms!.owed).toBe(price);
  });

  it("one room, two stays in a day: the new guest is the sale, the old guest's money is a payment for an earlier sale", async () => {
    const mgr = await managerActor();
    const a = await booked("Guest A", "204", D10, D11);
    const price = a.netAmount;
    await checkIn(a.id, mgr, null, at("2026-10-10T14:00:00"));
    // Guest A leaves on 11 Oct without paying (a manager lets them go).
    await checkOut(a.id, mgr, { allowBalance: true, overrideReason: "Will pay later today" }, at("2026-10-11T09:00:00"));
    await ready("204");
    // Guest B takes the same room the same day, and has not paid.
    const b = await booked("Guest B", "204", D11, D12);
    await checkIn(b.id, mgr, null, at("2026-10-11T14:00:00"));
    // Guest A comes back and pays.
    at("2026-10-11T16:00:00");
    await pay(a.id, price);

    const d = await buildRoomReportData(D11);
    expect(d.perf.newSales).toBe(1);
    expect(d.money.expected).toBe(b.netAmount);
    expect(rooms(d).sold).toHaveLength(1);
    expect(rooms(d).sold[0]).toMatchObject({ rooms: "204", guest: "Guest B", reference: b.reference, paid: 0, owed: b.netAmount, status: "UNPAID" });
    expect(rooms(d).payments).toHaveLength(1);
    expect(rooms(d).payments[0]).toMatchObject({ rooms: "204", guest: "Guest A", reference: a.reference, soldOn: D10, group: "LEFT", amount: price });
    expect(rooms(d).received).toMatchObject({ total: price, today: 0, left: price, earlier: price });
    // Same room number, two stays: only Guest B still owes.
    expect(rooms(d).owing).toHaveLength(1);
    expect(rooms(d).owing[0]).toMatchObject({ rooms: "204", guest: "Guest B", reference: b.reference, state: "SOLD_TODAY", owed: b.netAmount });
    expect(rooms(d).owed).toBe(b.netAmount);
    expect(d.checkouts).toHaveLength(1);
    expect(d.checkouts[0]).toMatchObject({ room: "204", reference: a.reference, paid: price, outstanding: 0 });

    // 10 Oct keeps Guest A's sale and what they owed that day.
    const before = await buildRoomReportData(D10);
    expect(rooms(before).sold[0]).toMatchObject({ guest: "Guest A", paid: 0, owed: price, status: "UNPAID" });
    expect(rooms(before).owed).toBe(price);
  });

  it("a guest who left owing is still listed as owing on the following days — a check-out is not a payment", async () => {
    const mgr = await managerActor();
    const a = await booked("Gone Owing", "203", D10, D11);
    await checkIn(a.id, mgr, null, at("2026-10-10T14:00:00"));
    await checkOut(a.id, mgr, { allowBalance: true, overrideReason: "Company will pay" }, at("2026-10-11T09:00:00"));
    at("2026-10-12T08:00:00");
    const d = await buildRoomReportData(D12);
    expect(d.perf.newSales).toBe(0);
    expect(rooms(d).owing).toHaveLength(1);
    expect(rooms(d).owing[0]).toMatchObject({ rooms: "203", guest: "Gone Owing", soldOn: D10, state: "LEFT", leftOn: D11, owed: a.netAmount, status: "UNPAID" });
    // The check-out day's list says who left owing, from the real check-out and the bill as that day closed.
    const doc = await buildDailyDocument(D11, await buildDailyReport(D11));
    expect(JSON.stringify(doc)).toContain("checked out still owing");
  });

  it("a stay that goes on is a continuing stay, never a new sale; its night is that day's room income", async () => {
    const mgr = await managerActor();
    const c = await booked("Long Stay", "205", D10, "2026-10-13");
    await checkIn(c.id, mgr, null, at("2026-10-10T15:00:00"));
    at("2026-10-11T12:00:00");
    await pay(c.id, 50_000);
    const d = await buildRoomReportData(D11);
    const night = c.netAmount / 3;
    expect(d.perf).toMatchObject({ newSales: 0, continuing: 1 });
    expect(rooms(d).sold).toHaveLength(0);
    expect(rooms(d).staying).toHaveLength(1);
    expect(rooms(d).staying[0]).toMatchObject({ rooms: "205", guest: "Long Stay", nights: 3, tonight: night, total: c.netAmount, paid: 50_000, owed: c.netAmount - 50_000, status: "PART_PAID" });
    expect(d.money.recognized).toBe(night);
    expect(rooms(d).income).toEqual({ sold: 0, staying: night, other: 0 });
    // The daily report calls that room what it is — occupied, not sold a second time.
    const daily = JSON.stringify(await buildDailyDocument(D11, await buildDailyReport(D11)));
    expect(daily).toContain("Rooms occupied");
    expect(daily).not.toContain("Rooms sold");
    // The first day: one sale for the whole stay, one night of income.
    const first = await buildRoomReportData(D10);
    expect(first.money.expected).toBe(c.netAmount);
    expect(first.money.recognized).toBe(night);
    expect(rooms(first).income).toEqual({ sold: night, staying: 0, other: 0 });
  });

  it("money paid before arriving is a payment, not a sale; a cancelled payment is listed and never counted", async () => {
    const mgr = await managerActor();
    const ahead = await booked("Paid Ahead", "203", D11, D12);
    at("2026-10-10T11:00:00");
    await pay(ahead.id, ahead.netAmount);
    const wrong = await pay(ahead.id, 5_000).catch(() => null); // a full bill takes no more money
    expect(wrong).toBeNull();
    const w = await booked("Walk Payer", "204", D10, D11);
    await checkIn(w.id, mgr, null, at("2026-10-10T13:00:00"));
    const mistake = await pay(w.id, 30_000);
    await reversePayment(mistake.id, "Typed on the wrong guest", mgr);
    await pay(w.id, 20_000);

    const d = await buildRoomReportData(D10);
    expect(d.perf.newSales).toBe(1);
    expect(rooms(d).received).toMatchObject({ total: ahead.netAmount + 20_000, today: 20_000, advance: ahead.netAmount, earlier: 0, refunds: 0 });
    expect(rooms(d).received.total).toBe(d.money.collected);
    expect(rooms(d).payments).toHaveLength(3);
    expect(rooms(d).payments.find((p) => p.guest === "Paid Ahead")).toMatchObject({ group: "ADVANCE", soldOn: null, rooms: "203" });
    expect(rooms(d).payments.filter((p) => p.reversed)).toHaveLength(1);
    expect(rooms(d).sold[0]).toMatchObject({ guest: "Walk Payer", paid: 20_000, owed: w.netAmount - 20_000, status: "PART_PAID" });
    // A booking that has not arrived owes nothing yet in the room report.
    expect(rooms(d).owing.map((o) => o.guest)).toEqual(["Walk Payer"]);
  });

  it("check-ins and check-outs are counted by the real moment, the same in every report", async () => {
    const mgr = await managerActor(), rec = await receptionistActor();
    const t = await roomType("DOUBLE_DELUXE");
    // Booked for 10 Oct, arrives on 11 Oct: sold on 11 Oct.
    const late = await booked("Came Late", "203", D10, D12);
    const early = await booked("On Time", "204", D10, D11);
    await checkIn(early.id, rec, null, at("2026-10-10T14:00:00"));
    await pay(early.id, early.netAmount);
    await checkOut(early.id, rec, {}, at("2026-10-11T09:30:00"));
    await checkIn(late.id, rec, null, at("2026-10-11T11:00:00"));
    // A walk-in at 02:00 on the 12th still belongs to the hotel day of the 11th.
    const walk = await createReservation({
      sourceCode: "WALK_IN", guest: { fullName: "Night Walk-in", phone: "0712999001" }, stay: { kind: "walkIn", nights: 1 },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms.find((r) => r.number === "205")!.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgr, at("2026-10-12T02:00:00"));
    expect(walk.status).toBe("CHECKED_IN");

    const d = await buildRoomReportData(D11);
    expect(d.perf).toMatchObject({ newSales: 2, checkedOut: 1 });
    expect(rooms(d).checkIns).toEqual({ walkIns: 1, reservations: 1 });
    expect(rooms(d).sold.map((s) => s.guest).sort()).toEqual(["Came Late", "Night Walk-in"]);
    const moved = await guestMovement({ from: D11, to: D11 });
    expect(moved).toMatchObject({ checkIns: 2, checkOuts: 1 });
    const people = await staffActivity(D11, D11);
    expect(people.reduce((s, p) => s + p.checkIns, 0)).toBe(2);
    expect(people.reduce((s, p) => s + p.checkOuts, 0)).toBe(1);
    expect(people.find((p) => p.id === rec.userId)).toMatchObject({ checkIns: 1, checkOuts: 1 });
    // 10 Oct had one check-in — the guest booked for that day who came a day late is not in it.
    expect(await guestMovement({ from: D10, to: D10 })).toMatchObject({ checkIns: 1, checkOuts: 0 });
    expect((await buildRoomReportData(D10)).perf.newSales).toBe(1);
    // The two days together.
    expect(await guestMovement({ from: D10, to: D11 })).toMatchObject({ checkIns: 3, checkOuts: 1 });
  });

  it("a stay changed after the day closed is flagged, not guessed; the WhatsApp text matches the report and keeps its link", async () => {
    const mgr = await managerActor();
    const c = await booked("Extends Later", "205", D10, D11);
    await checkIn(c.id, mgr, null, at("2026-10-10T15:00:00"));
    at("2026-10-10T20:00:00");
    await pay(c.id, 30_000);
    const d = await buildRoomReportData(D10);
    expect(rooms(d).notes).toEqual([]);
    const text = renderRoomReportText(d, "Vegas Luxury Hotel", LINK);
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.endsWith(LINK)).toBe(true);
    expect(text).toContain("*Room guests paid:* TZS 30,000");
    expect(text).toContain(`*Rooms sold today* · TZS ${c.netAmount.toLocaleString("en-US")}`);

    at("2026-10-11T08:00:00");
    await extendStay(c.rooms[0].id, D12, mgr);
    const later = await buildRoomReportData(D10);
    expect(rooms(later).notes).toHaveLength(1);
    expect(rooms(later).notes[0]).toContain(c.reference);
    expect(rooms(later).notes[0]).toContain("changed after this day closed");
  });

  it("a check-out is not a change — but one that re-prices the room after the day closed is flagged", async () => {
    const mgr = await managerActor();
    // Two guests arrive on the 10th: one leaves on time the next morning, one was booked for three nights and leaves early.
    const onTime = await booked("Leaves On Time", "206", D10, D11);
    const early = await booked("Leaves Early", "207", D10, "2026-10-13");
    await checkIn(onTime.id, mgr, null, at("2026-10-10T13:00:00"));
    await checkIn(early.id, mgr, null, at("2026-10-10T13:30:00"));
    at("2026-10-10T22:00:00");
    const before = await buildRoomReportData(D10);
    expect(rooms(before).notes).toEqual([]);
    expect(before.money.expected).toBe(onTime.netAmount + early.netAmount);

    await checkOut(onTime.id, mgr, { allowBalance: true, overrideReason: "Pays by phone later" }, at("2026-10-11T09:00:00"));
    expect(rooms(await buildRoomReportData(D10)).notes).toEqual([]);

    // Three nights become one: the price of the room sold on the 10th is no longer what it was that day.
    await checkOut(early.id, mgr, { allowBalance: true, overrideReason: "Pays by phone later", earlyReason: "Change of plans" }, at("2026-10-11T09:30:00"));
    const shorter = await db.reservation.findUniqueOrThrow({ where: { id: early.id } });
    expect(shorter.netAmount).toBeLessThan(early.netAmount);
    const after = await buildRoomReportData(D10);
    expect(rooms(after).notes).toHaveLength(1);
    expect(rooms(after).notes[0]).toContain(early.reference);
    expect(rooms(after).notes[0]).not.toContain(onTime.reference);
    expect(rooms(after).notes[0]).toContain("nights changed at check-out");
  });

  it("a bill moved onto a company invoice after the day closed is flagged — and an invoice is never money received", async () => {
    const mgr = await managerActor();
    const t = await roomType("DOUBLE_DELUXE");
    const co = await db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", paymentTermDays: 30 } });
    const r = await createReservation({
      sourceCode: "CORPORATE", guest: { fullName: "Company Guest", phone: "0712000099" }, corporateCustomerId: co.id, billing: { billTo: "COMPANY" },
      stay: { kind: "overnight", arrivalDate: D10, departureDate: D11 },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms.find((x) => x.number === "307")!.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgr, new Date());
    await checkIn(r.id, mgr, null, at("2026-10-10T14:00:00"));
    at("2026-10-10T22:00:00");
    expect(rooms(await buildRoomReportData(D10)).notes).toEqual([]);

    // The guest leaves on the 11th: the bill goes onto the company's invoice. No money has come in.
    const out = await checkOut(r.id, mgr, {}, at("2026-10-11T09:00:00"));
    expect(out.invoice?.number).toBeTruthy();
    const d11 = await buildRoomReportData(D11);
    expect(rooms(d11).received.total).toBe(0);
    expect(d11.money.collected).toBe(0);
    expect(d11.checkouts[0]).toMatchObject({ reference: r.reference, paid: 0 });

    // The 10th cannot be shown as it was (the invoice has no place in time on the bill) — it says so.
    const d10 = rooms(await buildRoomReportData(D10));
    expect(d10.notes).toHaveLength(1);
    expect(d10.notes[0]).toContain(r.reference);
    expect(d10.notes[0]).toContain("company invoice");
    expect(d10.sold[0].status).not.toBe("PAID");
    expect(d10.sold[0].paid).toBe(0);
  });

  it("a balance written off by a discount on a later day was still owed on the days before", async () => {
    const { discountStayBill } = await import("@/server/services/reservations");
    const mgr = await managerActor();
    const g = await booked("Written Off Later", "306", D10, D11);
    const price = g.netAmount;
    await checkIn(g.id, mgr, null, at("2026-10-10T14:00:00"));
    at("2026-10-10T19:00:00");
    await pay(g.id, 30_000);
    await checkOut(g.id, mgr, { allowBalance: true, overrideReason: "Will send the rest" }, at("2026-10-11T09:00:00"));

    // 12 Oct: the manager gives the rest as a discount on the whole bill. Nothing is owed any more.
    at("2026-10-12T11:00:00");
    await discountStayBill(g.id, { amount: price - 30_000, reason: "Service problem" }, mgr, new Date());
    expect((await db.reservation.findUniqueOrThrow({ where: { id: g.id } })).balanceAmount).toBe(0);

    // The 10th and the 11th still say what the guest owed as each day closed — and the bill as it was, before the discount.
    for (const day of [D10, D11]) {
      const owing = rooms(await buildRoomReportData(day)).owing;
      expect(owing).toHaveLength(1);
      expect(owing[0]).toMatchObject({ reference: g.reference, total: price, paid: 30_000, owed: price - 30_000, status: "PART_PAID", discount: 0 });
    }
    // The room's price is kept as it is now (it cannot be put back) — the row says so, and the day is flagged.
    const d10 = rooms(await buildRoomReportData(D10));
    expect(d10.sold[0]).toMatchObject({ total: 30_000, paid: 30_000, owed: price - 30_000, status: "PART_PAID", discountLater: price - 30_000 });
    expect(d10.notes.join(" ")).toContain(g.reference);
    // From the day of the discount the guest owes nothing.
    expect(rooms(await buildRoomReportData(D12)).owing).toEqual([]);
    expect(rooms(await buildRoomReportData(D12)).owed).toBe(0);
  });
});
