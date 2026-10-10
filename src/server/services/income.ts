import "server-only";
import { db } from "../db";
import { toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { timeRange } from "@/lib/meeting";
import { msg } from "@/i18n/msg";

/**
 * Income — every shilling actually received, from every source, in one list:
 * room payments, restaurant & bar sales, meeting room, company invoices.
 * Refunds come off; reversed payments and cancelled sales stay visible but are
 * not counted. Each line knows which payment account it landed in.
 */
export type IncomeSource = "ROOM" | "RESTAURANT" | "BAR" | "ROOM_SERVICE" | "TRANSPORT" | "MEETING" | "COMPANY" | "OTHER";
export const SOURCE_LABEL: Record<IncomeSource, string> = {
  ROOM: msg("Rooms"), RESTAURANT: msg("Restaurant"), BAR: msg("Bar"), ROOM_SERVICE: msg("Room service fee"), TRANSPORT: msg("Transport"), MEETING: msg("Meeting room"), COMPANY: msg("Company invoice"), OTHER: msg("Other"),
};

export interface IncomeRow {
  id: string; kind: "payment" | "sale"; at: Date; businessDate: string; source: IncomeSource;
  who: string; detail: string | null; rooms: string | null; href: string | null; reservationId: string | null;
  account: { id: string; name: string; number: string | null }; method: string; by: string;
  /** Signed: a refund is negative. */
  amount: number; refund: boolean; counted: boolean; note: string | null; reference: string | null;
}

export async function incomeRows(from: BusinessDate, to: BusinessDate): Promise<IncomeRow[]> {
  const bd = { gte: toDbDate(from), lte: toDbDate(to) };
  const [payments, sales] = await Promise.all([
    db.payment.findMany({
      where: { businessDate: bd },
      include: {
        account: true, method: true, recordedBy: { select: { fullName: true } },
        reservation: { select: { id: true, reference: true, kind: true, companyName: true, guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } } } },
        invoice: { select: { id: true, number: true } }, corporateCustomer: { select: { companyName: true } },
      },
    }),
    db.revenueTransaction.findMany({ where: { businessDate: bd }, include: { account: true, paymentMethod: true, category: true, recordedBy: { select: { fullName: true } } } }),
  ]);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const rows: IncomeRow[] = [
    ...payments.map((p): IncomeRow => {
      const refund = p.kind === "REFUND";
      const source: IncomeSource = p.reservation ? (p.reservation.kind === "MEETING" ? "MEETING" : "ROOM") : p.invoice || p.corporateCustomer ? "COMPANY" : "OTHER";
      return {
        id: p.id, kind: "payment", at: p.receivedAt, businessDate: day(p.businessDate), source,
        who: p.reservation?.companyName ?? p.reservation?.guest.fullName ?? p.corporateCustomer?.companyName ?? msg("Customer"),
        detail: p.reservation?.reference ?? p.invoice?.number ?? null,
        rooms: p.reservation?.rooms.map((r) => r.room.number).join(", ") || null,
        href: p.reservation ? `/staff/reservations/${p.reservation.id}` : p.invoice ? `/staff/invoices/${p.invoice.id}` : null, reservationId: p.reservationId,
        account: { id: p.accountId, name: p.account.name, number: p.account.accountNumber }, method: p.method.name, by: p.recordedBy.fullName,
        amount: refund ? -p.amount : p.amount, refund, counted: p.status === "POSTED",
        note: p.status === "REVERSED" ? `Reversed${p.reversalReason ? `: ${p.reversalReason}` : ""}` : refund ? msg("Refund") : null, reference: p.reference,
      };
    }),
    ...sales.map((s): IncomeRow => ({
      id: s.id, kind: "sale", at: s.occurredAt, businessDate: day(s.businessDate),
      source: s.kind === "RESTAURANT" ? "RESTAURANT" : s.kind === "BAR" ? "BAR" : s.kind === "ROOM_SERVICE" ? "ROOM_SERVICE" : s.kind === "TRANSPORT" ? "TRANSPORT" : "OTHER",
      who: s.description || s.category.name, detail: s.category.name, rooms: null, href: "/staff/sales", reservationId: null,
      account: { id: s.accountId, name: s.account.name, number: s.account.accountNumber }, method: s.paymentMethod.name, by: s.recordedBy.fullName,
      amount: s.amount, refund: false, counted: !s.isVoided, note: s.isVoided ? `Cancelled${s.voidReason ? `: ${s.voidReason}` : ""}` : null, reference: null,
    })),
  ];
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ───────────────────────── Who can pay / who owes ─────────────────────────

export type PartyKind = "STAY" | "LEFT" | "ARRIVAL" | "INVOICE";
export interface Party {
  key: string; kind: PartyKind; id: string; name: string; ref: string; detail: string | null;
  owes: number; total: number; paid: number;
  /** "Leaving today", "Overdue", "In the hotel", "Arriving today", … */
  tag: string; urgent: boolean;
  /** Room label for "Add to bill" (guests staying or arriving only). */
  room: string | null;
  /** A meeting room booking (same reservation & folio, shown with the companies). */
  meeting?: boolean;
}

/**
 * Everyone the desk may take money from, most urgent first: guests in the hotel
 * (leaving today / overdue first — all of them, so things can be added to their
 * bill), guests who left owing, arrivals not paid yet, company invoices and
 * meeting room bookings (reservations of a meeting room) the same way.
 */
export async function payingParties(today: BusinessDate): Promise<Party[]> {
  const t = toDbDate(today);
  const tomorrow = new Date(t.getTime() + 86_400_000);
  const [stays, invoices] = await Promise.all([
    db.reservation.findMany({
      where: {
        OR: [
          { status: "CHECKED_IN" },
          { status: "CHECKED_OUT", balanceAmount: { gt: 0 } },
          { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: { gte: t, lte: tomorrow } },
        ],
      },
      include: { guest: { select: { fullName: true, phone: true } }, rooms: { select: { status: true, departureDate: true, startAt: true, endAt: true, room: { select: { number: true } } } } },
    }),
    db.invoice.findMany({
      where: { reservationId: null, balanceAmount: { gt: 0 }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { corporateCustomer: { select: { companyName: true } }, guest: { select: { fullName: true } }, group: { select: { name: true } } },
    }),
  ]);
  const parties: (Party & { rank: number })[] = [];
  for (const r of stays) {
    const rooms = r.rooms.map((x) => x.room.number).join(", ");
    const departure = r.rooms.map((x) => x.departureDate.getTime()).sort().at(-1) ?? r.departureDate.getTime();
    // A group room is paid by its group (the group invoice), not by the guest at the desk.
    const owes = r.billTo === "GROUP" ? 0 : Math.max(0, r.balanceAmount);
    const base = { key: `r-${r.id}`, id: r.id, name: r.guest.fullName, ref: r.reference, owes, total: r.netAmount, paid: r.paidAmount };
    if (r.kind === "MEETING") {
      const when = r.rooms[0] ? timeRange(r.rooms[0].startAt, r.rooms[0].endAt) : "";
      const today = r.arrivalDate.getTime() === t.getTime();
      const kind: PartyKind = r.status === "CHECKED_IN" ? "STAY" : r.status === "CHECKED_OUT" ? "LEFT" : "ARRIVAL";
      if (kind !== "STAY" && owes === 0) continue;
      parties.push({
        ...base, name: r.companyName ?? r.guest.fullName, kind, meeting: true, room: kind === "LEFT" ? null : rooms,
        detail: `Room ${rooms} — Meeting room · ${when}`,
        tag: kind === "STAY" ? msg("Meeting in use") : kind === "LEFT" ? msg("Meeting done — owing") : today ? msg("Meeting today") : msg("Meeting tomorrow"),
        urgent: kind === "LEFT", rank: kind === "STAY" ? 2 : kind === "LEFT" ? 3 : 4,
      });
      continue;
    }
    if (r.status === "CHECKED_IN") {
      const overdue = departure < t.getTime(), leaving = departure === t.getTime();
      parties.push({ ...base, kind: "STAY", detail: `Room ${rooms}${r.guest.phone ? ` · ${r.guest.phone}` : ""}`, room: rooms, tag: overdue ? msg("Overdue") : leaving ? msg("Leaving today") : msg("In the hotel"), urgent: (overdue || leaving) && owes > 0, rank: overdue ? 0 : leaving ? 1 : owes > 0 ? 2 : 5 });
    } else if (r.status === "CHECKED_OUT") {
      parties.push({ ...base, kind: "LEFT", detail: `Left · room ${rooms}`, room: null, tag: msg("Left owing"), urgent: true, rank: 3 });
    } else if (owes > 0) {
      const arrivesToday = r.arrivalDate.getTime() === t.getTime();
      parties.push({ ...base, kind: "ARRIVAL", detail: `Room ${rooms} · arriving ${arrivesToday ? "today" : "tomorrow"}`, room: rooms, tag: arrivesToday ? msg("Arriving today") : msg("Arriving tomorrow"), urgent: false, rank: 4 });
    }
  }
  for (const i of invoices) {
    parties.push({ key: `i-${i.id}`, kind: "INVOICE", id: i.id, name: i.corporateCustomer?.companyName ?? i.group?.name ?? i.guest?.fullName ?? msg("Company"), ref: i.number, detail: i.group ? `Group invoice · ${i.group.name}` : msg("Company invoice"), owes: i.balanceAmount, total: i.netAmount, paid: i.paidAmount, tag: i.status === "OVERDUE" ? msg("Invoice overdue") : msg("Company"), urgent: i.status === "OVERDUE", room: null, rank: 6 });
  }
  return parties.sort((a, b) => a.rank - b.rank || b.owes - a.owes).map(({ rank, ...p }) => { void rank; return p; });
}
