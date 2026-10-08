import { englishT, type T } from "@/i18n/translate";
import { orderItemName } from "@/i18n/content";
import { DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";

/**
 * THE GUEST MESSAGES (WhatsApp / SMS) — one place, one Vegas style (owner, 2026-10-05: "complete, clear, elegant,
 * useful — not 'Your booking is confirmed. Thank you.'"). Every message reads the same way:
 *
 *   Hello {first name},            greeting
 *   {what happened}                one clear line
 *   *SECTION*  • facts …           the booking / order / trip
 *   *PAYMENT*  • total, paid, due  money — only from the system's own records, never worked out here
 *   {status / next step}
 *   {link}                         the customer's own page (a private token, never an internal id)
 *   {reception contact}
 *   {short closing}
 *
 * Pure text builders: they only arrange the facts they are given (see src/server/services/guest-message-data.ts,
 * which reads them from the finalized booking, folio, order, trip or invoice). WhatsApp formatting: *bold* headings,
 * "•" bullets, short sections, no HTML, a few plain emoji-free lines. A fact that is unknown is left out, never shown
 * as "—".
 *
 * LANGUAGE: every builder takes the guest's translator last (`t`, English when left out) — a Chinese guest gets the
 * same message in Chinese. Only the wording changes: amounts, references, names, rooms, phones and links stay as
 * they are. The facts passed in (dates, room types, the Wi-Fi line) are already in the guest's language.
 */

export type Hotel = { name: string; phone: string | null; /** The hotel's Instagram and TikTok pages. */ instagram?: string | null; tiktok?: string | null };

/** One line of a bill: "Restaurant — TZS 35,000". */
export type BillLine = { label: string; amount: number };

/** The money of a booking / order / trip as the system keeps it. */
export type Money = {
  /** The bill's lines (room, restaurant, room service…) — whatever applies. */
  lines?: BillLine[];
  discount?: number;
  total: number;
  paid: number;
  balance: number;
  /** A refund the system has recorded (never promised). */
  refunded?: number;
  /** Billed to a company (not the guest to pay). */
  company?: string | null;
};

export type StayFacts = {
  ref: string;
  /** "Double Deluxe" (several rooms: "2 × Double Deluxe"). */
  roomType: string;
  /** Room numbers — only once they are the guest's (checked in, or moved). */
  rooms?: string | null;
  checkIn: string;
  checkOut: string;
  nights?: number | null;
  guests?: string | null;
};

// ───────────────────────── building blocks ─────────────────────────

export const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
type Line = string | null | undefined | false;
/** A heading and its bullets — left out entirely when it has no lines. */
export function section(title: string, lines: Line[]) {
  const ls = lines.filter(Boolean) as string[];
  return ls.length ? `*${title}*\n${ls.map((l) => `• ${l}`).join("\n")}` : null;
}
/** The parts of a message, a blank line between each (empty parts dropped). */
export function compose(parts: Line[]) {
  return (parts.filter(Boolean) as string[]).join("\n\n");
}
const hello = (name: string | null | undefined, t: T) => {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? t("Hello {name},", { name: first }) : t("Hello there,");
};
const contact = (h: Hotel, lead: string) => (h.phone ? `${lead}\n${h.phone}` : null);
const link = (label: string, url: string | null | undefined) => (url ? `${label}\n${url}` : null);
/**
 * The guest's own link, opening in their language: `?lang=zh` for a Chinese guest (the page remembers it as their
 * choice); English links are unchanged.
 */
export function langLink<U extends string | null | undefined>(url: U, t: T): U {
  if (!url || t.locale === DEFAULT_LOCALE || /[?&]lang=/.test(url)) return url;
  const [path, hash] = url.split("#", 2);
  return `${path}${path.includes("?") ? "&" : "?"}lang=${LOCALE_META[t.locale].segment}${hash !== undefined ? `#${hash}` : ""}` as U;
}
/** A heading with one line under it ("*PAYMENT*\nStatus: PAID"). */
const block = (title: string, text: string) => `*${title}*\n${text}`;

/** Where the money stands, in one word the guest understands. */
export function payStatus(m: Money, t: T = englishT): string {
  if (m.company && m.balance <= 0) return t("BILLED TO COMPANY");
  if (m.total <= 0) return t("NOTHING TO PAY");
  if (m.balance <= 0) return t("PAID");
  if (m.paid > 0) return t("PARTIALLY PAID");
  return t("NOT PAID YET");
}
function moneyLines(m: Money, t: T, opts: { totalSoFar?: boolean; showLines?: boolean } = {}): Line[] {
  return [
    ...(opts.showLines === false ? [] : (m.lines ?? []).filter((l) => l.amount !== 0).map((l) => t("{label}: {amount}", { label: t(l.label), amount: tzs(l.amount) }))),
    m.discount ? t("Discount: − {amount}", { amount: tzs(m.discount) }) : null,
    opts.totalSoFar ? t("Total so far: {amount}", { amount: tzs(m.total) }) : t("Total: {amount}", { amount: tzs(m.total) }),
    t("Paid: {amount}", { amount: tzs(m.paid) }),
    m.refunded ? t("Refunded: {amount}", { amount: tzs(m.refunded) }) : null,
    m.company ? t("Billed to: {company}", { company: m.company }) : t("Balance: {amount}", { amount: tzs(Math.max(0, m.balance)) }),
  ];
}
/** "2 adults, 1 child" — in the guest's language. */
export function guestsText(adults: number, children: number, t: T = englishT) {
  const a = t.plural(adults, "{n} adult", "{n} adults");
  return children ? t("{adults}, {children}", { adults: a, children: t.plural(children, "{n} child", "{n} children") }) : a;
}
const stayLines = (s: StayFacts, t: T, opts: { ref?: boolean } = {}): Line[] => [
  opts.ref === false ? null : t("Booking Ref: {ref}", { ref: s.ref }),
  s.rooms ? t("Room: {room}", { room: s.rooms }) : null,
  t("Room Type: {type}", { type: s.roomType }),
  t("Check-in: {date}", { date: s.checkIn }),
  t("Check-out: {date}", { date: s.checkOut }),
  s.nights ? t("Nights: {n}", { n: s.nights }) : null,
  s.guests ? t("Guests: {guests}", { guests: s.guests }) : null,
];

// ───────────────────────── bookings & stays ─────────────────────────

/** The booking's state when it is sent: paid and confirmed, reserved (to pay), booked to pay later, or a request. */
export type BookingKind = "CONFIRMED" | "RESERVED" | "PAY_LATER" | "REQUEST";
const BOOKING_LEAD: Record<BookingKind, (hotel: string, t: T) => string> = {
  CONFIRMED: (hotel, t) => t("Your booking at {hotel} is confirmed.", { hotel }),
  RESERVED: (hotel, t) => t("Your booking at {hotel} is reserved.", { hotel }),
  PAY_LATER: (hotel, t) => t("Your booking at {hotel} has been received. It is not reserved until it is paid.", { hotel }),
  REQUEST: (hotel, t) => t("Your booking request has been received by {hotel}.", { hotel }),
};

export function bookingMessage(v: {
  hotel: Hotel; name: string; kind: BookingKind; stay: StayFacts; money: Money;
  /** The rate, when it is one rate for every night: "TZS 80,000/night". */
  rate?: number | null;
  bookingUrl: string | null; payUrl?: string | null;
}, t: T = englishT) {
  const due = v.money.balance > 0 && !v.money.company;
  return compose([
    hello(v.name, t),
    BOOKING_LEAD[v.kind](v.hotel.name, t),
    section(t("YOUR BOOKING"), stayLines(v.stay, t)),
    section(t("BOOKING SUMMARY"), [v.rate ? t("Room Rate: {rate}/night", { rate: tzs(v.rate) }) : null, ...moneyLines(v.money, t)]),
    block(t("PAYMENT"), t("Status: {status}", { status: payStatus(v.money, t) })),
    due && v.kind === "PAY_LATER" ? t("Pay now by mobile money to secure your room — the room may go to a guest who pays first.") : null,
    due && v.payUrl && v.payUrl !== v.bookingUrl ? link(t("Pay now (mobile money):"), v.payUrl) : null,
    link(due && v.payUrl === v.bookingUrl ? t("View your booking & pay by mobile money:") : t("View your booking:"), v.bookingUrl),
    contact(v.hotel, t("Need assistance? Call or WhatsApp Reception:")),
    t("We look forward to welcoming you to {hotel}.", { hotel: v.hotel.name }),
  ]);
}

/** A mobile-money payment for a booking, confirmed by the payment service (never sent before that). */
export function bookingPaidMessage(v: {
  hotel: Hotel; name: string; stay: StayFacts; amount: number; reference: string | null; money: Money; bookingUrl: string | null;
}, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Your payment has been received by {hotel}. Thank you!", { hotel: v.hotel.name }),
    section(t("PAYMENT DETAILS"), [
      t("Booking Ref: {ref}", { ref: v.stay.ref }), t("Room Type: {type}", { type: v.stay.roomType }),
      t("Stay: {from} → {to}", { from: v.stay.checkIn, to: v.stay.checkOut }),
      t("Amount Paid: {amount}", { amount: tzs(v.amount) }), t("Method: Mobile money"), t("Payment Status: PAID"),
      v.reference ? t("Payment Reference: {reference}", { reference: v.reference }) : null,
      v.money.balance > 0 ? t("Still to pay: {amount}", { amount: tzs(v.money.balance) }) : null,
    ]),
    v.money.balance > 0 ? null : t("Your booking is now confirmed."),
    link(t("View your booking:"), v.bookingUrl),
    t("Thank you for choosing {hotel}.", { hotel: v.hotel.name }),
  ]);
}

/** A payment started but not confirmed yet — never called paid. */
export function bookingPaymentPendingMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; payUrl: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Your booking payment is pending — we have not received it yet."),
    section(t("BOOKING"), [
      ...stayLines(v.stay, t).slice(0, 5), t("Total: {amount}", { amount: tzs(v.money.total) }),
      t("Paid: {amount}", { amount: tzs(v.money.paid) }), t("Balance: {amount}", { amount: tzs(v.money.balance) }),
    ]),
    t("Your booking is treated as paid only once the payment is confirmed."),
    link(t("Complete or view the payment:"), v.payUrl),
    contact(v.hotel, t("If you need assistance:")),
  ]);
}

export function bookingPaymentFailedMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; payUrl: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("We could not confirm your mobile-money payment for your {hotel} booking.", { hotel: v.hotel.name }),
    section(t("BOOKING"), [...stayLines(v.stay, t).slice(0, 5), t("Amount Due: {amount}", { amount: tzs(v.money.balance) }), t("Payment Status: NOT PAID")]),
    link(t("You can try the payment again here:"), v.payUrl),
    contact(v.hotel, t("If you need assistance:")),
  ]);
}

/** Dates, rooms or guests changed — the new booking, priced again by the system. */
export function bookingUpdatedMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; bookingUrl: string | null; payUrl?: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Your {hotel} booking has been updated.", { hotel: v.hotel.name }),
    section(t("UPDATED BOOKING"), stayLines(v.stay, t)),
    section(t("UPDATED BILL"), moneyLines(v.money, t)),
    block(t("PAYMENT"), t("Status: {status}", { status: payStatus(v.money, t) })),
    v.money.balance > 0 && !v.money.company && v.payUrl ? link(t("Pay the balance (mobile money):"), v.payUrl) : null,
    link(t("View your updated booking:"), v.bookingUrl),
    contact(v.hotel, t("For assistance, call or WhatsApp Reception:")),
  ]);
}

export function roomChangedMessage(v: { hotel: Hotel; name: string; ref: string; from: string | null; to: string; roomType: string; effective: string; stayUrl: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Your room at {hotel} has been changed.", { hotel: v.hotel.name }),
    section(t("ROOM CHANGE"), [
      t("Booking Ref: {ref}", { ref: v.ref }), v.from ? t("Previous Room: {room}", { room: v.from }) : null, t("New Room: {room}", { room: v.to }),
      t("Room Type: {type}", { type: v.roomType }), t("From: {date}", { date: v.effective }),
    ]),
    t("Your booking stays the same."),
    link(t("View your stay:"), v.stayUrl),
    contact(v.hotel, t("If you need anything, call or WhatsApp Reception:")),
  ]);
}

export function welcomeMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; wifi?: string | null; stayUrl: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Welcome to {hotel}! You’re checked in.", { hotel: v.hotel.name }),
    section(t("YOUR STAY"), stayLines(v.stay, t)),
    section(t("PAYMENT"), [...moneyLines(v.money, t, { totalSoFar: true }), t("Status: {status}", { status: payStatus(v.money, t) })]),
    v.wifi ? block(t("WI-FI"), v.wifi) : null,
    v.stayUrl ? block(t("EXPLORE VEGAS"), `${t("See our menu, order food & drinks to your room, ask for anything and see your bill:")}\n${v.stayUrl}`) : null,
    contact(v.hotel, t("Need anything during your stay? Call or WhatsApp Reception:")),
    t("Enjoy your stay at {hotel}!", { hotel: v.hotel.name }),
  ]);
}

/** The departure summary — the final bill straight from the folio. */
export function checkoutMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; stayUrl: string | null; thanksUrl?: string | null; payUrl?: string | null }, t: T = englishT) {
  const due = v.money.balance > 0 && !v.money.company;
  return compose([
    hello(v.name, t),
    t("Thank you for staying with {hotel}. You are checked out.", { hotel: v.hotel.name }),
    section(t("YOUR STAY"), stayLines(v.stay, t)),
    section(t("FINAL BILL"), moneyLines(v.money, t)),
    block(t("PAYMENT STATUS"), due ? t("OUTSTANDING · {amount}", { amount: tzs(v.money.balance) }) : v.money.company ? t("BILLED TO COMPANY") : t("PAID IN FULL")),
    due && v.payUrl ? link(t("Pay the balance (mobile money):"), v.payUrl) : null,
    link(t("Your stay summary and bill:"), v.stayUrl),
    link(t("A thank-you note from us:"), v.thanksUrl),
    link(t("Follow us on Instagram:"), v.hotel.instagram),
    link(t("Follow us on TikTok:"), v.hotel.tiktok),
    t("We look forward to welcoming you again at {hotel}.", { hotel: v.hotel.name }),
  ]);
}

export function balanceMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; payUrl: string | null; billUrl: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("This is your bill at {hotel}.", { hotel: v.hotel.name }),
    section(t("YOUR STAY"), [
      t("Booking Ref: {ref}", { ref: v.stay.ref }),
      v.stay.rooms ? t("Room: {room}", { room: v.stay.rooms }) : t("Room Type: {type}", { type: v.stay.roomType }),
      t("Check-out: {date}", { date: v.stay.checkOut }),
    ]),
    section(t("BALANCE"), [...moneyLines(v.money, t, { showLines: true }).slice(0, -1), t("Outstanding: {amount}", { amount: tzs(Math.max(0, v.money.balance)) })]),
    t("Payment Status: {status}", { status: v.money.balance > 0 ? t("OUTSTANDING") : t("PAID") }),
    v.money.balance > 0 ? link(t("Pay now (mobile money):"), v.payUrl) : null,
    link(t("View your bill:"), v.billUrl),
    contact(v.hotel, t("For assistance, call or WhatsApp Reception:")),
  ]);
}

export function cancelledMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; bookingUrl: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Your {hotel} booking has been cancelled.", { hotel: v.hotel.name }),
    section(t("BOOKING"), stayLines(v.stay, t)),
    block(t("BOOKING STATUS"), t("CANCELLED")),
    section(t("PAYMENT"), [
      t("Paid: {amount}", { amount: tzs(v.money.paid) }),
      v.money.refunded ? t("Refunded: {amount}", { amount: tzs(v.money.refunded) }) : null,
      v.money.balance > 0 ? t("Outstanding: {amount}", { amount: tzs(v.money.balance) }) : null,
    ]),
    link(t("View the booking:"), v.bookingUrl),
    contact(v.hotel, t("Questions? Call or WhatsApp Reception:")),
  ]);
}

/** Arrival day. */
export function arrivalReminderMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; bookingUrl: string | null; payUrl?: string | null }, t: T = englishT) {
  const due = v.money.balance > 0 && !v.money.company;
  return compose([
    hello(v.name, t),
    t("We look forward to welcoming you to {hotel} today.", { hotel: v.hotel.name }),
    section(t("YOUR BOOKING"), stayLines(v.stay, t)),
    due ? block(t("PAYMENT"), t("To pay: {amount}", { amount: tzs(v.money.balance) })) : null,
    due && v.payUrl ? link(t("Pay now (mobile money) and skip the wait:"), v.payUrl) : null,
    link(t("Your booking:"), v.bookingUrl),
    contact(v.hotel, t("Running late or need directions? Call or WhatsApp Reception:")),
  ]);
}

/** The meeting room, on the day. */
export function meetingReminderMessage(v: {
  hotel: Hotel; name: string; room: string; ref: string; date: string; time: string; attendees?: number | null; money: Money; bookingUrl: string | null;
}, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("A reminder of your meeting room booking at {hotel} today.", { hotel: v.hotel.name }),
    section(t("YOUR BOOKING"), [
      t("Booking Ref: {ref}", { ref: v.ref }), t("Room: {room}", { room: v.room }), t("Date: {date}", { date: v.date }), t("Time: {time}", { time: v.time }),
      v.attendees ? t("Attendees: {n}", { n: v.attendees }) : null,
    ]),
    v.money.balance > 0 && !v.money.company ? block(t("PAYMENT"), t("To pay: {amount}", { amount: tzs(v.money.balance) })) : null,
    link(t("Your booking:"), v.bookingUrl),
    contact(v.hotel, t("Need anything set up? Call or WhatsApp Reception:")),
  ]);
}

/** The meeting room. */
export function meetingMessage(v: {
  hotel: Hotel; name: string; kind: BookingKind; room: string; ref: string; date: string; time: string;
  attendees?: number | null; company?: string | null; money: Money; bookingUrl: string | null; payUrl?: string | null;
}, t: T = englishT) {
  const hotel = v.hotel.name;
  const lead = v.kind === "CONFIRMED" ? t("Your meeting room booking at {hotel} is confirmed.", { hotel })
    : v.kind === "RESERVED" ? t("Your meeting room booking at {hotel} is reserved.", { hotel })
    : v.kind === "PAY_LATER" ? t("Your meeting room booking at {hotel} has been received. It is not reserved until it is paid.", { hotel })
    : t("Your meeting room request has been received by {hotel}.", { hotel });
  return compose([
    hello(v.name, t),
    lead,
    section(t("MEETING ROOM"), [
      t("Room: {room}", { room: v.room }), t("Booking Ref: {ref}", { ref: v.ref }), t("Date: {date}", { date: v.date }), t("Time: {time}", { time: v.time }),
      v.attendees ? t("Attendees: {n}", { n: v.attendees }) : null, v.company ? t("Company: {company}", { company: v.company }) : null,
    ]),
    section(t("PAYMENT"), [
      t("Price: {amount}", { amount: tzs(v.money.total) }), t("Paid: {amount}", { amount: tzs(v.money.paid) }),
      t("Balance: {amount}", { amount: tzs(Math.max(0, v.money.balance)) }), t("Status: {status}", { status: payStatus(v.money, t) }),
    ]),
    v.money.balance > 0 && v.payUrl ? link(t("Pay now (mobile money):"), v.payUrl) : null,
    link(t("View the booking:"), v.bookingUrl),
    contact(v.hotel, t("For assistance, call or WhatsApp Reception:")),
  ]);
}

// ───────────────────────── restaurant & room service ─────────────────────────

export type OrderFacts = {
  number: string; place: string; type: string; date: string;
  /** When it was ordered and the hotel's time zone — the date is written again in the customer's language. */
  at?: Date | string | null; timezone?: string | null;
  /** nameI18n: the dish's name in each language when it was ordered. */
  items: { name: string; qty: number; total: number; nameI18n?: unknown }[];
  fee?: number; total: number;
  /** "PAID", "CHARGED TO ROOM", "PAY AFTER", "WAITING FOR PAYMENT"… (English; translated when shown). */
  payment: string;
};

/** "Mon 5 Oct, 14:05" in the customer's language (the hotel's time zone). */
export function orderDateText(at: Date | string, timezone: string, t: T = englishT) {
  return new Intl.DateTimeFormat(t.intl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone })
    .format(typeof at === "string" ? new Date(at) : at);
}

/** Where an order is served, in the customer's words ("Room 204", "Table 3", "Take out — {address}", "Counter"). */
export function placeText(place: string, t: T = englishT) {
  let m = /^Room (\S+)$/.exec(place);
  if (m) return t("Room {room}", { room: m[1] });
  m = /^Table (\S+)$/.exec(place);
  if (m) return t("Table {table}", { table: m[1] });
  m = /^Take out — ([\s\S]+)$/.exec(place);
  if (m) return t("Take out — {address}", { address: m[1] });
  return t(place);
}

const orderDetails = (o: OrderFacts, t: T, status?: string): Line[] => [
  t("Order No: {number}", { number: o.number }), t("Place: {place}", { place: placeText(o.place, t) }), t("Order Type: {type}", { type: t(o.type) }),
  status ? t("Status: {status}", { status }) : null,
  t("Date: {date}", { date: o.at && o.timezone ? orderDateText(o.at, o.timezone, t) : o.date }),
];
const orderLines = (o: OrderFacts, t: T): Line[] => [
  ...o.items.map((i) => `${orderItemName({ name: i.name, nameI18n: i.nameI18n }, t)} × ${i.qty} — ${tzs(i.total)}`),
  o.fee ? t("Room Service Fee — {amount}", { amount: tzs(o.fee) }) : null,
];

/** The whole order, as received. */
export function orderReceivedMessage(v: { hotel: Hotel; name: string | null; order: OrderFacts; trackUrl: string | null }, t: T = englishT) {
  const o = v.order;
  return compose([
    hello(v.name, t),
    t("Your order has been received by {hotel}.", { hotel: v.hotel.name }),
    section(t("ORDER DETAILS"), orderDetails(o, t)),
    section(t("YOUR ORDER"), orderLines(o, t)),
    block(t("TOTAL"), tzs(o.total)),
    block(t("PAYMENT"), t("Status: {status}", { status: t(o.payment) })),
    link(t("Track your order:"), v.trackUrl),
    contact(v.hotel, t("Need assistance? Call or WhatsApp us:")),
  ]);
}

/**
 * A step of the order (being prepared, ready, served, delivered, cancelled) — the same full layout as "received"
 * (owner, 2026-10-06: every message in the one structure): what happened, the order, its lines, total, payment,
 * the tracking link and how to reach the hotel. `status` and `line` come already in the customer's language.
 */
export function orderStatusMessage(v: {
  hotel: Hotel; name: string | null; number: string; place: string; status: string; line: string; trackUrl: string | null; again?: string | null;
  order?: OrderFacts | null;
}, t: T = englishT) {
  const o = v.order;
  return compose([
    hello(v.name, t),
    v.line,
    section(t("ORDER DETAILS"), o
      ? orderDetails(o, t, v.status)
      : [t("Order No: {number}", { number: v.number }), t("Place: {place}", { place: placeText(v.place, t) }), t("Status: {status}", { status: v.status })]),
    o ? section(t("YOUR ORDER"), orderLines(o, t)) : null,
    o ? block(t("TOTAL"), tzs(o.total)) : null,
    o ? block(t("PAYMENT"), t("Status: {status}", { status: t(o.payment) })) : null,
    link(t("Track your order:"), v.trackUrl),
    link(t("Order again any time:"), v.again),
    contact(v.hotel, t("Need assistance? Call or WhatsApp us:")),
  ]);
}

/** A group's charges so far (not the final invoice yet). */
export function groupStatementMessage(v: { hotel: Hotel; greet: string; group: string; number: string; rooms: number; money: Money }, t: T = englishT) {
  return compose([
    t("Dear {name},", { name: v.greet }),
    t("Here is the statement of {group}'s charges so far at {hotel}.", { group: v.group, hotel: v.hotel.name }),
    section(t("STATEMENT"), [t("Statement No: {number}", { number: v.number }), t("Group: {group}", { group: v.group }), t("Rooms: {n}", { n: v.rooms })]),
    section(t("AMOUNT"), [
      t("Total so far: {amount}", { amount: tzs(v.money.total) }), t("Paid: {amount}", { amount: tzs(v.money.paid) }),
      t("Balance: {amount}", { amount: tzs(Math.max(0, v.money.balance)) }), t("Status: {status}", { status: payStatus(v.money, t) }),
    ]),
    t("This is not the final invoice — it follows when every room has checked out."),
    contact(v.hotel, t("Questions? Call or WhatsApp us:")),
  ]);
}

/** A booking request from the website, before it is a booking: what the guest asked for and where it stands. */
export function bookingRequestMessage(v: {
  hotel: Hotel; name: string; ref: string; roomType: string; rooms?: number;
  checkIn: string; checkOut?: string | null; nights?: number | null; time?: string | null; guests: string;
  estimate?: number | null; status: string;
}, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Thank you for your booking request at {hotel}. Reception here, about your request.", { hotel: v.hotel.name }),
    section(t("YOUR REQUEST"), [
      t("Request Ref: {ref}", { ref: v.ref }), t("Room Type: {type}", { type: v.roomType }), v.rooms && v.rooms > 1 ? t("Rooms: {n}", { n: v.rooms }) : null,
      v.time ? t("Date: {date}", { date: v.checkIn }) : t("Check-in: {date}", { date: v.checkIn }),
      v.time ? t("Time: {time}", { time: v.time }) : v.checkOut ? t("Check-out: {date}", { date: v.checkOut }) : null,
      !v.time && v.nights ? t("Nights: {n}", { n: v.nights }) : null, t("Guests: {guests}", { guests: v.guests }),
    ]),
    v.estimate ? section(t("PRICE"), [t("Estimated total: {amount}", { amount: tzs(v.estimate) }), t("The final price is confirmed with your booking.")]) : null,
    block(t("STATUS"), v.status),
    contact(v.hotel, t("Reply here, or call or WhatsApp Reception:")),
    t("We look forward to welcoming you to {hotel}.", { hotel: v.hotel.name }),
  ]);
}

/** The order was paid by mobile money (confirmed by the payment service). */
export function orderPaidMessage(v: { hotel: Hotel; name: string | null; order: OrderFacts; amount: number; reference: string | null; trackUrl: string | null }, t: T = englishT) {
  return compose([
    hello(v.name, t),
    t("Your payment has been received by {hotel}. Thank you!", { hotel: v.hotel.name }),
    section(t("ORDER"), [
      t("Order No: {number}", { number: v.order.number }), t("Place: {place}", { place: placeText(v.order.place, t) }),
      t("Items: {n}", { n: v.order.items.reduce((n, i) => n + i.qty, 0) }), t("Total: {amount}", { amount: tzs(v.order.total) }),
    ]),
    section(t("PAYMENT"), [
      t("Method: Mobile money"), t("Amount Paid: {amount}", { amount: tzs(v.amount) }), t("Status: PAID"),
      v.reference ? t("Reference: {reference}", { reference: v.reference }) : null,
    ]),
    link(t("View your order:"), v.trackUrl),
    t("Thank you for ordering from {hotel}.", { hotel: v.hotel.name }),
  ]);
}

// ───────────────────────── transport ─────────────────────────

/** `service`, `when` and `payment` come already in the guest's language. */
export function transportMessage(v: {
  hotel: Hotel; name: string; ref: string; service: string; route: string; when: string;
  flight?: string | null; passengers?: number | null; bags?: number | null;
  price: number | null; payment: string; tripUrl: string | null; payUrl?: string | null; confirmed: boolean;
}, t: T = englishT) {
  const service = v.service.toLowerCase();
  return compose([
    hello(v.name, t),
    v.confirmed
      ? t("Your {service} with {hotel} is confirmed.", { service, hotel: v.hotel.name })
      : t("Your {service} request has been received by {hotel}.", { service, hotel: v.hotel.name }),
    section(t("TRANSPORT"), [
      t("Reference: {reference}", { reference: v.ref }), t("Guest: {name}", { name: v.name }), t("Route: {route}", { route: v.route }),
      v.flight ? t("Flight: {flight}", { flight: v.flight }) : null, t("When: {when}", { when: v.when }),
      v.passengers ? t("Passengers: {n}", { n: v.passengers }) : null, v.bags ? t("Bags: {n}", { n: v.bags }) : null,
    ]),
    section(t("TRANSFER"), [
      t("Service: {service}", { service: v.service }),
      v.price != null ? t("Price: {amount}", { amount: tzs(v.price) }) : t("Price: we confirm it with you"),
      t("Payment Status: {status}", { status: v.payment }),
    ]),
    v.payUrl ? link(t("Pay now (mobile money):"), v.payUrl) : null,
    link(t("View your trip:"), v.tripUrl),
    t("Our team will coordinate your transfer with you."),
    contact(v.hotel, t("For assistance, call or WhatsApp Reception:")),
  ]);
}

// ───────────────────────── invoices ─────────────────────────

export function invoiceMessageText(v: {
  hotel: Hotel; greet: string; number: string; final?: boolean; forWhat?: string | null; issued?: string | null; due?: string | null;
  money: Money; url: string | null;
}, t: T = englishT) {
  const hotel = v.hotel.name;
  const what = v.forWhat;
  const lead = v.final
    ? (what ? t("Your final invoice from {hotel} for {what}.", { hotel, what }) : t("Your final invoice from {hotel}.", { hotel }))
    : (what ? t("Your invoice from {hotel} for {what}.", { hotel, what }) : t("Your invoice from {hotel}.", { hotel }));
  return compose([
    t("Dear {name},", { name: v.greet }),
    lead,
    section(t("INVOICE"), [
      t("Invoice No: {number}", { number: v.number }), v.issued ? t("Issued: {date}", { date: v.issued }) : null,
      v.due && v.money.balance > 0 ? t("Due by: {date}", { date: v.due }) : null,
    ]),
    section(t("AMOUNT"), [
      t("Total: {amount}", { amount: tzs(v.money.total) }), t("Paid: {amount}", { amount: tzs(v.money.paid) }),
      t("Balance: {amount}", { amount: tzs(Math.max(0, v.money.balance)) }), t("Status: {status}", { status: payStatus(v.money, t) }),
    ]),
    v.money.balance > 0 ? t("Please use {number} as the payment reference.", { number: v.number }) : null,
    link(v.money.balance > 0 ? t("View the invoice and pay by mobile money:") : t("View the invoice:"), v.url),
    contact(v.hotel, t("Questions? Call or WhatsApp us:")),
  ]);
}
