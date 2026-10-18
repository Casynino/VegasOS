import "server-only";
import { db } from "../db";
import { operationalOnly } from "../staff-pickers";
import { getSettings, businessDayConfig } from "../settings";
import { businessRangeBounds, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { cashRecords, totalsOf } from "./cash-handover";
import { EARNED_NIGHT } from "./reservation-financials";

/**
 * Finance's own reports. Every line comes from the records themselves — nothing is estimated:
 *   discounts        what was taken off a price, by whom, with the original price and the final one;
 *   reconciliation   for each person who takes cash: cash recorded, handed over, received, the differences;
 *   cash handovers   every handover of the period (also as a spreadsheet).
 */

// ───────────────────────── Discounts ─────────────────────────

export type RoomDiscountRow = {
  id: string; href: string; reference: string; guest: string; roomType: string; room: string; nights: number;
  gross: number; promo: number; manual: number; net: number; reason: string | null; by: string | null; at: Date | null;
};
export type RestaurantDiscountRow = { id: string; number: string; party: string | null; original: number; discount: number; final: number; reason: string | null; by: string | null; at: Date };

/** Room discounts are counted on the nights that were earned (a guest who checked in), like the revenue; restaurant discounts on orders that were not cancelled. */
export async function discountHistory(from: BusinessDate, to: BusinessDate) {
  const bd = { gte: toDbDate(from), lte: toDbDate(to) };
  const [nights, orders] = await Promise.all([
    db.roomNight.groupBy({
      by: ["reservationRoomId"], where: { businessDate: bd, ...EARNED_NIGHT, discountAmount: { gt: 0 } }, _count: true,
      _sum: { grossAmount: true, discountAmount: true, promoDiscount: true, manualDiscount: true, netAmount: true },
    }),
    db.restaurantOrder.findMany({
      where: { businessDate: bd, discountAmount: { gt: 0 }, status: { not: "CANCELLED" } },
      select: { id: true, number: true, customerName: true, tableLabel: true, roomNumber: true, total: true, discountAmount: true, discountReason: true, discountById: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const rooms = await db.reservationRoom.findMany({
    where: { id: { in: nights.map((n) => n.reservationRoomId) } },
    select: { id: true, discountReason: true, discountSetById: true, discountSetAt: true, reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } } } }, roomType: { select: { name: true } }, room: { select: { number: true } } },
  });
  const people = await db.user.findMany({
    where: { id: { in: [...rooms.map((r) => r.discountSetById), ...orders.map((o) => o.discountById)].filter((x): x is string => !!x) } },
    select: { id: true, fullName: true },
  });
  const name = new Map(people.map((p) => [p.id, p.fullName]));
  const byRoom = new Map(rooms.map((r) => [r.id, r]));

  const roomRows: RoomDiscountRow[] = nights.flatMap((n) => {
    const r = byRoom.get(n.reservationRoomId);
    if (!r) return [];
    const manual = n._sum.manualDiscount ?? 0;
    return [{
      id: r.id, href: `/staff/reservations/${r.reservation.id}`, reference: r.reservation.reference, guest: r.reservation.guest.fullName, roomType: r.roomType.name, room: r.room.number, nights: n._count,
      gross: n._sum.grossAmount ?? 0, promo: n._sum.promoDiscount ?? 0, manual, net: n._sum.netAmount ?? 0,
      reason: manual > 0 ? r.discountReason : null, by: manual > 0 && r.discountSetById ? (name.get(r.discountSetById) ?? null) : null, at: manual > 0 ? r.discountSetAt : null,
    }];
  }).sort((a, b) => (b.manual + b.promo) - (a.manual + a.promo));

  const restaurantRows: RestaurantDiscountRow[] = orders.map((o) => ({
    id: o.id, number: o.number, party: o.customerName ?? o.roomNumber ?? o.tableLabel ?? null, original: o.total + o.discountAmount, discount: o.discountAmount, final: o.total,
    reason: o.discountReason, by: o.discountById ? (name.get(o.discountById) ?? null) : null, at: o.createdAt,
  }));

  const promo = roomRows.reduce((s, r) => s + r.promo, 0);
  const manual = roomRows.reduce((s, r) => s + r.manual, 0);
  const restaurant = restaurantRows.reduce((s, r) => s + r.discount, 0);
  // Who gave how much by hand (promotions are the hotel's own rule, not a person's).
  const staff = new Map<string, { name: string; amount: number; count: number }>();
  const add = (by: string | null, amount: number) => {
    if (!by || amount <= 0) return;
    const s = staff.get(by) ?? { name: by, amount: 0, count: 0 };
    s.amount += amount; s.count += 1; staff.set(by, s);
  };
  roomRows.forEach((r) => add(r.by, r.manual));
  restaurantRows.forEach((r) => add(r.by, r.discount));
  return {
    roomRows, restaurantRows, totals: { promo, manual, restaurant, all: promo + manual + restaurant, rooms: roomRows.length, orders: restaurantRows.length },
    byStaff: [...staff.values()].sort((a, b) => b.amount - a.amount),
  };
}
export type DiscountHistory = Awaited<ReturnType<typeof discountHistory>>;

// ───────────────────────── Staff cash reconciliation ─────────────────────────

/** For each person who takes cash: what they recorded in the period, what they handed over, what Finance received, and the differences. */
export async function reconciliationByStaff(from: BusinessDate, to: BusinessDate) {
  const cfg = businessDayConfig(await getSettings());
  const { start, end } = businessRangeBounds(from, to, cfg);
  const people = await db.user.findMany({
    where: operationalOnly({ isActive: true, role: { permissions: { some: { permission: { code: "cash.handover.submit" } } } } }),
    select: { id: true, fullName: true, role: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });
  const handovers = await db.cashHandover.findMany({
    where: { submittedById: { in: people.map((p) => p.id) }, submittedAt: { gte: start, lt: end }, status: { not: "REJECTED" } },
    select: { submittedById: true, status: true, expected: true, declared: true, received: true, difference: true },
  });
  const rows = await Promise.all(people.map(async (p) => {
    const t = totalsOf(await cashRecords(p.id, start, end));
    const mine = handovers.filter((h) => h.submittedById === p.id);
    const accepted = mine.filter((h) => h.status === "ACCEPTED");
    return {
      userId: p.id, name: p.fullName, role: p.role.name, recorded: t.expected, count: t.count,
      handovers: mine.length, declared: mine.reduce((s, h) => s + h.declared, 0), waiting: mine.filter((h) => h.status === "SUBMITTED" || h.status === "RETURNED").reduce((s, h) => s + h.declared, 0),
      received: accepted.reduce((s, h) => s + (h.received ?? 0), 0), difference: accepted.reduce((s, h) => s + (h.difference ?? 0), 0),
    };
  }));
  return rows.filter((r) => r.recorded > 0 || r.handovers > 0);
}
export type StaffReconciliationRow = Awaited<ReturnType<typeof reconciliationByStaff>>[number];

// ───────────────────────── Refunds, reversals and corrections ─────────────────────────

/** Payment corrections (method or account fixed, amount never changed) and ledger corrections in the period. */
export async function correctionsHistory(from: BusinessDate, to: BusinessDate) {
  const bd = { gte: toDbDate(from), lte: toDbDate(to) };
  const [methodFixes, ledger, refunds] = await Promise.all([
    db.paymentCorrection.findMany({ where: { businessDate: bd }, orderBy: { changedAt: "desc" }, take: 200 }),
    db.ledgerEntry.findMany({ where: { businessDate: bd, kind: { in: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT"] } }, orderBy: { occurredAt: "desc" }, take: 200, include: { account: { select: { name: true } }, createdBy: { select: { fullName: true } } } }),
    db.payment.findMany({ where: { OR: [{ kind: "REFUND", businessDate: bd }, { status: "REVERSED", reversalBusinessDate: bd }] }, orderBy: { receivedAt: "desc" }, take: 200,
      include: { account: { select: { name: true } }, recordedBy: { select: { fullName: true } }, reversedBy: { select: { fullName: true } }, reservation: { select: { reference: true, guest: { select: { fullName: true } } } } } }),
  ]);
  const people = await db.user.findMany({ where: { id: { in: methodFixes.map((m) => m.changedById) } }, select: { id: true, fullName: true } });
  const who = new Map(people.map((p) => [p.id, p.fullName]));
  return {
    refunds: refunds.map((p) => ({
      id: p.id, at: p.status === "REVERSED" ? (p.reversedAt ?? p.receivedAt) : p.receivedAt, kind: p.kind === "REFUND" ? ("REFUND" as const) : ("REVERSAL" as const), amount: p.amount, account: p.account.name,
      party: p.reservation?.guest.fullName ?? null, reference: p.reservation?.reference ?? p.reference, by: (p.status === "REVERSED" ? p.reversedBy?.fullName : null) ?? p.recordedBy.fullName, reason: p.reversalReason ?? p.notes,
    })),
    methodFixes: methodFixes.map((m) => ({ id: m.id, at: m.changedAt, amount: m.amount, reason: m.reason, by: who.get(m.changedById) ?? "—", businessDate: fromDbDate(m.businessDate) })),
    ledger: ledger.map((e) => ({ id: e.id, number: e.number, at: e.occurredAt, amount: e.kind === "ADJUSTMENT_IN" ? e.amount : -e.amount, account: e.account.name, description: e.description, by: e.createdBy.fullName, reversed: e.status === "REVERSED" })),
  };
}
export type CorrectionsHistory = Awaited<ReturnType<typeof correctionsHistory>>;
