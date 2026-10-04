import "server-only";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "../audit";
import { AppError } from "../errors";
import { getSettingsTx, stayConfig } from "../settings";
import { assertGroupBillOpen, recalculateReservation } from "./reservation-financials";
import { syncInvoice } from "./invoices";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import { chargeKind, lineDescription, parseLine } from "@/lib/charge-types";
import type { Actor } from "./reservations";
import { reopenHoldTx, secureByPaymentTx } from "./booking-holds";
import { resolveAccountTx } from "./payment-accounts";

/**
 * PaymentService — payments are append-only. Mistakes are corrected by a
 * reversal (keeps the original row, who reversed it and why) or a refund,
 * never by editing or deleting.
 */

export async function recordReservationPayment(
  input: { reservationId: string; amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null; notes?: string | null; kind?: "PAYMENT" | "REFUND" },
  actor: Actor,
) {
  return db.$transaction((tx) => recordPaymentTx(tx, input, actor));
}

/** Records a payment inside an existing transaction (used by "record payment & check out"). */
export async function recordPaymentTx(
  tx: Prisma.TransactionClient,
  input: { reservationId: string; amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null; notes?: string | null; kind?: "PAYMENT" | "REFUND" },
  actor: Actor,
) {
  if (!actor.userId) throw new AppError("Payments must be recorded by a signed-in staff member.", "FORBIDDEN");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter a positive whole amount.", "VALIDATION", { amount: "Invalid" });
  const kind = input.kind ?? "PAYMENT";
  if (kind === "REFUND" && !actor.permissions?.has("payments.reverse")) throw new AppError("Only a manager can issue refunds.", "FORBIDDEN");
  await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${input.reservationId} FOR UPDATE`;
  const r = await tx.reservation.findUnique({ where: { id: input.reservationId } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  const { account, method } = await resolveAccountTx(tx, input);

  if (kind === "PAYMENT" && input.amount > r.balanceAmount) {
    throw new AppError(
      r.balanceAmount <= 0
        ? "Nothing is owed on this booking."
        : `The amount is more than the balance of TZS ${r.balanceAmount.toLocaleString("en-TZ")}.`,
      "VALIDATION", { amount: "Exceeds balance" },
    );
  }
  if (kind === "REFUND" && input.amount > r.paidAmount) {
    throw new AppError("A refund cannot exceed what the guest has paid.", "VALIDATION", { amount: "Exceeds paid" });
  }

  const settings = await getSettingsTx(tx);
  const now = new Date();
  const payment = await tx.payment.create({
    data: {
      kind,
      amount: input.amount,
      methodId: method.id,
      accountId: account.id,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      receivedAt: now,
      businessDate: toDbDate(businessDateOf(now, stayConfig(settings))),
      reservationId: r.id,
      corporateCustomerId: r.corporateCustomerId,
      recordedById: actor.userId!,
    },
  });
  await recalculateReservation(tx, r.id);
  // Payment is what secures a booking; a refund of everything paid makes it pending again.
  if (kind === "PAYMENT") await secureByPaymentTx(tx, r.id, actor);
  else await reopenHoldTx(tx, r.id, actor);
  await audit(tx, actor, {
    action: kind === "REFUND" ? "payment.refunded" : "payment.created",
    entityType: "Payment", entityId: payment.id,
    after: { reservation: r.reference, amount: input.amount, method: method.code, account: account.name, reference: payment.reference },
  });
  return payment;
}

export async function reversePayment(paymentId: string, reason: string, actor: Actor) {
  if (!actor.permissions?.has("payments.reverse")) throw new AppError("Only a manager can reverse payments.", "FORBIDDEN");
  if (!reason.trim()) throw new AppError("Give a reason for the reversal.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new AppError("Payment not found.", "NOT_FOUND");
    if (p.status === "REVERSED") throw new AppError("This payment is already reversed.");
    // The payment keeps its own day; the reversal is a separate line on today's hotel day.
    const now = new Date();
    const settings = await getSettingsTx(tx);
    await tx.payment.update({
      where: { id: p.id },
      data: { status: "REVERSED", reversedAt: now, reversedById: actor.userId ?? null, reversalReason: reason.trim(), reversalBusinessDate: toDbDate(businessDateOf(now, stayConfig(settings))) },
    });
    if (p.reservationId) {
      await recalculateReservation(tx, p.reservationId);
      if (p.kind === "PAYMENT") await reopenHoldTx(tx, p.reservationId, actor);
    }
    if (p.invoiceId) await syncInvoice(tx, p.invoiceId);
    await audit(tx, actor, {
      action: "payment.reversed", entityType: "Payment", entityId: p.id,
      before: { status: p.status, amount: p.amount, kind: p.kind }, after: { status: "REVERSED", reversal: -p.amount, reason: reason.trim() },
    });
  });
}

export async function addReservationCharge(input: { reservationId: string; description: string; amount: number; category?: string }, actor: Actor) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter a positive whole amount.", "VALIDATION", { amount: "Invalid" });
  if (!input.description.trim()) throw new AppError("Describe the charge.", "VALIDATION", { description: "Required" });
  return db.$transaction(async (tx) => {
    const r = await tx.reservation.findUnique({ where: { id: input.reservationId } });
    if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
    if (["CANCELLED", "NO_SHOW"].includes(r.status)) throw new AppError("Cannot add charges to a cancelled booking.");
    await assertGroupBillOpen(tx, r.id, actor);
    const settings = await getSettingsTx(tx);
    const charge = await tx.reservationCharge.create({
      data: {
        reservationId: r.id, description: input.description.trim(), amount: input.amount,
        category: input.category ?? "OTHER",
        kind: chargeKind(input.category),
        businessDate: toDbDate(businessDateOf(new Date(), stayConfig(settings))), createdById: actor.userId ?? null,
      },
    });
    await recalculateReservation(tx, r.id);
    await audit(tx, actor, { action: "reservation.charge_added", entityType: "Reservation", entityId: r.id, after: { description: charge.description, amount: charge.amount } });
  });
}

export async function voidReservationCharge(chargeId: string, reason: string, actor: Actor) {
  if (!actor.permissions?.has("payments.reverse")) throw new AppError("Only a manager can void charges.", "FORBIDDEN");
  if (!reason.trim()) throw new AppError("Give a reason.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const c = await tx.reservationCharge.findUnique({ where: { id: chargeId } });
    if (!c || c.isVoided) throw new AppError("Charge not found or already voided.", "NOT_FOUND");
    if (c.category === "BILL_DISCOUNT") throw new AppError("This is part of a discount on the whole bill — it can't be reversed line by line.");
    if (c.restaurantOrderId) throw new AppError("This line comes from a restaurant order — change it on the order (pay at the restaurant, remove the item, or cancel it), so the table and the room stay the same.", "CONFLICT");
    await assertGroupBillOpen(tx, c.reservationId, actor);
    await tx.reservationCharge.update({ where: { id: c.id }, data: { isVoided: true, voidReason: reason.trim() } });
    await recalculateReservation(tx, c.reservationId);
    await audit(tx, actor, { action: "reservation.charge_voided", entityType: "Reservation", entityId: c.reservationId, before: { description: c.description, amount: c.amount }, after: { voided: true, reason } });
  });
}

export interface ChargeLine { type: string; item: string; qty: number; unitPrice: number; /** Picked from the menu (its photo shows on the tab). */ menuItemId?: string | null }

/**
 * Post one or more items to a guest's room account in one go (e.g. "2 × Breakfast",
 * "1 × Laundry"), optionally taking payment for them straight away. All or nothing.
 */
export async function postRoomCharges(
  input: { reservationId: string; lines: ChargeLine[]; pay?: { accountId?: string | null; methodId?: string | null; reference?: string | null } | null },
  actor: Actor,
) {
  return db.$transaction((tx) => postRoomChargesTx(tx, input, actor));
}

/** Same as postRoomCharges, inside a caller's transaction (e.g. a walk-in that orders room service at check-in). */
export async function postRoomChargesTx(
  tx: Prisma.TransactionClient,
  input: { reservationId: string; lines: ChargeLine[]; pay?: { accountId?: string | null; methodId?: string | null; reference?: string | null } | null },
  actor: Actor,
) {
  if (!input.lines.length) throw new AppError("Add at least one item.");
  for (const l of input.lines) {
    if (!l.item.trim()) throw new AppError("Say what each item is.", "VALIDATION", { item: "Required" });
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 99) throw new AppError("Quantity must be 1–99.", "VALIDATION", { qty: "Invalid" });
    if (!Number.isInteger(l.unitPrice) || l.unitPrice <= 0) throw new AppError(`Enter a price for ${l.item.trim()}.`, "VALIDATION", { unitPrice: "Invalid" });
  }
  {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${input.reservationId} FOR UPDATE`;
    const r = await tx.reservation.findUnique({ where: { id: input.reservationId }, include: { rooms: { where: { status: "CHECKED_IN" }, include: { room: { select: { number: true } } } } } });
    if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
    if (["CANCELLED", "NO_SHOW"].includes(r.status)) throw new AppError("Cannot add charges to a cancelled booking.");
    await assertGroupBillOpen(tx, r.id, actor);
    // Food typed in by hand while the guest's own order is still open at the restaurant would
    // charge it twice — that order goes on the room instead (it keeps its table and items).
    if (input.lines.some((l) => !l.menuItemId && ["RESTAURANT", "BAR", "ROOM_SERVICE"].includes(l.type))) {
      const people = [r.guestId, ...(await tx.reservationGuest.findMany({ where: { reservationId: r.id }, select: { guestId: true } })).map((g) => g.guestId)];
      const open = await tx.restaurantOrder.findFirst({
        where: { guestId: { in: people }, settlement: { not: "ROOM" }, paymentStatus: "UNPAID", status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" }, select: { number: true, total: true, tableLabel: true },
      });
      if (open) throw new AppError(`This guest's order #${open.number.replace(/^ORD-\d{4}-0*/, "")}${open.tableLabel ? ` at ${open.tableLabel}` : ""} (TZS ${open.total.toLocaleString("en-US")}) is not on the room yet — put that order on the room instead of typing it again.`, "CONFLICT");
    }
    const settings = await getSettingsTx(tx);
    const businessDate = toDbDate(businessDateOf(new Date(), stayConfig(settings)));
    const room = r.rooms.map((x) => x.room.number).join(", ");
    let total = 0;
    for (const l of input.lines) {
      const amount = l.qty * l.unitPrice;
      total += amount;
      await tx.reservationCharge.create({
        data: {
          reservationId: r.id, description: lineDescription(l.item, l.qty), amount, category: l.type, kind: chargeKind(l.type), menuItemId: l.menuItemId ?? null,
          businessDate, createdById: actor.userId ?? null,
        },
      });
    }
    await recalculateReservation(tx, r.id);
    await audit(tx, actor, {
      action: "reservation.charges_posted", entityType: "Reservation", entityId: r.id,
      after: { room, total, lines: input.lines.map((l) => ({ type: l.type, item: lineDescription(l.item, l.qty), amount: l.qty * l.unitPrice })) },
    });
    let paid = 0;
    if (input.pay) {
      const now = await tx.reservation.findUniqueOrThrow({ where: { id: r.id } });
      paid = Math.min(total, now.balanceAmount);
      if (paid > 0) await recordPaymentTx(tx, { reservationId: r.id, amount: paid, accountId: input.pay.accountId, methodId: input.pay.methodId, reference: input.pay.reference }, actor);
    }
    return { total, paid, room };
  }
}

/** Items the hotel has charged recently (most used first) — quick "tap to add again" buttons. */
export async function recentChargeItems(limit = 40) {
  const rows = await db.reservationCharge.findMany({
    // Restaurant & bar orders are picked from the menu instead (their lines carry the order number).
    where: { isVoided: false, restaurantOrderId: null, createdAt: { gte: new Date(Date.now() - 120 * 86_400_000) }, category: { notIn: ["LATE_CHECKOUT", "EARLY_DEPARTURE", "ROOM_UPGRADE", "ROOM_SERVICE_FEE"] } },
    select: { description: true, amount: true, category: true },
    orderBy: { createdAt: "desc" }, take: 800,
  });
  const map = new Map<string, { type: string; item: string; unitPrice: number; uses: number }>();
  for (const c of rows) {
    const { item, unitPrice } = parseLine(c.description, c.amount);
    const key = `${c.category}|${item.toLowerCase()}|${unitPrice}`;
    const hit = map.get(key);
    if (hit) hit.uses++; else map.set(key, { type: c.category ?? "OTHER", item, unitPrice, uses: 1 });
  }
  return [...map.values()].sort((a, b) => b.uses - a.uses).slice(0, limit);
}

/**
 * Correct WHERE a payment went (e.g. recorded as Cash, really paid by Bank) or its reference.
 * The amount can never change here — that needs a manager's reversal. Every correction is
 * kept (from → to, who, when, why) and shows in the ledger and the edit history.
 */
export async function correctPayment(
  input: { paymentId: string; accountId?: string | null; methodId?: string | null; reference?: string | null; reason?: string | null },
  actor: Actor,
) {
  if (!actor.userId || !actor.permissions?.has("payments.record")) throw new AppError("You cannot correct payments.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${input.paymentId} FOR UPDATE`;
    const p = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { method: true, account: true } });
    if (!p) throw new AppError("Payment not found.", "NOT_FOUND");
    if (p.status !== "POSTED") throw new AppError("A reversed payment cannot be corrected.");
    const { account, method } = await resolveAccountTx(tx, input.accountId ? { accountId: input.accountId } : { methodId: input.methodId });
    const reference = input.reference === undefined ? p.reference : input.reference?.trim() || null;
    if (account.id === p.accountId && method.id === p.methodId && reference === p.reference) throw new AppError("Nothing changed.");
    // The amount and date never change here. The reference is part of the original record: only a manager may correct it.
    if (reference !== p.reference && !actor.permissions?.has("payments.reverse")) {
      throw new AppError("Only a manager can correct a payment reference. You can correct where the money went (the method).", "FORBIDDEN");
    }
    const settings = await getSettingsTx(tx);
    const now = new Date();
    await tx.paymentCorrection.create({
      data: {
        paymentId: p.id, fromMethodId: p.methodId, toMethodId: method.id, fromAccountId: p.accountId, toAccountId: account.id, fromReference: p.reference, toReference: reference,
        amount: p.amount, reason: input.reason?.trim() ?? "", changedById: actor.userId!, changedAt: now,
        businessDate: toDbDate(businessDateOf(now, stayConfig(settings))),
      },
    });
    await tx.payment.update({ where: { id: p.id }, data: { methodId: method.id, accountId: account.id, reference } });
    await audit(tx, actor, {
      action: "payment.method_corrected", entityType: "Payment", entityId: p.id,
      before: { receivedInto: p.account.name, method: p.method.name, reference: p.reference, amount: p.amount },
      after: { receivedInto: account.name, method: method.name, reference, amount: p.amount, ...(input.reason?.trim() && { reason: input.reason.trim() }) },
    });
  });
}
