import "server-only";
import { db } from "@/server/db";
import { timeRange } from "@/lib/meeting";
import { fromDbDate, type BusinessDate } from "@/lib/time/business-date";
import { DEPT_LABEL, type InvoiceDept, type InvoiceDoc } from "./invoice-document";
import { groupBillTo } from "./bill-to";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";

const chargeDept = (kind: string): InvoiceDept => (kind === "RESTAURANT" || kind === "BAR" || kind === "ROOM_SERVICE" || kind === "TRANSPORT" ? kind : "OTHER");

/**
 * The group's charges so far, room by room — a statement (proforma) for a group
 * that asks for its bill before everyone has left. It is only a document:
 * nothing is billed, owed or counted by printing it. The final group invoice is
 * made when the group is finalized, from the same room folios.
 */
export async function groupStatementDoc(groupId: string, today: BusinessDate) {
  const g = await db.bookingGroup.findUnique({
    where: { id: groupId },
    include: {
      corporateCustomer: true, contactGuest: true,
      reservations: {
        where: { billTo: "GROUP", status: { notIn: ["CANCELLED", "NO_SHOW", "INQUIRY"] } },
        orderBy: { createdAt: "asc" },
        include: {
          guest: { select: { fullName: true } },
          guests: { where: { isPrimary: false }, select: { guest: { select: { fullName: true } } } },
          rooms: { where: { status: { not: "CANCELLED" } }, include: { room: { select: { number: true } }, roomType: { select: { name: true, category: true } } } },
          charges: { where: { isVoided: false }, orderBy: { businessDate: "asc" } },
          payments: { where: { status: "POSTED" }, include: { method: true } },
        },
      },
      invoices: { where: { status: { notIn: ["CANCELLED", "VOID"] } }, include: { payments: { where: { status: "POSTED" }, include: { method: true } } } },
    },
  });
  if (!g) return null;
  // The statement's own words in the reader's language; English outside a request.
  const t = await getT().catch(() => englishT);

  const items: InvoiceDoc["items"] = [];
  for (const r of g.reservations) {
    const room = r.rooms[0]?.room.number ?? null;
    for (const rr of r.rooms) {
      const units = rr.isDayUse ? 1 : rr.nights;
      const meeting = rr.roomType.category === "MEETING_ROOM";
      items.push({
        id: rr.id, reservationId: r.id, guestName: r.guest.fullName, roomNumber: rr.room.number, reference: r.reference, isRoom: true,
        dept: meeting ? "MEETING" : "ROOM",
        description: meeting ? `${rr.roomType.name} · ${timeRange(rr.startAt, rr.endAt)}` : `${rr.roomType.name} · ${rr.isDayUse ? "short time" : `${units} night${units === 1 ? "" : "s"}`}`,
        quantity: units, unitAmount: rr.ratePerNight, discountAmount: rr.discountAmount, netAmount: rr.netAmount,
        from: fromDbDate(rr.arrivalDate), to: fromDbDate(rr.departureDate),
      });
    }
    for (const c of r.charges) {
      items.push({
        id: c.id, reservationId: r.id, guestName: r.guest.fullName, roomNumber: room, reference: r.reference, isRoom: false,
        dept: chargeDept(c.kind), description: c.description, quantity: 1, unitAmount: c.amount, discountAmount: 0, netAmount: c.amount,
        date: fromDbDate(c.businessDate), from: fromDbDate(c.businessDate), to: null,
      });
    }
  }
  const byKind = new Map<string, number>();
  for (const i of items) byKind.set(DEPT_LABEL[i.dept!], (byKind.get(DEPT_LABEL[i.dept!]) ?? 0) + i.netAmount + i.discountAmount);
  const net = items.reduce((t, i) => t + i.netAmount, 0);
  const discount = items.reduce((t, i) => t + i.discountAmount, 0);
  // Money already received for these rooms: on the group's invoices, and any deposit paid on a room.
  const payments = [...g.invoices.flatMap((i) => i.payments), ...g.reservations.flatMap((r) => r.payments)]
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const paid = payments.reduce((t, p) => t + (p.kind === "REFUND" ? -p.amount : p.amount), 0);

  const doc: InvoiceDoc = {
    number: `STM-${g.reference}`, status: "ISSUED", issueDate: today, dueDate: null,
    terms: g.paymentTermDays ?? g.corporateCustomer?.paymentTermDays ?? null,
    billTo: groupBillTo(g, g.corporateCustomer, t),
    bookings: g.reservations.map((r) => r.reference),
    items, gross: net + discount, discount, net, paid, balance: Math.max(0, net - paid),
    payments: payments.map((p) => ({ id: p.id, at: p.receivedAt, method: p.method.name, reference: p.reference, amount: p.amount, refund: p.kind === "REFUND" })),
    notes: t("Statement of {group}'s charges so far (group {reference}). This is not a tax invoice and records nothing: the final group invoice is made when every room has checked out, and includes any charges added after today.", { group: g.name, reference: g.reference }),
    cancelReason: null,
    stays: Object.fromEntries(g.reservations.map((r) => [r.id, {
      reference: r.reference, people: r.adults + r.children, others: r.guests.map((x) => x.guest.fullName),
      arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate),
    }])),
    group: { name: g.name, reference: g.reference, rooms: g.reservations.length },
    byKind: [...byKind].filter(([, v]) => v !== 0).map(([label, amount]) => ({ label, amount })),
  };
  return { group: g, doc };
}
