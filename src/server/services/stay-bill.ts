import "server-only";
import { db } from "../db";
import { fromDbDate } from "@/lib/time/business-date";
import { CHARGE_ORDER, chargeItem, orderHeading } from "./stays";

/**
 * A stay's bill (folio) to view, print or download — every room night, everything added
 * to the room (restaurant, bar, room service, extras), every payment and the balance.
 * The totals are the booking's own (kept by the billing engine), never worked out again here.
 */
export async function stayBill(reservationId: string) {
  const r = await db.reservation.findUnique({
    where: { id: reservationId },
    include: {
      guest: { select: { fullName: true, phone: true, email: true } },
      corporateCustomer: { select: { companyName: true } },
      group: { select: { name: true, reference: true } },
      rooms: {
        where: { status: { not: "CANCELLED" } }, orderBy: { startAt: "asc" },
        include: { room: { select: { number: true } }, roomType: { select: { name: true } }, nightsLedger: { orderBy: { businessDate: "asc" } } },
      },
      charges: { where: { isVoided: false }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }], include: { restaurantOrder: CHARGE_ORDER } },
      payments: { where: { status: "POSTED" }, include: { account: { select: { name: true } }, method: { select: { name: true } } }, orderBy: { receivedAt: "asc" } },
    },
  });
  if (!r) return null;
  const rooms = r.rooms.map((rr) => {
    const nights = rr.nightsLedger;
    const gross = nights.reduce((t, n) => t + n.grossAmount, 0);
    const net = nights.reduce((t, n) => t + n.netAmount, 0);
    const rates = [...new Set(nights.map((n) => n.grossAmount))];
    return {
      id: rr.id, number: rr.room.number, type: rr.roomType.name, dayUse: rr.isDayUse, status: rr.status,
      from: nights[0] ? fromDbDate(nights[0].businessDate) : fromDbDate(r.arrivalDate), nights: nights.length,
      rate: rates.length === 1 ? rates[0] : nights.length ? Math.round(gross / nights.length) : rr.ratePerNight, dated: rates.length > 1,
      gross, discount: gross - net, net,
    };
  });
  const SECTION: Record<string, string> = { RESTAURANT: "Restaurant", BAR: "Bar", ROOM_SERVICE: "Room service" };
  // A restaurant order's lines sit under the order ("Restaurant — Outside 3 · Order #184"); an
  // order brought to the room goes under Room service. The place comes from the order itself,
  // so older lines (written before the place was in their words) show it too.
  const charges = r.charges.map((c) => {
    const o = c.restaurantOrder;
    return {
      id: c.id, date: fromDbDate(c.businessDate), description: chargeItem(c.description, o), amount: c.amount,
      section: o ? (o.type === "ROOM_SERVICE" ? "Room service" : "Restaurant")
        : c.category === "ROOM_SERVICE" || c.category === "ROOM_SERVICE_FEE" ? "Room service" : SECTION[c.kind] ?? "Services & extras",
      order: o ? { id: o.id, heading: orderHeading(o) } : null,
    };
  });
  const payments = r.payments.map((p) => ({ id: p.id, at: p.receivedAt, account: p.account?.name ?? p.method.name, reference: p.reference, amount: p.amount, refund: p.kind === "REFUND" }));
  return {
    id: r.id, reference: r.reference, status: r.status, kind: r.kind, billTo: r.billTo,
    guest: r.guest, company: r.corporateCustomer?.companyName ?? r.companyName ?? null, group: r.group,
    arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate),
    rooms, charges, payments,
    totals: {
      rooms: rooms.reduce((t, x) => t + x.gross, 0), discount: r.discountAmount, charges: r.chargesAmount, total: r.netAmount,
      paid: r.paidAmount, company: r.companyBilledAmount, balance: r.balanceAmount,
    },
  };
}
export type StayBill = NonNullable<Awaited<ReturnType<typeof stayBill>>>;

/**
 * The guest's own room bill, from their private stay link or the room's QR card. A bill a
 * company pays is not shown to the guest (the stay page does not show it either).
 */
export async function guestStayBill(where: { guestToken: string } | { roomQrToken: string }) {
  let id: string | null = null;
  if ("guestToken" in where) {
    if (!/^[A-Za-z0-9_-]{12,64}$/.test(where.guestToken)) return null;
    id = (await db.reservation.findUnique({ where: { guestToken: where.guestToken }, select: { id: true } }))?.id ?? null;
  } else {
    if (!/^[A-Za-z0-9_-]{8,24}$/.test(where.roomQrToken)) return null;
    const code = await db.roomQrCode.findUnique({ where: { token: where.roomQrToken }, select: { active: true, roomId: true } });
    if (!code?.active) return null;
    id = (await db.reservationRoom.findFirst({ where: { roomId: code.roomId, status: "CHECKED_IN", reservation: { status: "CHECKED_IN" } }, orderBy: { checkedInAt: "desc" }, select: { reservationId: true } }))?.reservationId ?? null;
  }
  if (!id) return null;
  const bill = await stayBill(id);
  if (!bill || bill.billTo !== "GUEST" || bill.status === "CANCELLED") return null;
  return bill;
}
