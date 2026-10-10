import "server-only";
import { db } from "@/server/db";
import { fromDbDate } from "@/lib/time/business-date";
import { DEPT_LABEL, type InvoiceDept, type InvoiceDoc } from "./invoice-document";
import { companyBillTo, groupBillTo } from "./bill-to";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";

/** Load an invoice (by id, or by its public verify token) shaped for the invoice document. */
export async function loadInvoiceDoc(where: { id: string } | { verifyToken: string }) {
  const inv = await db.invoice.findUnique({
    where,
    include: {
      items: { orderBy: { sortOrder: "asc" }, include: { reservation: { select: { reference: true } } } },
      corporateCustomer: true, guest: true,
      group: { include: { contactGuest: { select: { fullName: true, phone: true, email: true } } } },
      reservation: { select: { id: true, reference: true, payments: { where: { status: "POSTED" }, include: { method: true }, orderBy: { receivedAt: "asc" } } } },
      payments: { where: { status: "POSTED" }, include: { method: true }, orderBy: { receivedAt: "asc" } },
    },
  });
  if (!inv) return null;
  // The document's own words (who it is for, tax labels) in the reader's language; English outside a request.
  const t = await getT().catch(() => englishT);
  const c = inv.corporateCustomer;
  // Where every line came from — the room's folio department (accommodation, restaurant, bar, room service, transport, other).
  const chargeIds = inv.items.filter((i) => i.sourceType === "CHARGE" && i.sourceId).map((i) => i.sourceId!);
  const roomLineIds = inv.items.filter((i) => i.sourceType === "RESERVATION_ROOM" && i.sourceId).map((i) => i.sourceId!);
  const stayIds = [...new Set(inv.items.map((i) => i.reservationId).filter((x): x is string => !!x))];
  const [charges, roomLines, stays] = await Promise.all([
    db.reservationCharge.findMany({ where: { id: { in: chargeIds } }, select: { id: true, kind: true, businessDate: true } }),
    db.reservationRoom.findMany({ where: { id: { in: roomLineIds } }, select: { id: true, roomType: { select: { category: true } } } }),
    db.reservation.findMany({
      where: { id: { in: stayIds } },
      select: { id: true, reference: true, adults: true, children: true, arrivalDate: true, departureDate: true, guests: { where: { isPrimary: false }, select: { guest: { select: { fullName: true } } } } },
    }),
  ]);
  const chargeOf = new Map(charges.map((x) => [x.id, x]));
  const meetingLine = new Set(roomLines.filter((x) => x.roomType.category === "MEETING_ROOM").map((x) => x.id));
  const deptOf = (i: (typeof inv.items)[number]): InvoiceDept => {
    if (i.sourceType === "RESERVATION_ROOM" || i.kind === "ROOM" || i.kind === "MEETING_ROOM") return i.kind === "MEETING_ROOM" || (i.sourceId && meetingLine.has(i.sourceId)) ? "MEETING" : "ROOM";
    const k = i.sourceId ? chargeOf.get(i.sourceId)?.kind : null;
    return k === "RESTAURANT" || k === "BAR" || k === "ROOM_SERVICE" || k === "TRANSPORT" ? k : "OTHER";
  };
  const byKindMap = new Map<string, number>();
  // Before discounts, so the departments add up to the subtotal (the discount is its own line).
  for (const i of inv.items) {
    const label = DEPT_LABEL[deptOf(i)];
    byKindMap.set(label, (byKindMap.get(label) ?? 0) + i.grossAmount);
  }
  const groupRooms = stayIds.length;
  const payments = inv.reservation ? inv.reservation.payments : inv.payments;
  const iso = (d: Date | null) => (d ? fromDbDate(d) : null);
  const doc: InvoiceDoc = {
    number: inv.number, status: inv.status, issueDate: iso(inv.issueDate), dueDate: iso(inv.dueDate),
    terms: inv.paymentTermDays ?? c?.paymentTermDays ?? null,
    billTo: inv.group ? groupBillTo(inv.group, c, t) : c ? companyBillTo(c, t) : {
      name: inv.guest?.fullName ?? t("Guest"), lines: inv.guest?.address ? [inv.guest.address] : [],
      contact: [inv.guest?.phone, inv.guest?.email].filter(Boolean).join("  ·  ") || null,
    },
    bookings: [...new Set([inv.reservation?.reference, ...inv.items.map((i) => i.reservation?.reference)].filter((x): x is string => !!x))],
    items: inv.items.map((i) => ({
      id: i.id, description: i.description, quantity: i.quantity, unitAmount: i.unitAmount, discountAmount: i.discountAmount, netAmount: i.netAmount,
      reservationId: i.reservationId, guestName: i.guestName, roomNumber: i.roomNumber, from: iso(i.serviceFrom), to: iso(i.serviceTo),
      reference: i.reservation?.reference ?? null, isRoom: i.kind === "ROOM", dept: deptOf(i),
      date: i.sourceType === "CHARGE" && i.sourceId && chargeOf.get(i.sourceId) ? fromDbDate(chargeOf.get(i.sourceId)!.businessDate) : null,
    })),
    stays: Object.fromEntries(stays.map((r) => [r.id, {
      reference: r.reference, people: r.adults + r.children, others: r.guests.map((x) => x.guest.fullName),
      arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate),
    }])),
    gross: inv.grossAmount, discount: inv.discountAmount, net: inv.netAmount, paid: inv.paidAmount, balance: inv.balanceAmount,
    payments: payments.map((p) => ({ id: p.id, at: p.receivedAt, method: p.method.name, reference: p.reference, amount: p.amount, refund: p.kind === "REFUND" })),
    notes: inv.notes, cancelReason: inv.cancelReason,
    group: inv.group ? { name: inv.group.name, reference: inv.group.reference, rooms: groupRooms, final: inv.group.finalInvoiceId === inv.id } : null,
    byKind: [...byKindMap].filter(([, v]) => v !== 0).map(([label, amount]) => ({ label, amount })),
  };
  return { inv, doc };
}
