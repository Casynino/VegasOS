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
 * as "—". English now; every sentence lives here, so a Swahili set can follow the same shapes.
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
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";
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
const hello = (name: string | null | undefined) => `Hello ${firstName(name)},`;
const contact = (h: Hotel, lead = "Need anything? Call or WhatsApp Reception:") => (h.phone ? `${lead}\n${h.phone}` : null);
const link = (label: string, url: string | null | undefined) => (url ? `${label}\n${url}` : null);

/** Where the money stands, in one word the guest understands. */
export function payStatus(m: Money): string {
  if (m.company && m.balance <= 0) return "BILLED TO COMPANY";
  if (m.total <= 0) return "NOTHING TO PAY";
  if (m.balance <= 0) return "PAID";
  if (m.paid > 0) return "PARTIALLY PAID";
  return "NOT PAID YET";
}
function moneyLines(m: Money, opts: { totalLabel?: string; showLines?: boolean } = {}): Line[] {
  return [
    ...(opts.showLines === false ? [] : (m.lines ?? []).filter((l) => l.amount !== 0).map((l) => `${l.label}: ${tzs(l.amount)}`)),
    m.discount ? `Discount: − ${tzs(m.discount)}` : null,
    `${opts.totalLabel ?? "Total"}: ${tzs(m.total)}`,
    `Paid: ${tzs(m.paid)}`,
    m.refunded ? `Refunded: ${tzs(m.refunded)}` : null,
    m.company ? `Billed to: ${m.company}` : `Balance: ${tzs(Math.max(0, m.balance))}`,
  ];
}
const stayLines = (s: StayFacts, opts: { ref?: boolean } = {}): Line[] => [
  opts.ref === false ? null : `Booking Ref: ${s.ref}`,
  s.rooms ? `Room: ${s.rooms}` : null,
  `Room Type: ${s.roomType}`,
  `Check-in: ${s.checkIn}`,
  `Check-out: ${s.checkOut}`,
  s.nights ? `Nights: ${s.nights}` : null,
  s.guests ? `Guests: ${s.guests}` : null,
];

// ───────────────────────── bookings & stays ─────────────────────────

/** The booking's state when it is sent: paid and confirmed, reserved (to pay), booked to pay later, or a request. */
export type BookingKind = "CONFIRMED" | "RESERVED" | "PAY_LATER" | "REQUEST";
const BOOKING_LEAD: Record<BookingKind, (h: string) => string> = {
  CONFIRMED: (h) => `Your booking at ${h} is confirmed.`,
  RESERVED: (h) => `Your booking at ${h} is reserved.`,
  PAY_LATER: (h) => `Your booking at ${h} has been received. It is not reserved until it is paid.`,
  REQUEST: (h) => `Your booking request has been received by ${h}.`,
};

export function bookingMessage(v: {
  hotel: Hotel; name: string; kind: BookingKind; stay: StayFacts; money: Money;
  /** The rate, when it is one rate for every night: "TZS 80,000/night". */
  rate?: number | null;
  bookingUrl: string | null; payUrl?: string | null;
}) {
  const due = v.money.balance > 0 && !v.money.company;
  return compose([
    hello(v.name),
    BOOKING_LEAD[v.kind](v.hotel.name),
    section("YOUR BOOKING", stayLines(v.stay)),
    section("BOOKING SUMMARY", [v.rate ? `Room Rate: ${tzs(v.rate)}/night` : null, ...moneyLines(v.money)]),
    `*PAYMENT*\nStatus: ${payStatus(v.money)}`,
    due && v.kind === "PAY_LATER" ? "Pay now by mobile money to secure your room — the room may go to a guest who pays first." : null,
    due && v.payUrl && v.payUrl !== v.bookingUrl ? link("Pay now (mobile money):", v.payUrl) : null,
    link(due && v.payUrl === v.bookingUrl ? "View your booking & pay by mobile money:" : "View your booking:", v.bookingUrl),
    contact(v.hotel, "Need assistance? Call or WhatsApp Reception:"),
    `We look forward to welcoming you to ${v.hotel.name}.`,
  ]);
}

/** A mobile-money payment for a booking, confirmed by the payment service (never sent before that). */
export function bookingPaidMessage(v: {
  hotel: Hotel; name: string; stay: StayFacts; amount: number; reference: string | null; money: Money; bookingUrl: string | null;
}) {
  return compose([
    hello(v.name),
    `Your payment has been received by ${v.hotel.name}. Thank you!`,
    section("PAYMENT DETAILS", [
      `Booking Ref: ${v.stay.ref}`, `Room Type: ${v.stay.roomType}`, `Stay: ${v.stay.checkIn} → ${v.stay.checkOut}`,
      `Amount Paid: ${tzs(v.amount)}`, "Method: Mobile money", "Payment Status: PAID", v.reference ? `Payment Reference: ${v.reference}` : null,
      v.money.balance > 0 ? `Still to pay: ${tzs(v.money.balance)}` : null,
    ]),
    v.money.balance > 0 ? null : "Your booking is now confirmed.",
    link("View your booking:", v.bookingUrl),
    `Thank you for choosing ${v.hotel.name}.`,
  ]);
}

/** A payment started but not confirmed yet — never called paid. */
export function bookingPaymentPendingMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; payUrl: string | null }) {
  return compose([
    hello(v.name),
    "Your booking payment is pending — we have not received it yet.",
    section("BOOKING", [...stayLines(v.stay, {}).slice(0, 5), `Total: ${tzs(v.money.total)}`, `Paid: ${tzs(v.money.paid)}`, `Balance: ${tzs(v.money.balance)}`]),
    "Your booking is treated as paid only once the payment is confirmed.",
    link("Complete or view the payment:", v.payUrl),
    contact(v.hotel, "If you need assistance:"),
  ]);
}

export function bookingPaymentFailedMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; payUrl: string | null }) {
  return compose([
    hello(v.name),
    `We could not confirm your mobile-money payment for your ${v.hotel.name} booking.`,
    section("BOOKING", [...stayLines(v.stay, {}).slice(0, 5), `Amount Due: ${tzs(v.money.balance)}`, "Payment Status: NOT PAID"]),
    link("You can try the payment again here:", v.payUrl),
    contact(v.hotel, "If you need assistance:"),
  ]);
}

/** Dates, rooms or guests changed — the new booking, priced again by the system. */
export function bookingUpdatedMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; bookingUrl: string | null; payUrl?: string | null }) {
  return compose([
    hello(v.name),
    `Your ${v.hotel.name} booking has been updated.`,
    section("UPDATED BOOKING", stayLines(v.stay)),
    section("UPDATED BILL", moneyLines(v.money)),
    `*PAYMENT*\nStatus: ${payStatus(v.money)}`,
    v.money.balance > 0 && !v.money.company && v.payUrl ? link("Pay the balance (mobile money):", v.payUrl) : null,
    link("View your updated booking:", v.bookingUrl),
    contact(v.hotel, "For assistance, call or WhatsApp Reception:"),
  ]);
}

export function roomChangedMessage(v: { hotel: Hotel; name: string; ref: string; from: string | null; to: string; roomType: string; effective: string; stayUrl: string | null }) {
  return compose([
    hello(v.name),
    `Your room at ${v.hotel.name} has been changed.`,
    section("ROOM CHANGE", [`Booking Ref: ${v.ref}`, v.from ? `Previous Room: ${v.from}` : null, `New Room: ${v.to}`, `Room Type: ${v.roomType}`, `From: ${v.effective}`]),
    "Your booking stays the same.",
    link("View your stay:", v.stayUrl),
    contact(v.hotel, "If you need anything, call or WhatsApp Reception:"),
  ]);
}

export function welcomeMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; wifi?: string | null; stayUrl: string | null }) {
  return compose([
    hello(v.name),
    `Welcome to ${v.hotel.name}! You’re checked in.`,
    section("YOUR STAY", stayLines(v.stay)),
    section("PAYMENT", [...moneyLines(v.money, { totalLabel: "Total so far" }), `Status: ${payStatus(v.money)}`]),
    v.wifi ? `*WI-FI*\n${v.wifi}` : null,
    v.stayUrl ? `*EXPLORE VEGAS*\nSee our menu, order food & drinks to your room, ask for anything and see your bill:\n${v.stayUrl}` : null,
    contact(v.hotel, "Need anything during your stay? Call or WhatsApp Reception:"),
    `Enjoy your stay at ${v.hotel.name}!`,
  ]);
}

/** The departure summary — the final bill straight from the folio. */
export function checkoutMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; stayUrl: string | null; thanksUrl?: string | null; payUrl?: string | null }) {
  const due = v.money.balance > 0 && !v.money.company;
  return compose([
    hello(v.name),
    `Thank you for staying with ${v.hotel.name}. You are checked out.`,
    section("YOUR STAY", stayLines(v.stay)),
    section("FINAL BILL", moneyLines(v.money)),
    `*PAYMENT STATUS*\n${due ? `OUTSTANDING · ${tzs(v.money.balance)}` : v.money.company ? "BILLED TO COMPANY" : "PAID IN FULL"}`,
    due && v.payUrl ? link("Pay the balance (mobile money):", v.payUrl) : null,
    link("Your stay summary and bill:", v.stayUrl),
    link("A thank-you note from us:", v.thanksUrl),
    link("Follow us on Instagram:", v.hotel.instagram),
    link("Follow us on TikTok:", v.hotel.tiktok),
    `We look forward to welcoming you again at ${v.hotel.name}.`,
  ]);
}

export function balanceMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; payUrl: string | null; billUrl: string | null }) {
  return compose([
    hello(v.name),
    `This is your bill at ${v.hotel.name}.`,
    section("YOUR STAY", [`Booking Ref: ${v.stay.ref}`, v.stay.rooms ? `Room: ${v.stay.rooms}` : `Room Type: ${v.stay.roomType}`, `Check-out: ${v.stay.checkOut}`]),
    section("BALANCE", [...moneyLines(v.money, { showLines: true }).slice(0, -1), `Outstanding: ${tzs(Math.max(0, v.money.balance))}`]),
    `Payment Status: ${v.money.balance > 0 ? "OUTSTANDING" : "PAID"}`,
    v.money.balance > 0 ? link("Pay now (mobile money):", v.payUrl) : null,
    link("View your bill:", v.billUrl),
    contact(v.hotel, "For assistance, call or WhatsApp Reception:"),
  ]);
}

export function cancelledMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; bookingUrl: string | null }) {
  return compose([
    hello(v.name),
    `Your ${v.hotel.name} booking has been cancelled.`,
    section("BOOKING", stayLines(v.stay)),
    "*BOOKING STATUS*\nCANCELLED",
    section("PAYMENT", [`Paid: ${tzs(v.money.paid)}`, v.money.refunded ? `Refunded: ${tzs(v.money.refunded)}` : null, v.money.balance > 0 ? `Outstanding: ${tzs(v.money.balance)}` : null]),
    link("View the booking:", v.bookingUrl),
    contact(v.hotel, "Questions? Call or WhatsApp Reception:"),
  ]);
}

/** Arrival day. */
export function arrivalReminderMessage(v: { hotel: Hotel; name: string; stay: StayFacts; money: Money; bookingUrl: string | null; payUrl?: string | null }) {
  return compose([
    hello(v.name),
    `We look forward to welcoming you to ${v.hotel.name} today.`,
    section("YOUR BOOKING", stayLines(v.stay)),
    v.money.balance > 0 && !v.money.company ? `*PAYMENT*\nTo pay: ${tzs(v.money.balance)}` : null,
    v.money.balance > 0 && !v.money.company && v.payUrl ? link("Pay now (mobile money) and skip the wait:", v.payUrl) : null,
    link("Your booking:", v.bookingUrl),
    contact(v.hotel, "Running late or need directions? Call or WhatsApp Reception:"),
  ]);
}

/** The meeting room, on the day. */
export function meetingReminderMessage(v: {
  hotel: Hotel; name: string; room: string; ref: string; date: string; time: string; attendees?: number | null; money: Money; bookingUrl: string | null;
}) {
  return compose([
    hello(v.name),
    `A reminder of your meeting room booking at ${v.hotel.name} today.`,
    section("YOUR BOOKING", [`Booking Ref: ${v.ref}`, `Room: ${v.room}`, `Date: ${v.date}`, `Time: ${v.time}`, v.attendees ? `Attendees: ${v.attendees}` : null]),
    v.money.balance > 0 && !v.money.company ? `*PAYMENT*\nTo pay: ${tzs(v.money.balance)}` : null,
    link("Your booking:", v.bookingUrl),
    contact(v.hotel, "Need anything set up? Call or WhatsApp Reception:"),
  ]);
}

/** The meeting room. */
export function meetingMessage(v: {
  hotel: Hotel; name: string; kind: BookingKind; room: string; ref: string; date: string; time: string;
  attendees?: number | null; company?: string | null; money: Money; bookingUrl: string | null; payUrl?: string | null;
}) {
  const lead = v.kind === "CONFIRMED" ? `Your meeting room booking at ${v.hotel.name} is confirmed.`
    : v.kind === "RESERVED" ? `Your meeting room booking at ${v.hotel.name} is reserved.`
    : v.kind === "PAY_LATER" ? `Your meeting room booking at ${v.hotel.name} has been received. It is not reserved until it is paid.`
    : `Your meeting room request has been received by ${v.hotel.name}.`;
  return compose([
    hello(v.name),
    lead,
    section("MEETING ROOM", [`Room: ${v.room}`, `Booking Ref: ${v.ref}`, `Date: ${v.date}`, `Time: ${v.time}`, v.attendees ? `Attendees: ${v.attendees}` : null, v.company ? `Company: ${v.company}` : null]),
    section("PAYMENT", [`Price: ${tzs(v.money.total)}`, `Paid: ${tzs(v.money.paid)}`, `Balance: ${tzs(Math.max(0, v.money.balance))}`, `Status: ${payStatus(v.money)}`]),
    v.money.balance > 0 && v.payUrl ? link("Pay now (mobile money):", v.payUrl) : null,
    link("View the booking:", v.bookingUrl),
    contact(v.hotel, "For assistance, call or WhatsApp Reception:"),
  ]);
}

// ───────────────────────── restaurant & room service ─────────────────────────

export type OrderFacts = {
  number: string; place: string; type: string; date: string;
  items: { name: string; qty: number; total: number }[];
  fee?: number; total: number;
  /** "PAID", "CHARGED TO ROOM", "PAY AFTER", "WAITING FOR PAYMENT"… */
  payment: string;
};

/** The whole order, as received. */
export function orderReceivedMessage(v: { hotel: Hotel; name: string | null; order: OrderFacts; trackUrl: string | null }) {
  const o = v.order;
  return compose([
    hello(v.name),
    `Your order has been received by ${v.hotel.name}.`,
    section("ORDER DETAILS", [`Order No: ${o.number}`, `Place: ${o.place}`, `Order Type: ${o.type}`, `Date: ${o.date}`]),
    section("YOUR ORDER", [...o.items.map((i) => `${i.name} × ${i.qty} — ${tzs(i.total)}`), o.fee ? `Room Service Fee — ${tzs(o.fee)}` : null]),
    `*TOTAL*\n${tzs(o.total)}`,
    `*PAYMENT*\nStatus: ${o.payment}`,
    link("Track your order:", v.trackUrl),
    contact(v.hotel, "Need assistance? Call or WhatsApp us:"),
  ]);
}

/**
 * A step of the order (being prepared, ready, served, delivered, cancelled) — the same full layout as "received"
 * (owner, 2026-10-06: every message in the one structure): what happened, the order, its lines, total, payment,
 * the tracking link and how to reach the hotel.
 */
export function orderStatusMessage(v: {
  hotel: Hotel; name: string | null; number: string; place: string; status: string; line: string; trackUrl: string | null; again?: string | null;
  order?: OrderFacts | null;
}) {
  const o = v.order;
  return compose([
    hello(v.name),
    v.line,
    section("ORDER DETAILS", o
      ? [`Order No: ${o.number}`, `Place: ${o.place}`, `Order Type: ${o.type}`, `Status: ${v.status}`, `Date: ${o.date}`]
      : [`Order No: ${v.number}`, `Place: ${v.place}`, `Status: ${v.status}`]),
    o ? section("YOUR ORDER", [...o.items.map((i) => `${i.name} × ${i.qty} — ${tzs(i.total)}`), o.fee ? `Room Service Fee — ${tzs(o.fee)}` : null]) : null,
    o ? `*TOTAL*\n${tzs(o.total)}` : null,
    o ? `*PAYMENT*\nStatus: ${o.payment}` : null,
    link("Track your order:", v.trackUrl),
    link("Order again any time:", v.again),
    contact(v.hotel, "Need assistance? Call or WhatsApp us:"),
  ]);
}

/** A group's charges so far (not the final invoice yet). */
export function groupStatementMessage(v: { hotel: Hotel; greet: string; group: string; number: string; rooms: number; money: Money }) {
  return compose([
    `Dear ${v.greet},`,
    `Here is the statement of ${v.group}'s charges so far at ${v.hotel.name}.`,
    section("STATEMENT", [`Statement No: ${v.number}`, `Group: ${v.group}`, `Rooms: ${v.rooms}`]),
    section("AMOUNT", [`Total so far: ${tzs(v.money.total)}`, `Paid: ${tzs(v.money.paid)}`, `Balance: ${tzs(Math.max(0, v.money.balance))}`, `Status: ${payStatus(v.money)}`]),
    "This is not the final invoice — it follows when every room has checked out.",
    contact(v.hotel, "Questions? Call or WhatsApp us:"),
  ]);
}

/** A booking request from the website, before it is a booking: what the guest asked for and where it stands. */
export function bookingRequestMessage(v: {
  hotel: Hotel; name: string; ref: string; roomType: string; rooms?: number;
  checkIn: string; checkOut?: string | null; nights?: number | null; time?: string | null; guests: string;
  estimate?: number | null; status: string;
}) {
  return compose([
    hello(v.name),
    `Thank you for your booking request at ${v.hotel.name}. Reception here, about your request.`,
    section("YOUR REQUEST", [
      `Request Ref: ${v.ref}`, `Room Type: ${v.roomType}`, v.rooms && v.rooms > 1 ? `Rooms: ${v.rooms}` : null,
      v.time ? `Date: ${v.checkIn}` : `Check-in: ${v.checkIn}`, v.time ? `Time: ${v.time}` : v.checkOut ? `Check-out: ${v.checkOut}` : null,
      !v.time && v.nights ? `Nights: ${v.nights}` : null, `Guests: ${v.guests}`,
    ]),
    v.estimate ? section("PRICE", [`Estimated total: ${tzs(v.estimate)}`, "The final price is confirmed with your booking."]) : null,
    `*STATUS*\n${v.status}`,
    contact(v.hotel, "Reply here, or call or WhatsApp Reception:"),
    `We look forward to welcoming you to ${v.hotel.name}.`,
  ]);
}

/** The order was paid by mobile money (confirmed by the payment service). */
export function orderPaidMessage(v: { hotel: Hotel; name: string | null; order: OrderFacts; amount: number; reference: string | null; trackUrl: string | null }) {
  return compose([
    hello(v.name),
    `Your payment has been received by ${v.hotel.name}. Thank you!`,
    section("ORDER", [`Order No: ${v.order.number}`, `Place: ${v.order.place}`, `Items: ${v.order.items.reduce((t, i) => t + i.qty, 0)}`, `Total: ${tzs(v.order.total)}`]),
    section("PAYMENT", ["Method: Mobile money", `Amount Paid: ${tzs(v.amount)}`, "Status: PAID", v.reference ? `Reference: ${v.reference}` : null]),
    link("View your order:", v.trackUrl),
    `Thank you for ordering from ${v.hotel.name}.`,
  ]);
}

// ───────────────────────── transport ─────────────────────────

export function transportMessage(v: {
  hotel: Hotel; name: string; ref: string; service: string; route: string; when: string;
  flight?: string | null; passengers?: number | null; bags?: number | null;
  price: number | null; payment: string; tripUrl: string | null; payUrl?: string | null; confirmed: boolean;
}) {
  return compose([
    hello(v.name),
    v.confirmed ? `Your ${v.service.toLowerCase()} with ${v.hotel.name} is confirmed.` : `Your ${v.service.toLowerCase()} request has been received by ${v.hotel.name}.`,
    section("TRANSPORT", [`Reference: ${v.ref}`, `Guest: ${v.name}`, `Route: ${v.route}`, v.flight ? `Flight: ${v.flight}` : null, `When: ${v.when}`, v.passengers ? `Passengers: ${v.passengers}` : null, v.bags ? `Bags: ${v.bags}` : null]),
    section("TRANSFER", [`Service: ${v.service}`, v.price != null ? `Price: ${tzs(v.price)}` : "Price: we confirm it with you", `Payment Status: ${v.payment}`]),
    v.payUrl ? link("Pay now (mobile money):", v.payUrl) : null,
    link("View your trip:", v.tripUrl),
    "Our team will coordinate your transfer with you.",
    contact(v.hotel, "For assistance, call or WhatsApp Reception:"),
  ]);
}

// ───────────────────────── invoices ─────────────────────────

export function invoiceMessageText(v: {
  hotel: Hotel; greet: string; number: string; final?: boolean; forWhat?: string | null; issued?: string | null; due?: string | null;
  money: Money; url: string | null;
}) {
  return compose([
    `Dear ${v.greet},`,
    `${v.final ? "Your final invoice" : "Your invoice"} from ${v.hotel.name}${v.forWhat ? ` for ${v.forWhat}` : ""}.`,
    section("INVOICE", [`Invoice No: ${v.number}`, v.issued ? `Issued: ${v.issued}` : null, v.due && v.money.balance > 0 ? `Due by: ${v.due}` : null]),
    section("AMOUNT", [`Total: ${tzs(v.money.total)}`, `Paid: ${tzs(v.money.paid)}`, `Balance: ${tzs(Math.max(0, v.money.balance))}`, `Status: ${payStatus(v.money)}`]),
    v.money.balance > 0 ? `Please use ${v.number} as the payment reference.` : null,
    link(v.money.balance > 0 ? "View the invoice and pay by mobile money:" : "View the invoice:", v.url),
    contact(v.hotel, "Questions? Call or WhatsApp us:"),
  ]);
}
