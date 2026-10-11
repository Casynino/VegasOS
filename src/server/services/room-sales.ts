import "server-only";
import { db } from "../db";
import { businessDateOf, businessDayBounds, toDbDate, type BusinessDate, type BusinessDayConfig } from "@/lib/time/business-date";
import { billState, type BillState } from "@/lib/payment-status";

/**
 * ROOM SALES, PAYMENTS AND WHAT IS OWED — the one set of rules every report reads (room report, daily, weekly,
 * monthly, shift and staff reports). Nothing here is stored: every figure is read from the reservation, check-in,
 * room-night and payment records, so there is no second ledger that could disagree with them.
 *
 * The hotel day runs 04:00 → 04:00 (Africa/Dar_es_Salaam, both from Settings). Five different things happen in a
 * day; they are never the same number and are never added together:
 *
 * 1. A STAY is one room of one booking (reservation room + booking reference + room number). A room number alone
 *    never identifies it: Room 204 can hold a guest who left owing and a new guest on the same day — two stays.
 *
 * 2. A NEW ROOM SALE happens on the hotel day the guest actually CHECKED IN (the moment of check-in, inside
 *    04:00 → 04:00). Its value is the agreed room charge for the whole stay, after discount. It stays on that day
 *    whenever it is paid — a guest who checks in today and pays tomorrow is still today's sale. A stay that goes on
 *    is a CONTINUING STAY on the following days, never a new sale.
 *
 * 3. ROOM INCOME (the hotel's accounting policy — see reporting.ts; not changed here) is recognised night by night
 *    from the room-night ledger: each night of an in-house or checked-out stay is income on its own hotel day, once.
 *    A 3-night stay is one sale on its first day and one night of income on each of its three days.
 *
 * 4. A PAYMENT belongs to the hotel day it was recorded (`Payment.businessDate`), never to the day the room was
 *    sold. It is linked to its booking, so a payment for an earlier sale is shown with the day that room was sold.
 *    Money is paid against the booking, not against one room: a booking of several rooms shows its paid and owed
 *    amounts once, with its rooms listed together — never an invented split per room.
 *
 * 5. STILL OWED "as the day closed" = the booking's bill up to that day, less what had been paid up to that day:
 *      room charges after discount + extras charged up to that day − payments (less refunds) up to that day
 *      − amounts moved onto a company invoice.
 *    It is the booking's balance today, put back to that day by taking away the payments and extras recorded on
 *    later hotel days. So a guest who pays the next day still owes in that day's report, and the payment shows in
 *    the next day's. A payment that was cancelled (reversed) and a charge that was voided are recording mistakes:
 *    they are not counted on any day. A discount is taken off once, in the room charge. A discount on the whole
 *    bill given on a later day is put back too, from the hotel's own record of it — so a balance written off later
 *    was still owed that day.
 *
 * What cannot be put back to an earlier day, and is flagged instead of guessed: a room price changed after the day
 * closed (extension, shorter stay, nights changed at check-out, room discount, room move) and an amount moved onto a
 * company invoice later — the records keep those as they are now.
 */

const GUEST_ROOM = { roomType: { category: "GUEST_ROOM" as const } };

/** Guest rooms actually checked in inside [start, end) — the new room sales of a period. */
export const checkedInWithin = (start: Date, end: Date) => ({
  ...GUEST_ROOM, status: { in: ["CHECKED_IN", "CHECKED_OUT"] as ("CHECKED_IN" | "CHECKED_OUT")[] }, checkedInAt: { gte: start, lt: end },
});

/** Guest rooms actually checked out inside [start, end). */
export const checkedOutWithin = (start: Date, end: Date) => ({
  ...GUEST_ROOM, status: "CHECKED_OUT" as const, checkedOutAt: { gte: start, lt: end },
});

const byRoomNo = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
/** "204" or "204, 205" — the rooms of one booking, in order. */
export const roomList = (numbers: string[]) => [...new Set(numbers)].sort(byRoomNo).join(", ");

// ─────────────────────────── The bill of a booking, as a day closed ───────────────────────────

export type BillAt = {
  /** The whole bill up to that day: room charges after discount + the extras charged up to that day. */
  total: number;
  /** The extras part of it (restaurant, bar, laundry … charged to the room). */
  extras: number;
  /** Paid up to that day (payments less refunds). */
  paid: number;
  /** Moved onto a company invoice — the company owes it, it is not money received. */
  company: number;
  owed: number;
  status: BillState;
  /** The discount already taken off the bill by that day (room discount + any discount on the whole bill). */
  discount: number;
  /** The room part of a discount on the whole bill given on a later day — still owed that day, off the price now. */
  discountLater: number;
};

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Each booking's bill as the given hotel day closed (rule 5 above). Read from the booking's own totals and its
 * payment and charge records — the same records the guest's bill is made of.
 */
export async function billsAsOf(reservationIds: string[], date: BusinessDate): Promise<Map<string, BillAt>> {
  const ids = [...new Set(reservationIds)];
  const out = new Map<string, BillAt>();
  if (!ids.length) return out;
  const later = { gt: toDbDate(date) };
  const [rows, paidLater, chargedLater, discountedLater, billDiscounts] = await Promise.all([
    db.reservation.findMany({ where: { id: { in: ids } }, select: { id: true, billTo: true, netAmount: true, discountAmount: true, chargesAmount: true, paidAmount: true, companyBilledAmount: true, balanceAmount: true } }),
    db.payment.groupBy({ by: ["reservationId", "kind"], where: { reservationId: { in: ids }, invoiceId: null, status: "POSTED", businessDate: later }, _sum: { amount: true } }),
    db.reservationCharge.groupBy({ by: ["reservationId"], where: { reservationId: { in: ids }, isVoided: false, businessDate: later }, _sum: { amount: true } }),
    // A discount on the whole bill given on a later day. Its extras part is a minus line among the charges above; its
    // room part was taken off the nights, so it is put back from the hotel's own record of that discount.
    db.auditLog.findMany({ where: { entityType: "Reservation", entityId: { in: ids }, action: "reservation.bill_discounted", businessDate: later }, select: { entityId: true, after: true } }),
    db.reservationCharge.groupBy({ by: ["reservationId"], where: { reservationId: { in: ids }, isVoided: false, category: "BILL_DISCOUNT", businessDate: { lte: toDbDate(date) } }, _sum: { amount: true } }),
  ]);
  const paidAfter = new Map<string, number>(), chargedAfter = new Map<string, number>(), roomDiscountAfter = new Map<string, number>();
  for (const d of discountedLater) {
    const share = record(record(d.after).split).rooms;
    if (d.entityId && typeof share === "number") roomDiscountAfter.set(d.entityId, (roomDiscountAfter.get(d.entityId) ?? 0) + share);
  }
  const extrasDiscount = new Map(billDiscounts.map((d) => [d.reservationId, -(d._sum.amount ?? 0)]));
  for (const p of paidLater) if (p.reservationId) paidAfter.set(p.reservationId, (paidAfter.get(p.reservationId) ?? 0) + (p.kind === "PAYMENT" ? 1 : -1) * (p._sum.amount ?? 0));
  for (const c of chargedLater) chargedAfter.set(c.reservationId, c._sum.amount ?? 0);
  for (const r of rows) {
    const pl = paidAfter.get(r.id) ?? 0, cl = chargedAfter.get(r.id) ?? 0, dl = roomDiscountAfter.get(r.id) ?? 0;
    const bill = { total: r.netAmount - cl + dl, extras: r.chargesAmount - cl, paid: r.paidAmount - pl, company: r.companyBilledAmount, owed: r.balanceAmount + pl - cl + dl };
    out.set(r.id, { ...bill, status: billState({ ...bill, billTo: r.billTo }), discount: r.discountAmount - dl + (extrasDiscount.get(r.id) ?? 0), discountLater: dl });
  }
  return out;
}

// ─────────────────────────── Payments received in a day, each with the day its room was sold ───────────────────────────

/**
 * Which sale a payment was for:
 * TODAY = a room sold (checked in) this same hotel day · STAYING = a guest who checked in on an earlier day and is
 * still in the hotel · LEFT = a guest who has already checked out · ADVANCE = a booking not checked in yet.
 */
export type PaymentGroup = "TODAY" | "STAYING" | "LEFT" | "ADVANCE";

export type PaymentLine = {
  at: string;
  /** The rooms of the booking the money was for ("—" when no room is on the booking any more). */
  rooms: string; guest: string; reference: string;
  /** The hotel day the room was sold (the booking's first check-in); null = not checked in yet. */
  soldOn: string | null;
  group: PaymentGroup;
  amount: number;
  /** Money given back to the guest. */
  refund: boolean;
  /** Cancelled as a recording mistake — listed, never counted. */
  reversed: boolean;
  method: string; account: string; ref: string | null; by: string;
};

export type Received = {
  /** Payments counted (refunds are apart). The four parts always add up to it. */
  total: number; today: number; staying: number; left: number; advance: number;
  /** For rooms sold before today = staying + left. */
  earlier: number;
  refunds: number;
};

const LIVE = ["CHECKED_IN", "CHECKED_OUT"];

/** Where a booking stood on a hotel day — from its guest rooms that had checked in before the day ended. */
function standing(rooms: { status: string; checkedInAt: Date | null; checkedOutAt: Date | null }[], start: Date, end: Date, cfg: BusinessDayConfig) {
  const inHouse = rooms.filter((r) => LIVE.includes(r.status) && r.checkedInAt && r.checkedInAt < end);
  if (!inHouse.length) return { group: "ADVANCE" as const, soldOn: null, leftOn: null };
  const first = inHouse.reduce((a, r) => (r.checkedInAt! < a ? r.checkedInAt! : a), inHouse[0].checkedInAt!);
  const soldOn = businessDateOf(first, cfg);
  if (first >= start) return { group: "TODAY" as const, soldOn, leftOn: null };
  const gone = inHouse.every((r) => r.checkedOutAt && r.checkedOutAt < end);
  const last = gone ? inHouse.reduce((a, r) => (r.checkedOutAt! > a ? r.checkedOutAt! : a), inHouse[0].checkedOutAt!) : null;
  return { group: gone ? ("LEFT" as const) : ("STAYING" as const), soldOn, leftOn: last ? businessDateOf(last, cfg) : null };
}

const BOOKING_ROOMS = {
  where: GUEST_ROOM,
  select: { status: true, checkedInAt: true, checkedOutAt: true, room: { select: { number: true } } },
} as const;

/** The rooms to name for a booking: the ones the guest checked into; before check-in, the rooms held for them. */
function namedRooms(rooms: { status: string; room: { number: string } }[]) {
  const live = rooms.filter((r) => LIVE.includes(r.status));
  const held = live.length ? live : rooms.filter((r) => !["CANCELLED", "NO_SHOW"].includes(r.status));
  // A booking that was cancelled or never arrived still names the room it was made for.
  return roomList((held.length ? held : rooms).map((r) => r.room.number)) || "—";
}

/**
 * Every payment recorded against a room booking on one hotel day (rule 4), oldest first, each with the day its room
 * was sold. The counted payments add up to the room report's "Paid by room guests".
 */
export async function paymentsReceived(date: BusinessDate, cfg: BusinessDayConfig): Promise<{ lines: PaymentLine[]; received: Received }> {
  const { start, end } = businessDayBounds(date, cfg);
  const rows = await db.payment.findMany({
    where: { businessDate: toDbDate(date), reservation: { kind: "STAY" } },
    orderBy: { receivedAt: "asc" },
    select: {
      amount: true, kind: true, status: true, receivedAt: true, reference: true,
      method: { select: { name: true } }, account: { select: { name: true } }, recordedBy: { select: { fullName: true } },
      reservation: { select: { reference: true, guest: { select: { fullName: true } }, rooms: BOOKING_ROOMS } },
    },
  });
  const received: Received = { total: 0, today: 0, staying: 0, left: 0, advance: 0, earlier: 0, refunds: 0 };
  const lines: PaymentLine[] = rows.map((p) => {
    const b = p.reservation!;
    const st = standing(b.rooms, start, end, cfg);
    const refund = p.kind === "REFUND", reversed = p.status === "REVERSED";
    if (!reversed) {
      if (refund) received.refunds += p.amount;
      else {
        received.total += p.amount;
        if (st.group === "TODAY") received.today += p.amount;
        else if (st.group === "STAYING") received.staying += p.amount;
        else if (st.group === "LEFT") received.left += p.amount;
        else received.advance += p.amount;
      }
    }
    return {
      at: p.receivedAt.toISOString(), rooms: namedRooms(b.rooms), guest: b.guest.fullName, reference: b.reference, soldOn: st.soldOn, group: st.group,
      amount: p.amount, refund, reversed, method: p.method.name, account: p.account.name, ref: p.reference, by: p.recordedBy.fullName.replace(/\s*\(.*\)/, ""),
    };
  });
  received.earlier = received.staying + received.left;
  return { lines, received };
}

// ─────────────────────────── What room guests still owed as a day closed ───────────────────────────

export type OwingLine = {
  rooms: string; guest: string; reference: string;
  soldOn: string;
  /** SOLD_TODAY = checked in this day · STAYING = checked in earlier, still in the hotel · LEFT = already checked out. */
  state: "SOLD_TODAY" | "STAYING" | "LEFT";
  /** The hotel day the guest left (LEFT only). */
  leftOn: string | null;
  total: number; paid: number; company: number; owed: number; status: BillState;
  /** The discount already taken off the bill (room discount + any whole-bill discount). Absent on older reports. */
  discount?: number;
};

/**
 * Every room booking that had checked in and still owed money as the day closed (rule 5) — the guests in the hotel
 * and the ones who left owing. A guest who paid on a later day is still listed here with what they owed that day.
 */
export async function owedAtClose(date: BusinessDate, cfg: BusinessDayConfig): Promise<{ lines: OwingLine[]; owed: number }> {
  const { start, end } = businessDayBounds(date, cfg);
  const discountedLater = await db.auditLog.findMany({
    where: { entityType: "Reservation", action: "reservation.bill_discounted", businessDate: { gt: toDbDate(date) } }, select: { entityId: true }, distinct: ["entityId"],
  });
  const bookings = await db.reservation.findMany({
    where: {
      kind: "STAY",
      rooms: { some: { ...GUEST_ROOM, status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, checkedInAt: { lt: end } } },
      // Owes now, or the balance was brought down on a later day — by a payment or by a discount on the bill — so it
      // may have owed then.
      OR: [
        { balanceAmount: { gt: 0 } },
        { payments: { some: { status: "POSTED", kind: "PAYMENT", invoiceId: null, businessDate: { gt: toDbDate(date) } } } },
        { charges: { some: { isVoided: false, amount: { lt: 0 }, businessDate: { gt: toDbDate(date) } } } },
        { id: { in: discountedLater.map((d) => d.entityId).filter((x): x is string => !!x) } },
      ],
    },
    select: { id: true, reference: true, guest: { select: { fullName: true } }, rooms: BOOKING_ROOMS },
  });
  const bills = await billsAsOf(bookings.map((b) => b.id), date);
  const lines: OwingLine[] = [];
  for (const b of bookings) {
    const bill = bills.get(b.id);
    if (!bill || bill.owed <= 0) continue;
    const st = standing(b.rooms, start, end, cfg);
    if (st.group === "ADVANCE") continue;
    lines.push({
      rooms: namedRooms(b.rooms), guest: b.guest.fullName, reference: b.reference, soldOn: st.soldOn,
      state: st.group === "TODAY" ? "SOLD_TODAY" : st.group, leftOn: st.leftOn,
      total: bill.total, paid: bill.paid, company: bill.company, owed: bill.owed, status: bill.status,
      discount: bill.discount,
    });
  }
  const order = { SOLD_TODAY: 0, STAYING: 1, LEFT: 2 };
  lines.sort((a, b) => order[a.state] - order[b.state] || b.owed - a.owed || byRoomNo(a.rooms, b.rooms));
  return { lines, owed: lines.reduce((t, l) => t + l.owed, 0) };
}

// ─────────────────────────── Checks: records that do not add up, or changed after the day closed ───────────────────────────

/** Changes to a booking that move its room price — after a day has closed they cannot be put back to that day. */
const PRICE_CHANGES = [
  "reservation.dates_changed", "reservation.extended", "reservation.extended_free", "reservation.discount_changed",
  "reservation.bill_discounted", "reservation.billing_changed", "reservation.room_changed",
];

/** A bill moved onto a company or group invoice — written against the invoice, with the booking's reference. */
const INVOICED = ["invoice.company_billed", "invoice.group_billed"];

/**
 * Plain-word warnings for a day's report — never a guess, never a correction:
 *  - a booking whose stored bill does not add up from its own payments and charges;
 *  - a booking whose bill was changed after the day closed — dates, discount, room, who pays, nights changed at
 *    check-out (left early, or stayed over and was charged) or a bill moved onto a company invoice (shown as it is now);
 *  - a room counted in the day's room income with no check-in time on record (it is a sale on no day).
 */
export async function recordChecks(date: BusinessDate, cfg: BusinessDayConfig, reservationIds: string[]): Promise<string[]> {
  const ids = [...new Set(reservationIds)];
  const { end } = businessDayBounds(date, cfg);
  const notes: string[] = [];
  const list = (refs: string[]) => (refs.length > 6 ? `${refs.slice(0, 6).join(", ")} and ${refs.length - 6} more` : refs.join(", "));

  const [bookings, paid, charged, changed, left, invoiced, untimed] = await Promise.all([
    ids.length ? db.reservation.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true, netAmount: true, chargesAmount: true, paidAmount: true, companyBilledAmount: true, balanceAmount: true } }) : Promise.resolve([]),
    ids.length ? db.payment.groupBy({ by: ["reservationId", "kind"], where: { reservationId: { in: ids }, invoiceId: null, status: "POSTED" }, _sum: { amount: true } }) : Promise.resolve([]),
    ids.length ? db.reservationCharge.groupBy({ by: ["reservationId"], where: { reservationId: { in: ids }, isVoided: false }, _sum: { amount: true } }) : Promise.resolve([]),
    ids.length ? db.auditLog.findMany({ where: { entityType: "Reservation", entityId: { in: ids }, action: { in: PRICE_CHANGES }, createdAt: { gte: end } }, select: { entityId: true }, distinct: ["entityId"] }) : Promise.resolve([]),
    // A check-out is not a change by itself — only one that re-priced the room or put the bill on an invoice.
    ids.length ? db.auditLog.findMany({ where: { entityType: "Reservation", entityId: { in: ids }, action: "reservation.checked_out", createdAt: { gte: end } }, select: { entityId: true, after: true } }) : Promise.resolve([]),
    ids.length ? db.auditLog.findMany({ where: { entityType: "Invoice", action: { in: INVOICED }, createdAt: { gte: end } }, select: { after: true } }) : Promise.resolve([]),
    db.reservationRoom.findMany({
      where: { ...GUEST_ROOM, status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, checkedInAt: null, nightsLedger: { some: { businessDate: toDbDate(date) } } },
      select: { room: { select: { number: true } } },
    }),
  ]);

  const paidBy = new Map<string, number>(), chargedBy = new Map<string, number>();
  for (const p of paid) if (p.reservationId) paidBy.set(p.reservationId, (paidBy.get(p.reservationId) ?? 0) + (p.kind === "PAYMENT" ? 1 : -1) * (p._sum.amount ?? 0));
  for (const c of charged) chargedBy.set(c.reservationId, c._sum.amount ?? 0);
  const wrong = bookings.filter((b) =>
    b.netAmount - b.paidAmount - b.companyBilledAmount !== b.balanceAmount || b.paidAmount !== (paidBy.get(b.id) ?? 0) || b.chargesAmount !== (chargedBy.get(b.id) ?? 0));
  if (wrong.length) notes.push(`The stored bill of ${wrong.length === 1 ? "one booking" : `${wrong.length} bookings`} does not add up from its own payments and charges (${list(wrong.map((b) => b.reference))}). The figures are shown as recorded — please have the bill checked.`);

  const refOf = new Map(bookings.map((b) => [b.id, b.reference]));
  const late = new Set<string>();
  const flag = (id: string | null) => { const ref = refOf.get(id ?? ""); if (ref) late.add(ref); };
  for (const c of changed) flag(c.entityId);
  for (const c of left) {
    const a = record(c.after);
    if ((Array.isArray(a.nightChanges) && a.nightChanges.length) || a.invoice) flag(c.entityId);
  }
  const known = new Set(refOf.values());
  for (const i of invoiced) { const ref = record(i.after).reservation; if (typeof ref === "string" && known.has(ref)) late.add(ref); }
  const moved = bookings.map((b) => b.reference).filter((ref) => late.has(ref));
  if (moved.length) notes.push(`${moved.length === 1 ? "One booking was" : `${moved.length} bookings were`} changed after this day closed (dates, nights changed at check-out, discount, room, who pays, or a bill moved to a company invoice): ${list(moved)}. ${moved.length === 1 ? "Its" : "Their"} room price is shown as it is now, not as it was that day, and what ${moved.length === 1 ? "it" : "they"} owed that day may have been different.`);

  if (untimed.length) notes.push(`Room ${roomList(untimed.map((r) => r.room.number))} ${untimed.length === 1 ? "has" : "have"} a guest on record with no check-in time. ${untimed.length === 1 ? "It is" : "They are"} counted in room income, but not as a room sold on any day.`);
  return notes;
}
