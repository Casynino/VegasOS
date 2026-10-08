import "server-only";
import { db } from "../db";
import { getSettings } from "../settings";
import { formatMinutes, fromDbDate } from "@/lib/time/business-date";
import { internationalPhone, prettyPhone } from "@/lib/guest-messages";
import {
  arrivalReminderMessage, balanceMessage, bookingMessage, bookingPaidMessage, bookingPaymentFailedMessage, bookingPaymentPendingMessage,
  bookingUpdatedMessage, cancelledMessage, checkoutMessage, guestsText, langLink, meetingMessage, roomChangedMessage, transportMessage, welcomeMessage,
  type BookingKind, type Hotel, type Money, type StayFacts,
} from "@/lib/wa-messages";
import { getTFor } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";
import { stayBill } from "./stay-bill";
import { ensureGuestToken } from "./guest-comms";
import { isPayLater } from "./booking-holds";

/**
 * The facts every guest message is written from — read from the system's own records (the booking and its folio, the
 * payment, the trip), never worked out again: the bill's totals are the billing engine's, the payment's reference is
 * the payment service's. The words are in src/lib/wa-messages.ts. Links are the guest's private pages (tokens only).
 *
 * Each message is in ITS GUEST's language (Guest.preferredLanguage, English when not known): the words, the dates
 * (the same hotel days and times, written their way), the hotel's room type names; links open their pages in it.
 */

/** The guest's translator — their saved language, else English. */
export const guestT = (language: string | null | undefined): Promise<T> => getTFor(language);

export async function messageHotel(): Promise<Hotel> {
  const s = await getSettings();
  return { name: s.hotelName, phone: prettyPhone(s.whatsapp || s.phone) || null, instagram: s.instagramUrl || null, tiktok: s.tiktokUrl || null };
}

/** "2026-10-05" → "Mon, 5 Oct 2026" ("2026年10月5日周一" in Chinese). */
export const weekdayDate = (d: string, t: T = englishT) => t.date(d);
export { guestsText };

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
        guest: { select: { id: true, fullName: true, phone: true, preferredLanguage: true } },
        rooms: { where: { status: { not: "CANCELLED" } }, orderBy: { startAt: "asc" }, select: { startAt: true, endAt: true, isDayUse: true, status: true, room: { select: { number: true } }, roomType: { select: { name: true } } } },
      },
    }),
    getSettings(),
  ]);
  if (!bill || !r) return null;
  const [token, t] = await Promise.all([ensureGuestToken(db, reservationId), guestT(r.guest.preferredLanguage)]);
  const hotel: Hotel = { name: s.hotelName, phone: prettyPhone(s.whatsapp || s.phone) || null, instagram: s.instagramUrl || null, tiktok: s.tiktokUrl || null };
  const tz = s.timezone;
  const time = (d: Date) => t.time(d, tz);
  const date = (d: string) => weekdayDate(d, t);

  // The room type(s): "Double Deluxe", "2 × Double Deluxe", "Double Deluxe, Executive Suite" (in the guest's language).
  const counts = new Map<string, number>();
  for (const x of r.rooms) counts.set(x.roomType.name, (counts.get(x.roomType.name) ?? 0) + 1);
  const roomType = [...counts].map(([n, c]) => (c > 1 ? `${c} × ${t(n)}` : t(n))).join(", ") || "—";
  // Room numbers only once they are the guest's (checked in or out) — before that a room can still change.
  const assigned = r.rooms.some((x) => x.status === "CHECKED_IN" || x.status === "CHECKED_OUT");
  const dayUse = r.rooms.length > 0 && r.rooms.every((x) => x.isDayUse);
  const first = r.rooms[0];
  const stay: StayFacts = {
    ref: r.reference, roomType,
    rooms: assigned ? r.rooms.filter((x) => x.status === "CHECKED_IN" || x.status === "CHECKED_OUT").map((x) => x.room.number).join(", ") : null,
    checkIn: dayUse && first ? `${date(bill.arrival)} · ${time(first.startAt)}` : t("{date} · from {time}", { date: date(bill.arrival), time: formatMinutes(s.standardCheckInMinutes) }),
    checkOut: dayUse && first ? `${date(bill.departure)} · ${time(first.endAt)}` : t("{date} · by {time}", { date: date(bill.departure), time: formatMinutes(s.checkoutMinutes) }),
    nights: dayUse ? null : bill.rooms.reduce((m, x) => Math.max(m, x.nights), 0) || null,
    guests: r.kind === "MEETING" ? null : guestsText(r.adults, r.children, t),
  };

  // The bill as the folio has it: the room(s), then each kind of charge; the discount; total, paid, balance.
  const bySection = new Map<string, number>();
  for (const c of bill.charges) bySection.set(c.section, (bySection.get(c.section) ?? 0) + c.amount);
  const refunded = bill.payments.filter((p) => p.refund).reduce((t, p) => t + p.amount, 0);
  const company = r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? r.companyName ?? t("the company") : null;
  const money: Money = {
    // English labels (the message translates them): the room(s), then the folio's sections.
    lines: [{ label: r.kind === "MEETING" ? msg("Meeting room") : bill.rooms.length > 1 ? msg("Rooms") : msg("Room"), amount: bill.totals.rooms }, ...[...bySection].map(([label, amount]) => ({ label, amount }))],
    discount: bill.totals.discount || undefined,
    total: bill.totals.total, paid: bill.totals.paid, balance: bill.totals.balance, refunded: refunded || undefined,
    company: company && bill.totals.company > 0 ? company : null,
  };
  const rate = bill.rooms.length === 1 && !bill.rooms[0].dated && !bill.rooms[0].dayUse ? bill.rooms[0].rate : null;

  const kind: BookingKind = r.status === "INQUIRY" ? (isPayLater(r.externalData) ? "PAY_LATER" : "REQUEST")
    : r.status === "RESERVED" ? (bill.totals.paid > 0 && bill.totals.balance <= 0 ? "CONFIRMED" : "RESERVED")
    : "CONFIRMED";
  const inHouse = r.status === "CHECKED_IN" || r.status === "CHECKED_OUT";
  // The guest's pages, opening in their language.
  const links = {
    booking: langLink(`${origin}/booking/${encodeURIComponent(r.reference)}?token=${encodeURIComponent(r.manageToken)}`, t),
    stay: langLink(`${origin}/stay/${token}`, t),
    bill: langLink(`${origin}/stay/${token}/bill`, t),
    // Pay now: the booking's page before arrival; the guest's bill (with its Pay now) once they are staying.
    pay: langLink(inHouse ? `${origin}/stay/${token}/bill` : `${origin}/booking/${encodeURIComponent(r.reference)}?token=${encodeURIComponent(r.manageToken)}`, t),
  };
  const meeting = r.kind === "MEETING" && first ? {
    room: t(first.roomType.name), date: date(bill.arrival), time: `${time(first.startAt)} – ${time(first.endAt)}`,
    attendees: r.adults || null, company: r.corporateCustomer?.companyName ?? r.companyName ?? null,
  } : null;
  const wifi = s.wifiNetwork
    ? `${t("Network: {network}", { network: s.wifiNetwork })}${s.wifiPassword ? ` · ${t("Password: {password}", { password: s.wifiPassword })}` : ""}`
    : null;
  return { r, t, bill, hotel, stay, money, rate, kind, links, meeting, wifi };
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
  const { r, t, hotel, stay, money, links } = f;
  const name = r.guest.fullName;
  const ref = r.reference;
  const thanksUrl = langLink(extra.thanksUrl ?? null, t);
  let text: string;
  let subject = `${hotel.name} — ${r.reference}`;
  if (f.meeting && (type === "BOOKING" || type === "UPDATED" || type === "PAID")) {
    text = meetingMessage({ hotel, name, kind: f.kind, room: f.meeting.room, ref: r.reference, date: f.meeting.date, time: f.meeting.time, attendees: f.meeting.attendees, company: f.meeting.company, money, bookingUrl: links.booking, payUrl: links.pay }, t);
    subject = t("Your meeting room booking {ref} — {hotel}", { ref, hotel: hotel.name });
  } else switch (type) {
    case "BOOKING":
      text = bookingMessage({ hotel, name, kind: f.kind, stay, money, rate: f.rate, bookingUrl: links.booking, payUrl: links.pay }, t);
      subject = t("Your booking {ref} — {hotel}", { ref, hotel: hotel.name });
      break;
    case "WELCOME":
      text = welcomeMessage({ hotel, name, stay, money, wifi: f.wifi, stayUrl: links.stay }, t);
      subject = t("Welcome to {hotel}", { hotel: hotel.name });
      break;
    case "CHECKOUT":
      text = checkoutMessage({ hotel, name, stay, money, stayUrl: links.stay, thanksUrl, payUrl: links.pay }, t);
      subject = t("Thank you for staying at {hotel}", { hotel: hotel.name });
      break;
    case "BALANCE":
      text = balanceMessage({ hotel, name, stay, money, payUrl: links.pay, billUrl: links.bill }, t);
      subject = t("Your bill — {hotel}", { hotel: hotel.name });
      break;
    case "CANCELLED":
      text = cancelledMessage({ hotel, name, stay, money, bookingUrl: links.booking }, t);
      subject = t("Booking {ref} cancelled — {hotel}", { ref, hotel: hotel.name });
      break;
    case "UPDATED":
      text = bookingUpdatedMessage({ hotel, name, stay, money, bookingUrl: links.booking, payUrl: links.pay }, t);
      subject = t("Your booking {ref} has been updated — {hotel}", { ref, hotel: hotel.name });
      break;
    case "REMINDER":
      text = arrivalReminderMessage({ hotel, name, stay, money, bookingUrl: links.booking, payUrl: links.pay }, t);
      subject = t("See you today — {hotel}", { hotel: hotel.name });
      break;
    case "PAID":
      text = bookingPaidMessage({ hotel, name, stay, money, amount: extra.amount ?? money.paid, reference: extra.reference ?? null, bookingUrl: links.booking }, t);
      subject = t("Payment received — {hotel}", { hotel: hotel.name });
      break;
    case "PAYMENT_PENDING":
      text = bookingPaymentPendingMessage({ hotel, name, stay, money, payUrl: links.pay }, t);
      break;
    case "PAYMENT_FAILED":
      text = bookingPaymentFailedMessage({ hotel, name, stay, money, payUrl: links.pay }, t);
      break;
  }
  return {
    text, subject, link: type === "WELCOME" || type === "CHECKOUT" ? links.stay : links.booking,
    guest: { id: r.guest.id, name, phone: internationalPhone(r.guest.phone) },
    /** The language the message is written in (the guest's). */
    locale: t.locale,
  };
}

/** A guest moved to another room. */
export async function roomChangeMessage(reservationId: string, from: string | null, to: string, effective: string, origin: string) {
  const f = await reservationFacts(reservationId, origin);
  if (!f) return null;
  return {
    text: roomChangedMessage({ hotel: f.hotel, name: f.r.guest.fullName, ref: f.r.reference, from, to, roomType: f.stay.roomType, effective: weekdayDate(effective, f.t), stayUrl: f.links.stay }, f.t),
    guest: { id: f.r.guest.id, name: f.r.guest.fullName, phone: internationalPhone(f.r.guest.phone) },
    locale: f.t.locale,
  };
}

const TRIP_SERVICE: Record<string, string> = {
  AIRPORT_PICKUP: msg("Airport pickup"), AIRPORT_DROPOFF: msg("Airport drop-off"), HOTEL_TRANSFER: msg("Hotel transfer"), GUEST_TRANSPORT: msg("Transport"), OTHER: msg("Transport"),
};

/** A transport booking: the trip and its price, from the trip itself — in its guest's language (the linked guest, else the booking's). */
export async function tripMessage(tripId: string, origin: string) {
  const [trip, s] = await Promise.all([
    db.transportTrip.findUnique({
      where: { id: tripId },
      include: {
        service: { select: { name: true } }, guest: { select: { preferredLanguage: true } },
        reservation: { select: { guest: { select: { preferredLanguage: true } } } },
      },
    }),
    getSettings(),
  ]);
  if (!trip) return null;
  const t = await guestT(trip.guest?.preferredLanguage ?? trip.reservation?.guest.preferredLanguage);
  const hotel: Hotel = { name: s.hotelName, phone: prettyPhone(s.whatsapp || s.phone) || null, instagram: s.instagramUrl || null, tiktok: s.tiktokUrl || null };
  const when = `${weekdayDate(fromDbDate(trip.businessDate), t)} · ${t.time(trip.pickupAt, s.timezone)}`;
  const payment = trip.paidAt ? t("PAID") : trip.chargeId ? t("ON YOUR ROOM BILL") : trip.charge != null ? t("NOT PAID YET") : t("PRICE TO CONFIRM");
  const page = langLink(trip.payToken ? `${origin}/transport/trip/${trip.payToken}` : null, t);
  return {
    text: transportMessage({
      hotel, name: trip.passengerName, ref: trip.reference, service: t(trip.service?.name ?? TRIP_SERVICE[trip.type] ?? "Transport"),
      route: `${trip.pickupLocation} → ${trip.destination}`, when, flight: trip.flightNumber, passengers: trip.passengers, bags: trip.bags || null,
      price: trip.charge, payment, tripUrl: page, payUrl: !trip.paidAt && !trip.chargeId && trip.charge ? page : null,
      confirmed: ["CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP", "COMPLETED"].includes(trip.status),
    }, t),
    to: internationalPhone(trip.passengerPhone),
    locale: t.locale,
  };
}
