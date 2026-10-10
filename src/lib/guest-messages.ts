import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

/**
 * Messages to guests (booking confirmation, welcome at check-in). The hotel can
 * write its own text in Settings; these placeholders are filled in:
 * {name} {hotel} {ref} {room} {checkin} {checkout} {nights} {length} {guests} {status}
 * {balance} {link} {menu} {phone} {wifi}
 */
export const GUEST_MESSAGE_TYPES = {
  BOOKING_CREATED: msg("Booking details"),
  BOOKING_CONFIRMED: msg("Booking confirmed"),
  BOOKING_UPDATED: msg("Booking updated"),
  BOOKING_CANCELLED: msg("Booking cancelled"),
  ROOM_CHANGED: msg("Room changed"),
  PAYMENT_RECEIVED: msg("Payment received"),
  BOOKING_REMINDER: msg("Arrival reminder"),
  WELCOME: msg("Welcome / check-in"),
  CHECKOUT_REMINDER: msg("Check-out reminder"),
  THANK_YOU: msg("Thank-you note"),
  PAYMENT: msg("Payment / invoice"),
  ORDER_RECEIVED: msg("Order received"),
  ORDER_PREPARING: msg("Order being prepared"),
  ORDER_READY: msg("Order ready"),
  ORDER_DELIVERED: msg("Order delivered"),
  ORDER_CANCELLED: msg("Order cancelled"),
  ORDER_PAID: msg("Order paid"),
  TRANSPORT: msg("Transport"),
  CUSTOM: msg("Message"),
} as const;
export type GuestMessageType = keyof typeof GUEST_MESSAGE_TYPES;

export const DEFAULT_BOOKING_MESSAGE = `Hello {name},

Thank you for choosing {hotel}.

BOOKING DETAILS
Ref: {ref}
Room: {room}
Check-in: {checkin}
Check-out: {checkout}
Guests: {guests} · {length}
Status: {status}
{balance}

Explore our menu & services:
Open Menu & Services: {menu}

Need help? Call or WhatsApp {phone}.

Enjoy your stay at {hotel}.`;

export const DEFAULT_WELCOME_MESSAGE = `Hello {name},

Welcome to {hotel}!

You’re all checked in to Room {room}.

Check-out: {checkout}

Explore Vegas
View our menu, order food & drinks to your room, and explore more hotel services.

View Menu & More: {menu}

Need anything? Call or WhatsApp Reception: {phone}

Enjoy your stay!`;

/** Events the hotel can switch on or off (Admin → Settings). */
export const GUEST_EVENTS = [
  { key: "bookingCreated", label: "Booking saved — send the booking details", type: "BOOKING_CREATED" },
  { key: "checkIn", label: "Guest checked in — send the welcome message", type: "WELCOME" },
  { key: "checkOut", label: "Guest checked out — send the thank-you note", type: "THANK_YOU" },
  { key: "orders", label: "Restaurant orders — tell the customer when it is being prepared, ready, delivered or cancelled", type: "ORDER_READY" },
] as const;
export type GuestEventKey = (typeof GUEST_EVENTS)[number]["key"];
/** On unless the hotel switched it off. */
export function guestEventOn(settings: unknown, key: GuestEventKey) {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  return s[key] !== false;
}

export interface GuestMessageValues {
  name: string; hotel: string; ref: string; room: string; checkin: string; checkout: string;
  nights: number; guests: string; status: string; balance: string; link: string; menu: string; phone: string; wifi: string;
  /** "1 Night", "3 Nights" or "Day use". */
  length?: string;
}

/** Fill a template. Lines left empty by a missing value are dropped. */
export function guestMessageText(template: string | null | undefined, fallback: string, v: GuestMessageValues) {
  const first = v.name.trim().split(/\s+/)[0] || v.name;
  const map: Record<string, string> = {
    name: first, hotel: v.hotel, ref: v.ref, room: v.room, checkin: v.checkin, checkout: v.checkout, nights: String(v.nights),
    guests: v.guests, status: v.status, balance: v.balance, link: v.link, menu: v.menu, phone: v.phone, wifi: v.wifi,
    length: v.length ?? (v.nights ? `${v.nights} Night${v.nights === 1 ? "" : "s"}` : "Day use"),
  };
  // A line that only held a value the booking does not have (e.g. {balance}, {wifi}) is left out.
  return (template?.trim() || fallback).split("\n")
    .map((line) => ({ blankable: /\{\w+\}/.test(line), text: line.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? map[k] : m)) }))
    .filter((l) => !(l.blankable && l.text.trim() === ""))
    .map((l) => l.text).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Phone as a WhatsApp / SMS number: +255… (a local 07… number gets the Tanzania code). */
export function internationalPhone(phone: string | null | undefined) {
  if (!phone) return null;
  const d = phone.replace(/[^\d+]/g, "");
  if (/^\+\d{9,15}$/.test(d)) return d;
  if (/^00\d{9,15}$/.test(d)) return `+${d.slice(2)}`;
  if (/^0\d{9}$/.test(d)) return `+255${d.slice(1)}`;
  if (/^255\d{9}$/.test(d)) return `+${d}`;
  return null;
}

/** A phone number the hotel can reach: 9–15 digits (local 07… or international). */
export function validPhone(phone: string | null | undefined) {
  return internationalPhone(phone) !== null;
}

/** The thank-you message sent with the guest's thank-you note link (in the guest's language when their translator is passed). */
export function thankYouMessageText(v: { name: string; hotel: string; link: string | null; phone?: string | null; website?: string | null }, t: T = englishT) {
  return [
    t("Dear {name},", { name: v.name.trim().split(/\s+/)[0] }),
    t("Thank you for staying at {hotel}. It was a pleasure to have you with us.", { hotel: v.hotel }),
    v.link ? t("Your stay summary: {link}", { link: v.link }) : null,
    t("We look forward to welcoming you back."),
    `${v.hotel}${v.phone ? ` · ${v.phone}` : ""}${v.website ? ` · ${v.website}` : ""}`,
  ].filter(Boolean).join("\n");
}

/** "+255710223344" → "+255 710 223 344" (easy to read in a message). */
export function prettyPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const d = phone.replace(/[^\d+]/g, "");
  const m = /^\+255(\d{3})(\d{3})(\d{3})$/.exec(d);
  return m ? `+255 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

/** "+255710223344" → "+255 7•• ••• 344": enough to recognise, not enough to copy. */
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return "•••";
  const cc = phone.trim().startsWith("+") ? `+${d.slice(0, d.length - 9)} ` : "";
  const rest = d.slice(-9);
  return `${cc}${rest[0]}•• ••• ${rest.slice(-3)}`;
}
/** "nino@gmail.com" → "n•••@gmail.com". */
export function maskEmail(email: string | null | undefined) {
  if (!email || !email.includes("@")) return null;
  const [user, domain] = email.split("@");
  return `${user[0] ?? ""}•••@${domain}`;
}
/** "John Smith" → "John S." — the first name in full, the rest as initials ("asha juma" → "Asha J."). */
export function shortName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const head = first ?? name.trim();
  return [head.charAt(0).toLocaleUpperCase() + head.slice(1), ...rest.map((w) => `${w.charAt(0).toLocaleUpperCase()}.`)].join(" ");
}
