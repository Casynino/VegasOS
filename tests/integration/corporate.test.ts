import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, checkOut, createReservation, previewCheckOut, type CreateReservationInput } from "@/server/services/reservations";
import { addReservationCharge } from "@/server/services/payments";
import { issueInvoice, recordInvoicePayment, voidInvoice } from "@/server/services/invoices";
import { changeBilling, companyAccount, companyStatement, receivablesBoard, recordCompanyPayment } from "@/server/services/company-billing";
import { getLedger } from "@/server/services/finance";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

const BOOKED = eat("2026-10-05T10:00:00");
const ARRIVE = eat("2026-10-10T15:00:00");
const LEAVE = eat("2026-10-12T10:00:00");
const WIDE = { from: "2026-01-01", to: "2027-12-31" };

async function company(data: Partial<{ creditLimit: number; consolidateInvoices: boolean; paymentTermDays: number }> = {}) {
  return db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", paymentTermDays: 30, ...data } });
}

async function stay(companyId: string | null, billing: CreateReservationInput["billing"], name = "John Michael", extra: Partial<CreateReservationInput> = {}) {
  const dd = await roomType("DOUBLE_DELUXE");
  const r = await createReservation({
    sourceCode: "CORPORATE", guest: { fullName: name }, corporateCustomerId: companyId, billing,
    stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" },
    rooms: [{ roomTypeId: dd.id, adults: 1, children: 0, discountPerNight: 0 }], ...extra,
  }, await receptionistActor(), BOOKED);
  await checkIn(r.id, await receptionistActor(), null, ARRIVE);
  return r;
}

describe("corporate customers & invoices", () => {
  it("company pays everything: check out & issue invoice — no money from the guest, income counted once", async () => {
    const c = await company();
    const r = await stay(c.id, { billTo: "COMPANY" });
    await addReservationCharge({ reservationId: r.id, description: "Dinner", amount: 35_000, category: "RESTAURANT" }, await receptionistActor());

    const preview = await previewCheckOut(r.id, {}, LEAVE);
    expect(preview.company?.billedNow).toBe(195_000);
    expect(preview.balance).toBe(0);

    const out = await checkOut(r.id, await receptionistActor(), {}, LEAVE);
    expect(out.invoice?.number).toMatch(/^INV-2026-\d{6}$/);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: out.invoice!.id }, include: { items: true } });
    expect(inv.status).toBe("ISSUED");
    expect(inv.netAmount).toBe(195_000);
    expect(inv.items.every((i) => i.reservationId === r.id && i.guestName === "John Michael")).toBe(true);
    expect(inv.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-11"); // 12 Oct + 30 days
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.balanceAmount).toBe(0);
    expect(after.companyBilledAmount).toBe(195_000);

    // The company pays in two parts; income never goes up again.
    const bank = await db.paymentMethod.findUniqueOrThrow({ where: { code: "BANK" } });
    await recordCompanyPayment({ companyId: c.id, amount: 100_000, methodId: bank.id, reference: "BANK-1" }, await managerActor());
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PARTIALLY_PAID");
    await recordCompanyPayment({ companyId: c.id, amount: 95_000, methodId: bank.id, reference: "BANK-2" }, await managerActor());
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await expect(recordCompanyPayment({ companyId: c.id, amount: 1, methodId: bank.id }, await managerActor())).rejects.toThrow(/no unpaid/);

    const { totals } = await getLedger(WIDE);
    expect(totals.income).toBe(195_000);
    expect(totals.moneyIn).toBe(195_000);
  });

  it("split: the company pays the room, the guest pays their own drinks at checkout", async () => {
    const c = await company();
    const r = await stay(c.id, { billTo: "SPLIT", covers: ["ROOM"] });
    await addReservationCharge({ reservationId: r.id, description: "Beers", amount: 12_000, category: "BAR" }, await receptionistActor());
    const preview = await previewCheckOut(r.id, {}, LEAVE);
    expect(preview.company?.billedNow).toBe(160_000);
    expect(preview.balance).toBe(12_000);
    await expect(checkOut(r.id, await receptionistActor(), {}, LEAVE)).rejects.toThrow(/still owes TZS 12,000/);
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    const out = await checkOut(r.id, await receptionistActor(), { payment: { amount: 12_000, methodId: cash.id } }, LEAVE);
    expect(out.invoice?.amount).toBe(160_000);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(0);
  });

  it("consolidated: several stays go on one open invoice, then it is issued; the statement adds up", async () => {
    const c = await company({ consolidateInvoices: true });
    const a = await stay(c.id, { billTo: "COMPANY" }, "Mary");
    const b = await stay(c.id, { billTo: "COMPANY" }, "Peter");
    const x = await checkOut(a.id, await receptionistActor(), {}, LEAVE);
    const y = await checkOut(b.id, await receptionistActor(), {}, LEAVE);
    expect(x.invoice?.id).toBe(y.invoice?.id);
    expect(x.invoice?.issued).toBe(false);
    const draft = await db.invoice.findUniqueOrThrow({ where: { id: x.invoice!.id }, include: { items: true } });
    expect(draft.status).toBe("DRAFT");
    expect(new Set(draft.items.map((i) => i.guestName))).toEqual(new Set(["Mary", "Peter"]));
    expect(draft.netAmount).toBe(320_000);

    await issueInvoice(draft.id, await managerActor());
    const board = await receivablesBoard("2026-10-12");
    expect(board.total).toBe(320_000);
    expect(board.companies[0]).toMatchObject({ name: "ABC Company Ltd", balance: 320_000 });
    const st = await companyStatement(c.id, "2026-01-01", "2027-12-31");
    expect(st.opening).toBe(0);
    expect(st.closing).toBe(320_000);
  });

  it("credit limit: over the limit needs a manager's approval with a reason", async () => {
    const c = await company({ creditLimit: 100_000 });
    const dd = await roomType("DOUBLE_DELUXE");
    const base: CreateReservationInput = {
      sourceCode: "CORPORATE", guest: { fullName: "Sarah" }, corporateCustomerId: c.id, billing: { billTo: "COMPANY" },
      stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" },
      rooms: [{ roomTypeId: dd.id, adults: 1, children: 0, discountPerNight: 0 }],
    };
    await expect(createReservation(base, await receptionistActor(), BOOKED)).rejects.toThrow(/available credit/);
    await expect(createReservation({ ...base, creditOverride: { reason: "Boss agreed" } }, await receptionistActor(), BOOKED)).rejects.toThrow(/Only a manager/);
    const ok = await createReservation({ ...base, creditOverride: { reason: "Boss agreed" } }, await managerActor(), BOOKED);
    expect(ok.billTo).toBe("COMPANY");
    const acct = await companyAccount(c.id, "2026-10-05");
    expect(acct?.available).toBe(100_000 - 160_000);
  });

  it("void gives the lines back to the stay; changing to guest-pays works before billing", async () => {
    const c = await company();
    const r = await stay(c.id, { billTo: "COMPANY" });
    const out = await checkOut(r.id, await receptionistActor(), {}, LEAVE);
    await expect(voidInvoice(out.invoice!.id, "", await managerActor())).rejects.toThrow(/reason/);
    await voidInvoice(out.invoice!.id, "Wrong company", await managerActor());
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(160_000);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: out.invoice!.id } })).status).toBe("VOID");

    const other = await stay(c.id, { billTo: "COMPANY" }, "Guest Two");
    await changeBilling(other.id, { corporateCustomerId: null, billTo: "GUEST", covers: [], paymentTermDays: null }, await managerActor());
    const p = await previewCheckOut(other.id, {}, LEAVE);
    expect(p.company).toBeNull();
    expect(p.balance).toBe(160_000);
  });

  it("invoice paid later into CRDB, with the date it arrived; the ledger shows it as owed, never as income twice", async () => {
    const c = await company();
    const r = await stay(c.id, { billTo: "COMPANY" });
    const out = await checkOut(r.id, await receptionistActor(), {}, LEAVE);
    const inv = out.invoice!;
    const before = await getLedger(WIDE);
    const owedLine = before.rows.find((x) => x.source === "INVOICE")!;
    expect(owedLine).toMatchObject({ category: "Receivable", income: 0, moneyIn: 0, reference: inv.number });
    const incomeBefore = before.totals.income;

    const crdb = await db.moneyAccount.findUniqueOrThrow({ where: { code: "BANK" } });
    await expect(recordInvoicePayment({ invoiceId: inv.id, amount: 1_000, accountId: crdb.id, receivedOn: "2099-01-01" }, await managerActor())).rejects.toThrow(/future/);
    await recordInvoicePayment({ invoiceId: inv.id, amount: 160_000, accountId: crdb.id, reference: "ABC-90881", notes: "Paid by transfer", receivedOn: "2026-09-20" }, await managerActor());
    const p = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(p).toMatchObject({ accountId: crdb.id, amount: 160_000, reference: "ABC-90881", notes: "Paid by transfer" });
    expect(p.businessDate.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect((await getLedger(WIDE)).totals.income).toBe(incomeBefore); // the payment settles the debt — not new income
  });
});

