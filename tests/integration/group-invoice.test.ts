import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkInGroup, checkOutGroup, createGroupBooking, finalizeGroup, getGroup, invoiceGroupRooms, recordGroupPayment, updateGroup } from "@/server/services/groups";
import { addReservationCharge } from "@/server/services/payments";
import { createReservation } from "@/server/services/reservations";
import { revenue } from "@/server/services/reporting";
import { loadInvoiceDoc } from "@/components/staff/invoices/load-invoice";
import { groupStatementDoc } from "@/components/staff/invoices/group-statement";
import { getLedger } from "@/server/services/finance";
import { businessDateOf } from "@/lib/time/business-date";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const ARR = "2026-11-10", DEP = "2026-11-13";
const NOW = eat("2026-11-01T10:00:00");

describe("group invoice with room-by-room folios", () => {
  it("2 rooms × 3 nights with food & bar → one invoice, a folio per room, categories kept, paid in parts", async () => {
    const mgr = await managerActor();
    const c = await db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", contactPerson: "Asha", paymentTermDays: 30 } });
    const [st, dd] = await Promise.all([roomType("STANDARD"), roomType("DOUBLE_DELUXE")]);
    const g = await createGroupBooking({
      name: "ABC Staff Trip", type: "COMPANY", corporateCustomerId: c.id, contact: { fullName: "Asha Leader", phone: "0713000009" },
      sourceCode: "CORPORATE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
      rooms: [
        { roomTypeId: st.id, guest: { fullName: "John" }, adults: 1, children: 0 },
        { roomTypeId: dd.id, guest: { fullName: "Peter" }, adults: 1, children: 0 },
      ],
    }, mgr, NOW);
    await checkInGroup(g.id, mgr, null, eat("2026-11-10T15:00:00"));
    const [john, peter] = (await getGroup(g.id))!.rooms;
    for (const amount of [30_000, 30_000, 30_000]) await addReservationCharge({ reservationId: john.id, description: "Lunch", amount, category: "RESTAURANT" }, mgr);
    await addReservationCharge({ reservationId: john.id, description: "10 × Beer", amount: 40_000, category: "BAR" }, mgr);
    await addReservationCharge({ reservationId: peter.id, description: "Meals", amount: 75_000, category: "RESTAURANT" }, mgr);
    await addReservationCharge({ reservationId: peter.id, description: "Drinks", amount: 50_000, category: "BAR" }, mgr);
    await checkOutGroup(g.id, mgr, [john.id, peter.id], {}, eat("2026-11-13T10:00:00"));
    await finalizeGroup(g.id, mgr);

    const view = (await getGroup(g.id))!;
    expect(view.invoices).toHaveLength(1);
    const inv = view.invoices[0];
    expect(inv).toMatchObject({ status: "ISSUED", net: 675_000 });

    // The invoice keeps every line on its room and department.
    const { doc } = (await loadInvoiceDoc({ id: inv.id }))!;
    const room = (res: string) => doc.items.filter((i) => i.reservationId === res);
    const sum = (xs: { netAmount: number }[]) => xs.reduce((t, i) => t + i.netAmount, 0);
    expect(sum(room(john.id))).toBe(310_000);
    expect(sum(room(peter.id))).toBe(365_000);
    expect(room(john.id).find((i) => i.dept === "ROOM")).toMatchObject({ quantity: 3, unitAmount: 60_000, netAmount: 180_000 });
    expect(sum(room(john.id).filter((i) => i.dept === "RESTAURANT"))).toBe(90_000);
    expect(sum(room(john.id).filter((i) => i.dept === "BAR"))).toBe(40_000);
    expect(room(peter.id).find((i) => i.dept === "ROOM")).toMatchObject({ quantity: 3, unitAmount: 80_000, netAmount: 240_000 });
    expect(doc.stays?.[john.id]).toMatchObject({ arrival: ARR, departure: DEP });
    expect(doc.group).toMatchObject({ name: "ABC Staff Trip", rooms: 2, final: true });
    // Addressed to the company, with the group's contact person — not to a guest.
    expect(doc.billTo).toMatchObject({ name: "ABC Company Ltd", person: { name: "Asha Leader" } });
    expect(doc.byKind).toEqual(expect.arrayContaining([
      { label: "Accommodation", amount: 420_000 }, { label: "Restaurant / food", amount: 165_000 }, { label: "Bar", amount: 90_000 },
    ]));

    // Paid in parts: 500k, then the rest in two payments — each recorded once, on the invoice.
    await recordGroupPayment(g.id, { amount: 500_000, accountId: "acct_cash" }, mgr);
    expect((await getGroup(g.id))!.invoices[0]).toMatchObject({ status: "PARTIALLY_PAID", paid: 500_000, balance: 175_000 });
    await recordGroupPayment(g.id, { amount: 100_000, accountId: "acct_cash" }, mgr);
    await recordGroupPayment(g.id, { amount: 75_000, accountId: "acct_cash" }, mgr);
    const done = (await getGroup(g.id))!;
    expect(done.invoices[0]).toMatchObject({ status: "PAID", balance: 0 });
    expect(done.totals).toMatchObject({ total: 675_000, paid: 675_000, outstanding: 0 });
    expect(await db.payment.count({ where: { invoiceId: inv.id } })).toBe(3);

    // The ledger keeps where the money came from: room nights as room revenue, food and drinks by department.
    expect((await revenue({ from: ARR, to: DEP })).rooms.net).toBe(420_000);
    const charges = await db.reservationCharge.groupBy({ by: ["kind"], where: { reservationId: { in: [john.id, peter.id] } }, _sum: { amount: true } });
    expect(Object.fromEntries(charges.map((x) => [x.kind, x._sum.amount]))).toEqual({ RESTAURANT: 165_000, BAR: 90_000 });
  });

  it("edit: set the company or change the leader — blocked once the group has an invoice", async () => {
    const mgr = await managerActor();
    const [dd, tw] = await Promise.all([roomType("DOUBLE_DELUXE"), roomType("TWIN")]);
    const g = await createGroupBooking({
      name: "Chuwa family", type: "FAMILY", contact: { fullName: "Nino Chuwa", phone: "0714000002" },
      sourceCode: "PHONE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
      rooms: [
        { roomTypeId: dd.id, guest: { fullName: "Nino Chuwa", phone: "0714000002" }, adults: 1, children: 0 },
        { roomTypeId: tw.id, guest: { fullName: "Baraka Chuwa" }, adults: 1, children: 0 },
      ],
    }, mgr, NOW);
    const before = (await getGroup(g.id))!;
    // A new leader from the members: they now get the invoice.
    await updateGroup(g.id, { contact: { id: before.rooms[1].guest.id, fullName: "Baraka Chuwa" } }, mgr);
    expect((await getGroup(g.id))!).toMatchObject({ payer: "Chuwa family", contact: { fullName: "Baraka Chuwa" } });
    // A company takes over the bill: the group's rooms follow.
    const c = await db.corporateCustomer.create({ data: { companyName: "Chuwa Traders" } });
    await updateGroup(g.id, { corporateCustomerId: c.id }, mgr);
    const after = (await getGroup(g.id))!;
    expect(after.payer).toBe("Chuwa Traders");
    expect(await db.reservation.count({ where: { groupId: g.id, corporateCustomerId: c.id } })).toBe(2);
    // Once invoiced, who pays cannot change without voiding first.
    await invoiceGroupRooms(g.id, after.rooms.map((r) => r.id), "COMBINED", mgr);
    await expect(updateGroup(g.id, { corporateCustomerId: null }, mgr)).rejects.toThrow(/Void/);
  });

  it("a guest booked on a company becomes one of its people", async () => {
    const mgr = await managerActor();
    const c = await db.corporateCustomer.create({ data: { companyName: "Staff Co" } });
    const st = await roomType("STANDARD");
    const r = await createReservation({
      sourceCode: "CORPORATE", guest: { fullName: "New Employee", phone: "0715123456" }, corporateCustomerId: c.id, billing: { billTo: "COMPANY" },
      stay: { kind: "overnight", arrivalDate: ARR, departureDate: DEP }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }],
    }, mgr, NOW);
    const g = await db.guest.findUniqueOrThrow({ where: { id: r.guestId } });
    expect(g.corporateCustomerId).toBe(c.id);
  });

  it("finalize: only after everyone has left; late charges land on the final invoice; statement before that records nothing", async () => {
    const mgr = await managerActor();
    const [st, dd] = await Promise.all([roomType("STANDARD"), roomType("DOUBLE_DELUXE")]);
    const g = await createGroupBooking({
      name: "PORT TANZANIA LTD", type: "GOVERNMENT", contact: { fullName: "John Michael", phone: "0713000123", email: "john@port.test" },
      profile: { address: "Dar es Salaam, Tanzania", taxId: "123-456-789", registrationNo: "REG-42", billingEmail: "Accounts@Port.test", billingNotes: "LPO required" },
      sourceCode: "PHONE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
      rooms: [
        { roomTypeId: st.id, guest: { fullName: "Peter" }, adults: 1, children: 0 },
        { roomTypeId: dd.id, guest: { fullName: "Sarah" }, adults: 1, children: 0 },
      ],
    }, mgr, NOW);
    await checkInGroup(g.id, mgr, null, eat("2026-11-10T15:00:00"));
    const [peter, sarah] = (await getGroup(g.id))!.rooms;
    await addReservationCharge({ reservationId: peter.id, description: "Dinner", amount: 30_000, category: "RESTAURANT" }, mgr);

    // Mid-stay statement: every room's charges so far — nothing billed or created by it.
    const invoicesBefore = await db.invoice.count();
    const stm = (await groupStatementDoc(g.id, "2026-11-11"))!.doc;
    expect(stm).toMatchObject({ net: 180_000 + 240_000 + 30_000, paid: 0, billTo: { name: "PORT TANZANIA LTD", person: { name: "John Michael" } } });
    expect(await db.invoice.count()).toBe(invoicesBefore);

    // Peter leaves; Sarah is still in the hotel: too early to finalize.
    await checkOutGroup(g.id, mgr, [peter.id], {}, eat("2026-11-13T10:00:00"));
    expect((await getGroup(g.id))!.readyToFinalize).toBe(false);
    await expect(finalizeGroup(g.id, mgr)).rejects.toThrow(/not checked out yet/);

    // Sarah orders a drink before leaving; after both leave, a late minibar charge is found on Peter's room.
    await addReservationCharge({ reservationId: sarah.id, description: "Soda", amount: 5_000, category: "BAR" }, mgr);
    await checkOutGroup(g.id, mgr, [sarah.id], {}, eat("2026-11-13T11:00:00"));
    await addReservationCharge({ reservationId: peter.id, description: "Minibar (found at cleaning)", amount: 8_000, category: "OTHER" }, mgr);
    expect((await getGroup(g.id))!.readyToFinalize).toBe(true);

    const fin = await finalizeGroup(g.id, mgr);
    expect(fin.finalInvoice?.amount).toBe(180_000 + 240_000 + 30_000 + 5_000 + 8_000);
    const view = (await getGroup(g.id))!;
    expect(view.invoices.filter((i) => i.status !== "CANCELLED")).toHaveLength(1);
    expect(view).toMatchObject({ status: "COMPLETED", finalInvoiceId: fin.finalInvoice!.id, totals: { toInvoice: 0, outstanding: 463_000 } });
    expect(view.finalizedAt).not.toBeNull();
    await expect(finalizeGroup(g.id, mgr)).rejects.toThrow(/already final/);

    // The final invoice is made out to the group with its billing profile and contact person.
    const { doc } = (await loadInvoiceDoc({ id: fin.finalInvoice!.id }))!;
    expect(doc.group).toMatchObject({ name: "PORT TANZANIA LTD", rooms: 2, final: true });
    expect(doc.billTo).toMatchObject({
      name: "PORT TANZANIA LTD", lines: ["Dar es Salaam, Tanzania"], tax: "TIN 123-456-789  ·  Reg. No. REG-42",
      contact: "accounts@port.test", note: "LPO required", person: { name: "John Michael", email: "john@port.test" },
    });

    // Paid later in two parts; the ledger names the invoice and the payer, and adds no income.
    await recordGroupPayment(g.id, { amount: 400_000, accountId: "acct_cash", reference: "CRDB-1" }, mgr);
    await recordGroupPayment(g.id, { amount: 63_000, accountId: "acct_cash" }, mgr);
    expect((await getGroup(g.id))!.invoices[0]).toMatchObject({ status: "PAID", balance: 0 });
    const today = businessDateOf(new Date());
    const rows = (await getLedger({ from: today, to: today })).rows.filter((r) => r.source === "PAYMENT");
    expect(rows.map((r) => r.description)).toEqual(expect.arrayContaining([`Payment for invoice ${fin.finalInvoice!.number} — PORT TANZANIA LTD`]));
    expect(rows.every((r) => r.income === 0)).toBe(true);
  });
});
