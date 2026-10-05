import "server-only";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "../db";
import { ONLINE_RECORDER_ID } from "./online-recorder";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { rateLimit } from "../rate-limit";
import { recordPaymentTx } from "./payments";
import { ordersDueForPrompt, payOrdersFromMobileTx } from "./restaurant";
import { payTripFromMobileTx } from "./transport";
import { recordInvoicePaymentTx } from "./invoices";
import { notifyBookingGuestSoon } from "./guest-comms";
import { holdForPayment, isPayLater, releasePayingHold, type PayingHold } from "./booking-holds";
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
  | { purpose: "RESTAURANT"; orderIds: string[]; handedOverById?: string | null }
  | { purpose: "TRANSPORT"; tripId: string }
  | { purpose: "INVOICE"; invoiceId: string };

/** What a prompt is for, as one key — one live prompt per bill ("RES:<id>", "ORD:<sorted ids>", "TRIP:<id>", "INV:<id>"). */
const targetKeyOf = (t: PromptTarget, orderIds: string[]) =>
  t.purpose === "RESERVATION" ? `RES:${t.reservationId}` : t.purpose === "TRANSPORT" ? `TRIP:${t.tripId}` : t.purpose === "INVOICE" ? `INV:${t.invoiceId}` : `ORD:${[...orderIds].sort().join(",")}`;
/** A customer's prompt is given up sooner than a staff one (they are looking at their phone). */
const CUSTOMER_EXPIRES_MS = 10 * 60_000; // a phone's prompt times out within minutes; an abandoned payment never holds an order long
const newToken = () => randomBytes(18).toString("base64url");

/** Where a customer pays for a booking itself (the website's booking pages, the Hotel booking QR) — not a staying guest's bill. */
export const BOOKING_PAY_SOURCES: readonly string[] = ["BOOKING_PAGE", "WEBSITE", "HOTEL_QR"];

export type PromptOptions = {
  /** Where it started (WEBSITE, TABLE_QR, ROOM_QR, STAY_LINK, ORDER_LINK, BOOKING_PAGE, HOTEL_QR, DESK…). */
  source?: string | null;
  /** The browser's key for this "Pay" press — pressed twice (double tap, refresh, two tabs) it is the same attempt. */
  clientKey?: string | null;
};

/**
 * Send the payment prompt to the customer's phone — sent by staff ("Send to phone", `actor` set) or by the customer
 * themselves ("Pay online", `actor` null). The amount is always worked out here, never taken from the screen. Returns
 * the waiting attempt (or throws with a clear message).
 */
export async function requestMobilePayment(target: PromptTarget, rawPhone: string, actor: (Actor & { userId: string }) | null, now = new Date(), opts: PromptOptions = {}) {
  if (!ntzsEnabled()) throw new AppError(actor ? "Mobile money requests are not set up yet — add the nTZS key in the server settings." : "Online payment is not available right now — please pay at the hotel.", "CONFLICT");
  const customer = !actor;
  // The same press again: the same attempt (no second prompt, no second payment).
  if (opts.clientKey) {
    const again = await db.mobilePayment.findUnique({ where: { clientKey: opts.clientKey } });
    if (again) return { ...again, instructions: null, reused: true };
  }
  const phone = ntzsPhone(rawPhone);
  if (!phone) throw new AppError(customer ? "Enter your mobile-money number, e.g. 0712 345 678." : "Enter the customer's mobile-money number, e.g. 0712 345 678.", "VALIDATION", { phone: "Invalid" });
  // Before asking again: an earlier attempt for this bill that was approved late is recorded first — never paid twice.
  await settleLateAttempts(target, now);

  // A booking that holds no room yet (book now, pay later): its room is checked again and held while it is paid — or
  // "just taken". Moved to a room at another price: said first, nothing is asked until they press again (the room stays held).
  const hold = target.purpose === "RESERVATION" ? await holdForPayment(target.reservationId, actor ?? { label: "Customer · online" }, now) : null;
  if (hold?.held && hold.after !== hold.before) throw new AppError(priceMoved(hold, customer), "CONFLICT");
  try {
    return await promptFor(target, phone, actor, now, opts);
  } catch (e) {
    // Nothing went to the phone: the booking stops holding the room again at once (a live request keeps it).
    if (hold?.held && target.purpose === "RESERVATION") await releasePayingHold(target.reservationId, undefined, now).catch(() => null);
    throw e;
  }
}

/** "Room 104 was just taken — Room 105 (same type) is yours to pay for; the price is now…". */
function priceMoved(h: PayingHold, customer: boolean) {
  const m = h.moves[0];
  const room = m ? `Room ${m.from} was just taken — Room ${m.to} (${m.type}) is kept for you instead. ` : "";
  return customer
    ? `${room}The price is now ${fmt(h.after)} (was ${fmt(h.before)}). Press Pay again to pay ${fmt(h.after)}.`
    : `${m ? `Room ${m.from} was taken by a guest who paid first — the booking moved to Room ${m.to} (${m.type}). ` : ""}The price is now ${fmt(h.after)} (was ${fmt(h.before)}). Check the amount and send again.`;
}

async function promptFor(target: PromptTarget, phone: string, actor: (Actor & { userId: string }) | null, now: Date, opts: PromptOptions) {
  const customer = !actor;
  let amount: number, name: string | null = null, reservationId: string | null = null, orderIds: string[] = [], tripId: string | null = null, invoiceId: string | null = null;
  let payingHold = false;
  if (target.purpose === "TRANSPORT") {
    // A trip: its price, worked out here — once, and never for a trip paid, billed or closed.
    const t = await db.transportTrip.findUnique({ where: { id: target.tripId }, select: { id: true, status: true, charge: true, chargeId: true, paidAt: true, passengerName: true, sales: { where: { isVoided: false }, select: { id: true } } } });
    if (!t) throw new AppError("Trip not found.", "NOT_FOUND");
    if (t.status === "CANCELLED" || t.status === "NO_SHOW") throw new AppError("This trip is closed — nothing to pay.", "CONFLICT");
    if (t.chargeId || t.paidAt || t.sales.length) throw new AppError("This trip is already paid or on a bill.", "CONFLICT");
    if (!t.charge || t.charge <= 0) throw new AppError("This trip has no price yet — we confirm it with you first.", "CONFLICT");
    amount = t.charge; tripId = t.id; name = t.passengerName;
  } else if (target.purpose === "INVOICE") {
    // An issued invoice (a company's or a group's): what is still owed on it.
    const inv = await db.invoice.findUnique({ where: { id: target.invoiceId }, select: { id: true, status: true, balanceAmount: true, reservationId: true, corporateCustomer: { select: { companyName: true } } } });
    if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
    if (inv.reservationId) throw new AppError("This invoice follows its booking — pay the booking instead.", "CONFLICT");
    if (!["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status) || inv.balanceAmount <= 0) throw new AppError("Nothing is owed on this invoice.", "CONFLICT");
    amount = inv.balanceAmount; invoiceId = inv.id; name = inv.corporateCustomer?.companyName ?? null;
  } else if (target.purpose === "RESERVATION") {
    const r = await db.reservation.findUnique({ where: { id: target.reservationId }, select: { id: true, status: true, balanceAmount: true, externalData: true, holdUntil: true, guest: { select: { fullName: true } } } });
    if (!r) throw new AppError("Booking not found.", "NOT_FOUND");
    // Held only while it is paid (booked to pay later, or an enquiry): a request staff send times out like the guest's own,
    // so the room is never kept for hours on a request nobody approves.
    payingHold = r.status === "RESERVED" && !!r.holdUntil && (isPayLater(r.externalData) || marksPayingHold(r.externalData));
    if (r.status === "CANCELLED" || r.status === "NO_SHOW") throw new AppError("This booking is closed — nothing to pay.", "CONFLICT");
    amount = Math.round(target.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new AppError("Enter the amount.", "VALIDATION", { amount: "Required" });
    if (r.balanceAmount <= 0) throw new AppError("Nothing is owed on this booking.", "CONFLICT");
    if (amount > r.balanceAmount) throw new AppError(`That is more than ${customer ? "is owed" : "the guest owes"} (${fmt(r.balanceAmount)}).`, "VALIDATION", { amount: "Exceeds balance" });
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
  if (amount < NTZS_MIN_TZS) throw new AppError(`Mobile-money payments start at ${fmt(NTZS_MIN_TZS)}.`, "VALIDATION", { amount: "Too small" });
  const targetKey = targetKeyOf(target, orderIds);

  // One live prompt per bill — decided under a lock on the bill, so two presses at once cannot both send one.
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${targetKey}))`;
    const live = await tx.mobilePayment.findFirst({
      where: {
        status: "PENDING", completedAt: null,
        OR: [{ targetKey }, ...(reservationId ? [{ reservationId }] : tripId ? [{ tripId }] : invoiceId ? [{ invoiceId }] : [{ orderIds: { hasSome: orderIds } }])],
        createdAt: { gt: new Date(now.getTime() - (customer ? CUSTOMER_EXPIRES_MS : PROMPT_BUSY_MS)) },
      },
      orderBy: { createdAt: "desc" },
    });
    // A customer pressing Pay again (another tab, a new phone) sees the prompt already on its way; staff are told.
    if (live && customer) return { mp: live, reused: true };
    if (live) throw new AppError("A payment request for this bill is already waiting on the customer's phone — ask them to confirm it, or cancel it first.", "CONFLICT");
    const mp = await tx.mobilePayment.create({
      data: {
        purpose: target.purpose, amount, phone, reservationId, orderIds, tripId, invoiceId, livemode: ntzsLive(), requestedById: actor?.userId ?? null,
        initiator: customer ? "CUSTOMER" : "STAFF", source: opts.source ?? (customer ? "WEBSITE" : "DESK"), publicToken: newToken(), clientKey: opts.clientKey ?? null,
        targetKey, expiresAt: new Date(now.getTime() + (customer || payingHold ? CUSTOMER_EXPIRES_MS : PROMPT_EXPIRES_MS)),
        handedOverById: target.purpose === "RESTAURANT" ? target.handedOverById ?? null : null,
      },
    });
    return { mp, reused: false };
  }).catch(async (e) => {
    // Two presses with the same key at once: the other one made it.
    if (opts.clientKey && isUniqueViolation(e)) return { mp: await db.mobilePayment.findUniqueOrThrow({ where: { clientKey: opts.clientKey } }), reused: true };
    throw e;
  });
  if (created.reused) return { ...created.mp, instructions: null, reused: true };
  const mp = created.mp;

  const res = await createNtzsDeposit({ amountTzs: amount, phone, reference: mp.id, name });
  if (!res.ok) {
    // Only a clear refusal means no prompt went out. No answer (timed out), a server error or an answer without an id
    // may have sent it all the same: the attempt keeps waiting a short while — the bill stays locked against a second
    // prompt, the webhook still finds it by our reference, and it times out by itself if nothing comes.
    const refused = typeof res.status === "number" && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409;
    if (refused) {
      await db.mobilePayment.updateMany({ where: { id: mp.id, status: "PENDING", completedAt: null }, data: { status: "FAILED", lastError: res.error.slice(0, 500) } });
      throw new AppError(customer ? friendlyForCustomer(res.error, target.purpose) : res.error, "CONFLICT");
    }
    console.warn("[ntzs] prompt not confirmed by nTZS — kept waiting", { id: mp.id, httpStatus: res.status ?? null, error: res.error });
    await db.mobilePayment.updateMany({
      where: { id: mp.id, status: "PENDING", completedAt: null },
      data: { lastError: `nTZS did not confirm the request (${res.error}) — if it reached the phone and they pay, it is still recorded automatically.`.slice(0, 500), expiresAt: new Date(now.getTime() + CUSTOMER_EXPIRES_MS) },
    });
    const waiting = await db.mobilePayment.findUniqueOrThrow({ where: { id: mp.id } });
    return { ...waiting, instructions: null, reused: false };
  }
  const sent = await db.mobilePayment.update({ where: { id: mp.id }, data: { depositId: res.data.id, pspReference: res.data.pspReference ?? null } });
  await audit(db, actor ?? { label: "Customer · online" }, {
    action: "mobile_payment.requested", entityType: "MobilePayment", entityId: mp.id,
    after: { amount, phone: maskPhone(phone), purpose: target.purpose, reservationId, orders: orderIds.length, depositId: res.data.id, live: sent.livemode, by: customer ? "customer" : "staff", source: sent.source },
  });
  return { ...sent, instructions: res.data.instructions ?? null, reused: false };
}

/**
 * Earlier attempts for the same bill (the last few hours) not recorded yet — still waiting, timed out, stopped, marked
 * failed — are asked about once more: money nTZS did collect is recorded before anything new is asked.
 */
async function settleLateAttempts(target: PromptTarget, now: Date) {
  const bill = target.purpose === "RESERVATION" ? { reservationId: target.reservationId }
    : target.purpose === "TRANSPORT" ? { tripId: target.tripId }
    : target.purpose === "INVOICE" ? { invoiceId: target.invoiceId }
    : { orderIds: { hasSome: target.orderIds } };
  const late = await db.mobilePayment.findMany({
    where: { ...bill, status: { in: ["PENDING", "EXPIRED", "FAILED", "CANCELLED"] }, completedAt: null, depositId: { not: null }, createdAt: { gt: new Date(now.getTime() - 6 * 3_600_000) } },
    orderBy: { createdAt: "desc" }, take: 3, select: { id: true },
  });
  for (const m of late) await checkMobilePayment(m.id, "check", now).catch(() => null);
}

/** What a customer sees when nTZS refuses: plain words, never the provider's technical message — and where else to pay. */
export function friendlyForCustomer(error: string, purpose: PromptTarget["purpose"] = "RESERVATION") {
  const elsewhere = purpose === "RESTAURANT" ? "pay at the counter" : purpose === "RESERVATION" ? "pay at the hotel" : "contact us";
  if (/phone|number/i.test(error)) return "That number cannot receive a mobile-money payment request — check it and try again.";
  if (/amount/i.test(error)) return `This amount cannot be paid online — please ${elsewhere}.`;
  if (/busy|try again|did not answer|timed out/i.test(error)) return "The payment service is busy — please try again in a moment.";
  return `Online payment is not available right now — please try again, or ${elsewhere}.`;
}

/** Why a request was refused, in a few plain words (the payment page says what to do next itself). */
export function refusalReason(error: string) {
  if (/phone|number/i.test(error)) return "That number cannot receive a mobile-money payment request — check it and try again.";
  if (/amount/i.test(error)) return "This amount cannot be paid online.";
  if (/busy|try again|did not answer|timed out/i.test(error)) return "The payment service is busy — please try again in a moment.";
  return "Online payment did not start.";
}

/** A desk enquiry being paid (see booking-holds: held only while it is paid). */
const marksPayingHold = (data: unknown) => !!data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>).payingHold === true;

/** "255712345678" → "0712 ••• 678" (what staff screens and the audit show). */
export const maskPhone = (p: string) => `0${p.slice(3, 6)} ••• ${p.slice(-3)}`;

export { ONLINE_RECORDER_ID };

/**
 * Who the payment is recorded by: the staff member who sent the prompt (as if they had recorded it) — or, for a
 * customer paying from their phone by themselves, "Customer (paid by phone)" (never a person who did not handle it).
 */
async function settleActor(mp: MobilePayment): Promise<Actor & { userId: string }> {
  // Checked when the prompt was sent (payments.record / revenue.record): the confirmation itself is from nTZS.
  const permissions = new Set(["payments.record", "revenue.record", "restaurant.payments.confirm"]);
  if (!mp.requestedById) return { userId: ONLINE_RECORDER_ID, label: "Customer (paid by phone)", role: "Paid by phone", permissions };
  const u = await db.user.findUnique({ where: { id: mp.requestedById }, select: { fullName: true, role: { select: { name: true } } } });
  return { userId: mp.requestedById, label: `${u?.fullName ?? "Staff"} · nTZS`, role: u?.role.name ?? null, permissions };
}

/**
 * nTZS says the money came in: record it — once. `received` is what nTZS confirmed (the prompt's amount when absent).
 * Safe to call from the webhook, the screen and the scheduled run at the same time (the row is locked).
 */
export async function settleMobilePayment(id: string, info: { received?: number | null; pspReference?: string | null; source: "webhook" | "check" | "sweep" }, now = new Date()) {
  try {
    const out = await recordMobilePayment(id, info, now);
    // Recorded just now (exactly once, whichever way nTZS's answer came): a booking the guest paid is confirmed — tell them.
    if (out.recorded) await bookingPaidNotice(out.mp);
    return out;
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

/**
 * A room booking the guest paid online themselves (the website, the Hotel booking QR) is confirmed by its payment: the
 * guest gets the booking details by message — when a provider is connected and the hotel has them on — sent once the
 * answer to nTZS (or to the guest's page) has gone. Never throws.
 */
async function bookingPaidNotice(mp: MobilePayment) {
  if (mp.purpose !== "RESERVATION" || !mp.reservationId || mp.initiator !== "CUSTOMER" || !BOOKING_PAY_SOURCES.includes(mp.source ?? "")) return;
  try {
    const r = await db.reservation.findUnique({ where: { id: mp.reservationId }, select: { kind: true, status: true, source: { select: { code: true } } } });
    if (r?.kind === "STAY" && r.status === "CONFIRMED" && ["WEBSITE", "HOTEL_QR"].includes(r.source.code)) await notifyBookingGuestSoon(mp.reservationId, "BOOKING_CONFIRMED");
  } catch (e) {
    console.error("[ntzs] booking confirmation message", mp.reservationId, e);
  }
}

async function recordMobilePayment(id: string, info: { received?: number | null; pspReference?: string | null; source: "webhook" | "check" | "sweep" }, now: Date) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "mobile_payments" WHERE "id" = ${id} FOR UPDATE`;
    const mp = await tx.mobilePayment.findUnique({ where: { id } });
    if (!mp) throw new AppError("Payment request not found.", "NOT_FOUND");
    // Recorded already (whatever its status says now): never twice.
    if (mp.status === "COMPLETED" || mp.completedAt || mp.paymentId || mp.orderPaymentIds.length) return { mp, recorded: false };
    const received = Math.round(info.received && info.received > 0 ? info.received : mp.amount);
    const actor = await settleActor(mp);
    const method = await tx.paymentMethod.findUniqueOrThrow({ where: { code: NTZS_METHOD }, select: { id: true } });
    const reference = `nTZS ${info.pspReference || mp.pspReference || mp.depositId || mp.id}`.slice(0, 80);
    let paymentId: string | null = null, orderPaymentIds: string[] = [], note: string | null = null;

    if (mp.purpose === "RESERVATION" && mp.reservationId) {
      await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${mp.reservationId} FOR UPDATE`;
      const r = await tx.reservation.findUniqueOrThrow({ where: { id: mp.reservationId }, select: { balanceAmount: true, reference: true } });
      // Never more than is owed now (another payment or a discount since the prompt): the rest is flagged, not lost.
      const amount = Math.min(received, Math.max(0, r.balanceAmount));
      if (amount > 0) {
        const p = await recordPaymentTx(tx, { reservationId: mp.reservationId, amount, methodId: method.id, accountId: null, reference, notes: `Mobile money request to ${maskPhone(mp.phone)} · confirmed by nTZS`, internal: true }, actor);
        paymentId = p.id;
      }
      if (received > amount) note = `${fmt(received - amount)} more than ${r.reference} still owed came in by nTZS — refund it or put it on another bill.`;
    } else if (mp.purpose === "RESTAURANT") {
      const out = await payOrdersFromMobileTx(tx as unknown as Tx, mp.orderIds, received, { methodId: method.id, reference, handedOverById: mp.handedOverById }, actor, now);
      orderPaymentIds = out.paid.map((p) => p.paymentId);
      if (out.left > 0) note = `${fmt(out.left)} came in by nTZS but the order(s) no longer matched (paid already, changed or cancelled) — check the bill and refund or apply it.`;
    } else if (mp.purpose === "TRANSPORT" && mp.tripId) {
      const out = await payTripFromMobileTx(tx as unknown as Tx, mp.tripId, received, { methodId: method.id, reference }, actor);
      if (out.left > 0) note = out.saleId
        ? `${fmt(out.left)} more than the trip's price came in by nTZS — refund it or put it on another bill.`
        : `${fmt(out.left)} came in by nTZS but the trip no longer matched (paid, billed, its price changed or it was cancelled) — check it and refund or apply it.`;
    } else if (mp.purpose === "INVOICE" && mp.invoiceId) {
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${mp.invoiceId} FOR UPDATE`;
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: mp.invoiceId }, select: { number: true, status: true, balanceAmount: true } });
      const open = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status);
      const amount = open ? Math.min(received, Math.max(0, inv.balanceAmount)) : 0;
      if (amount > 0) {
        const p = await recordInvoicePaymentTx(tx as unknown as Tx, { invoiceId: mp.invoiceId, amount, methodId: method.id, accountId: null, reference, notes: `Paid online from ${maskPhone(mp.phone)} · confirmed by nTZS` }, actor, { internal: true });
        paymentId = p.id;
      }
      if (received > amount) note = `${fmt(received - amount)} more than invoice ${inv.number} still owed came in by nTZS — refund it or put it on another bill.`;
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

/**
 * Ask nTZS how a payment not recorded yet is doing (the waiting screens, the scheduled run, "Check with nTZS"). Money
 * nTZS has is recorded — whatever our side says now (waiting, timed out, stopped, marked failed). `answered`: nTZS
 * replied (otherwise nothing could be learned now — logged).
 */
export async function checkMobilePaymentWithAnswer(id: string, source: "check" | "sweep" = "check", now = new Date()): Promise<{ mp: MobilePayment; answered: boolean; ntzsStatus: string | null; error: string | null }> {
  const mp = await db.mobilePayment.findUnique({ where: { id } });
  if (!mp) throw new AppError("Payment request not found.", "NOT_FOUND");
  if (mp.status === "COMPLETED" || !mp.depositId) return { mp, answered: false, ntzsStatus: null, error: mp.depositId ? null : "nTZS gave no reference for this request" };
  await db.mobilePayment.update({ where: { id }, data: { lastCheckedAt: now } });
  const res = await getNtzsDeposit(mp.depositId);
  if (!res.ok) {
    console.warn("[ntzs] could not ask nTZS about a deposit", { id, depositId: mp.depositId, httpStatus: res.status ?? null, error: res.error });
    return { mp, answered: false, ntzsStatus: null, error: res.error };
  }
  const status = res.data.status || null;
  if (depositCompleted(res.data.status)) {
    const done = (await settleMobilePayment(id, { received: res.data.amountTzs ?? null, pspReference: res.data.pspReference ?? null, source }, now)).mp;
    return { mp: done, answered: true, ntzsStatus: status, error: null };
  }
  if (!depositFailed(res.data.status) && res.data.status !== "submitted" && res.data.status !== "pending" && res.data.status !== "processing") {
    console.info(`[ntzs] deposit ${mp.depositId} reads "${res.data.status || "(no status)"}" — still waiting`);
  }
  if (mp.status === "PENDING" && depositFailed(res.data.status)) {
    await db.mobilePayment.updateMany({ where: { id, status: "PENDING", completedAt: null }, data: { status: "FAILED", lastError: `The customer did not pay (${res.data.status}).` } });
    await paymentEnded(mp, now);
    return { mp: await db.mobilePayment.findUniqueOrThrow({ where: { id } }), answered: true, ntzsStatus: status, error: null };
  }
  return { mp, answered: true, ntzsStatus: status, error: null };
}
export async function checkMobilePayment(id: string, source: "check" | "sweep" = "check", now = new Date()) {
  return (await checkMobilePaymentWithAnswer(id, source, now)).mp;
}

/** Staff stop waiting (the customer will pay another way). If the money still comes in, it is recorded all the same. */
export async function cancelMobilePayment(id: string, actor: Actor) {
  const mp = await db.mobilePayment.findUnique({ where: { id } });
  if (!mp) throw new AppError("Payment request not found.", "NOT_FOUND");
  if (mp.status !== "PENDING") return mp;
  // Paid already (the customer approved just now)? Then it is recorded, not cancelled — nobody collects it again.
  const asked = mp.depositId ? await checkMobilePayment(id).catch(() => mp) : mp;
  if (asked.status === "COMPLETED") return asked;
  // Only a prompt still waiting is cancelled (one being recorded right now stays recorded).
  const done = await db.mobilePayment.updateMany({ where: { id, status: "PENDING", completedAt: null }, data: { status: "CANCELLED" } });
  if (done.count) {
    await audit(db, actor, { action: "mobile_payment.cancelled", entityType: "MobilePayment", entityId: id, after: { amount: mp.amount } });
    await paymentEnded(mp);
  }
  return db.mobilePayment.findUniqueOrThrow({ where: { id } });
}

/**
 * A booking's payment ended without the money (stopped, declined on the phone): a booking held only while it is paid
 * (pay later) lets its room go at once — no waiting for the 30 minutes (booking-holds; a live request or any payment
 * keeps it). Never throws.
 */
async function paymentEnded(mp: Pick<MobilePayment, "purpose" | "reservationId">, now = new Date()) {
  if (mp.purpose !== "RESERVATION" || !mp.reservationId) return;
  await releasePayingHold(mp.reservationId, undefined, now, { reason: "The payment was not completed — the room is not held" }).catch((e) => console.error("[ntzs] could not let the room go", mp.reservationId, e));
}

/**
 * The scheduled run: prompts still waiting (a webhook that never came) are asked about once more; one nobody answered
 * for 2 hours is given up. Stops starting new checks at `deadline`.
 */
export async function sweepMobilePayments(now = new Date(), deadline = Date.now() + 10_000) {
  if (!ntzsEnabled()) return { checked: 0, expired: 0 };
  // Everything not recorded from the last two days — waiting, and also stopped / timed out / marked failed (a customer
  // can approve late): nTZS is asked again, the longest-unchecked first.
  const waiting = await db.mobilePayment.findMany({
    where: { status: { in: ["PENDING", "CANCELLED", "EXPIRED", "FAILED"] }, completedAt: null, depositId: { not: null }, createdAt: { gt: new Date(now.getTime() - 48 * 3_600_000), lt: new Date(now.getTime() - 60_000) } },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], take: 30, select: { id: true, status: true, createdAt: true },
  });
  // A request nTZS never confirmed (no reference to ask about) stops waiting once its time is up.
  const unconfirmed = await db.mobilePayment.updateMany({ where: { status: "PENDING", completedAt: null, depositId: null, expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
  let checked = 0, expired = unconfirmed.count;
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

/**
 * While staff use the system: payments not recorded yet are checked with nTZS — at most every two minutes, and only
 * when one has not been asked about for a while (runs after the page is sent, never slowing it).
 */
export async function sweepMobilePaymentsIfDue(now = new Date()) {
  if (!ntzsEnabled()) return;
  const due = await db.mobilePayment.count({
    where: {
      status: { in: ["PENDING", "CANCELLED", "EXPIRED", "FAILED"] }, completedAt: null, depositId: { not: null },
      createdAt: { gt: new Date(now.getTime() - 48 * 3_600_000), lt: new Date(now.getTime() - 60_000) },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 2 * 60_000) } }],
    },
  });
  if (!due) return;
  try { await rateLimit("ntzs-sweep", 1, 120); } catch { return; }
  await sweepMobilePayments(now, Date.now() + 8_000);
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
