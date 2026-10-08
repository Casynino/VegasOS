import "server-only";
import { timeRange } from "@/lib/meeting";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { resolveAccountTx } from "./payment-accounts";
import { getSettingsTx, stayConfig } from "../settings";
import { addDays, businessDateOf, fromDbDate, toDbDate, zonedInstant, type BusinessDate } from "@/lib/time/business-date";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { recalculateReservation } from "./reservation-financials";
import type { Actor } from "./reservations";
import { msg, msgf } from "@/i18n/msg";

/**
 * InvoiceService.
 * - Reservation invoices mirror the reservation folio (rooms, discounts, extra
 *   charges) and its payments — money is still recorded against the booking,
 *   so there is exactly one financial record.
 * - Stand-alone invoices (corporate extras, meeting room…) hold their own lines
 *   and take payments directly.
 * Invoices are never deleted: drafts can be edited, issued invoices can only be cancelled.
 */

/** INV-2026-000001, INV-2026-000002 … — automatic, unique, restarting each year. Never typed by staff. */
export async function nextInvoiceNumber(tx: Tx, today: BusinessDate): Promise<string> {
  const year = today.slice(0, 4);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('invoice_number'))::text`;
  const last = await tx.invoice.findFirst({ where: { number: { startsWith: `INV-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? Number(last.number.slice(-6)) + 1 : 1;
  return `INV-${year}-${String(n).padStart(6, "0")}`;
}

async function todayTx(tx: Tx) {
  return businessDateOf(new Date(), stayConfig(await getSettingsTx(tx)));
}

/** Company-billing lines lower their stays' guest balances — refresh those stays when an invoice changes. */
/** A cancelled / void invoice gives its stays' deposits back to the stays (they were only applied to it). */
async function detachStayPayments(tx: Tx, invoiceId: string) {
  await tx.payment.updateMany({ where: { invoiceId, reservationId: { not: null } }, data: { invoiceId: null } });
}

async function refreshBilledStays(tx: Tx, invoiceId: string) {
  const stays = await tx.invoiceItem.findMany({ where: { invoiceId, reservationId: { not: null } }, select: { reservationId: true }, distinct: ["reservationId"] });
  for (const s of stays) await recalculateReservation(tx, s.reservationId!);
}

export function deriveInvoiceStatus(inv: { status: InvoiceStatus; netAmount: number; paidAmount: number; dueDate: Date | null }, today: string): InvoiceStatus {
  if (inv.status === "DRAFT" || inv.status === "CANCELLED" || inv.status === "VOID") return inv.status;
  const balance = inv.netAmount - inv.paidAmount;
  if (balance <= 0 && inv.netAmount > 0) return "PAID";
  if (inv.dueDate && fromDbDate(inv.dueDate) < today && balance > 0) return "OVERDUE";
  return inv.paidAmount > 0 ? "PARTIALLY_PAID" : "ISSUED";
}

/** Rebuild lines & totals from the linked reservation (drafts), and money from payments. */
export async function syncInvoice(tx: Tx, invoiceId: string): Promise<void> {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true, payments: { where: { status: "POSTED" } } } });
  const settings = await getSettingsTx(tx);
  const today = businessDateOf(new Date(), stayConfig(settings));

  let gross = 0, discount = 0, net = 0, paid = 0;
  if (inv.reservationId) {
    const r = await tx.reservation.findUniqueOrThrow({
      where: { id: inv.reservationId },
      include: { rooms: { include: { room: true, roomType: true } }, charges: { where: { isVoided: false } } },
    });
    if (inv.status === "DRAFT") {
      await tx.invoiceItem.deleteMany({ where: { invoiceId } });
      const lines = [
        ...r.rooms.filter((x) => ["RESERVED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(x.status)).map((x, i) => {
          const units = x.isDayUse ? 1 : x.nights;
          return {
            kind: "ROOM" as const, sortOrder: i, sourceType: "RESERVATION_ROOM", sourceId: x.id,
            description: x.roomType.category === "MEETING_ROOM"
              ? `Room ${x.room.number} — ${x.roomType.name} · ${fromDbDate(x.arrivalDate)} ${timeRange(x.startAt, x.endAt)}`
              : `Room ${x.room.number} · ${x.roomType.name} · ${x.isDayUse ? "short time" : `${units} night${units === 1 ? "" : "s"}`} (${fromDbDate(x.arrivalDate)} → ${fromDbDate(x.departureDate)})`,
            quantity: units, unitAmount: x.ratePerNight, grossAmount: x.grossAmount, discountAmount: x.discountAmount, netAmount: x.netAmount,
          };
        }),
        ...r.charges.map((c, i) => ({
          kind: "CHARGE" as const, sortOrder: 100 + i, sourceType: "CHARGE", sourceId: c.id, description: c.description, quantity: 1,
          unitAmount: c.amount, grossAmount: c.amount, discountAmount: 0, netAmount: c.amount,
        })),
      ];
      if (lines.length) await tx.invoiceItem.createMany({ data: lines.map((l) => ({ ...l, invoiceId })) });
    } else if (inv.status !== "CANCELLED" && inv.status !== "VOID") {
      // Issued invoice: never rewrite history — append adjustment lines for any folio change
      // (stay extension, early departure, upgrade, new or voided charges).
      const current = new Map<string, { type: string; net: number; gross: number; discount: number; label: string }>();
      for (const x of r.rooms) {
        const billable = ["RESERVED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(x.status);
        current.set(x.id, { type: "RESERVATION_ROOM", net: billable ? x.netAmount : 0, gross: billable ? x.grossAmount : 0, discount: billable ? x.discountAmount : 0, label: `Room ${x.room.number} · ${x.roomType.name}` });
      }
      const allCharges = await tx.reservationCharge.findMany({ where: { reservationId: r.id } });
      for (const c of allCharges) current.set(c.id, { type: "CHARGE", net: c.isVoided ? 0 : c.amount, gross: c.isVoided ? 0 : c.amount, discount: 0, label: c.description });
      const invoiced = new Map<string, { net: number; gross: number; discount: number }>();
      for (const it of inv.items) {
        if (!it.sourceId) continue;
        const acc = invoiced.get(it.sourceId) ?? { net: 0, gross: 0, discount: 0 };
        invoiced.set(it.sourceId, { net: acc.net + it.netAmount, gross: acc.gross + it.grossAmount, discount: acc.discount + it.discountAmount });
      }
      let order = inv.items.length;
      for (const [sourceId, cur] of current) {
        const was = invoiced.get(sourceId) ?? { net: 0, gross: 0, discount: 0 };
        const dNet = cur.net - was.net;
        if (dNet === 0) continue;
        await tx.invoiceItem.create({
          data: {
            invoiceId, kind: cur.type === "CHARGE" ? "CHARGE" : "ROOM", sortOrder: 200 + order++, sourceType: cur.type, sourceId,
            description: `${was.net === 0 ? "Added" : "Adjustment"}: ${cur.label}${dNet < 0 ? " (reduced)" : ""}`,
            quantity: 1, unitAmount: cur.gross - was.gross, grossAmount: cur.gross - was.gross, discountAmount: cur.discount - was.discount, netAmount: dNet,
          },
        });
      }
    }
    gross = r.grossAmount + r.chargesAmount;
    discount = r.discountAmount;
    net = r.netAmount;
    paid = r.paidAmount;
  } else {
    const items = await tx.invoiceItem.findMany({ where: { invoiceId } });
    gross = items.reduce((s, i) => s + i.grossAmount, 0);
    discount = items.reduce((s, i) => s + i.discountAmount, 0);
    net = items.reduce((s, i) => s + i.netAmount, 0);
    paid = inv.payments.reduce((s, p) => s + (p.kind === "PAYMENT" ? p.amount : -p.amount), 0);
  }
  const status = deriveInvoiceStatus({ status: inv.status, netAmount: net, paidAmount: paid, dueDate: inv.dueDate }, today);
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { grossAmount: gross, discountAmount: discount, netAmount: net, paidAmount: paid, balanceAmount: net - paid, status },
  });
}

export async function createInvoiceForReservation(reservationId: string, actor: Actor) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  return db.$transaction(async (tx) => {
    const r = await tx.reservation.findUnique({ where: { id: reservationId } });
    if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
    if (["CANCELLED", "NO_SHOW", "INQUIRY"].includes(r.status)) throw new AppError("This booking cannot be invoiced.");
    if (r.billTo === "GROUP") throw new AppError("This room is paid by its group — invoice it from the group page (it goes on the group's invoice).");
    if (r.billTo !== "GUEST" && r.corporateCustomerId) {
      throw new AppError("This stay is billed to the company — use “Bill the company” (or check out & issue invoice).");
    }
    const existing = await tx.invoice.findFirst({ where: { reservationId, status: { notIn: ["CANCELLED", "VOID"] } } });
    if (existing) return existing;
    const inv = await tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx, await todayTx(tx)), reservationId, guestId: r.guestId,
        createdById: actor.userId!, status: "DRAFT",
      },
    });
    await syncInvoice(tx, inv.id);
    await audit(tx, actor, { action: "invoice.created", entityType: "Invoice", entityId: inv.id, after: { number: inv.number, reservation: r.reference } });
    return inv;
  });
}

export interface ManualLine { description: string; quantity: number; unitAmount: number; discountAmount?: number; kind?: "MEETING_ROOM" | "OTHER" | "CHARGE" }

export async function createManualInvoice(
  input: { corporateCustomerId?: string | null; guestId?: string | null; lines: ManualLine[]; notes?: string | null; paymentTermDays?: number | null },
  actor: Actor,
) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  if (!input.corporateCustomerId && !input.guestId) throw new AppError("Choose who the invoice is for.");
  const lines = input.lines.filter((l) => l.description.trim());
  if (lines.length === 0) throw new AppError("Add at least one line.");
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || !Number.isInteger(l.unitAmount) || l.unitAmount < 0) throw new AppError("Line quantities and amounts must be whole positive numbers.");
    if ((l.discountAmount ?? 0) < 0 || (l.discountAmount ?? 0) > l.quantity * l.unitAmount) throw new AppError("A line discount cannot exceed the line amount.");
  }
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        number: await nextInvoiceNumber(tx, await todayTx(tx)), corporateCustomerId: input.corporateCustomerId ?? null, guestId: input.guestId ?? null,
        notes: input.notes?.trim() || null, createdById: actor.userId!, status: "DRAFT", paymentTermDays: input.paymentTermDays ?? null,
        items: {
          create: lines.map((l, i) => {
            const gross = l.quantity * l.unitAmount;
            const disc = l.discountAmount ?? 0;
            return { kind: l.kind ?? "OTHER", description: l.description.trim(), quantity: l.quantity, unitAmount: l.unitAmount, grossAmount: gross, discountAmount: disc, netAmount: gross - disc, sortOrder: i };
          }),
        },
      },
    });
    await syncInvoice(tx, inv.id);
    await audit(tx, actor, { action: "invoice.created", entityType: "Invoice", entityId: inv.id, after: { number: inv.number, lines: lines.length } });
    return inv;
  });
}

export async function issueInvoice(invoiceId: string, actor: Actor, dueDate?: string | null) {
  return db.$transaction((tx) => issueInvoiceTx(tx, invoiceId, actor, dueDate));
}

/** Issue a draft inside a transaction: freeze its lines, set the due date from the terms, give it a verify code. */
export async function issueInvoiceTx(tx: Tx, invoiceId: string, actor: Actor, dueDate?: string | null) {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { corporateCustomer: true } });
  if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
  if (inv.status !== "DRAFT") throw new AppError("Only draft invoices can be issued.");
  await syncInvoice(tx, inv.id); // freeze lines from the latest folio
  const settings = await getSettingsTx(tx);
  const today = businessDateOf(new Date(), stayConfig(settings));
  if (inv.netAmount === 0 && !inv.reservationId) throw new AppError("This invoice has nothing on it yet.");
  const due = dueDate || addDays(today, inv.paymentTermDays ?? inv.corporateCustomer?.paymentTermDays ?? settings.invoiceDefaultDueDays);
  if (due < today) throw new AppError("Due date cannot be in the past.");
  await tx.invoice.update({
    where: { id: inv.id },
    data: { status: "ISSUED", issueDate: toDbDate(today), dueDate: toDbDate(due), verifyToken: inv.verifyToken ?? randomBytes(18).toString("base64url") },
  });
  await syncInvoice(tx, inv.id);
  await audit(tx, actor, { action: "invoice.issued", entityType: "Invoice", entityId: inv.id, after: { number: inv.number, dueDate: due } });
}

export async function cancelInvoice(invoiceId: string, reason: string, actor: Actor) {
  if (!reason.trim()) throw new AppError("Give a reason.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: { where: { status: "POSTED" } } } });
    if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
    if (inv.status === "CANCELLED" || inv.status === "VOID") throw new AppError("Already cancelled.");
    if (!inv.reservationId && inv.payments.some((p) => !p.reservationId)) throw new AppError("This invoice has payments. Reverse them first.");
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim() } });
    await detachStayPayments(tx, inv.id);
    await refreshBilledStays(tx, inv.id);
    await audit(tx, actor, { action: "invoice.cancelled", entityType: "Invoice", entityId: inv.id, before: { status: inv.status }, after: { status: "CANCELLED", reason } });
  });
}

/**
 * VOID — an issued invoice that should never have existed (wrong company, sent twice…).
 * It stays on record, marked void, and counts for nothing. Any stays it billed owe
 * those lines again until they are billed correctly.
 */
export async function voidInvoice(invoiceId: string, reason: string, actor: Actor) {
  if (!actor.permissions?.has("invoices.manage")) throw new AppError("Only a manager can void invoices.", "FORBIDDEN");
  if (!reason.trim()) throw new AppError("Give a reason.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: { where: { status: "POSTED" } } } });
    if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
    if (inv.status === "DRAFT") throw new AppError("A draft has not been sent — cancel it instead.");
    if (inv.status === "CANCELLED" || inv.status === "VOID") throw new AppError("Already void.");
    if (inv.payments.some((p) => !p.reservationId)) throw new AppError("This invoice has payments. Reverse them first.");
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "VOID", cancelledAt: new Date(), cancelReason: reason.trim() } });
    await detachStayPayments(tx, inv.id);
    await refreshBilledStays(tx, inv.id);
    await audit(tx, actor, { action: "invoice.voided", entityType: "Invoice", entityId: inv.id, before: { status: inv.status, total: inv.netAmount }, after: { status: "VOID", reason: reason.trim() } });
  });
}

export async function recordInvoicePayment(
  input: {
    invoiceId: string; amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null; notes?: string | null;
    /** Hotel day the money arrived (e.g. the bank transfer came yesterday). Blank = now. Never in the future. */
    receivedOn?: BusinessDate | null;
  },
  actor: Actor,
) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter a positive whole amount.", "VALIDATION", { amount: msg("Invalid") });
  return db.$transaction((tx) => recordInvoicePaymentTx(tx, input, actor));
}

/** A payment on an issued (company / group) invoice — by hand, or the automatic nTZS recording (`internal`). */
export async function recordInvoicePaymentTx(
  tx: Tx,
  input: { invoiceId: string; amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null; notes?: string | null; receivedOn?: BusinessDate | null },
  actor: Actor,
  opts: { internal?: boolean } = {},
) {
  await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
  const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
  if (inv.reservationId) throw new AppError("Record this payment on the reservation — the invoice follows it automatically.");
  if (!["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status)) throw new AppError("Only issued invoices can receive payments.");
  if (input.amount > inv.balanceAmount) throw new AppError(msgf("Amount exceeds the balance of TZS {amount}.", { amount: inv.balanceAmount.toLocaleString("en-TZ") }), "VALIDATION", { amount: msg("Too much") });
  const { account, method } = await resolveAccountTx(tx, input, "payments", { internal: opts.internal });
  const settings = await getSettingsTx(tx);
  const now = new Date();
  const today = businessDateOf(now, stayConfig(settings));
  if (input.receivedOn && input.receivedOn > today) throw new AppError("The payment date cannot be in the future.", "VALIDATION", { receivedOn: msg("Future") });
  const day = input.receivedOn ?? today;
  const p = await tx.payment.create({
    data: {
      amount: input.amount, methodId: method.id, accountId: account.id, reference: input.reference?.trim() || null, notes: input.notes?.trim() || null,
      receivedAt: day === today ? now : zonedInstant(day, 12 * 60, settings.timezone),
      businessDate: toDbDate(day), invoiceId: inv.id,
      corporateCustomerId: inv.corporateCustomerId, recordedById: actor.userId!,
    },
  });
  await syncInvoice(tx, inv.id);
  await audit(tx, actor, { action: "payment.created", entityType: "Payment", entityId: p.id, after: { invoice: inv.number, amount: input.amount, account: account.name, method: method.code, receivedOn: day, reference: p.reference } });
  return p;
}

/** Mark issued invoices past their due date as OVERDUE (run nightly and on read). */
export async function refreshOverdueInvoices() {
  const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = businessDateOf(new Date(), stayConfig(settings));
  return db.invoice.updateMany({
    where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: toDbDate(today) }, balanceAmount: { gt: 0 } },
    data: { status: "OVERDUE" },
  });
}
