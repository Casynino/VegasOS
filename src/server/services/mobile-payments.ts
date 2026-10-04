import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { recordPaymentTx } from "./payments";
import { ordersDueForPrompt, payOrdersFromMobileTx } from "./restaurant";
import { createNtzsDeposit, depositCompleted, depositFailed, getNtzsDeposit, ntzsEnabled, ntzsLive, ntzsPhone, NTZS_MIN_TZS } from "./ntzs";
import type { Actor } from "./reservations";
import type { MobilePayment } from "@/generated/prisma/client";

/**
 * MOBILE-MONEY PROMPTS (nTZS) — reception sends one for a guest's bill, the Restaurant Counter (or reception) for an
 * order or a table's bill. The customer approves it on their phone; when nTZS confirms (webhook, or the screen / the
 * scheduled run asking), the payment is recorded by itself — exactly once — on the bill or the orders, into the nTZS
 * account, as the payment of the person who sent the prompt. Money that came in is always recorded, even when the
 * prompt was cancelled or timed out in the meantime.
 */

/** The nTZS payment method (its account is the nTZS account — never offered to staff by hand). */
const NTZS_METHOD = "NTZS";
/** A prompt nobody answered is given up after this long (a late confirmation is still recorded). */
const PROMPT_EXPIRES_MS = 2 * 3_600_000;
/** A second prompt for the same bill is refused while the first one is this fresh — ask the customer to approve it. */
const PROMPT_BUSY_MS = 3 * 60_000;

const fmt = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;

export type PromptTarget =
  | { purpose: "RESERVATION"; reservationId: string; amount: number }
  | { purpose: "RESTAURANT"; orderIds: string[]; handedOverById?: string | null };

/** Send the payment prompt to the customer's phone. Returns the waiting prompt (or throws with a clear message). */
export async function requestMobilePayment(target: PromptTarget, rawPhone: string, actor: Actor & { userId: string }, now = new Date()) {
  if (!ntzsEnabled()) throw new AppError("Mobile-money prompts are not set up yet — add the nTZS key in the server settings.", "CONFLICT");
  const phone = ntzsPhone(rawPhone);
  if (!phone) throw new AppError("Enter the customer's mobile-money number, e.g. 0712 345 678.", "VALIDATION", { phone: "Invalid" });

  let amount: number, name: string | null = null, reservationId: string | null = null, orderIds: string[] = [];
  if (target.purpose === "RESERVATION") {
    const r = await db.reservation.findUnique({ where: { id: target.reservationId }, select: { id: true, status: true, balanceAmount: true, guest: { select: { fullName: true } } } });
    if (!r) throw new AppError("Booking not found.", "NOT_FOUND");
    if (r.status === "CANCELLED" || r.status === "NO_SHOW") throw new AppError("This booking is closed — nothing to collect.", "CONFLICT");
    amount = Math.round(target.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new AppError("Enter the amount.", "VALIDATION", { amount: "Required" });
    if (r.balanceAmount <= 0) throw new AppError("Nothing is owed on this booking.", "CONFLICT");
    if (amount > r.balanceAmount) throw new AppError(`That is more than the guest owes (${fmt(r.balanceAmount)}).`, "VALIDATION", { amount: "Exceeds balance" });
    reservationId = r.id; name = r.guest.fullName;
  } else {
    if (target.handedOverById) {
      const ok = await db.user.count({
        where: {
          id: target.handedOverById, isActive: true,
          role: { AND: [
            { permissions: { some: { permission: { code: "restaurant.serve" } } } },
            { permissions: { none: { permission: { code: { in: ["restaurant.device", "dashboard.manager", "dashboard.owner", "dashboard.admin"] } } } } },
          ] },
        },
      });
      if (!ok) throw new AppError("Choose the waiter who brought the order.", "VALIDATION", { handedOverById: "Invalid" });
    }
    const due = await ordersDueForPrompt(target.orderIds);
    amount = due.total; orderIds = due.orders.map((o) => o.id); name = due.orders[0]?.customerName ?? null;
  }
  if (amount < NTZS_MIN_TZS) throw new AppError(`Mobile-money prompts start at ${fmt(NTZS_MIN_TZS)}.`, "VALIDATION", { amount: "Too small" });

  // One prompt at a time for a bill: the customer approves the one already on their phone (or staff cancel it).
  const busy = await db.mobilePayment.findFirst({
    where: {
      status: "PENDING", createdAt: { gt: new Date(now.getTime() - PROMPT_BUSY_MS) },
      ...(reservationId ? { reservationId } : { orderIds: { hasSome: orderIds } }),
    },
    select: { id: true },
  });
  if (busy) throw new AppError("A payment prompt for this bill is already waiting on the customer's phone — ask them to approve it, or cancel it first.", "CONFLICT");

  const mp = await db.mobilePayment.create({
    data: {
      purpose: target.purpose, amount, phone, reservationId, orderIds, livemode: ntzsLive(), requestedById: actor.userId,
      handedOverById: target.purpose === "RESTAURANT" ? target.handedOverById ?? null : null,
    },
  });
  const res = await createNtzsDeposit({ amountTzs: amount, phone, reference: mp.id, name });
  if (!res.ok) {
    await db.mobilePayment.update({ where: { id: mp.id }, data: { status: "FAILED", lastError: res.error.slice(0, 500) } });
    throw new AppError(res.error, "CONFLICT");
  }
  const sent = await db.mobilePayment.update({ where: { id: mp.id }, data: { depositId: res.data.id, pspReference: res.data.pspReference ?? null } });
  await audit(db, actor, {
    action: "mobile_payment.requested", entityType: "MobilePayment", entityId: mp.id,
    after: { amount, phone: maskPhone(phone), purpose: target.purpose, reservationId, orders: orderIds.length, depositId: res.data.id, live: sent.livemode },
  });
  return { ...sent, instructions: res.data.instructions ?? null };
}

/** "255712345678" → "0712 ••• 678" (what staff screens and the audit show). */
export const maskPhone = (p: string) => `0${p.slice(3, 6)} ••• ${p.slice(-3)}`;

/** The staff member who sent the prompt — the payment is theirs (as if they had recorded it). */
async function promptActor(mp: MobilePayment): Promise<Actor & { userId: string }> {
  const u = await db.user.findUnique({ where: { id: mp.requestedById }, select: { id: true, fullName: true, role: { select: { name: true } } } });
  return {
    userId: mp.requestedById, label: `${u?.fullName ?? "Staff"} · nTZS`, role: u?.role.name ?? null,
    // Checked when the prompt was sent (payments.record / revenue.record): the confirmation itself is from nTZS.
    permissions: new Set(["payments.record", "revenue.record", "restaurant.payments.confirm"]),
  };
}

/**
 * nTZS says the money came in: record it — once. `received` is what nTZS confirmed (the prompt's amount when absent).
 * Safe to call from the webhook, the screen and the scheduled run at the same time (the row is locked).
 */
export async function settleMobilePayment(id: string, info: { received?: number | null; pspReference?: string | null; source: "webhook" | "check" | "sweep" }, now = new Date()) {
  try {
    return await recordMobilePayment(id, info, now);
  } catch (e) {
    // The money came in but could not go on the bill (a rule of the bill refused it): keep it as received, needing
    // attention — shown to staff, never retried forever. Anything else (the database busy…) is tried again.
    if (!(e instanceof AppError) || e.code === "NOT_FOUND") throw e;
    const received = Math.round(info.received && info.received > 0 ? info.received : 0);
    const flagged = await db.mobilePayment.updateMany({
      where: { id, completedAt: null, paymentId: null },
      data: { status: "COMPLETED", completedAt: now, pspReference: info.pspReference ?? undefined, attentionAt: now,
        lastError: `${received ? fmt(received) : "The money"} came in by nTZS but could not be recorded: ${e.message} — record it by hand or refund it.`.slice(0, 500) },
    });
    if (flagged.count) await audit(db, { label: "nTZS" }, { action: "mobile_payment.needs_attention", entityType: "MobilePayment", entityId: id, after: { reason: e.message, received } });
    return { mp: await db.mobilePayment.findUniqueOrThrow({ where: { id } }), recorded: false };
  }
}

async function recordMobilePayment(id: string, info: { received?: number | null; pspReference?: string | null; source: "webhook" | "check" | "sweep" }, now: Date) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "mobile_payments" WHERE "id" = ${id} FOR UPDATE`;
    const mp = await tx.mobilePayment.findUnique({ where: { id } });
    if (!mp) throw new AppError("Payment prompt not found.", "NOT_FOUND");
    // Recorded already (whatever its status says now): never twice.
    if (mp.status === "COMPLETED" || mp.completedAt || mp.paymentId || mp.orderPaymentIds.length) return { mp, recorded: false };
    const received = Math.round(info.received && info.received > 0 ? info.received : mp.amount);
    const actor = await promptActor(mp);
    const method = await tx.paymentMethod.findUniqueOrThrow({ where: { code: NTZS_METHOD }, select: { id: true } });
    const reference = `nTZS ${info.pspReference || mp.pspReference || mp.depositId || mp.id}`.slice(0, 80);
    let paymentId: string | null = null, orderPaymentIds: string[] = [], note: string | null = null;

    if (mp.purpose === "RESERVATION" && mp.reservationId) {
      await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${mp.reservationId} FOR UPDATE`;
      const r = await tx.reservation.findUniqueOrThrow({ where: { id: mp.reservationId }, select: { balanceAmount: true, reference: true } });
      // Never more than is owed now (another payment or a discount since the prompt): the rest is flagged, not lost.
      const amount = Math.min(received, Math.max(0, r.balanceAmount));
      if (amount > 0) {
        const p = await recordPaymentTx(tx, { reservationId: mp.reservationId, amount, methodId: method.id, accountId: null, reference, notes: `Mobile-money prompt to ${maskPhone(mp.phone)} · confirmed by nTZS`, internal: true }, actor);
        paymentId = p.id;
      }
      if (received > amount) note = `${fmt(received - amount)} more than ${r.reference} still owed came in by nTZS — refund it or put it on another bill.`;
    } else if (mp.purpose === "RESTAURANT") {
      const out = await payOrdersFromMobileTx(tx as unknown as Tx, mp.orderIds, received, { methodId: method.id, reference, handedOverById: mp.handedOverById }, actor, now);
      orderPaymentIds = out.paid.map((p) => p.paymentId);
      if (out.left > 0) note = `${fmt(out.left)} came in by nTZS but the order(s) no longer matched (paid already, changed or cancelled) — check the bill and refund or apply it.`;
    }

    const done = await tx.mobilePayment.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: now, paymentId, orderPaymentIds, pspReference: info.pspReference ?? mp.pspReference, lastError: note, attentionAt: note ? now : null },
    });
    await audit(tx, actor, {
      action: "mobile_payment.completed", entityType: "MobilePayment", entityId: id,
      after: { received, amount: mp.amount, via: info.source, payment: paymentId, orderPayments: orderPaymentIds.length, ...(note && { attention: note }) },
    });
    return { mp: done, recorded: true };
  }, { timeout: 20_000, maxWait: 10_000 });
}

/** Ask nTZS how a waiting prompt is doing (the screen waiting for the customer, the scheduled run). */
export async function checkMobilePayment(id: string, source: "check" | "sweep" = "check", now = new Date()) {
  const mp = await db.mobilePayment.findUnique({ where: { id } });
  if (!mp) throw new AppError("Payment prompt not found.", "NOT_FOUND");
  if (mp.status === "COMPLETED" || !mp.depositId) return mp;
  const res = await getNtzsDeposit(mp.depositId);
  if (!res.ok) return mp; // nTZS not answering: still waiting
  if (depositCompleted(res.data.status)) return (await settleMobilePayment(id, { received: res.data.amountTzs ?? null, pspReference: res.data.pspReference ?? null, source }, now)).mp;
  if (mp.status === "PENDING" && depositFailed(res.data.status)) {
    await db.mobilePayment.updateMany({ where: { id, status: "PENDING", completedAt: null }, data: { status: "FAILED", lastError: `The customer did not pay (${res.data.status}).` } });
    return db.mobilePayment.findUniqueOrThrow({ where: { id } });
  }
  return mp;
}

/** Staff stop waiting (the customer will pay another way). If the money still comes in, it is recorded all the same. */
export async function cancelMobilePayment(id: string, actor: Actor) {
  const mp = await db.mobilePayment.findUnique({ where: { id } });
  if (!mp) throw new AppError("Payment prompt not found.", "NOT_FOUND");
  if (mp.status !== "PENDING") return mp;
  // Only a prompt still waiting is cancelled (one being recorded right now stays recorded).
  const done = await db.mobilePayment.updateMany({ where: { id, status: "PENDING", completedAt: null }, data: { status: "CANCELLED" } });
  if (done.count) await audit(db, actor, { action: "mobile_payment.cancelled", entityType: "MobilePayment", entityId: id, after: { amount: mp.amount } });
  return db.mobilePayment.findUniqueOrThrow({ where: { id } });
}

/**
 * The scheduled run: prompts still waiting (a webhook that never came) are asked about once more; one nobody answered
 * for 2 hours is given up. Stops starting new checks at `deadline`.
 */
export async function sweepMobilePayments(now = new Date(), deadline = Date.now() + 10_000) {
  if (!ntzsEnabled()) return { checked: 0, expired: 0 };
  const waiting = await db.mobilePayment.findMany({
    where: { status: { in: ["PENDING", "CANCELLED"] }, depositId: { not: null }, createdAt: { gt: new Date(now.getTime() - 48 * 3_600_000), lt: new Date(now.getTime() - 60_000) } },
    orderBy: { createdAt: "asc" }, take: 30, select: { id: true, status: true, createdAt: true },
  });
  let checked = 0, expired = 0;
  for (const w of waiting) {
    if (Date.now() > deadline) break;
    const mp = await checkMobilePayment(w.id, "sweep", now).catch(() => null);
    checked += 1;
    if (mp?.status === "PENDING" && now.getTime() - w.createdAt.getTime() > PROMPT_EXPIRES_MS) {
      const r = await db.mobilePayment.updateMany({ where: { id: w.id, status: "PENDING", completedAt: null }, data: { status: "EXPIRED" } });
      expired += r.count;
    }
  }
  return { checked, expired };
}

/** The webhook: find the prompt nTZS is talking about (by its deposit id, or our reference). */
export async function findMobilePayment(ref: { depositId?: string | null; reference?: string | null }) {
  if (ref.depositId) {
    const byDeposit = await db.mobilePayment.findUnique({ where: { depositId: ref.depositId } });
    if (byDeposit) return byDeposit;
  }
  if (ref.reference && /^[a-z0-9]{20,40}$/i.test(ref.reference)) return db.mobilePayment.findUnique({ where: { id: ref.reference } });
  return null;
}

/** Mobile-money that came in but needs a person (more than was owed, the bill changed, or it could not be recorded). */
export async function mobilePaymentsNeedingAttention(purpose?: "RESERVATION" | "RESTAURANT") {
  const rows = await db.mobilePayment.findMany({
    where: { attentionAt: { not: null }, resolvedAt: null, ...(purpose ? { purpose } : {}) },
    orderBy: { attentionAt: "desc" }, take: 30,
    select: { id: true, amount: true, phone: true, purpose: true, lastError: true, attentionAt: true, reservationId: true, orderIds: true, pspReference: true, depositId: true, requestedBy: { select: { fullName: true } }, reservation: { select: { reference: true, guest: { select: { fullName: true } } } } },
  });
  return rows.map((r) => ({ ...r, phone: maskPhone(r.phone) }));
}

/** Someone dealt with it (refunded, recorded by hand or put on another bill): it leaves the list. */
export async function resolveMobilePaymentAttention(id: string, note: string, actor: Actor & { userId: string }) {
  const r = await db.mobilePayment.updateMany({ where: { id, attentionAt: { not: null }, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actor.userId, resolvedNote: note.slice(0, 300) } });
  if (!r.count) throw new AppError("Already dealt with.", "CONFLICT");
  await audit(db, actor, { action: "mobile_payment.resolved", entityType: "MobilePayment", entityId: id, after: { note } });
}
