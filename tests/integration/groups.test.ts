import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addOccupant, addRoomToGroup, checkInGroup, checkOutGroup, createGroupBooking, finalizeGroup, getGroup, invoiceGroupRooms, recordGroupPayment, removeOccupant } from "@/server/services/groups";
import { addReservationCharge } from "@/server/services/payments";
import { revenue } from "@/server/services/reporting";
import { businessDateOf } from "@/lib/time/business-date";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const ARR = "2026-11-10", DEP = "2026-11-12";
const NOW = eat("2026-11-01T10:00:00");
const IN = eat("2026-11-10T15:00:00");
const OUT = eat("2026-11-12T10:00:00");

async function company() {
  return db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", paymentTermDays: 30 } });
}

async function abcGroup(opts: { ownBillLast?: boolean } = {}) {
  const c = await company();
  const [st, dd, ex] = await Promise.all([roomType("STANDARD"), roomType("DOUBLE_DELUXE"), roomType("EXECUTIVE")]);
  const g = await createGroupBooking({
    name: "ABC Company", type: "COMPANY", corporateCustomerId: c.id, contact: { fullName: "Asha Director", phone: "0713000001" },
    sourceCode: "CORPORATE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
    rooms: [
      { roomTypeId: ex.id, guest: { fullName: "Asha Director", phone: "0713000001" }, adults: 1, children: 0 },
      { roomTypeId: dd.id, guest: { fullName: "Peter Employee" }, adults: 1, children: 0 },
      { roomTypeId: st.id, guest: { fullName: "Sarah Employee" }, adults: 1, children: 0, ownBill: !!opts.ownBillLast },
    ],
  }, await managerActor(), NOW);
  return { g, c };
}

describe("group bookings", () => {
  it("one group, separate reservations: own guest, own room, own price; the group pays", async () => {
    const { g, c } = await abcGroup();
    const view = (await getGroup(g.id))!;
    expect(view).toMatchObject({ name: "ABC Company", payer: "ABC Company Ltd", company: { id: c.id } });
    expect(view.rooms).toHaveLength(3);
    expect(view.rooms.map((r) => r.guest.fullName)).toEqual(["Asha Director", "Peter Employee", "Sarah Employee"]);
    // Different prices, each worked out by the pricing engine: 100k, 80k, 60k a night × 2.
    expect(view.rooms.map((r) => r.total)).toEqual([200_000, 160_000, 120_000]);
    expect(new Set(view.rooms.map((r) => r.reference)).size).toBe(3);
    expect(view.rooms.every((r) => r.billTo === "GROUP" && r.status === "CONFIRMED")).toBe(true);
    expect(view.totals).toMatchObject({ rooms: 3, guests: 3, total: 480_000, toInvoice: 480_000, outstanding: 480_000 });
  });

  it("rooms check in and out on their own; the group invoice collects them; revenue is counted once", async () => {
    const mgr = await managerActor();
    const { g } = await abcGroup();
    const res = await checkInGroup(g.id, mgr, null, IN);
    expect(res.every((x) => x.ok)).toBe(true);
    let view = (await getGroup(g.id))!;
    const [director, peter, sarah] = view.rooms;
    await addReservationCharge({ reservationId: peter.id, description: "Dinner", amount: 30_000, category: "RESTAURANT" }, mgr);

    // Peter leaves first: his bill (room + dinner) goes to the group's open invoice; he owes nothing.
    const one = await checkOutGroup(g.id, mgr, [peter.id], {}, OUT);
    expect(one[0]).toMatchObject({ ok: true });
    view = (await getGroup(g.id))!;
    expect(view.rooms.find((r) => r.id === peter.id)).toMatchObject({ status: "CHECKED_OUT", balance: 0, billed: 190_000 });
    expect(view.rooms.find((r) => r.id === director.id)?.status).toBe("CHECKED_IN");
    expect(view.invoices).toHaveLength(1);
    expect(view.invoices[0]).toMatchObject({ status: "DRAFT", net: 190_000 });

    // The others leave: the same running bill gets their lines — still open until the group is finalized.
    await checkOutGroup(g.id, mgr, [director.id, sarah.id], {}, OUT);
    view = (await getGroup(g.id))!;
    expect(view.invoices).toHaveLength(1);
    expect(view.invoices[0]).toMatchObject({ status: "DRAFT", net: 510_000 });
    expect(view).toMatchObject({ stay: "COMPLETED", readyToFinalize: true });
    // Finalize: the running bill becomes the final group invoice.
    const fin = await finalizeGroup(g.id, mgr);
    expect(fin.finalInvoice).toMatchObject({ amount: 510_000 });
    view = (await getGroup(g.id))!;
    expect(view.invoices[0]).toMatchObject({ status: "ISSUED", net: 510_000 });
    expect(view).toMatchObject({ finalInvoiceId: view.invoices[0].id, readyToFinalize: false });
    const items = await db.invoiceItem.findMany({ where: { invoiceId: view.invoices[0].id } });
    expect(new Set(items.map((i) => i.roomNumber)).size).toBe(3);
    expect(items.find((i) => i.description === "Dinner")?.guestName).toBe("Peter Employee");
    expect(view.totals).toMatchObject({ toInvoice: 0, invoicedUnpaid: 510_000, outstanding: 510_000, checkedOut: 3 });

    // One payment settles part of the group — recorded once, on the invoice.
    await recordGroupPayment(g.id, { amount: 300_000, accountId: "acct_cash" }, mgr);
    view = (await getGroup(g.id))!;
    expect(view.invoices[0]).toMatchObject({ status: "PARTIALLY_PAID", paid: 300_000, balance: 210_000 });
    expect(view.totals).toMatchObject({ paid: 300_000, outstanding: 210_000 });
    expect(await db.payment.count()).toBe(1);

    // Income = the nights and the dinner, once — the invoice and payment add nothing.
    const rev = await revenue({ from: ARR, to: DEP });
    expect(rev.rooms.net).toBe(480_000);
    const today = businessDateOf(new Date());
    expect((await revenue({ from: today, to: today })).restaurant).toBe(30_000);
  });

  it("a room paying its own bill cannot leave owing, unless a manager accepts it", async () => {
    const mgr = await managerActor();
    const { g } = await abcGroup({ ownBillLast: true });
    await checkInGroup(g.id, mgr, null, IN);
    const sarah = (await getGroup(g.id))!.rooms[2];
    expect(sarah.billTo).toBe("GUEST");
    const blocked = await checkOutGroup(g.id, mgr, [sarah.id], {}, OUT);
    expect(blocked[0].ok).toBe(false);
    expect(blocked[0].message).toMatch(/owes/);
    const forced = await checkOutGroup(g.id, mgr, [sarah.id], { allowBalance: true, overrideReason: "Pays next week" }, OUT);
    expect(forced[0].ok).toBe(true);
    const view = (await getGroup(g.id))!;
    expect(view.totals.ownRoomsOwe).toBe(120_000);
  });

  it("invoices chosen rooms: separate (one per room) or combined (ticked rooms together)", async () => {
    const mgr = await managerActor();
    const { g } = await abcGroup();
    const [a, b, c] = (await getGroup(g.id))!.rooms;
    const sep = await invoiceGroupRooms(g.id, [a.id], "SEPARATE", mgr);
    expect(sep).toHaveLength(1);
    const comb = await invoiceGroupRooms(g.id, [b.id, c.id], "COMBINED", mgr);
    expect(comb).toHaveLength(1);
    expect(comb[0].amount).toBe(280_000);
    await expect(invoiceGroupRooms(g.id, [b.id], "COMBINED", mgr)).rejects.toThrow(/already invoiced/);
    const view = (await getGroup(g.id))!;
    expect(view.invoices.map((i) => i.status)).toEqual(["ISSUED", "ISSUED"]);
    expect(view.totals).toMatchObject({ toInvoice: 0, invoicedUnpaid: 480_000 });
  });

  it("a family without a company: parents in one room, children in another; the contact pays", async () => {
    const mgr = await managerActor();
    const [dd, tw] = await Promise.all([roomType("DOUBLE_DELUXE"), roomType("TWIN")]);
    const g = await createGroupBooking({
      name: "Chuwa family", type: "FAMILY", contact: { fullName: "Nino Chuwa", phone: "0714000002" },
      sourceCode: "PHONE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
      rooms: [
        { roomTypeId: dd.id, guest: { fullName: "Nino Chuwa", phone: "0714000002" }, occupants: [{ fullName: "Mama Chuwa" }], adults: 2, children: 0 },
        // The child's booking uses the parent's phone — they stay two different people.
        { roomTypeId: tw.id, guest: { fullName: "Baraka Chuwa", phone: "0714000002" }, occupants: [{ fullName: "Neema Chuwa" }], adults: 1, children: 1 },
      ],
    }, mgr, NOW);
    const view = (await getGroup(g.id))!;
    // No company: the invoice is made out to the group, with Nino as the contact person.
    expect(view.payer).toBe("Chuwa family");
    expect(view.contact.fullName).toBe("Nino Chuwa");
    expect(view.rooms.map((r) => r.guest.fullName)).toEqual(["Nino Chuwa", "Baraka Chuwa"]);
    expect(view.rooms[0].occupants.map((o) => o.fullName)).toEqual(["Mama Chuwa"]);
    expect(view.totals.guests).toBe(4);
    await checkInGroup(g.id, mgr, null, IN);
    await checkOutGroup(g.id, mgr, view.rooms.map((r) => r.id), {}, OUT);
    await finalizeGroup(g.id, mgr);
    const inv = await db.invoice.findFirstOrThrow({ where: { groupId: g.id } });
    expect(inv).toMatchObject({ status: "ISSUED", corporateCustomerId: null, guestId: view.contact.id, netAmount: 480_000 });

    // Occupants can be added and removed; the main guest cannot.
    await addOccupant(view.rooms[1].id, { fullName: "Grace Chuwa" }, mgr);
    const guest = await db.guest.findFirstOrThrow({ where: { fullName: "Grace Chuwa" } });
    await removeOccupant(view.rooms[1].id, guest.id, mgr);
    await expect(removeOccupant(view.rooms[1].id, view.rooms[1].guest.id, mgr)).rejects.toThrow(/main guest/);
  });

  it("adding a room re-checks availability; a full type is refused and nothing half-books", async () => {
    const mgr = await managerActor();
    const { g } = await abcGroup();
    const tw = await roomType("TWIN");
    await addRoomToGroup(g.id, { roomTypeId: tw.id, guest: { fullName: "James" }, adults: 1, children: 0 }, mgr, NOW);
    // Only one Twin room exists: a second one for the same dates is refused.
    await expect(addRoomToGroup(g.id, { roomTypeId: tw.id, guest: { fullName: "Anna" }, adults: 1, children: 0 }, mgr, NOW)).rejects.toThrow(/fully booked/);
    const st = await roomType("STANDARD");
    // A whole group asking for 3 Standard rooms (only 2 exist, one already taken) books nothing.
    await expect(createGroupBooking({
      name: "Too big", type: "OTHER", contact: { fullName: "X" }, sourceCode: "PHONE", billing: "COMBINED", arrivalDate: ARR, departureDate: DEP,
      rooms: [0, 1].map(() => ({ roomTypeId: st.id, adults: 1, children: 0 })),
    }, mgr, NOW)).rejects.toThrow(/fully booked/);
    expect(await db.bookingGroup.count({ where: { name: "Too big" } })).toBe(0);
    expect((await getGroup(g.id))!.totals.rooms).toBe(4);
  });
});
