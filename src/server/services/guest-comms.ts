import "server-only";
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { db, type Tx } from "../db";
import { AppError } from "../errors";
import { getSettings } from "../settings";
import { siteOrigin } from "../site-origin";
import { fromDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { guestEventOn, maskEmail, maskPhone, shortName, type GuestMessageType } from "@/lib/guest-messages";
import { reservationMessage, roomChangeMessage } from "./guest-message-data";
import { createRestaurantOrderTx } from "./restaurant";
import { paidFirstTx, type PaidFirst } from "./online-orders";
import { createGuestRequest } from "./requests";
import { guestNotifyConnected, sendGuestText } from "./guest-notify";
import { bookedAsOf } from "./public-booking";
import { msg } from "@/i18n/msg";
import { spotName } from "@/components/restaurant/shell";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";
import { orderItemName } from "@/i18n/content";

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

/**
 * The ready-to-send booking details / welcome message for a reservation — the full, structured message (the stay, the
 * bill, the payment, the guest's link, reception) from src/server/services/guest-message-data.ts.
 */
export async function guestMessage(reservationId: string, type: "BOOKING_CREATED" | "WELCOME", origin: string) {
  const m = await reservationMessage(reservationId, type === "WELCOME" ? "WELCOME" : "BOOKING", origin);
  if (!m) throw new AppError("Reservation not found.", "NOT_FOUND");
  const g = await db.guest.findUniqueOrThrow({ where: { id: m.guest.id }, select: { email: true, preferredChannel: true } });
  return { text: m.text, link: m.link, subject: m.subject, guest: { ...m.guest, email: g.email, preferredChannel: g.preferredChannel } };
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
    // Booking saved: the full booking details. Paid by mobile money: "Payment received" — the amount and the payment
    // service's reference (sent only once the payment service confirmed it).
    const paid = event === "BOOKING_CONFIRMED"
      ? await db.mobilePayment.findFirst({ where: { reservationId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { amount: true, pspReference: true } })
      : null;
    const m = event === "BOOKING_CONFIRMED" && paid
      ? await reservationMessage(reservationId, "PAID", origin, { amount: paid.amount, reference: paid.pspReference })
      : await reservationMessage(reservationId, "BOOKING", origin);
    if (!m?.guest.phone) return false;
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
 * A stay's message sent by itself — the welcome at check-in, the departure summary at check-out, a cancellation, a room
 * change, a payment that did not go through — only when a messaging provider is connected and the hotel has that kind
 * of message on (Settings → messages to guests). One-off events go once (checked against the log); every send is
 * logged on the guest's profile, sent or failed. Never throws: the check-in, check-out or payment stands either way —
 * without a provider, reception sends the same message in one tap from the booking.
 */
export async function notifyReservationGuest(reservationId: string, kind: "WELCOME" | "CHECKOUT" | "CANCELLED" | "PAYMENT_FAILED" | "ROOM_CHANGED", extra: { from?: string | null; to?: string } = {}) {
  try {
    if (!guestNotifyConnected()) return false;
    const s = await getSettings();
    const event = kind === "WELCOME" ? "checkIn" : kind === "CHECKOUT" ? "checkOut" : "bookingCreated";
    if (!guestEventOn(s.guestNotifications, event)) return false;
    const type: GuestMessageType = kind === "WELCOME" ? "WELCOME" : kind === "CHECKOUT" ? "THANK_YOU" : kind === "CANCELLED" ? "BOOKING_CANCELLED" : kind === "ROOM_CHANGED" ? "ROOM_CHANGED" : "PAYMENT";
    if (kind !== "ROOM_CHANGED" && kind !== "PAYMENT_FAILED" && (await db.guestMessage.count({ where: { reservationId, type, status: "SENT" } }))) return false;
    // A payment that did not go through: one message, not one per try (the guest is usually still on the page).
    if (kind === "PAYMENT_FAILED" && (await db.guestMessage.count({ where: { reservationId, type, status: "SENT", createdAt: { gt: new Date(Date.now() - 30 * 60_000) } } }))) return false;
    let origin = "";
    try { origin = await siteOrigin(); } catch { origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? ""; }
    let m: { text: string; guest: { id: string; phone: string | null } } | null;
    if (kind === "ROOM_CHANGED") {
      m = extra.to ? await roomChangeMessage(reservationId, extra.from ?? null, extra.to, new Date().toISOString().slice(0, 10), origin) : null;
    } else if (kind === "CHECKOUT") {
      const note = await db.thankYouNote.findFirst({ where: { reservationId }, orderBy: { version: "desc" }, select: { token: true } });
      m = await reservationMessage(reservationId, "CHECKOUT", origin, { thanksUrl: note ? `${origin}/thanks/${note.token}` : null });
    } else {
      m = await reservationMessage(reservationId, kind, origin);
    }
    if (!m?.guest.phone) return false;
    const sent = await sendGuestText({ to: m.guest.phone, text: m.text, event: type });
    await logGuestMessage(db, {
      guestId: m.guest.id, reservationId, type, channel: sent.channel, to: m.guest.phone, body: m.text, status: sent.ok ? "SENT" : "FAILED", error: sent.error ?? null,
    }, { label: "Automatic" });
    return sent.ok;
  } catch (e) {
    console.error("guest notification", kind, reservationId, e);
    return false;
  }
}

/** The same once the answer has gone out (never delays the desk); straight away where there is no request (a job, a test). */
export function notifyReservationGuestSoon(reservationId: string, kind: Parameters<typeof notifyReservationGuest>[1], extra: Parameters<typeof notifyReservationGuest>[2] = {}) {
  if (!guestNotifyConnected()) return;
  try {
    after(() => notifyReservationGuest(reservationId, kind, extra));
  } catch {
    void notifyReservationGuest(reservationId, kind, extra);
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
        select: { number: true, status: true, total: true, createdAt: true, trackToken: true, items: { select: { name: true, nameI18n: true, quantity: true } } },
      },
    },
  });
  if (!r) return null;
  const sum = (kinds: string[]) => r.charges.filter((c) => kinds.includes(c.kind)).reduce((t, c) => t + c.amount, 0);
  const known = ["RESTAURANT", "BAR", "ROOM_SERVICE", "TRANSPORT"];
  const lines = [
    // Shown on the guest's page in their language (t(label) there).
    { label: r.kind === "MEETING" ? msg("Meeting room") : msg("Room"), amount: r.grossAmount },
    { label: msg("Restaurant"), amount: sum(["RESTAURANT"]) },
    { label: msg("Bar"), amount: sum(["BAR"]) },
    { label: msg("Room service"), amount: sum(["ROOM_SERVICE"]) },
    { label: msg("Transport"), amount: sum(["TRANSPORT"]) },
    { label: msg("Other"), amount: r.charges.filter((c) => !known.includes(c.kind)).reduce((t, c) => t + c.amount, 0) },
    { label: msg("Discount"), amount: -r.discountAmount },
  ].filter((l) => l.amount !== 0);
  const payer = r.billTo === "GROUP" ? r.group?.corporateCustomer?.companyName ?? r.group?.name ?? null : r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? null : null;
  const meeting = r.kind === "MEETING" && r.rooms[0] ? { start: r.rooms[0].startAt.toISOString(), end: r.rooms[0].endAt.toISOString() } : null;
  // Booked on a public page and not here yet: who it was booked as — never the profile found by the phone typed there
  // (anyone can type a number). Once checked in, reception has met the guest.
  const typed = r.status === "RESERVED" || r.status === "CONFIRMED" || r.status === "INQUIRY" ? bookedAsOf(r.externalData) : null;
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
    orders: r.restaurantOrders.map((o) => ({ number: o.number, status: o.status, total: o.total, at: o.createdAt.toISOString(), track: o.trackToken, items: o.items.map((i) => ({ name: i.name, nameI18n: i.nameI18n, quantity: i.quantity })) })),
  };
}
export type GuestStay = NonNullable<Awaited<ReturnType<typeof stayView>>>;

/** The guest's private link. */
export const stayByToken = (token: string) => stayView({ guestToken: token });

const ORDER_LIMIT = 5; // orders per stay per 30 minutes from the guest's phone
export type StayOrderInput = {
  items: { menuItemId: string; quantity: number }[]; notes?: string | null; clientKey?: string | null;
  /** Common requests the guest ticked (ORDER_REQUESTS codes). */
  noteCodes?: string[] | null;
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
      notes: input.notes?.trim().slice(0, 300) || null, noteCodes: input.noteCodes, customerName: r.guest.fullName,
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
      select: { id: true, number: true, type: true, source: true, tableLabel: true, location: { select: { name: true } }, total: true, roomNumber: true, createdAt: true, reservationId: true, items: { select: { name: true, nameI18n: true, quantity: true } } },
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
  // The words are for the staff member reading the profile (their language); the history itself stays as recorded.
  const t = await getT().catch(() => englishT);
  const events: Event[] = [];
  for (const r of reservations) {
    events.push({ at: r.createdAt, kind: "booking", title: t("Booking {ref}", { ref: r.reference }), detail: r.source ? t(r.source.name) : undefined, href: `/staff/reservations/${r.id}` });
    const inAt = r.rooms.map((x) => x.checkedInAt).filter((d): d is Date => !!d).sort((a, b) => +a - +b)[0];
    const outAt = r.rooms.map((x) => x.checkedOutAt).filter((d): d is Date => !!d).sort((a, b) => +b - +a)[0];
    const rooms = r.rooms.map((x) => x.room.number).join(", ");
    if (inAt) events.push({ at: inAt, kind: "checkin", title: rooms ? t("Checked in · Room {rooms}", { rooms }) : t("Checked in"), detail: r.reference, href: `/staff/reservations/${r.id}` });
    if (outAt && r.status === "CHECKED_OUT") events.push({ at: outAt, kind: "checkout", title: t("Checked out"), detail: r.reference, href: `/staff/reservations/${r.id}` });
    if (r.status === "CANCELLED" || r.status === "NO_SHOW") events.push({ at: r.createdAt, kind: "cancel", title: r.status === "NO_SHOW" ? t("Did not arrive") : t("Booking cancelled"), detail: r.reference });
  }
  for (const m of messages) {
    // "Booking created · whatsapp" — the kind of message and how it went (catalog keys "guest-message::…", "guest-channel::…").
    const kind = m.type === "CUSTOM" ? t("Message") : t.ctx("guest-message", m.type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));
    events.push({ at: m.createdAt, kind: "message", title: `${kind} · ${t.ctx("guest-channel", m.channel.toLowerCase())}`, detail: [m.reservation?.reference, m.sentBy?.fullName].filter(Boolean).join(" · ") });
  }
  for (const o of orders) {
    const what = o.type === "ROOM_SERVICE" ? t("Room service order") : ["GUEST", "GUEST_LINK", "ROOM_QR", "PUBLIC_QR", "TABLE_QR", "QR", "WEBSITE"].includes(o.source) ? t("Ordered from their phone") : t("Restaurant / bar order");
    events.push({
      at: o.createdAt, kind: "order", title: `${what} · ${formatTZS(o.total)}`,
      detail: [o.items.map((i) => `${i.quantity} × ${orderItemName(i, t)}`).join(", "), o.location ? spotName(o.location.name, t) : o.tableLabel != null ? spotName(o.tableLabel, t) : (o.roomNumber ? t("Room {room}", { room: o.roomNumber }) : null), o.number].filter(Boolean).join(" · "),
      href: `/staff/restaurant/orders/${o.id}`,
    });
  }
  for (const c of changes) events.push({ at: c.createdAt, kind: "change", title: c.action === "guest.created" ? t("Customer saved") : t("Details updated"), detail: c.user?.fullName ?? c.actorLabel ?? undefined });

  // Where their bills went: "Order #184 put on Room 305 · TZS 45,000" — by whom, and why.
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  /** A place as it was recorded ("Table 3 — Inside", "Room 305"), in the reader's words. */
  const spot = (name: string | null) => (name ? spotName(name, t) : null);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const field = (j: unknown, k: string) => (j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>)[k] : undefined);
  const billName = (b: string | null) => (!b || b === "Restaurant" ? t("the restaurant bill") : spotName(b, t));
  const near = (a: Date, b: Date) => Math.abs(+a - +b) < 10_000;
  const bill = billed.logs;
  for (const l of bill) {
    const after = l.after, before = l.before;
    const by = l.user?.fullName.replace(/\s*\(.*\)/, "") ?? l.actorLabel;
    const why = str(field(after, "reason"));
    const who = [by ? t("by {name}", { name: by }) : null, why ? `(${why})` : null].filter(Boolean).join(" ") || undefined;
    const number = billed.numbers.get(l.entityId ?? "");
    const order = number ? t("Order #{number}", { number: number.replace(/^ORD-\d{4}-0*/, "") }) : t("An order");
    const href = l.entityType === "RestaurantOrder" ? `/staff/restaurant/orders/${l.entityId}` : undefined;
    if (l.action === "dining_session.charged_to_room") {
      const n = Array.isArray(field(after, "orders")) ? (field(after, "orders") as unknown[]).length : 0;
      events.push({ at: l.createdAt, kind: "billing", title: t("Table bill at {table} put on Room {room} · {amount}", { table: spot(str(field(after, "table"))) ?? t("a table"), room: str(field(after, "room")) ?? "—", amount: formatTZS(num(field(after, "amount"))) }), detail: [n ? t.plural(n, "{n} order", "{n} orders") : null, who].filter(Boolean).join(" · ") || undefined });
    } else if (l.action === "restaurant_order.charged_to_room") {
      // Part of a table's bill or a change of who pays: that entry already says it.
      if (bill.some((x) => x !== l && near(x.createdAt, l.createdAt) && ((x.action === "restaurant_order.billing_changed" && x.entityId === l.entityId) || (x.action === "dining_session.charged_to_room" && x.entityId === str(field(after, "session")))))) continue;
      const other = str(field(after, "roomOfAnotherGuest"));
      events.push({ at: l.createdAt, kind: "billing", title: t("{order} put on {billing} · {amount}", { order, billing: spot(str(field(after, "billing"))) ?? t("a room"), amount: formatTZS(num(field(after, "total"))) }), detail: [spot(str(field(after, "table"))), other ? t("{name}'s room", { name: other }) : null, who].filter(Boolean).join(" · ") || undefined, href });
    } else if (l.action === "restaurant_order.room_paid_now") {
      events.push({ at: l.createdAt, kind: "billing", title: t("{order} removed from {billing} — paid now · {amount}", { order, billing: spot(str(field(before, "billing"))) ?? t("the room"), amount: formatTZS(num(field(after, "total"))) }), detail: who, href });
    } else {
      events.push({ at: l.createdAt, kind: "billing", title: t("{order} moved from {from} to {to} · {amount}", { order, from: billName(str(field(before, "billing"))), to: billName(str(field(after, "billing"))), amount: formatTZS(num(field(after, "amount"))) }), detail: who, href });
    }
  }
  return { events: events.sort((a, b) => +b.at - +a.at).slice(0, 80), messages };
}
