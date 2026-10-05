import "server-only";
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { db, type Tx } from "../db";
import { AppError } from "../errors";
import { getSettings } from "../settings";
import { siteOrigin } from "../site-origin";
import { fromDbDate, formatMinutes } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import {
  DEFAULT_BOOKING_MESSAGE, DEFAULT_WELCOME_MESSAGE, guestEventOn, guestMessageText, internationalPhone, maskEmail, maskPhone, prettyPhone, shortName,
  type GuestMessageType,
} from "@/lib/guest-messages";
import { createRestaurantOrderTx } from "./restaurant";
import { paidFirstTx, type PaidFirst } from "./online-orders";
import { createGuestRequest } from "./requests";
import { guestNotifyConnected, sendGuestText } from "./guest-notify";
import { bookedAsOf } from "./public-booking";

type Actor = { userId?: string | null; label?: string; ipAddress?: string | null };

/**
 * GuestCommunicationService — the guest's private stay link and the messages
 * reception sends them (booking details, welcome at check-in). Messages go out
 * from reception's own WhatsApp / SMS / email in one tap until an automatic
 * provider is connected; every send is logged on the guest's profile.
 */

/** A long random link token — never the database id, cannot be guessed. */
export const newGuestToken = () => randomBytes(18).toString("base64url");

/** The reservation's stay-link token (made the first time it is needed). */
export async function ensureGuestToken(tx: Tx | typeof db, reservationId: string) {
  const r = await tx.reservation.findUnique({ where: { id: reservationId }, select: { guestToken: true } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  if (r.guestToken) return r.guestToken;
  const token = newGuestToken();
  await tx.reservation.update({ where: { id: reservationId }, data: { guestToken: token } });
  return token;
}

const validToken = (t: string) => /^[A-Za-z0-9_-]{16,64}$/.test(t);

const STATUS_WORD: Record<string, string> = {
  INQUIRY: "Enquiry", RESERVED: "Reserved", CONFIRMED: "Confirmed", CHECKED_IN: "Checked In", CHECKED_OUT: "Checked Out", CANCELLED: "Cancelled", NO_SHOW: "No-show",
};
/** "2026-09-27" → "27 Sept 2026". */
/** "2026-09-28" → "Mon, 28 Sept 2026". */
const weekdayDate = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const dayMonthYear = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** The ready-to-send booking / welcome message for a reservation. */
export async function guestMessage(reservationId: string, type: "BOOKING_CREATED" | "WELCOME", origin: string) {
  const settings = await getSettings();
  const token = await ensureGuestToken(db, reservationId);
  const r = await db.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: {
      guest: { select: { id: true, fullName: true, phone: true, email: true, preferredChannel: true } },
      rooms: { where: { status: { not: "CANCELLED" } }, include: { room: { select: { number: true } }, roomType: { select: { name: true } } }, orderBy: { arrivalDate: "asc" } },
    },
  });
  const inHouse = r.rooms.filter((x) => x.status === "CHECKED_IN");
  const rooms = type === "WELCOME" && inHouse.length ? inHouse : r.rooms;
  // Booking details: "305 — Double Deluxe"; welcome: "305" (they are standing in it).
  const room = rooms.map((x) => (type === "WELCOME" ? x.room.number : `${x.room.number} — ${x.roomType.name}`)).join(", ") || "—";
  const nights = r.rooms.reduce((m, x) => Math.max(m, x.isDayUse ? 0 : x.nights), 0);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const balance = r.balanceAmount > 0 && r.billTo === "GUEST" ? `Amount Due: ${formatTZS(r.balanceAmount)}` : r.paidAmount > 0 && r.balanceAmount <= 0 ? "Paid in full — thank you" : "";
  const text = guestMessageText(
    type === "WELCOME" ? settings.welcomeMessageTemplate : settings.bookingMessageTemplate,
    type === "WELCOME" ? DEFAULT_WELCOME_MESSAGE : DEFAULT_BOOKING_MESSAGE,
    {
      name: r.guest.fullName, hotel: settings.hotelName, ref: r.reference, room,
      checkin: `${dayMonthYear(fromDbDate(r.arrivalDate))} · ${formatMinutes(settings.standardCheckInMinutes)}`,
      checkout: type === "WELCOME"
        ? `${weekdayDate(fromDbDate(r.departureDate))} · by ${formatMinutes(settings.checkoutMinutes)}`
        : `${dayMonthYear(fromDbDate(r.departureDate))} · ${formatMinutes(settings.checkoutMinutes)}`,
      nights, length: nights ? plural(nights, "Night", "Nights") : "Day use",
      guests: `${plural(r.adults, "Adult", "Adults")}${r.children ? `, ${plural(r.children, "Child", "Children")}` : ""}`,
      status: STATUS_WORD[r.status] ?? r.status, balance,
      link: `${origin}/stay/${token}`, menu: `${origin}/stay/${token}#menu`,
      phone: prettyPhone(settings.whatsapp || settings.phone), wifi: settings.wifiNetwork ? `Wi-Fi: ${settings.wifiNetwork}${settings.wifiPassword ? ` · Password: ${settings.wifiPassword}` : ""}` : "",
    },
  );
  return {
    text, link: `${origin}/stay/${token}`,
    guest: { id: r.guest.id, name: r.guest.fullName, phone: internationalPhone(r.guest.phone), email: r.guest.email, preferredChannel: r.guest.preferredChannel },
    subject: type === "WELCOME" ? `Welcome to ${settings.hotelName}` : `Your booking ${r.reference} — ${settings.hotelName}`,
  };
}

/** Log a message sent to a guest (from the staff screen or a provider). */
export async function logGuestMessage(tx: Tx | typeof db, m: {
  guestId: string; reservationId?: string | null; type: GuestMessageType; channel: string; to?: string | null; body: string;
  status?: "SENT" | "FAILED"; error?: string | null;
}, actor: Actor) {
  return tx.guestMessage.create({
    data: {
      guestId: m.guestId, reservationId: m.reservationId ?? null, type: m.type, channel: m.channel, to: m.to ?? null,
      body: m.body.slice(0, 4000), status: m.status ?? "SENT", error: m.error ?? null, sentById: actor.userId ?? null,
    },
  });
}

/**
 * The booking details, sent to the guest by themselves — a Hotel QR booking reserved to pay at the hotel, or a booking
 * the guest paid online once nTZS confirmed it. Only when a messaging provider is connected and the hotel has "Booking
 * saved" messages on; once per booking and event; logged on the guest's profile. Never throws: the booking stands either
 * way (without a provider, reception sends the same details in one tap from the booking).
 */
export async function notifyBookingGuest(reservationId: string, event: "BOOKING_CREATED" | "BOOKING_CONFIRMED") {
  try {
    if (!guestNotifyConnected()) return false;
    const s = await getSettings();
    if (!guestEventOn(s.guestNotifications, "bookingCreated")) return false;
    if (await db.guestMessage.count({ where: { reservationId, type: event, status: "SENT" } })) return false;
    let origin = "";
    try { origin = await siteOrigin(); } catch { origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? ""; }
    // One text for both: its status and balance lines read "Confirmed" and "Paid in full" once paid.
    const m = await guestMessage(reservationId, "BOOKING_CREATED", origin);
    if (!m.guest.phone) return false;
    const sent = await sendGuestText({ to: m.guest.phone, text: m.text, event });
    await logGuestMessage(db, {
      guestId: m.guest.id, reservationId, type: event, channel: sent.channel, to: m.guest.phone, body: m.text, status: sent.ok ? "SENT" : "FAILED", error: sent.error ?? null,
    }, { label: "Automatic" });
    return sent.ok;
  } catch (e) {
    console.error("booking notification", reservationId, e);
    return false;
  }
}

/**
 * The same, once the answer has gone out — the guest's "Book" and nTZS's webhook never wait for the messaging
 * provider. Where there is no request to wait for (a job, a test) it is sent straight away.
 */
export async function notifyBookingGuestSoon(reservationId: string, event: "BOOKING_CREATED" | "BOOKING_CONFIRMED") {
  try {
    after(() => notifyBookingGuest(reservationId, event));
  } catch {
    await notifyBookingGuest(reservationId, event);
  }
}

// ───────────────────────── The guest's stay page ─────────────────────────

/**
 * What the guest sees — their own stay only, never internal ids: the booking, their details
 * (phone and email partly hidden), the bill, their orders. Used by the guest's private link
 * and by the room QR (which shows whoever is checked in to that room now).
 */
export async function stayView(where: { guestToken: string } | { id: string }) {
  if ("guestToken" in where && !validToken(where.guestToken)) return null;
  const r = await db.reservation.findUnique({
    where,
    select: {
      id: true, reference: true, status: true, kind: true, arrivalDate: true, departureDate: true, adults: true, children: true,
      grossAmount: true, discountAmount: true, netAmount: true, paidAmount: true, balanceAmount: true, billTo: true, companyName: true, externalData: true,
      guest: { select: { fullName: true, phone: true, email: true } },
      corporateCustomer: { select: { companyName: true } },
      group: { select: { name: true, corporateCustomer: { select: { companyName: true } } } },
      rooms: {
        where: { status: { not: "CANCELLED" } }, orderBy: { arrivalDate: "asc" },
        select: {
          status: true, nights: true, isDayUse: true, startAt: true, endAt: true, room: { select: { number: true } },
          roomType: { select: { name: true, images: true, shortDescription: true, bedType: true, sizeSqm: true, amenities: { select: { amenity: { select: { name: true } } }, orderBy: { amenity: { sortOrder: "asc" } } } } },
        },
      },
      charges: { where: { isVoided: false }, select: { kind: true, amount: true } },
      // What they asked for lately (towels, cleaning…) and where it is.
      requests: {
        where: { type: { not: "COMPLAINT" }, createdAt: { gte: new Date(Date.now() - 48 * 3600_000) } }, orderBy: { createdAt: "desc" }, take: 6,
        select: { id: true, type: true, status: true, createdAt: true },
      },
      restaurantOrders: {
        where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 12,
        select: { number: true, status: true, total: true, createdAt: true, trackToken: true, items: { select: { name: true, quantity: true } } },
      },
    },
  });
  if (!r) return null;
  const sum = (kinds: string[]) => r.charges.filter((c) => kinds.includes(c.kind)).reduce((t, c) => t + c.amount, 0);
  const known = ["RESTAURANT", "BAR", "ROOM_SERVICE", "TRANSPORT"];
  const lines = [
    { label: r.kind === "MEETING" ? "Meeting room" : "Room", amount: r.grossAmount },
    { label: "Restaurant", amount: sum(["RESTAURANT"]) },
    { label: "Bar", amount: sum(["BAR"]) },
    { label: "Room service", amount: sum(["ROOM_SERVICE"]) },
    { label: "Transport", amount: sum(["TRANSPORT"]) },
    { label: "Other", amount: r.charges.filter((c) => !known.includes(c.kind)).reduce((t, c) => t + c.amount, 0) },
    { label: "Discount", amount: -r.discountAmount },
  ].filter((l) => l.amount !== 0);
  const payer = r.billTo === "GROUP" ? r.group?.corporateCustomer?.companyName ?? r.group?.name ?? null : r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? null : null;
  const meeting = r.kind === "MEETING" && r.rooms[0] ? { start: r.rooms[0].startAt.toISOString(), end: r.rooms[0].endAt.toISOString() } : null;
  // Booked on a public page and not here yet: who it was booked as — never the profile found by the phone typed there
  // (anyone can type a number). Once checked in, reception has met the guest.
  const typed = r.status === "RESERVED" || r.status === "CONFIRMED" ? bookedAsOf(r.externalData) : null;
  const who = typed ?? { fullName: r.guest.fullName, phone: r.guest.phone, email: r.guest.email };
  return {
    // Never the private stay link's token: the room QR shows this page to whoever scans the card.
    reference: r.reference, status: r.status, kind: r.kind,
    guestName: shortName(who.fullName), phone: maskPhone(who.phone), email: maskEmail(who.email), company: r.companyName,
    arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate), adults: r.adults, children: r.children, meeting,
    rooms: r.rooms.map((x) => ({ number: x.room.number, type: x.roomType.name, nights: x.isDayUse ? 0 : x.nights, inHouse: x.status === "CHECKED_IN" })),
    // Their room type, for the welcome: its photos, a line about it and what it has.
    roomInfo: (() => {
      const t = (r.rooms.find((x) => x.status === "CHECKED_IN") ?? r.rooms[0])?.roomType;
      if (!t) return null;
      const photos = Array.isArray(t.images) ? (t.images as unknown[]).filter((x): x is string => typeof x === "string" && x.startsWith("/")).slice(0, 8) : [];
      return { photos, description: t.shortDescription, bed: t.bedType, size: t.sizeSqm, amenities: t.amenities.map((a) => a.amenity.name).slice(0, 8) };
    })(),
    // The whole bill for the guest; a company / group bill shows who pays, not the company's money.
    money: payer ? null : { lines, total: r.netAmount, paid: r.paidAmount, balance: Math.max(0, r.balanceAmount) },
    payer,
    canOrder: r.status === "CHECKED_IN",
    requests: r.requests.map((q) => ({ id: q.id, type: q.type, status: q.status, at: q.createdAt.toISOString() })),
    orders: r.restaurantOrders.map((o) => ({ number: o.number, status: o.status, total: o.total, at: o.createdAt.toISOString(), track: o.trackToken, items: o.items.map((i) => `${i.quantity} × ${i.name}`) })),
  };
}
export type GuestStay = NonNullable<Awaited<ReturnType<typeof stayView>>>;

/** The guest's private link. */
export const stayByToken = (token: string) => stayView({ guestToken: token });

const ORDER_LIMIT = 5; // orders per stay per 30 minutes from the guest's phone
export type StayOrderInput = {
  items: { menuItemId: string; quantity: number }[]; notes?: string | null; clientKey?: string | null;
  /** "Pay now" instead of the room bill: the guest's payment screenshot and the account — staff check it and record it. */
  paidFirst?: PaidFirst | null;
  /** "Pay online" (nTZS) instead of the room bill: the payment request follows once the order is in (see online-pay). */
  payOnline?: boolean;
};

/**
 * An order for a stay that is checked in now — from the guest's link or the room QR.
 * Room service (or, for a meeting in use, served to the meeting room), on the stay's bill.
 */
export async function placeOrderForStay(reservationId: string, input: StayOrderInput, source: "GUEST_LINK" | "ROOM_QR", now = new Date(), opts: { roomId?: string } = {}) {
  if (input.clientKey) {
    const same = await db.restaurantOrder.findUnique({ where: { clientKey: input.clientKey } });
    if (same) return same; // the same tap sent twice
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
    const r = await tx.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, status: true, kind: true, reference: true, guestId: true, guest: { select: { fullName: true, phone: true } }, rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } },
    });
    if (!r) throw new AppError("This stay was not found.", "NOT_FOUND");
    if (r.status !== "CHECKED_IN") throw new AppError("Ordering to the room opens when the guest has checked in. Please call reception.", "VALIDATION");
    // A room QR: that very room — still checked in to this stay now (a room move between scan and send is refused).
    const scanned = opts.roomId ? await tx.reservationRoom.findFirst({ where: { reservationId: r.id, roomId: opts.roomId, status: "CHECKED_IN" }, select: { room: { select: { number: true } } } }) : null;
    if (opts.roomId && !scanned) throw new AppError("No one is checked in to this room right now — please contact reception to order.", "VALIDATION");
    const recent = await tx.restaurantOrder.count({ where: { reservationId: r.id, source: { in: ["GUEST_LINK", "ROOM_QR"] }, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } } });
    if (recent >= ORDER_LIMIT) throw new AppError("Several orders were sent just now — please call reception for more.", "VALIDATION");
    if (input.items.length > 30) throw new AppError("Too many items in one order.", "VALIDATION");
    const paidFirst = input.paidFirst && !input.payOnline ? await paidFirstTx(tx, input.paidFirst, now) : null;
    const meeting = r.kind === "MEETING";
    const room = r.rooms.map((x) => x.room.number).join(", ");
    return createRestaurantOrderTx(tx, {
      // A meeting in use is served in the meeting room (no room-service fee); a guest room gets room service.
      type: meeting ? "DINE_IN" : "ROOM_SERVICE", tableLabel: meeting ? `Meeting room ${room}` : null,
      // On the room bill, or paid now (online, or with the guest's proof — then it is not on the room bill).
      settlement: paidFirst || input.payOnline ? "UNPAID" : "ROOM", reservationId: r.id, items: input.items,
      notes: input.notes?.trim().slice(0, 300) || null, customerName: r.guest.fullName,
    }, { userId: null, label: `Guest (${source === "ROOM_QR" ? "room QR" : "online"}) · ${r.reference}` }, now, {
      byCustomer: true, source, guestId: r.guestId, customerPhone: r.guest.phone, clientKey: input.clientKey ?? null, paidFirst, payOnline: !!input.payOnline, servedRoom: scanned?.room.number ?? null,
    });
  });
}

/** The guest orders from their own link. */
export async function placeStayOrder(token: string, input: StayOrderInput, now = new Date()) {
  if (!validToken(token)) throw new AppError("This link is not valid.", "NOT_FOUND");
  const r = await db.reservation.findUnique({ where: { guestToken: token }, select: { id: true } });
  if (!r) throw new AppError("This link is not valid.", "NOT_FOUND");
  return placeOrderForStay(r.id, input, "GUEST_LINK", now);
}

/** The guest asks for something (towels, cleaning…) from their own link. */
export async function askFromStay(token: string, input: Parameters<typeof createGuestRequest>[1], now = new Date()) {
  if (!validToken(token)) throw new AppError("This link is not valid.", "NOT_FOUND");
  const r = await db.reservation.findUnique({ where: { guestToken: token }, select: { id: true } });
  if (!r) throw new AppError("This link is not valid.", "NOT_FOUND");
  return createGuestRequest(r.id, input, "GUEST_LINK", now);
}

// ───────────────────────── Guest profile ─────────────────────────

/**
 * Everything that happened with a guest, newest first: bookings, stays, messages, changes, their
 * orders — and who put an order of theirs on a room, took it off, or changed who pays (with why).
 */
export async function guestTimeline(guestId: string) {
  const [reservations, messages, changes, orders, billed] = await Promise.all([
    db.reservation.findMany({
      where: { guestId }, orderBy: { createdAt: "desc" }, take: 60,
      select: {
        id: true, reference: true, createdAt: true, status: true,
        source: { select: { name: true } },
        rooms: { select: { checkedInAt: true, checkedOutAt: true, room: { select: { number: true } } } },
      },
    }),
    db.guestMessage.findMany({ where: { guestId }, orderBy: { createdAt: "desc" }, take: 60, include: { sentBy: { select: { fullName: true } }, reservation: { select: { reference: true } } } }),
    db.auditLog.findMany({ where: { entityType: "Guest", entityId: guestId }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { fullName: true } } } }),
    db.restaurantOrder.findMany({
      // Every order of theirs: on their own (restaurant, table, website) or on their room.
      where: { OR: [{ guestId }, { reservation: { guestId } }], status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 40,
      select: { id: true, number: true, type: true, source: true, tableLabel: true, location: { select: { name: true } }, total: true, roomNumber: true, createdAt: true, reservationId: true, items: { select: { name: true, quantity: true } } },
    }),
    // Who put their orders on a room, took them off, or changed who pays — from the history log.
    (async () => {
      const [os, ss] = await Promise.all([
        db.restaurantOrder.findMany({ where: { OR: [{ guestId }, { reservation: { guestId } }] }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, number: true } }),
        db.diningSession.findMany({ where: { OR: [{ guestId }, { members: { some: { guestId } } }] }, orderBy: { startedAt: "desc" }, take: 50, select: { id: true } }),
      ]);
      const logs = os.length + ss.length === 0 ? [] : await db.auditLog.findMany({
        where: {
          OR: [
            { entityType: "RestaurantOrder", entityId: { in: os.map((o) => o.id) }, action: { in: ["restaurant_order.charged_to_room", "restaurant_order.room_paid_now", "restaurant_order.billing_changed"] } },
            { entityType: "DiningSession", entityId: { in: ss.map((x) => x.id) }, action: "dining_session.charged_to_room" },
          ],
        },
        orderBy: { createdAt: "desc" }, take: 40, include: { user: { select: { fullName: true } } },
      });
      return { numbers: new Map(os.map((o) => [o.id, o.number])), logs };
    })(),
  ]);
  type Event = { at: Date; kind: "booking" | "checkin" | "checkout" | "cancel" | "message" | "change" | "order" | "billing"; title: string; detail?: string; href?: string };
  const events: Event[] = [];
  for (const r of reservations) {
    events.push({ at: r.createdAt, kind: "booking", title: `Booking ${r.reference}`, detail: r.source?.name, href: `/staff/reservations/${r.id}` });
    const inAt = r.rooms.map((x) => x.checkedInAt).filter((d): d is Date => !!d).sort((a, b) => +a - +b)[0];
    const outAt = r.rooms.map((x) => x.checkedOutAt).filter((d): d is Date => !!d).sort((a, b) => +b - +a)[0];
    const rooms = r.rooms.map((x) => x.room.number).join(", ");
    if (inAt) events.push({ at: inAt, kind: "checkin", title: `Checked in${rooms ? ` · Room ${rooms}` : ""}`, detail: r.reference, href: `/staff/reservations/${r.id}` });
    if (outAt && r.status === "CHECKED_OUT") events.push({ at: outAt, kind: "checkout", title: "Checked out", detail: r.reference, href: `/staff/reservations/${r.id}` });
    if (r.status === "CANCELLED" || r.status === "NO_SHOW") events.push({ at: r.createdAt, kind: "cancel", title: r.status === "NO_SHOW" ? "Did not arrive" : "Booking cancelled", detail: r.reference });
  }
  for (const m of messages) events.push({ at: m.createdAt, kind: "message", title: `${m.type === "CUSTOM" ? "Message" : m.type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} · ${m.channel.toLowerCase()}`, detail: [m.reservation?.reference, m.sentBy?.fullName].filter(Boolean).join(" · ") });
  for (const o of orders) {
    events.push({
      at: o.createdAt, kind: "order", title: `${o.type === "ROOM_SERVICE" ? "Room service order" : ["GUEST", "GUEST_LINK", "ROOM_QR", "PUBLIC_QR", "TABLE_QR", "QR", "WEBSITE"].includes(o.source) ? "Ordered from their phone" : "Restaurant / bar order"} · ${formatTZS(o.total)}`,
      detail: [o.items.map((i) => `${i.quantity} × ${i.name}`).join(", "), o.location?.name ?? o.tableLabel ?? (o.roomNumber ? `Room ${o.roomNumber}` : null), o.number].filter(Boolean).join(" · "),
      href: `/staff/restaurant/orders/${o.id}`,
    });
  }
  for (const c of changes) events.push({ at: c.createdAt, kind: "change", title: c.action === "guest.created" ? "Customer saved" : "Details updated", detail: c.user?.fullName ?? c.actorLabel ?? undefined });

  // Where their bills went: "Order #184 put on Room 305 · TZS 45,000" — by whom, and why.
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const field = (j: unknown, k: string) => (j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>)[k] : undefined);
  const billName = (b: string | null) => (!b || b === "Restaurant" ? "the restaurant bill" : b);
  const near = (a: Date, b: Date) => Math.abs(+a - +b) < 10_000;
  const bill = billed.logs;
  for (const l of bill) {
    const after = l.after, before = l.before;
    const by = l.user?.fullName.replace(/\s*\(.*\)/, "") ?? l.actorLabel;
    const why = str(field(after, "reason"));
    const who = [by ? `by ${by}` : null, why ? `(${why})` : null].filter(Boolean).join(" ") || undefined;
    const number = billed.numbers.get(l.entityId ?? "");
    const order = number ? `Order #${number.replace(/^ORD-\d{4}-0*/, "")}` : "An order";
    const href = l.entityType === "RestaurantOrder" ? `/staff/restaurant/orders/${l.entityId}` : undefined;
    if (l.action === "dining_session.charged_to_room") {
      const n = Array.isArray(field(after, "orders")) ? (field(after, "orders") as unknown[]).length : 0;
      events.push({ at: l.createdAt, kind: "billing", title: `Table bill at ${str(field(after, "table")) ?? "a table"} put on Room ${str(field(after, "room")) ?? "—"} · ${formatTZS(num(field(after, "amount")))}`, detail: [n ? `${n} order${n === 1 ? "" : "s"}` : null, who].filter(Boolean).join(" · ") || undefined });
    } else if (l.action === "restaurant_order.charged_to_room") {
      // Part of a table's bill or a change of who pays: that entry already says it.
      if (bill.some((x) => x !== l && near(x.createdAt, l.createdAt) && ((x.action === "restaurant_order.billing_changed" && x.entityId === l.entityId) || (x.action === "dining_session.charged_to_room" && x.entityId === str(field(after, "session")))))) continue;
      const other = str(field(after, "roomOfAnotherGuest"));
      events.push({ at: l.createdAt, kind: "billing", title: `${order} put on ${str(field(after, "billing")) ?? "a room"} · ${formatTZS(num(field(after, "total")))}`, detail: [str(field(after, "table")), other ? `${other}'s room` : null, who].filter(Boolean).join(" · ") || undefined, href });
    } else if (l.action === "restaurant_order.room_paid_now") {
      events.push({ at: l.createdAt, kind: "billing", title: `${order} removed from ${str(field(before, "billing")) ?? "the room"} — paid now · ${formatTZS(num(field(after, "total")))}`, detail: who, href });
    } else {
      events.push({ at: l.createdAt, kind: "billing", title: `${order} moved from ${billName(str(field(before, "billing")))} to ${billName(str(field(after, "billing")))} · ${formatTZS(num(field(after, "amount")))}`, detail: who, href });
    }
  }
  return { events: events.sort((a, b) => +b.at - +a.at).slice(0, 80), messages };
}
