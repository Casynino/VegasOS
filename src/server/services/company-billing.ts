import "server-only";
import { timeRange } from "@/lib/meeting";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { resolveAccountTx } from "./payment-accounts";
import { getSettingsTx, stayConfig } from "../settings";
import { addDays, businessDateOf, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { chargeGroup, companyPays, type BillTo } from "@/lib/billing";
import { getT } from "@/i18n/server";
import { msg, msgf } from "@/i18n/msg";
import { nextInvoiceNumber, syncInvoice } from "./invoices";
import { recalculateReservation } from "./reservation-financials";
import type { Actor } from "./reservations";

/**
 * Company billing ("city ledger").
 *
 * A stay paid by a company keeps its own folio. When the company's part is
 * billed (at checkout, or on demand) those lines are MOVED onto a company
 * invoice: each invoice line remembers the stay, guest, room and dates it came
 * from, and the stay's guest balance drops by the same amount. The company then
 * owes the invoice; its payments are recorded on the invoice.
 *
 * Income is still counted once, from the nights and charges themselves — an
 * invoice or a company payment never adds income again.
 *
 * Group bookings use the same mechanism: a room billed to its group (billTo
 * GROUP) moves its bill onto the group's invoice — one combined invoice for the
 * group, or one per room — made out to the group's company, or to its contact
 * person when there is no company. Every line keeps its room and guest.
 */

const LIVE_ROOM = ["RESERVED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
const OPEN_INVOICE = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;
const COMPANY_INVOICE = { reservationId: null, status: { notIn: ["CANCELLED" as const, "VOID" as const] } };

export type InvoiceMode = "ISSUE" | "OPEN";

interface Line {
  sourceType: "RESERVATION_ROOM" | "CHARGE";
  sourceId: string;
  kind: "ROOM" | "CHARGE";
  description: string;
  quantity: number;
  unitAmount: number;
  gross: number;
  discount: number;
  net: number;
  room: string | null;
  from: Date | null;
  to: Date | null;
}

/** What the company should be billed for this stay right now, minus what it has already been billed. */
async function unbilledLines(tx: Tx, reservationId: string, opts: { includeInHouse: boolean }) {
  const r = await tx.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: { guest: true, corporateCustomer: true, group: { include: { contactGuest: true, corporateCustomer: true } }, rooms: { include: { room: true, roomType: true } }, charges: true },
  });
  const billTo = r.billTo as BillTo;
  const payer = billTo === "GROUP" ? !!r.group : !!r.corporateCustomer;
  if (!payer || billTo === "GUEST") return { r, lines: [] as Line[] };

  const wanted: Line[] = [];
  for (const rr of r.rooms) {
    if (rr.status === "CHECKED_IN" && !opts.includeInHouse) continue; // still staying: billed when they leave
    const billable = LIVE_ROOM.includes(rr.status) && companyPays(billTo, r.companyCovers, "ROOM");
    const units = rr.isDayUse ? 1 : rr.nights;
    wanted.push({
      sourceType: "RESERVATION_ROOM", sourceId: rr.id, kind: "ROOM",
      description: rr.roomType.category === "MEETING_ROOM" ? `${rr.roomType.name} · ${timeRange(rr.startAt, rr.endAt)}` : `${rr.roomType.name} · ${rr.isDayUse ? "short time" : `${units} night${units === 1 ? "" : "s"}`}`,
      quantity: units, unitAmount: rr.ratePerNight,
      gross: billable ? rr.grossAmount : 0, discount: billable ? rr.discountAmount : 0, net: billable ? rr.netAmount : 0,
      room: rr.room.number, from: rr.arrivalDate, to: rr.departureDate,
    });
  }
  const oneRoom = r.rooms.length === 1 ? r.rooms[0].room.number : null;
  for (const c of r.charges) {
    const billable = !c.isVoided && companyPays(billTo, r.companyCovers, chargeGroup(c.category));
    wanted.push({
      sourceType: "CHARGE", sourceId: c.id, kind: "CHARGE", description: c.description, quantity: 1, unitAmount: c.amount,
      gross: billable ? c.amount : 0, discount: 0, net: billable ? c.amount : 0, room: oneRoom, from: c.businessDate, to: c.businessDate,
    });
  }

  const done = await tx.invoiceItem.findMany({ where: { reservationId, invoice: COMPANY_INVOICE } });
  const billed = new Map<string, { gross: number; discount: number; net: number }>();
  for (const it of done) {
    const k = it.sourceId ?? "";
    const a = billed.get(k) ?? { gross: 0, discount: 0, net: 0 };
    billed.set(k, { gross: a.gross + it.grossAmount, discount: a.discount + it.discountAmount, net: a.net + it.netAmount });
  }
  const lines: Line[] = [];
  for (const w of wanted) {
    const was = billed.get(w.sourceId);
    if (!was) { if (w.net !== 0) lines.push(w); continue; }
    const dNet = w.net - was.net;
    if (dNet === 0) continue;
    // Already billed before and changed since (extension, early departure, voided charge): bill only the difference.
    lines.push({
      ...w, description: `${dNet < 0 ? "Credit" : "Adjustment"}: ${w.description}`, quantity: 1,
      unitAmount: w.gross - was.gross, gross: w.gross - was.gross, discount: w.discount - was.discount, net: dNet,
    });
  }
  return { r, lines };
}

/** What would be moved to the company right now (for previews). */
export async function unbilledCompanyAmount(tx: Tx, reservationId: string, includeInHouse = false) {
  const { lines } = await unbilledLines(tx, reservationId, { includeInHouse });
  return lines.reduce((s, l) => s + l.net, 0);
}

function dueFrom(today: BusinessDate, days: number) {
  return addDays(today, Math.max(0, days));
}

/**
 * Move the company's part of a stay onto a company invoice.
 * - "ISSUE": a new invoice, issued now with the due date from the payment terms.
 * - "OPEN": added to the company's open (draft) invoice, to be sent later — one invoice for many stays.
 * Returns the invoice, or null when there was nothing for the company to pay.
 */
export async function billCompanyTx(
  tx: Tx, reservationId: string, actor: Actor,
  opts: { mode?: InvoiceMode | null; includeInHouse?: boolean; now?: Date; /** Group billing: put the lines on this invoice. */ invoiceId?: string | null } = {},
) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  const { r, lines } = await unbilledLines(tx, reservationId, { includeInHouse: !!opts.includeInHouse });
  if (r.billTo === "GROUP" && r.group) return lines.length ? billToGroupTx(tx, r, lines, actor, opts) : null;
  const company = r.corporateCustomer;
  if (!company || lines.length === 0) return null;

  const settings = await getSettingsTx(tx);
  const today = businessDateOf(opts.now ?? new Date(), stayConfig(settings));
  const mode: InvoiceMode = opts.mode ?? (company.consolidateInvoices ? "OPEN" : "ISSUE");
  const terms = r.paymentTermDays ?? company.paymentTermDays;

  let invoice = mode === "OPEN"
    ? await tx.invoice.findFirst({ where: { corporateCustomerId: company.id, reservationId: null, status: "DRAFT" }, orderBy: { createdAt: "asc" } })
    : null;
  if (!invoice) {
    invoice = await tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx, today), corporateCustomerId: company.id, createdById: actor.userId,
        status: "DRAFT", paymentTermDays: terms,
      },
    });
  }
  const start = await tx.invoiceItem.count({ where: { invoiceId: invoice.id } });
  await tx.invoiceItem.createMany({
    data: lines.map((l, i) => ({
      invoiceId: invoice.id, kind: l.kind, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount,
      grossAmount: l.gross, discountAmount: l.discount, netAmount: l.net, sortOrder: start + i,
      sourceType: l.sourceType, sourceId: l.sourceId, reservationId: r.id, guestName: r.guest.fullName,
      roomNumber: l.room, serviceFrom: l.from, serviceTo: l.to,
    })),
  });
  if (mode === "ISSUE") {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", issueDate: toDbDate(today), dueDate: toDbDate(dueFrom(today, terms)), verifyToken: randomBytes(18).toString("base64url") },
    });
  }
  await syncInvoice(tx, invoice.id);
  await recalculateReservation(tx, r.id);
  // The company pays the whole bill: a deposit already paid on the stay counts on its invoice.
  if (r.billTo === "COMPANY") await applyStayPaymentsTx(tx, r.id, invoice.id);
  const amount = lines.reduce((s, l) => s + l.net, 0);
  await audit(tx, actor, {
    action: "invoice.company_billed", entityType: "Invoice", entityId: invoice.id,
    after: { number: invoice.number, company: company.companyName, reservation: r.reference, guest: r.guest.fullName, amount, lines: lines.length, issued: mode === "ISSUE" },
  });
  return { id: invoice.id, number: invoice.number, amount, issued: mode === "ISSUE" };
}

type Unbilled = Awaited<ReturnType<typeof unbilledLines>>;

/**
 * Money already paid on a stay (a deposit, a prepayment) follows its bill onto
 * the company / group invoice: it shows there as paid and lowers what is owed.
 * The payment keeps its stay, so the trail stays room → guest → invoice → payment.
 */
export async function applyStayPaymentsTx(tx: Tx, reservationId: string, invoiceId: string) {
  const ps = await tx.payment.findMany({ where: { reservationId, invoiceId: null, status: "POSTED" }, select: { id: true, amount: true, kind: true } });
  if (!ps.length) return 0;
  await tx.payment.updateMany({ where: { id: { in: ps.map((p) => p.id) } }, data: { invoiceId } });
  await recalculateReservation(tx, reservationId);
  await syncInvoice(tx, invoiceId);
  return ps.reduce((t, p) => t + (p.kind === "PAYMENT" ? p.amount : -p.amount), 0);
}

/**
 * A group room's bill → the group's invoice. COMBINED groups collect every room
 * on one draft invoice (the group's running bill); it becomes the final group
 * invoice only when staff finalize the group after everyone has left — never by
 * itself, so late charges still land on it. SEPARATE groups get one issued
 * invoice per room. `opts.invoiceId` puts the lines on a chosen group invoice
 * (staff picking rooms to bill together).
 */
async function billToGroupTx(tx: Tx, r: Unbilled["r"], lines: Line[], actor: Actor, opts: { mode?: InvoiceMode | null; now?: Date; invoiceId?: string | null }) {
  const g = r.group!;
  const settings = await getSettingsTx(tx);
  const today = businessDateOf(opts.now ?? new Date(), stayConfig(settings));
  const terms = g.paymentTermDays ?? g.corporateCustomer?.paymentTermDays ?? settings.invoiceDefaultDueDays;
  const mode: InvoiceMode = opts.mode ?? (g.billing === "COMBINED" ? "OPEN" : "ISSUE");

  let invoice = opts.invoiceId
    ? await tx.invoice.findFirst({ where: { id: opts.invoiceId, groupId: g.id, status: { notIn: ["CANCELLED", "VOID"] } } })
    : mode === "OPEN" ? await tx.invoice.findFirst({ where: { groupId: g.id, status: "DRAFT" }, orderBy: { createdAt: "asc" } }) : null;
  if (opts.invoiceId && !invoice) throw new AppError("That group invoice cannot take more rooms.");
  if (!invoice) {
    invoice = await tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx, today), groupId: g.id,
        corporateCustomerId: g.corporateCustomerId, guestId: g.corporateCustomerId ? null : g.contactGuestId,
        createdById: actor.userId!, status: "DRAFT", paymentTermDays: terms,
        notes: `${g.name} — group ${g.reference}`,
      },
    });
  }
  const start = await tx.invoiceItem.count({ where: { invoiceId: invoice.id } });
  await tx.invoiceItem.createMany({
    data: lines.map((l, i) => ({
      invoiceId: invoice.id, kind: l.kind, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount,
      grossAmount: l.gross, discountAmount: l.discount, netAmount: l.net, sortOrder: start + i,
      sourceType: l.sourceType, sourceId: l.sourceId, reservationId: r.id, guestName: r.guest.fullName,
      roomNumber: l.room, serviceFrom: l.from, serviceTo: l.to,
    })),
  });
  // A separate (per-room) invoice is issued now; the combined group bill waits for the group to be finalized.
  const issue = invoice.status === "DRAFT" && mode === "ISSUE";
  if (issue) {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", issueDate: toDbDate(today), dueDate: toDbDate(dueFrom(today, terms)), verifyToken: randomBytes(18).toString("base64url") },
    });
  }
  await syncInvoice(tx, invoice.id);
  await recalculateReservation(tx, r.id);
  const deposit = await applyStayPaymentsTx(tx, r.id, invoice.id);
  const amount = lines.reduce((s, l) => s + l.net, 0);
  await audit(tx, actor, {
    action: "invoice.group_billed", entityType: "Invoice", entityId: invoice.id,
    after: { number: invoice.number, group: g.reference, name: g.name, reservation: r.reference, guest: r.guest.fullName, amount, lines: lines.length, issued: issue || invoice.status !== "DRAFT", ...(deposit && { depositApplied: deposit }) },
  });
  return { id: invoice.id, number: invoice.number, amount, issued: issue || invoice.status !== "DRAFT" };
}

export async function billCompanyNow(reservationId: string, actor: Actor, mode?: InvoiceMode | null) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
    const res = await billCompanyTx(tx, reservationId, actor, { mode, includeInHouse: true });
    if (!res) throw new AppError("There is nothing for the company to pay on this stay yet.");
    return res;
  }, { timeout: 20_000, maxWait: 10_000 });
}

/** Stays that should be billed to a company but have not been fully billed yet (in house or upcoming). */
async function unbilledExposure(companyId: string) {
  const rows = await db.reservation.findMany({
    where: { corporateCustomerId: companyId, billTo: { not: "GUEST" }, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] }, balanceAmount: { gt: 0 } },
    select: { balanceAmount: true },
  });
  return rows.reduce((s, r) => s + r.balanceAmount, 0);
}

/** Everything the hotel needs to know about one company's account. */
export async function companyAccount(companyId: string, today: BusinessDate) {
  const [c, invoices, reservations, paid, unbilled] = await Promise.all([
    db.corporateCustomer.findUnique({ where: { id: companyId } }),
    db.invoice.findMany({ where: { corporateCustomerId: companyId, reservationId: null }, select: { id: true, status: true, netAmount: true, balanceAmount: true, dueDate: true } }),
    db.reservation.count({ where: { corporateCustomerId: companyId, status: { notIn: ["CANCELLED", "INQUIRY"] } } }),
    db.payment.aggregate({ where: { corporateCustomerId: companyId, invoiceId: { not: null }, status: "POSTED", kind: "PAYMENT" }, _sum: { amount: true } }),
    unbilledExposure(companyId),
  ]);
  if (!c) return null;
  const live = invoices.filter((i) => !["CANCELLED", "VOID"].includes(i.status));
  const open = live.filter((i) => (OPEN_INVOICE as readonly string[]).includes(i.status) && i.balanceAmount > 0);
  const overdue = open.filter((i) => i.dueDate && fromDbDate(i.dueDate) < today);
  const drafts = live.filter((i) => i.status === "DRAFT");
  const balance = open.reduce((s, i) => s + i.balanceAmount, 0);
  const draftTotal = drafts.reduce((s, i) => s + i.netAmount, 0);
  const committed = balance + draftTotal + unbilled;
  return {
    balance, draftTotal, unbilled, committed,
    creditLimit: c.creditLimit,
    available: c.creditLimit == null ? null : c.creditLimit - committed,
    invoiceCount: live.filter((i) => i.status !== "DRAFT").length,
    paidCount: live.filter((i) => i.status === "PAID").length,
    unpaidCount: open.length,
    overdueCount: overdue.length,
    overdueAmount: overdue.reduce((s, i) => s + i.balanceAmount, 0),
    reservations,
    totalInvoiced: live.filter((i) => i.status !== "DRAFT").reduce((s, i) => s + i.netAmount, 0),
    totalPaid: paid._sum.amount ?? 0,
  };
}

/**
 * Credit check for a new company-billed booking. Over the limit needs a
 * manager's approval (with a reason) — never silently allowed.
 */
export async function assertCompanyCredit(
  tx: Tx,
  input: { companyId: string; amount: number; override?: { reason: string } | null; reference?: string },
  actor: Actor,
) {
  const c = await tx.corporateCustomer.findUnique({ where: { id: input.companyId } });
  if (!c) throw new AppError("Choose a company.", "VALIDATION", { corporateCustomerId: msg("Required") });
  if (c.status !== "ACTIVE") {
    throw new AppError(c.status === "ON_HOLD"
      ? msgf("{company} is on hold — it cannot be billed. Ask a manager.", { company: c.companyName })
      : msgf("{company} is inactive — it cannot be billed. Ask a manager.", { company: c.companyName }), "FORBIDDEN");
  }
  if (c.creditLimit == null || input.amount <= 0) return;
  const settings = await getSettingsTx(tx);
  const acct = await companyAccount(c.id, businessDateOf(new Date(), stayConfig(settings)));
  const available = (acct?.available ?? 0);
  if (input.amount <= available) return;
  const over = { amount: input.amount.toLocaleString("en-TZ"), company: c.companyName, available: Math.max(0, available).toLocaleString("en-TZ") };
  if (!input.override?.reason?.trim()) throw new AppError(msgf("This booking (TZS {amount}) will go over {company}'s available credit of TZS {available}. A manager must approve it.", over), "CONFLICT", { creditOverride: msg("Needs approval") });
  if (!actor.permissions?.has("corporate.manage")) throw new AppError(msgf("This booking (TZS {amount}) will go over {company}'s available credit of TZS {available}. Only a manager can approve going over the limit.", over), "FORBIDDEN");
  await audit(tx, actor, {
    action: "corporate.credit_override", entityType: "CorporateCustomer", entityId: c.id,
    after: { company: c.companyName, amount: input.amount, available, limit: c.creditLimit, reason: input.override.reason.trim(), reservation: input.reference ?? null },
  });
}

/**
 * The company pays (all or part of what it owes): the money is spread over its
 * open invoices, oldest due date first — or only the invoices chosen.
 */
export async function recordCompanyPayment(
  input: { companyId: string; amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null; invoiceIds?: string[] | null },
  actor: Actor,
) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter the amount received.", "VALIDATION", { amount: msg("Invalid") });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "corporate_customers" WHERE "id" = ${input.companyId} FOR UPDATE`;
    const { account, method } = await resolveAccountTx(tx, input);
    const open = await tx.invoice.findMany({
      where: {
        corporateCustomerId: input.companyId, reservationId: null, status: { in: [...OPEN_INVOICE] }, balanceAmount: { gt: 0 },
        ...(input.invoiceIds?.length ? { id: { in: input.invoiceIds } } : {}),
      },
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }, { number: "asc" }],
    });
    const owed = open.reduce((s, i) => s + i.balanceAmount, 0);
    if (owed === 0) throw new AppError("This company has no unpaid invoices.");
    if (input.amount > owed) throw new AppError(msgf("That is more than the company owes (TZS {amount}).", { amount: owed.toLocaleString("en-TZ") }), "VALIDATION", { amount: msg("Too much") });

    const settings = await getSettingsTx(tx);
    const now = new Date();
    const businessDate = toDbDate(businessDateOf(now, stayConfig(settings)));
    let left = input.amount;
    const applied: { invoice: string; amount: number }[] = [];
    for (const inv of open) {
      if (left === 0) break;
      const part = Math.min(left, inv.balanceAmount);
      await tx.payment.create({
        data: {
          amount: part, methodId: method.id, accountId: account.id, reference: input.reference?.trim() || null, receivedAt: now, businessDate,
          invoiceId: inv.id, corporateCustomerId: input.companyId, recordedById: actor.userId!,
        },
      });
      await syncInvoice(tx, inv.id);
      applied.push({ invoice: inv.number, amount: part });
      left -= part;
    }
    await audit(tx, actor, {
      action: "payment.company", entityType: "CorporateCustomer", entityId: input.companyId,
      after: { amount: input.amount, method: method.code, reference: input.reference ?? null, applied },
    });
    return { applied };
  });
}

/** Account statement: opening balance, invoices (+), payments (−), closing balance. */
export async function companyStatement(companyId: string, from: BusinessDate, to: BusinessDate) {
  const t = await getT();
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({
      where: { corporateCustomerId: companyId, reservationId: null, issueDate: { not: null, lte: toDbDate(to) }, status: { notIn: ["DRAFT", "CANCELLED", "VOID"] } },
      select: { id: true, number: true, issueDate: true, dueDate: true, netAmount: true, items: { select: { guestName: true }, distinct: ["guestName"] } },
    }),
    db.payment.findMany({
      where: { corporateCustomerId: companyId, invoiceId: { not: null }, status: "POSTED", businessDate: { lte: toDbDate(to) } },
      select: { id: true, kind: true, amount: true, businessDate: true, reference: true, method: { select: { name: true } }, invoice: { select: { number: true } } },
    }),
  ]);
  type Entry = { date: BusinessDate; kind: "INVOICE" | "PAYMENT" | "REFUND"; ref: string; detail: string; debit: number; credit: number; href: string | null };
  const all: Entry[] = [
    ...invoices.map((i) => ({
      date: fromDbDate(i.issueDate!), kind: "INVOICE" as const, ref: i.number,
      detail: `${t("Invoice")}${i.dueDate ? ` · ${t("due {date}", { date: t.date(fromDbDate(i.dueDate)) })}` : ""}${i.items.length ? ` · ${i.items.map((x) => x.guestName).filter(Boolean).slice(0, 3).join(", ")}` : ""}`,
      debit: i.netAmount, credit: 0, href: `/staff/invoices/${i.id}`,
    })),
    ...payments.map((p) => ({
      date: fromDbDate(p.businessDate), kind: p.kind === "PAYMENT" ? ("PAYMENT" as const) : ("REFUND" as const), ref: p.invoice?.number ?? "",
      detail: `${p.kind === "PAYMENT" ? t.ctx("money", "Payment") : t("Refund")} · ${t(p.method.name)}${p.reference ? ` · ${p.reference}` : ""}`,
      debit: p.kind === "REFUND" ? p.amount : 0, credit: p.kind === "PAYMENT" ? p.amount : 0, href: null,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "INVOICE" ? -1 : 1));
  const before = all.filter((e) => e.date < from);
  const opening = before.reduce((s, e) => s + e.debit - e.credit, 0);
  let bal = opening;
  const rows = all.filter((e) => e.date >= from).map((e) => { bal += e.debit - e.credit; return { ...e, balance: bal }; });
  return {
    opening, rows, closing: bal,
    invoiced: rows.reduce((s, e) => s + e.debit, 0),
    paid: rows.reduce((s, e) => s + e.credit, 0),
  };
}

/** Accounts receivable across all companies: due today / this week / overdue, and who owes what. */
export async function receivablesBoard(today: BusinessDate) {
  const open = await db.invoice.findMany({
    where: { reservationId: null, status: { in: [...OPEN_INVOICE] }, balanceAmount: { gt: 0 } },
    include: { corporateCustomer: { select: { id: true, companyName: true } }, guest: { select: { fullName: true } }, group: { select: { name: true } } },
    orderBy: [{ dueDate: "asc" }],
  });
  const weekEnd = addDays(today, 7);
  const days = (d: BusinessDate) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  const rows = open.map((i) => {
    const due = i.dueDate ? fromDbDate(i.dueDate) : null;
    return {
      id: i.id, number: i.number, companyId: i.corporateCustomer?.id ?? null,
      customer: i.corporateCustomer?.companyName ?? i.group?.name ?? i.guest?.fullName ?? "—",
      total: i.netAmount, paid: i.paidAmount, balance: i.balanceAmount, due, dueIn: due ? days(due) : null,
    };
  });
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s + r.balance, 0);
  const byCompany = new Map<string, { id: string | null; name: string; balance: number; overdue: number; invoices: number; oldest: number }>();
  for (const r of rows) {
    const k = r.companyId ?? r.customer;
    const e = byCompany.get(k) ?? { id: r.companyId, name: r.customer, balance: 0, overdue: 0, invoices: 0, oldest: 0 };
    e.balance += r.balance; e.invoices += 1;
    if (r.dueIn != null && r.dueIn < 0) { e.overdue += r.balance; e.oldest = Math.max(e.oldest, -r.dueIn); }
    byCompany.set(k, e);
  }
  return {
    rows,
    total: sum(rows),
    dueToday: sum(rows.filter((r) => r.due === today)),
    dueWeek: sum(rows.filter((r) => r.due != null && r.due >= today && r.due <= weekEnd)),
    overdue: sum(rows.filter((r) => r.due != null && r.due < today)),
    companies: [...byCompany.values()].sort((a, b) => b.balance - a.balance),
  };
}

/** "Part of this stay is already on <company>'s invoice…" — the company's name when it has one. */
const alreadyBilled = (company: string | null | undefined) => company != null
  ? msgf("Part of this stay is already on {company}'s invoice — void that invoice first.", { company })
  : msg("Part of this stay is already on a company's invoice — void that invoice first.");

/** Change who pays for a stay (guest / company / split). Lines already billed are corrected at the next billing. */
export async function changeBilling(
  reservationId: string,
  input: { corporateCustomerId: string | null; billTo: BillTo; covers: string[]; paymentTermDays: number | null },
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
    const r = await tx.reservation.findUnique({ where: { id: reservationId }, include: { corporateCustomer: true, group: true } });
    if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
    if (["CANCELLED", "NO_SHOW"].includes(r.status)) throw new AppError("This booking is closed.");
    if (input.billTo === "GROUP") {
      // A group room: the group pays (its company, or its contact person) — or back to "pays own bill".
      if (!r.group) throw new AppError("This booking is not part of a group.");
      if (r.billTo === "GROUP") return;
      if (r.companyBilledAmount !== 0 && r.corporateCustomerId && r.corporateCustomerId !== r.group.corporateCustomerId) {
        throw new AppError(alreadyBilled(r.corporateCustomer?.companyName), "CONFLICT");
      }
      await tx.reservation.update({ where: { id: r.id }, data: { billTo: "GROUP", corporateCustomerId: r.group.corporateCustomerId, companyCovers: [], paymentTermDays: null } });
      await audit(tx, actor, { action: "reservation.billing_changed", entityType: "Reservation", entityId: r.id, before: { billTo: r.billTo }, after: { billTo: "GROUP", group: r.group.reference } });
      if (r.status === "CHECKED_OUT") await billCompanyTx(tx, r.id, actor, {});
      return;
    }
    const companyId = input.corporateCustomerId;
    if (input.billTo !== "GUEST" && !companyId) throw new AppError("Choose the company.", "VALIDATION", { corporateCustomerId: msg("Required") });
    if (input.billTo === "SPLIT" && input.covers.length === 0) throw new AppError("Choose what the company pays for.", "VALIDATION", { covers: msg("Required") });
    if (r.companyBilledAmount !== 0 && companyId !== r.corporateCustomerId) {
      throw new AppError(alreadyBilled(r.corporateCustomer?.companyName), "CONFLICT");
    }
    if (companyId && companyId !== r.corporateCustomerId) {
      const c = await tx.corporateCustomer.findUnique({ where: { id: companyId } });
      if (!c || c.status !== "ACTIVE") throw new AppError("That company account is not active.");
    }
    const data = {
      corporateCustomerId: companyId || null,
      billTo: companyId ? input.billTo : "GUEST",
      companyCovers: input.billTo === "SPLIT" ? input.covers : [],
      paymentTermDays: input.billTo === "GUEST" ? null : input.paymentTermDays,
    } as const;
    await tx.reservation.update({ where: { id: r.id }, data: { ...data, companyCovers: [...data.companyCovers] } });
    await audit(tx, actor, {
      action: "reservation.billing_changed", entityType: "Reservation", entityId: r.id,
      before: { company: r.corporateCustomer?.companyName ?? null, billTo: r.billTo, covers: r.companyCovers, terms: r.paymentTermDays },
      after: { company: companyId, billTo: data.billTo, covers: data.companyCovers, terms: data.paymentTermDays },
    });
    // A stay already checked out is re-billed straight away so the company invoice matches.
    if (r.status === "CHECKED_OUT" && data.billTo !== "GUEST") await billCompanyTx(tx, r.id, actor, {});
  });
}

/** Active companies for the booking forms: terms, credit left (null = no limit) and their people to pick as guests. */
export async function bookingCompanies(today: BusinessDate) {
  const companies = await db.corporateCustomer.findMany({
    where: { status: "ACTIVE" }, orderBy: { companyName: "asc" },
    select: {
      id: true, companyName: true, paymentTermDays: true, defaultBillTo: true, defaultCovers: true, creditLimit: true, contactPerson: true, phone: true, email: true, kind: true,
      guests: { orderBy: { fullName: "asc" }, take: 200, select: { id: true, fullName: true, phone: true, idType: true, idNumber: true } },
    },
  });
  return Promise.all(companies.map(async (c) => ({
    id: c.id, companyName: c.companyName, terms: c.paymentTermDays, billTo: c.defaultBillTo, covers: c.defaultCovers,
    available: c.creditLimit == null ? null : (await companyAccount(c.id, today))?.available ?? null,
    staff: c.guests,
    contact: { name: c.contactPerson, phone: c.phone, email: c.email }, kind: c.kind,
  })));
}
