import "server-only";
import { db } from "../db";
import { getSettings } from "../settings";
import { formatMinutes, fromDbDate } from "@/lib/time/business-date";
import { internationalPhone, prettyPhone } from "@/lib/guest-messages";
import {
  arrivalReminderMessage, balanceMessage, bookingMessage, bookingPaidMessage, bookingPaymentFailedMessage, bookingPaymentPendingMessage,
  bookingUpdatedMessage, cancelledMessage, checkoutMessage, meetingMessage, roomChangedMessage, transportMessage, welcomeMessage,
  type BookingKind, type Hotel, type Money, type StayFacts,
} from "@/lib/wa-messages";
import { stayBill } from "./stay-bill";
import { ensureGuestToken } from "./guest-comms";
import { isPayLater } from "./booking-holds";

/**
 * The facts every guest message is written from — read from the system's own records (the booking and its folio, the
 * payment, the trip), never worked out again: the bill's totals are the billing engine's, the payment's reference is
 * the payment service's. The words are in src/lib/wa-messages.ts. Links are the guest's private pages (tokens only).
 */

export async function messageHotel(): Promise<Hotel> {
  const s = await getSettings();
  return { name: s.hotelName, phone: prettyPhone(s.whatsapp || s.phone) || null, instagram: s.instagramUrl || null, tiktok: s.tiktokUrl || null };
}

/** "2026-10-05" → "Mon, 5 Oct 2026". */
export const weekdayDate = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const guestsText = (adults: number, children: number) => `${plural(adults, "adult", "adults")}${children ? `, ${plural(children, "child", "children")}` : ""}`;

export type ReservationMessageType =
  | "BOOKING" | "WELCOME" | "CHECKOUT" | "BALANCE" | "CANCELLED" | "UPDATED" | "REMINDER" | "PAID" | "PAYMENT_PENDING" | "PAYMENT_FAILED";

/** Everything a stay's messages say, from the booking and its folio. */
async function reservationFacts(reservationId: string, origin: string) {
  const [bill, r, s] = await Promise.all([
    stayBill(reservationId),
    db.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true, reference: true, manageToken: true, status: true, kind: true, adults: true, children: true, externalData: true, billTo: true,
        companyName: true, companyBilledAmount: true, corporateCustomer: { select: { companyName: true } },
        guest: { select: { id: true, fullName: true, phone: true } },
        rooms: { where: { status: { not: "CANCELLED" } }, orderBy: { startAt: "asc" }, select: { startAt: true, endAt: true, isDayUse: true, status: true, room: { select: { number: true } }, roomType: { select: { name: true } } } },
      },
    }),
    getSettings(),
  ]);
  if (!bill || !r) return null;
  const token = await ensureGuestToken(db, reservationId);
  const hotel: Hotel = { name: s.hotelName, phone: prettyPhone(s.whatsapp || s.phone) || null, instagram: s.instagramUrl || null, tiktok: s.tiktokUrl || null };
  const tz = s.timezone;
  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(d);

  // The room type(s): "Double Deluxe", "2 × Double Deluxe", "Double Deluxe, Executive Suite".
  const counts = new Map<string, number>();
  for (const x of r.rooms) counts.set(x.roomType.name, (counts.get(x.roomType.name) ?? 0) + 1);
  const roomType = [...counts].map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(", ") || "—";
  // Room numbers only once they are the guest's (checked in or out) — before that a room can still change.
  const assigned = r.rooms.some((x) => x.status === "CHECKED_IN" || x.status === "CHECKED_OUT");
  const dayUse = r.rooms.length > 0 && r.rooms.every((x) => x.isDayUse);
  const first = r.rooms[0];
  const stay: StayFacts = {
    ref: r.reference, roomType,
    rooms: assigned ? r.rooms.filter((x) => x.status === "CHECKED_IN" || x.status === "CHECKED_OUT").map((x) => x.room.number).join(", ") : null,
    checkIn: dayUse && first ? `${weekdayDate(bill.arrival)} · ${time(first.startAt)}` : `${weekdayDate(bill.arrival)} · from ${formatMinutes(s.standardCheckInMinutes)}`,
    checkOut: dayUse && first ? `${weekdayDate(bill.departure)} · ${time(first.endAt)}` : `${weekdayDate(bill.departure)} · by ${formatMinutes(s.checkoutMinutes)}`,
    nights: dayUse ? null : bill.rooms.reduce((m, x) => Math.max(m, x.nights), 0) || null,
    guests: r.kind === "MEETING" ? null : guestsText(r.adults, r.children),
  };

  // The bill as the folio has it: the room(s), then each kind of charge; the discount; total, paid, balance.
  const bySection = new Map<string, number>();
  for (const c of bill.charges) bySection.set(c.section, (bySection.get(c.section) ?? 0) + c.amount);
  const refunded = bill.payments.filter((p) => p.refund).reduce((t, p) => t + p.amount, 0);
  const company = r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? r.companyName ?? "the company" : null;
  const money: Money = {
    lines: [{ label: r.kind === "MEETING" ? "Meeting room" : bill.rooms.length > 1 ? "Rooms" : "Room", amount: bill.totals.rooms }, ...[...bySection].map(([label, amount]) => ({ label, amount }))],
    discount: bill.totals.discount || undefined,
    total: bill.totals.total, paid: bill.totals.paid, balance: bill.totals.balance, refunded: refunded || undefined,
    company: company && bill.totals.company > 0 ? company : null,
  };
  const rate = bill.rooms.length === 1 && !bill.rooms[0].dated && !bill.rooms[0].dayUse ? bill.rooms[0].rate : null;

  const kind: BookingKind = r.status === "INQUIRY" ? (isPayLater(r.externalData) ? "PAY_LATER" : "REQUEST")
    : r.status === "RESERVED" ? (bill.totals.paid > 0 && bill.totals.balance <= 0 ? "CONFIRMED" : "RESERVED")
    : "CONFIRMED";
  const inHouse = r.status === "CHECKED_IN" || r.status === "CHECKED_OUT";
  const links = {
    booking: `${origin}/booking/${encodeURIComponent(r.reference)}?token=${encodeURIComponent(r.manageToken)}`,
    stay: `${origin}/stay/${token}`,
    bill: `${origin}/stay/${token}/bill`,
    // Pay now: the booking's page before arrival; the guest's bill (with its Pay now) once they are staying.
    pay: inHouse ? `${origin}/stay/${token}/bill` : `${origin}/booking/${encodeURIComponent(r.reference)}?token=${encodeURIComponent(r.manageToken)}`,
  };
  const meeting = r.kind === "MEETING" && first ? {
    room: first.roomType.name, date: weekdayDate(bill.arrival), time: `${time(first.startAt)} – ${time(first.endAt)}`,
    attendees: r.adults || null, company: r.corporateCustomer?.companyName ?? r.companyName ?? null,
  } : null;
  return { r, bill, hotel, stay, money, rate, kind, links, meeting, wifi: s.wifiNetwork ? `Network: ${s.wifiNetwork}${s.wifiPassword ? ` · Password: ${s.wifiPassword}` : ""}` : null };
}

/**
 * The ready-to-send message for a stay (booking details, welcome, check-out, bill, cancellation, update, reminder,
 * payment received / pending / not completed), with who it goes to. Null when the booking is gone.
 */
export async function reservationMessage(reservationId: string, type: ReservationMessageType, origin: string, extra: {
  /** A confirmed payment: its amount and the payment service's reference. */
  amount?: number; reference?: string | null;
  /** The thank-you note's page (check-out). */
  thanksUrl?: string | null;
} = {}) {
  const f = await reservationFacts(reservationId, origin);
  if (!f) return null;
  const { r, hotel, stay, money, links } = f;
  const name = r.guest.fullName;
  let text: string;
  let subject = `${hotel.name} — ${r.reference}`;
  if (f.meeting && (type === "BOOKING" || type === "UPDATED" || type === "PAID")) {
    text = meetingMessage({ hotel, name, kind: f.kind, room: f.meeting.room, ref: r.reference, date: f.meeting.date, time: f.meeting.time, attendees: f.meeting.attendees, company: f.meeting.company, money, bookingUrl: links.booking, payUrl: links.pay });
    subject = `Your meeting room booking ${r.reference} — ${hotel.name}`;
  } else switch (type) {
    case "BOOKING":
      text = bookingMessage({ hotel, name, kind: f.kind, stay, money, rate: f.rate, bookingUrl: links.booking, payUrl: links.pay });
      subject = `Your booking ${r.reference} — ${hotel.name}`;
      break;
    case "WELCOME":
      text = welcomeMessage({ hotel, name, stay, money, wifi: f.wifi, stayUrl: links.stay });
      subject = `Welcome to ${hotel.name}`;
      break;
    case "CHECKOUT":
      text = checkoutMessage({ hotel, name, stay, money, stayUrl: links.stay, thanksUrl: extra.thanksUrl ?? null, payUrl: links.pay });
      subject = `Thank you for staying at ${hotel.name}`;
      break;
    case "BALANCE":
      text = balanceMessage({ hotel, name, stay, money, payUrl: links.pay, billUrl: links.bill });
      subject = `Your bill — ${hotel.name}`;
      break;
    case "CANCELLED":
      text = cancelledMessage({ hotel, name, stay, money, bookingUrl: links.booking });
      subject = `Booking ${r.reference} cancelled — ${hotel.name}`;
      break;
    case "UPDATED":
      text = bookingUpdatedMessage({ hotel, name, stay, money, bookingUrl: links.booking, payUrl: links.pay });
      subject = `Your booking ${r.reference} has been updated — ${hotel.name}`;
      break;
    case "REMINDER":
      text = arrivalReminderMessage({ hotel, name, stay, money, bookingUrl: links.booking, payUrl: links.pay });
      subject = `See you today — ${hotel.name}`;
      break;
    case "PAID":
      text = bookingPaidMessage({ hotel, name, stay, money, amount: extra.amount ?? money.paid, reference: extra.reference ?? null, bookingUrl: links.booking });
      subject = `Payment received — ${hotel.name}`;
      break;
    case "PAYMENT_PENDING":
      text = bookingPaymentPendingMessage({ hotel, name, stay, money, payUrl: links.pay });
      break;
    case "PAYMENT_FAILED":
      text = bookingPaymentFailedMessage({ hotel, name, stay, money, payUrl: links.pay });
      break;
  }
  return {
    text, subject, link: type === "WELCOME" || type === "CHECKOUT" ? links.stay : links.booking,
    guest: { id: r.guest.id, name, phone: internationalPhone(r.guest.phone) },
  };
}

/** A guest moved to another room. */
export async function roomChangeMessage(reservationId: string, from: string | null, to: string, effective: string, origin: string) {
  const f = await reservationFacts(reservationId, origin);
  if (!f) return null;
  return {
    text: roomChangedMessage({ hotel: f.hotel, name: f.r.guest.fullName, ref: f.r.reference, from, to, roomType: f.stay.roomType, effective: weekdayDate(effective), stayUrl: f.links.stay }),
    guest: { id: f.r.guest.id, name: f.r.guest.fullName, phone: internationalPhone(f.r.guest.phone) },
  };
}

const TRIP_SERVICE: Record<string, string> = { AIRPORT_PICKUP: "Airport pickup", AIRPORT_DROPOFF: "Airport drop-off", HOTEL_TRANSFER: "Hotel transfer", GUEST_TRANSPORT: "Transport", OTHER: "Transport" };

/** A transport booking: the trip and its price, from the trip itself. */
export async function tripMessage(tripId: string, origin: string) {
  const [t, s] = await Promise.all([
    db.transportTrip.findUnique({ where: { id: tripId }, include: { service: { select: { name: true } } } }),
    getSettings(),
  ]);
  if (!t) return null;
  const hotel: Hotel = { name: s.hotelName, phone: prettyPhone(s.whatsapp || s.phone) || null, instagram: s.instagramUrl || null, tiktok: s.tiktokUrl || null };
  const when = `${weekdayDate(fromDbDate(t.businessDate))} · ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: s.timezone }).format(t.pickupAt)}`;
  const payment = t.paidAt ? "PAID" : t.chargeId ? "ON YOUR ROOM BILL" : t.charge != null ? "NOT PAID YET" : "PRICE TO CONFIRM";
  const page = t.payToken ? `${origin}/transport/trip/${t.payToken}` : null;
  return {
    text: transportMessage({
      hotel, name: t.passengerName, ref: t.reference, service: t.service?.name ?? TRIP_SERVICE[t.type] ?? "Transport",
      route: `${t.pickupLocation} → ${t.destination}`, when, flight: t.flightNumber, passengers: t.passengers, bags: t.bags || null,
      price: t.charge, payment, tripUrl: page, payUrl: !t.paidAt && !t.chargeId && t.charge ? page : null,
      confirmed: ["CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP", "COMPLETED"].includes(t.status),
    }),
    to: internationalPhone(t.passengerPhone),
  };
}
