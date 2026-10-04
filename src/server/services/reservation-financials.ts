import "server-only";
import type { Tx } from "../db";
import { addDays, eachDate, fromDbDate, toDbDate } from "@/lib/time/business-date";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { syncInvoice } from "./invoices";
import { channelFor, quoteStay } from "./pricing";
import { AppError } from "../errors";

/** Stay statuses that hold a room and earn room revenue. */
export const REVENUE_STATUSES: ReservationStatus[] = ["RESERVED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
export const ACTIVE_STATUSES: ReservationStatus[] = ["RESERVED", "CONFIRMED", "CHECKED_IN"];

/**
 * Room revenue rule: a booked night is only a price (what the guest will owe).
 * It becomes room income once the guest has checked in. Use this filter on
 * every room-night query that counts income or rooms sold.
 */
export const EARNED_NIGHT = { reservationRoom: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] as ReservationStatus[] } } };

/**
 * Keep the per-night ledger of one reservation room in step with its dates.
 * Each night carries its own price snapshot (base, promotion, manual
 * discount), so:
 *  - nights already on the ledger keep the price they were sold at, even if
 *    room prices or promotions change later;
 *  - new nights (a new booking, an extension, an overstay, moved dates) are
 *    priced by the PricingService at today's prices and promotions;
 *  - nights no longer in the stay are removed.
 * The manual (negotiated) discount per night applies to every night.
 * The room's gross / discount / net totals are then summed from its nights,
 * which occupancy, room revenue, invoices and checkout all read from.
 */
export async function syncRoomNights(tx: Tx, reservationRoomId: string): Promise<void> {
  const rr = await tx.reservationRoom.findUniqueOrThrow({
    where: { id: reservationRoomId },
    include: { reservation: { select: { sourceId: true, source: { select: { code: true } } } }, roomType: { select: { baseRate: true } }, nightsLedger: true },
  });
  if (!REVENUE_STATUSES.includes(rr.status)) {
    await tx.roomNight.deleteMany({ where: { reservationRoomId } });
    return;
  }

  const arrival = fromDbDate(rr.arrivalDate);
  const wanted = rr.isDayUse ? [arrival] : eachDate(arrival, fromDbDate(rr.departureDate));
  const keep = new Set(wanted);
  const existing = new Map(rr.nightsLedger.map((n) => [fromDbDate(n.businessDate), n]));

  // Nights that left the stay (early departure, shortened or moved dates).
  const gone = rr.nightsLedger.filter((n) => !keep.has(fromDbDate(n.businessDate))).map((n) => n.id);
  if (gone.length) await tx.roomNight.deleteMany({ where: { id: { in: gone } } });

  // New nights: short time keeps its own flat price; overnight nights use today's price rules.
  const missing = wanted.filter((d) => !existing.has(d));
  const priced = new Map<string, { base: number; promoDiscount: number; promotion: { id: string; name: string } | null; priceRule?: { id: string; name: string } | null }>();
  if (missing.length) {
    if (rr.isDayUse) {
      priced.set(missing[0], { base: rr.ratePerNight, promoDiscount: 0, promotion: null });
    } else {
      // Priced now, at today's base price and promotions: for a new booking that is exactly
      // what it was quoted; for an extension or overstay the new nights get today's prices.
      const q = await quoteStay(tx, {
        dates: missing, base: rr.roomType.baseRate, roomTypeId: rr.roomTypeId, roomId: rr.roomId, channel: channelFor(rr.reservation.source.code),
      });
      for (const n of q.nights) priced.set(n.date, { base: n.base, promoDiscount: n.promoDiscount, promotion: n.promotion, priceRule: n.priceRule });
    }
  }

  const manualFor = (base: number, promo: number) => Math.min(Math.max(0, rr.discountPerNight), base - promo);
  for (const d of missing) {
    const p = priced.get(d)!;
    const manual = manualFor(p.base, p.promoDiscount);
    await tx.roomNight.create({
      data: {
        reservationRoomId: rr.id, roomId: rr.roomId, roomTypeId: rr.roomTypeId, sourceId: rr.reservation.sourceId,
        businessDate: toDbDate(d), isDayUse: rr.isDayUse,
        grossAmount: p.base, promoDiscount: p.promoDiscount, manualDiscount: manual,
        promotionId: p.promotion?.id ?? null, promotionName: p.promotion?.name ?? null,
        priceRuleId: p.priceRule?.id ?? null, priceRuleName: p.priceRule?.name ?? null,
        discountAmount: p.promoDiscount + manual, netAmount: p.base - p.promoDiscount - manual,
      },
    });
  }
  // Nights already sold keep base & promotion, and the manual discount follows the booking's
  // current negotiated discount. Before arrival every night follows the booked room; once the
  // guest is in, each night keeps the room it was actually slept in (a move sets them itself).
  const followRoom = !["CHECKED_IN", "CHECKED_OUT"].includes(rr.status);
  for (const [d, n] of existing) {
    if (!keep.has(d)) continue;
    // A night given free by a manager stays free; a share of a manager's whole-bill discount stays on the night.
    const manual = n.complimentary ? n.grossAmount - n.promoDiscount : Math.min(n.grossAmount - n.promoDiscount, manualFor(n.grossAmount, n.promoDiscount) + n.billDiscount);
    const roomId = followRoom ? rr.roomId : n.roomId;
    const roomTypeId = followRoom ? rr.roomTypeId : n.roomTypeId;
    if (manual !== n.manualDiscount || n.roomId !== roomId || n.roomTypeId !== roomTypeId || n.sourceId !== rr.reservation.sourceId) {
      await tx.roomNight.update({
        where: { id: n.id },
        data: {
          roomId, roomTypeId, sourceId: rr.reservation.sourceId,
          manualDiscount: manual, discountAmount: n.promoDiscount + manual, netAmount: n.grossAmount - n.promoDiscount - manual,
        },
      });
    }
  }

  // The room's totals are the sum of its nights.
  const nights = await tx.roomNight.findMany({ where: { reservationRoomId: rr.id } });
  const gross = nights.reduce((s, n) => s + n.grossAmount, 0);
  const discount = nights.reduce((s, n) => s + n.discountAmount, 0);
  await tx.reservationRoom.update({
    where: { id: rr.id },
    data: { grossAmount: gross, discountAmount: discount, netAmount: gross - discount },
  });
}

/**
 * ReservationFinancialService — recompute cached gross / discount / net /
 * paid / balance and the reservation's overall dates & status from its rooms,
 * charges and posted payments. Call inside the same transaction as any change.
 */
export async function recalculateReservation(tx: Tx, reservationId: string): Promise<void> {
  const reservation = await tx.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: {
      rooms: true,
      charges: { where: { isVoided: false } },
      payments: { where: { status: "POSTED" } },
    },
  });

  const billable = reservation.rooms.filter((r) => REVENUE_STATUSES.includes(r.status));
  const gross = billable.reduce((s, r) => s + r.grossAmount, 0);
  const discount = billable.reduce((s, r) => s + r.discountAmount, 0);
  const charges = reservation.charges.reduce((s, c) => s + c.amount, 0);
  // A deposit that followed the bill onto a company / group invoice counts there, not here (never twice).
  const paid = reservation.payments.filter((p) => !p.invoiceId).reduce((s, p) => s + (p.kind === "PAYMENT" ? p.amount : -p.amount), 0);
  const net = gross - discount + charges;
  // Lines moved onto a company invoice are owed by the company now, not by the guest.
  const billedAgg = await tx.invoiceItem.aggregate({
    where: { reservationId, invoice: { reservationId: null, status: { notIn: ["CANCELLED", "VOID"] } } },
    _sum: { netAmount: true },
  });
  const billed = billedAgg._sum.netAmount ?? 0;

  const live = reservation.rooms.filter((r) => r.status !== "CANCELLED");
  const dated = live.length ? live : reservation.rooms;
  const arrival = dated.map((r) => fromDbDate(r.arrivalDate)).sort()[0];
  const departure = dated.map((r) => fromDbDate(r.departureDate)).sort().at(-1)!;

  await tx.reservation.update({
    where: { id: reservationId },
    data: {
      grossAmount: gross,
      discountAmount: discount,
      chargesAmount: charges,
      netAmount: net,
      paidAmount: paid,
      companyBilledAmount: billed,
      balanceAmount: net - paid - billed,
      status: deriveStatus(reservation.rooms.map((r) => r.status), reservation.status),
      arrivalDate: toDbDate(arrival),
      departureDate: toDbDate(departure),
    },
  });

  // Keep any invoice for this booking in step with the folio.
  const invoices = await tx.invoice.findMany({ where: { reservationId, status: { not: "CANCELLED" } }, select: { id: true } });
  for (const inv of invoices) await syncInvoice(tx, inv.id);
  if (reservation.groupId) await recalculateGroup(tx, reservation.groupId);
}

/**
 * Once a group's final invoice is made, its rooms' bills change only with a
 * manager: the change is then put on an adjustment invoice (the final invoice
 * itself is never edited), and every step is in the history.
 */
export async function assertGroupBillOpen(tx: Tx, reservationId: string, actor: { permissions?: ReadonlySet<string> }) {
  const r = await tx.reservation.findUnique({ where: { id: reservationId }, select: { billTo: true, group: { select: { name: true, finalizedAt: true } } } });
  if (r?.billTo === "GROUP" && r.group?.finalizedAt && !actor.permissions?.has("invoices.manage")) {
    throw new AppError(`${r.group.name}'s final invoice is already made — only a manager can change this room's bill, and the change goes on an adjustment invoice.`, "FORBIDDEN");
  }
}

/** A group's cached dates and status, from its rooms (bookings). */
export async function recalculateGroup(tx: Tx, groupId: string): Promise<void> {
  const rs = await tx.reservation.findMany({ where: { groupId }, select: { status: true, arrivalDate: true, departureDate: true } });
  if (rs.length === 0) return;
  const live = rs.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
  const dated = live.length ? live : rs;
  const arrival = dated.map((r) => fromDbDate(r.arrivalDate)).sort()[0];
  const departure = dated.map((r) => fromDbDate(r.departureDate)).sort().at(-1)!;
  const status = live.length === 0 ? "CANCELLED" : live.every((r) => r.status === "CHECKED_OUT") ? "COMPLETED" : "ACTIVE";
  await tx.bookingGroup.update({ where: { id: groupId }, data: { arrivalDate: toDbDate(arrival), departureDate: toDbDate(departure), status } });
}

/** Overall reservation status from its rooms' statuses. */
export function deriveStatus(roomStatuses: ReservationStatus[], current: ReservationStatus): ReservationStatus {
  if (roomStatuses.length === 0) return current;
  const set = new Set(roomStatuses);
  if (set.has("CHECKED_IN")) return "CHECKED_IN";
  const open = roomStatuses.filter((s) => s !== "CANCELLED" && s !== "NO_SHOW");
  if (open.length === 0) return set.has("NO_SHOW") ? "NO_SHOW" : "CANCELLED";
  if (open.every((s) => s === "CHECKED_OUT")) return "CHECKED_OUT";
  if (open.some((s) => s === "CHECKED_OUT")) return "CHECKED_IN"; // partially departed group
  if (open.every((s) => s === "INQUIRY")) return "INQUIRY";
  if (open.some((s) => s === "CONFIRMED")) return "CONFIRMED";
  return "RESERVED";
}

export { addDays };
