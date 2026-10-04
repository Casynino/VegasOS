import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkInGroup, checkOutGroup, createGroupBooking, finalizeGroup, getGroup, invoiceGroupRooms, recordGroupPayment } from "@/server/services/groups";
import { addReservationCharge, recordReservationPayment, voidReservationCharge } from "@/server/services/payments";
import { previewCheckOut } from "@/server/services/reservations";
import { voidInvoice } from "@/server/services/invoices";
import { loadInvoiceDoc } from "@/components/staff/invoices/load-invoice";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const ARR = "2026-11-10", DEP = "2026-11-13";
const NOW = eat("2026-11-01T10:00:00");
const IN = eat("2026-11-10T15:00:00");
const OUT = eat("2026-11-13T10:00:00");

/** ABC Company: 3 rooms × 3 nights (Standard 60k, Double Deluxe 80k, Standard 60k). */
async function threeRooms() {
  const mgr = await managerActor();
  const c = await db.corporateCustomer.create({ data: { companyName: "ABC COMPANY", contactPerson: "John Doe", paymentTermDays: 30 } });
  const [st, dd, ex] = await Promise.all([roomType("STANDARD"), roomType("DOUBLE_DELUXE"), roomType("EXECUTIVE")]);
  const g = await createGroupBooking({
    name: "ABC Company Booking", type: "COMPANY", corporateCustomerId: c.id, contact: { fullName: "John Doe", phone: "0713000500" },
    sourceCode: "CORPORATE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
    rooms: [
      { roomTypeId: st.id, guest: { fullName: "Guest A" }, adults: 1, children: 0 },
      { roomTypeId: dd.id, guest: { fullName: "Guest B" }, adults: 1, children: 0 },
      { roomTypeId: ex.id, guest: { fullName: "Guest C" }, adults: 1, children: 0 },
    ],
  }, mgr, NOW);
  await checkInGroup(g.id, mgr, null, IN);
  const [a, b, cRoom] = (await getGroup(g.id))!.rooms;
  return { mgr, g, a, b, c: cRoom };
}

describe("group check-out: the final invoice only after the last guest", () => {
  it("knows the last guest; statuses move Active → Partially checked out → Ready → Final invoice → Partially paid → Paid · closed", async () => {
    const { mgr, g, a, b, c } = await threeRooms();
    expect((await getGroup(g.id))!.billingStatus).toBe("ACTIVE");

    // Guest A leaves: two rooms remain, so no final invoice.
    const pa = await previewCheckOut(a.id, { userId: mgr.userId! }, OUT);
    expect(pa.group).toMatchObject({ remaining: 2, last: false });
    await checkOutGroup(g.id, mgr, [a.id], {}, OUT);
    let v = (await getGroup(g.id))!;
    expect(v).toMatchObject({ billingStatus: "PARTIALLY_CHECKED_OUT", readyToFinalize: false, totals: { checkedOut: 1, staying: 2 } });
    expect(v.invoices.every((i) => i.status === "DRAFT")).toBe(true);
    await expect(finalizeGroup(g.id, mgr)).rejects.toThrow(/not checked out yet/);

    await checkOutGroup(g.id, mgr, [b.id], {}, OUT);
    // Guest C is the last active guest.
    const pc = await previewCheckOut(c.id, { userId: mgr.userId! }, OUT);
    expect(pc.group).toMatchObject({ remaining: 0, last: true, payer: "ABC COMPANY" });
    await checkOutGroup(g.id, mgr, [c.id], {}, OUT);
    v = (await getGroup(g.id))!;
    expect(v).toMatchObject({ billingStatus: "READY_FOR_FINAL_INVOICE", readyToFinalize: true });
    expect(v.invoices.filter((i) => i.status !== "DRAFT")).toHaveLength(0); // not generated until the receptionist confirms

    // Reception confirms (check-out permission is enough).
    const fin = await finalizeGroup(g.id, await receptionistActor());
    const total = 3 * (60_000 + 80_000 + 100_000);
    expect(fin.finalInvoice?.amount).toBe(total);
    expect((await getGroup(g.id))!.billingStatus).toBe("FINAL_INVOICE_GENERATED");
    await recordGroupPayment(g.id, { amount: 300_000, accountId: "acct_cash" }, mgr);
    expect((await getGroup(g.id))!.billingStatus).toBe("PARTIALLY_PAID");
    await recordGroupPayment(g.id, { amount: total - 300_000, accountId: "acct_cash" }, mgr);
    v = (await getGroup(g.id))!;
    expect(v).toMatchObject({ billingStatus: "CLOSED", totals: { outstanding: 0, paid: total } });
  });

  it("a deposit paid on a room counts once — as a payment on the final invoice", async () => {
    const { mgr, g, a, b, c } = await threeRooms();
    await recordReservationPayment({ reservationId: a.id, amount: 50_000, accountId: "acct_cash", reference: "DEP-1" }, mgr);
    await checkOutGroup(g.id, mgr, [a.id, b.id, c.id], {}, OUT);
    const fin = await finalizeGroup(g.id, mgr);
    const total = 720_000;
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: fin.finalInvoice!.id } });
    // The invoice shows the full bill, the deposit as already paid, and only the rest owed.
    expect(inv).toMatchObject({ netAmount: total, paidAmount: 50_000, balanceAmount: total - 50_000, status: "PARTIALLY_PAID" });
    const room = await db.reservation.findUniqueOrThrow({ where: { id: a.id } });
    expect(room).toMatchObject({ balanceAmount: 0, paidAmount: 0, companyBilledAmount: 180_000 });
    const v = (await getGroup(g.id))!;
    expect(v.totals).toMatchObject({ total, paid: 50_000, outstanding: total - 50_000 });
    expect(v.totals.paid + v.totals.outstanding).toBe(v.totals.total);
    expect(v.payments.filter((p) => p.deposit)).toHaveLength(1);
    // The payment keeps its room: room → guest → invoice → payment.
    const p = await db.payment.findFirstOrThrow({ where: { reference: "DEP-1" } });
    expect(p).toMatchObject({ reservationId: a.id, invoiceId: inv.id });

    // Voiding the invoice gives the deposit back to its room.
    await voidInvoice(inv.id, "Wrong company", mgr);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ paidAmount: 50_000, companyBilledAmount: 0, balanceAmount: 130_000 });
  });

  it("a charge corrected after a guest left appears once, at its latest value — never twice", async () => {
    const { mgr, g, a, b, c } = await threeRooms();
    await addReservationCharge({ reservationId: a.id, description: "Food", amount: 30_000, category: "RESTAURANT" }, mgr);
    await checkOutGroup(g.id, mgr, [a.id], {}, OUT);
    // The kitchen corrects Guest A's food after she left, and a late bar bill arrives.
    const wrong = await db.reservationCharge.findFirstOrThrow({ where: { reservationId: a.id, description: "Food" } });
    await voidReservationCharge(wrong.id, "Wrong amount", mgr);
    await addReservationCharge({ reservationId: a.id, description: "Food (corrected)", amount: 25_000, category: "RESTAURANT" }, mgr);
    await addReservationCharge({ reservationId: b.id, description: "Drinks", amount: 40_000, category: "BAR" }, mgr);
    await checkOutGroup(g.id, mgr, [b.id, c.id], {}, OUT);
    const fin = await finalizeGroup(g.id, mgr);
    const { doc } = (await loadInvoiceDoc({ id: fin.finalInvoice!.id }))!;
    expect(doc.items.some((i) => /^(Credit|Adjustment):/.test(i.description))).toBe(false);
    expect(doc.items.filter((i) => i.description.startsWith("Food"))).toEqual([expect.objectContaining({ description: "Food (corrected)", netAmount: 25_000, roomNumber: expect.any(String), guestName: "Guest A" })]);
    const sources = doc.items.map((i) => i.id);
    expect(new Set(sources).size).toBe(sources.length);
    expect(doc.net).toBe(720_000 + 25_000 + 40_000);
    expect(doc.items.find((i) => i.description === "Drinks")).toMatchObject({ dept: "BAR", guestName: "Guest B" });
  });

  it("after the final invoice: reception cannot change a room's bill; a manager's change becomes an adjustment invoice", async () => {
    const { mgr, g, a, b, c } = await threeRooms();
    await checkOutGroup(g.id, mgr, [a.id, b.id, c.id], {}, OUT);
    const fin = await finalizeGroup(g.id, mgr);
    await expect(addReservationCharge({ reservationId: a.id, description: "Minibar", amount: 8_000, category: "BAR" }, await receptionistActor())).rejects.toThrow(/final invoice is already made/);
    await addReservationCharge({ reservationId: a.id, description: "Minibar", amount: 8_000, category: "BAR" }, mgr);
    expect((await getGroup(g.id))!.changedSinceFinal).toBe(8_000);
    const adj = await invoiceGroupRooms(g.id, [a.id], "COMBINED", mgr);
    expect(adj[0].amount).toBe(8_000);
    // The final invoice itself is unchanged.
    expect(await db.invoice.findUniqueOrThrow({ where: { id: fin.finalInvoice!.id } })).toMatchObject({ netAmount: 720_000 });
    expect((await getGroup(g.id))!.changedSinceFinal).toBe(0);
  });
});
