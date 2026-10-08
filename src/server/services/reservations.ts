import "server-only";
import { ONLINE_RECORDER_ID } from "./online-recorder";
import { discountLimit, discountTooBigMessage } from "@/lib/discounts";
import { shortTimeRate } from "@/lib/short-time";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError, isExclusionViolation, isUniqueViolation } from "../errors";
import { getSettingsTx, stayConfig } from "../settings";
import { findAvailableRooms, lockRoomTypes } from "./availability";
import { recalculateReservation, syncRoomNights, ACTIVE_STATUSES } from "./reservation-financials";
import { normalizePhone, resolveGuest, typedDifferences, type GuestInput } from "./guests";
import { thankYouAfterCheckout } from "./thank-you";
import { notifyReservationGuestSoon } from "./guest-comms";
import { readerT, roomStatusWord, setRoomStatusTx } from "./rooms";
import { postRoomChargesTx, recordPaymentTx, type ChargeLine } from "./payments";
import { createRestaurantOrderTx } from "./restaurant";
import { assertCompanyCredit, billCompanyTx, type InvoiceMode } from "./company-billing";
import { expireUnpaidHolds, holdDeadline, isPayLater, secureRoomsTx } from "./booking-holds";
import { BILLING_GROUP_CODES, companyPays } from "@/lib/billing";
import { quoteRoom } from "@/lib/pricing";
import { channelFor, loadPricing, quoteFromPromos, quoteStay } from "./pricing";
import { CHECK_IN_READY } from "@/lib/room-status";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { msg, msgf } from "@/i18n/msg";
import { DEFAULT_LOCALE } from "@/i18n/config";
import type { T } from "@/i18n/translate";
import {
  addDays, businessDateOf, eachDate, fromDbDate, isBusinessDate, parseTimeToMinutes, toDbDate, zonedInstant, type BusinessDate,
} from "@/lib/time/business-date";
import { dayUseStay, isLateArrivalInstant, meetingStay, overnightStay, StayError, walkInStay, type Stay } from "@/lib/time/stay";
import type { HotelSettings, Prisma } from "@/generated/prisma/client";
import type { ReservationStatus } from "@/generated/prisma/enums";

/**
 * ReservationService — the one reservation engine. The public website and the
 * staff system both call `createReservation`; the booking source is the only
 * difference between them.
 */

export interface Actor extends AuditActor {
  permissions?: ReadonlySet<string>;
  /** The staff member's role name (kept on restaurant order history). */
  role?: string | null;
}

export type StayRequest =
  | { kind: "overnight"; arrivalDate: BusinessDate; departureDate: BusinessDate }
  | { kind: "dayUse"; startAt: Date; endAt: Date }
  | { kind: "walkIn"; nights: number }
  /** A meeting room booked by time (start–end on one day). */
  | { kind: "meeting"; startAt: Date; endAt: Date };

export interface RoomRequest {
  roomTypeId: string;
  roomId?: string | null; // omit to auto-assign
  adults: number;
  children: number;
  discountPerNight?: number | null; // omit to use the standard discount
  discountReason?: string | null;
}

export interface CreateReservationInput {
  sourceCode: string;
  guest: GuestInput;
  corporateCustomerId?: string | null;
  /** Company name when the company has no company account (meeting room bookings, mostly). */
  companyName?: string | null;
  /** Who pays: the guest (default), the company, or split by what the company covers. */
  billing?: { billTo: "GUEST" | "COMPANY" | "SPLIT" | "GROUP"; covers?: string[]; paymentTermDays?: number | null } | null;
  /** A room of a group booking (the group checks the company's credit once, for all its rooms). */
  groupId?: string | null;
  /** A manager approves a company booking that goes over its credit limit. */
  creditOverride?: { reason: string } | null;
  stay: StayRequest;
  rooms: RoomRequest[];
  status?: "INQUIRY" | "RESERVED" | "CONFIRMED";
  checkInNow?: boolean;
  specialRequests?: string | null;
  internalNotes?: string | null;
  externalReference?: string | null;
  /** Expected arrival time (HH:MM) as told by the guest. */
  eta?: string | null;
  /** Money taken at the desk while booking (walk-in / short time) — recorded in the same transaction. */
  payment?: { amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null } | null;
  /** Room service & extras ordered while booking (put on the room account in the same transaction). */
  charges?: ChargeLine[] | null;
  /**
   * Food & drinks picked from the menu while booking — priced here from the menu, never from the screen.
   * Guest checking in now: real orders the kitchen & bar see, charged to the room (room service adds its fee).
   * Booking for later: a pre-order on the bill at menu prices.
   */
  menuItems?: { menuItemId: string; quantity: number }[] | null;
  menuRoomService?: boolean;
  /** Link to the website booking request this reservation fulfils (converted atomically, once). */
  bookingRequestId?: string | null;
  /** Booked online and being paid online now: an unpaid booking holds its room only this long (the payment confirms it). */
  holdMinutes?: number | null;
  /** Booked from a Hotel booking QR (source HOTEL_QR): which one — found on the server from the scanned token, never sent by the phone. */
  bookingQrId?: string | null;
  /**
   * What a public booking page received with the booking (the website, the Hotel QR): the name and contact the
   * customer typed (the booking's own pages show these back — never the profile found by the phone) and, from the
   * QR, the key of the "Book" press that made it.
   */
  externalData?: Prisma.InputJsonValue | null;
}

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newReference(): string {
  const bytes = randomBytes(6);
  return `VLH-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

function buildStay(req: StayRequest, settings: HotelSettings, now: Date): Stay {
  const cfg = stayConfig(settings);
  try {
    switch (req.kind) {
      case "overnight":
        return overnightStay({ arrivalDate: req.arrivalDate, departureDate: req.departureDate }, cfg);
      case "dayUse":
        return dayUseStay({ startAt: req.startAt, endAt: req.endAt }, cfg);
      case "walkIn":
        return walkInStay({ now, nights: req.nights }, cfg);
      case "meeting":
        return meetingStay({ startAt: req.startAt, endAt: req.endAt }, cfg);
    }
  } catch (e) {
    if (e instanceof StayError) throw new AppError(e.localized ?? e.message, "VALIDATION");
    throw e;
  }
}

/** A booking's status inside a sentence: the English word as it always was ("checked out", "no show"); in another language, the status's own name. */
const bookingStatusWord = (t: T, status: ReservationStatus) => (t.locale === DEFAULT_LOCALE ? status.toLowerCase().replace("_", " ") : t(RESERVATION_STATUS_META[status].label));

/** A manual (negotiated) discount must be allowed for this staff member and within the hotel's limit. */
export function assertManualDiscount(perNight: number, actor: Actor, settings: HotelSettings) {
  const limit = discountLimit(actor.permissions, settings);
  if (limit === 0) throw new AppError("You are not allowed to give discounts.", "FORBIDDEN");
  if (perNight > limit) throw new AppError(discountTooBigMessage(limit), "FORBIDDEN");
}

function translateDbError(e: unknown): never {
  if (isExclusionViolation(e)) {
    throw new AppError(
      "That room was just booked by someone else for these dates. Please choose another room or dates.",
      "UNAVAILABLE",
    );
  }
  throw e;
}

export async function createReservation(input: CreateReservationInput, actor: Actor, now = new Date()) {
  if (input.rooms.length === 0) throw new AppError("Choose at least one room.");
  if (input.rooms.length > 10) throw new AppError("A single booking can hold at most 10 rooms.");
  await expireUnpaidHolds(now);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        (tx) => createReservationTx(tx, input, actor, now),
        { timeout: 20_000, maxWait: 10_000 },
      );
    } catch (e) {
      if (isUniqueViolation(e) && String((e as Error).message ?? "").includes("reference")) continue; // reference collision
      translateDbError(e);
    }
  }
  throw new AppError("Could not create the booking. Please try again.");
}

/** Inside an open transaction (group bookings create all their rooms in one). */
export async function createReservationTx(tx: Tx, input: CreateReservationInput, actor: Actor, now: Date) {
  const settings = await getSettingsTx(tx);
  const source = await tx.bookingSource.findUnique({ where: { code: input.sourceCode } });
  if (!source || !source.isActive) throw new AppError("Choose a valid booking source.", "VALIDATION", { sourceCode: "Invalid" });
  // A Hotel QR booking keeps which QR it came from (its numbers); nothing else can claim one — and the desk cannot book "as" the QR.
  const bookingQr = input.bookingQrId ? await tx.bookingQrCode.findUnique({ where: { id: input.bookingQrId }, select: { id: true, label: true } }) : null;
  if (input.bookingQrId && (!bookingQr || source.code !== "HOTEL_QR")) throw new AppError("Choose a valid booking source.", "VALIDATION", { sourceCode: "Invalid" });
  if (source.code === "HOTEL_QR" && !bookingQr) {
    throw new AppError("Hotel QR bookings are made by guests from the QR — choose how this guest booked.", "VALIDATION", { sourceCode: "Invalid" });
  }

  const stay = buildStay(input.stay, settings, now);
  const today = businessDateOf(now, stayConfig(settings));
  const checkInNow = input.checkInNow || input.stay.kind === "walkIn";

  const meeting = input.stay.kind === "meeting";
  if (input.stay.kind !== "walkIn" && stay.arrivalDate < today) {
    throw new AppError(meeting ? msg("The meeting date cannot be in the past.") : msg("Arrival date cannot be in the past."), "VALIDATION", { arrivalDate: msg("In the past") });
  }
  if (meeting && stay.endAt <= now) throw new AppError("That meeting time has already passed.", "VALIDATION", { startAt: msg("In the past") });
  if (checkInNow && stay.arrivalDate !== today) {
    throw new AppError("Only stays starting today can be checked in immediately.");
  }
  if (stay.arrivalDate > addDays(today, settings.maxAdvanceBookingDays)) {
    throw new AppError(msgf("Bookings can be made up to {days} days ahead.", { days: settings.maxAdvanceBookingDays }));
  }

  const typeIds = input.rooms.map((r) => r.roomTypeId);
  const types = await tx.roomType.findMany({ where: { id: { in: typeIds }, isActive: true } });
  const typeById = new Map(types.map((t) => [t.id, t]));
  // The reader's language, for the room type's name inside a message (the hotel's own content).
  const tr = await readerT();
  for (const r of input.rooms) {
    const t = typeById.get(r.roomTypeId);
    if (!t) throw new AppError("One of the selected room types is not available.", "UNAVAILABLE");
    // Meeting rooms are booked by time and guest rooms by the night — never the other way round.
    if (meeting !== (t.category === "MEETING_ROOM")) {
      throw new AppError(meeting ? msgf("{type} is a guest room — book it as a stay.", { type: tr(t.name) }) : msgf('{type} is booked by time — choose "Meeting room".', { type: tr(t.name) }), "VALIDATION");
    }
    if (meeting && (r.adults < 1 || r.adults > t.maxAdults || r.children !== 0)) {
      throw new AppError(msgf("{type} holds up to {n} people.", { type: tr(t.name), n: t.maxAdults }), "VALIDATION", { attendees: msg("Too many") });
    }
    if (!meeting && (r.adults < 1 || r.adults > t.maxAdults || r.children < 0 || r.children > t.maxChildren)) {
      throw new AppError(t.maxChildren
        ? msgf("{type} fits up to {adults} adult(s) and {children} child(ren).", { type: tr(t.name), adults: t.maxAdults, children: t.maxChildren })
        : msgf("{type} fits up to {adults} adult(s).", { type: tr(t.name), adults: t.maxAdults }));
    }
  }

  const channel = channelFor(source.code);
  const { promos, rules } = stay.isDayUse ? { promos: [], rules: [] } : await loadPricing(tx, stay.arrivalDate, addDays(stay.departureDate, -1));

  // Serialise with any concurrent booking of the same room types, then re-check availability.
  await lockRoomTypes(tx, typeIds);
  const free = await findAvailableRooms({ stay, category: meeting ? "MEETING_ROOM" : "GUEST_ROOM" }, tx);
  const taken = new Set<string>();
  const assignments = input.rooms.map((r) => {
    const t = typeById.get(r.roomTypeId)!;
    let room;
    if (r.roomId) {
      room = free.find((f) => f.id === r.roomId && f.roomTypeId === r.roomTypeId && !taken.has(f.id));
      if (!room) throw new AppError(meeting ? msgf("{type} is already booked for part of that time. Choose another time.", { type: tr(t.name) }) : msgf("The selected {type} room is no longer available for these dates.", { type: tr(t.name) }), "UNAVAILABLE");
    } else {
      room = free.find((f) => f.roomTypeId === r.roomTypeId && !taken.has(f.id) && (!checkInNow || CHECK_IN_READY.includes(f.status)));
      if (!room) {
        throw new AppError(
          checkInNow
            ? msgf("No clean {type} room is ready right now.", { type: tr(t.name) })
            : meeting ? msgf("{type} is already booked for part of that time. Choose another time.", { type: tr(t.name) }) : msgf("Sorry — {type} is fully booked for these dates.", { type: tr(t.name) }),
          "UNAVAILABLE",
        );
      }
    }
    if (checkInNow && !CHECK_IN_READY.includes(room.status)) {
      throw new AppError(msgf("Room {room} is {status} — it must be clean before check-in.", { room: room.number, status: roomStatusWord(tr, room.status, room.status.toLowerCase().replace("_", " ")) }));
    }
    taken.add(room.id);

    if (meeting) {
      // Meeting room: the room type's current price for the booking (snapshotted), less any allowed discount.
      const manual = Math.min(Math.max(0, Math.trunc(r.discountPerNight ?? 0)), t.baseRate);
      if (manual > 0) assertManualDiscount(manual, actor, settings);
      return { request: r, room, type: t, rate: t.baseRate, manual, promotion: null, promoPerNight: 0, overridden: manual > 0, net: t.baseRate - manual };
    }
    if (stay.isDayUse) {
      // Short time has its own price (25% off the room): no promotion, no further discount.
      const rate = shortTimeRate(t.baseRate);
      return { request: r, room, type: t, rate, manual: 0, promotion: null, promoPerNight: 0, overridden: false, net: rate };
    }
    // Price = base − the promotion that applies (worked out here, never taken from the browser) − manual discount.
    const manual = Math.max(0, Math.trunc(r.discountPerNight ?? 0));
    if (manual > 0) assertManualDiscount(manual, actor, settings);
    const q = quoteFromPromos({ dates: stay.nightDates, base: t.baseRate, roomTypeId: t.id, roomId: room.id, channel, promos, rules, manual });
    return { request: r, room, type: t, rate: t.baseRate, manual, promotion: q.promotion, promoPerNight: q.promoPerNight, overridden: manual > 0, net: q.net };
  });

  const guestId = await resolveGuest(tx, input.guest);
  // Booked on a public page by a customer found by their phone: what they typed differently goes in the notes.
  const typed = await typedDifferences(tx, guestId, input.guest);
  // A group room billed to the group (its company or contact person); otherwise a company, or the guest.
  const billTo = input.groupId && input.billing?.billTo === "GROUP" ? "GROUP"
    : input.corporateCustomerId ? (input.billing?.billTo === "GROUP" ? "COMPANY" : input.billing?.billTo ?? "COMPANY") : "GUEST";
  const covers = billTo === "SPLIT" ? [...new Set(input.billing?.covers ?? [])].filter((c) => (BILLING_GROUP_CODES as readonly string[]).includes(c)) : [];
  if (billTo === "SPLIT" && covers.length === 0) throw new AppError("Choose what the company pays for.", "VALIDATION", { covers: "Required" });
  if (input.corporateCustomerId) {
    const corp = await tx.corporateCustomer.findUnique({ where: { id: input.corporateCustomerId } });
    if (!corp || corp.status !== "ACTIVE") throw new AppError("Corporate account is not active.");
    // A guest booked on a company with no company yet becomes one of its staff — offered next time.
    await tx.guest.updateMany({ where: { id: guestId, corporateCustomerId: null }, data: { corporateCustomerId: corp.id } });
    if (billTo !== "GUEST" && !input.groupId && companyPays(billTo, covers, "ROOM")) {
      // Estimate of what this stay puts on the company's account (the room part).
      const estimate = assignments.reduce((sum, a) => sum + a.net, 0);
      await assertCompanyCredit(tx, { companyId: corp.id, amount: estimate, override: input.creditOverride }, actor);
    }
  }

  // Payment is what secures a room: a booking with money taken now, or billed to a company, is confirmed.
  // Without payment it is pending — the room is held only until the hold time, unless a manager confirms it.
  const paying = (input.payment?.amount ?? 0) > 0;
  const guaranteedUnpaid = input.status === "CONFIRMED" && !paying && billTo === "GUEST" && !!actor.permissions?.has("reservations.confirm_unpaid");
  const status: ReservationStatus = checkInNow ? "CHECKED_IN"
    : input.status === "INQUIRY" ? "INQUIRY"
      : paying || billTo !== "GUEST" || guaranteedUnpaid ? "CONFIRMED" : "RESERVED";
  const holdUntil = status !== "RESERVED" ? null
    : input.holdMinutes ? new Date(now.getTime() + input.holdMinutes * 60_000) : holdDeadline(settings, now);
  const reservation = await tx.reservation.create({
    data: {
      reference: newReference(),
      manageToken: randomBytes(24).toString("base64url"),
      guestToken: randomBytes(18).toString("base64url"),
      kind: meeting ? "MEETING" : "STAY",
      groupId: input.groupId ?? null,
      sourceId: source.id,
      bookingQrId: bookingQr?.id ?? null,
      externalReference: input.externalReference?.trim() || null,
      ...(input.externalData != null && { externalData: input.externalData }),
      guestId,
      corporateCustomerId: input.corporateCustomerId ?? null,
      companyName: input.companyName?.trim() || null,
      billTo,
      companyCovers: covers,
      paymentTermDays: billTo !== "GUEST" ? input.billing?.paymentTermDays ?? null : null,
      status,
      adults: assignments.reduce((s, a) => s + a.request.adults, 0),
      children: assignments.reduce((s, a) => s + a.request.children, 0),
      arrivalDate: toDbDate(stay.arrivalDate),
      departureDate: toDbDate(stay.departureDate),
      specialRequests: input.specialRequests?.trim() || null,
      internalNotes: [input.internalNotes?.trim(), typed].filter(Boolean).join(" ") || null,
      eta: input.eta ?? null,
      holdUntil,
      createdById: actor.userId ?? null,
      businessDate: toDbDate(today),
      confirmedAt: status === "CONFIRMED" ? now : null,
      guests: { create: { guestId, isPrimary: true } },
    },
  });

  for (const a of assignments) {
    const rr = await tx.reservationRoom.create({
      data: {
        reservationId: reservation.id,
        roomId: a.room.id,
        roomTypeId: a.type.id,
        status,
        startAt: stay.startAt,
        endAt: stay.endAt,
        arrivalDate: toDbDate(stay.arrivalDate),
        departureDate: toDbDate(stay.departureDate),
        nights: stay.nights,
        isDayUse: stay.isDayUse,
        isLateArrival: stay.isLateArrival,
        adults: a.request.adults,
        children: a.request.children,
        ratePerNight: a.rate,
        discountPerNight: a.manual,
        discountOverridden: a.overridden,
        discountReason: a.overridden ? a.request.discountReason?.trim() || "Discount set at booking" : null,
        discountSetById: a.overridden ? actor.userId ?? null : null,
        discountSetAt: a.overridden ? now : null,
        promotionId: a.promotion?.id ?? null,
        promotionName: a.promotion?.name ?? null,
        promoDiscountPerNight: a.promoPerNight,
        // Totals are summed from the priced nights by syncRoomNights below.
        grossAmount: 0,
        discountAmount: 0,
        netAmount: 0,
        checkedInAt: checkInNow ? now : null,
        checkedInById: checkInNow ? actor.userId ?? null : null,
      },
    });
    await syncRoomNights(tx, rr.id);
    if (checkInNow) await setRoomStatusTx(tx, a.room.id, "OCCUPIED", actor, `Checked in: ${reservation.reference}`);
    if (a.overridden) {
      await audit(tx, actor, {
        action: "reservation.discount_changed", entityType: "Reservation", entityId: reservation.id,
        before: { room: a.room.number, discountPerNight: 0 },
        after: { room: a.room.number, discountPerNight: a.manual, reason: a.request.discountReason },
      });
    }
  }
  await recalculateReservation(tx, reservation.id);

  if (input.bookingRequestId) {
    // Claim the request inside this transaction: a concurrent conversion waits on the row
    // lock, then matches 0 rows and rolls back — one request can only ever become one reservation.
    const claimed = await tx.bookingRequest.updateMany({
      where: { id: input.bookingRequestId, reservationId: null, status: { notIn: ["CONVERTED", "REJECTED", "CANCELLED"] } },
      data: { reservationId: reservation.id, status: "CONVERTED", handledById: actor.userId ?? null, handledAt: now },
    });
    if (claimed.count === 0) throw new AppError("This booking request has already been handled by someone else.", "CONFLICT");
    await tx.bookingRequestEvent.create({
      data: { requestId: input.bookingRequestId, type: "CONVERTED", toStatus: "CONVERTED", note: `Reservation ${reservation.reference} created`, actorId: actor.userId ?? null },
    });
  }

  if (input.charges?.length) {
    await postRoomChargesTx(tx, { reservationId: reservation.id, lines: input.charges }, actor);
  }
  const menuItems = (input.menuItems ?? []).filter((m) => m.quantity > 0);
  if (menuItems.length) {
    if (checkInNow && actor.permissions?.has("restaurant.orders")) {
      // In the hotel now: one order to the kitchen & bar, charged to the room — for this guest (reception's when the desk makes it).
      const desk = actor.permissions.has("dashboard.front_desk") && !["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => actor.permissions?.has(p as never));
      await createRestaurantOrderTx(tx, {
        type: input.menuRoomService ? "ROOM_SERVICE" : "DINE_IN", settlement: "ROOM", reservationId: reservation.id,
        items: menuItems.map((m) => ({ menuItemId: m.menuItemId, quantity: m.quantity })),
      }, actor, now, { guestId: reservation.guestId, source: desk ? "RECEPTION" : "STAFF_MANUAL" });
    } else {
      // Arriving later: a pre-order on the bill, at today's menu prices (a booking's package — meetings, groups).
      const menu = await tx.menuItem.findMany({ where: { id: { in: menuItems.map((m) => m.menuItemId) } }, include: { category: true } });
      const lines: ChargeLine[] = menuItems.map((w) => {
        const m = menu.find((x) => x.id === w.menuItemId);
        if (!m || !m.isActive || !m.category.isActive) throw new AppError("An item picked from the menu is no longer on it. Remove it and try again.", "VALIDATION", { menuItems: msg("Inactive") });
        return { type: m.category.revenueKind === "BAR" ? "BAR" : "RESTAURANT", item: checkInNow ? m.name : `${m.name} (pre-order)`, qty: w.quantity, unitPrice: m.price, menuItemId: m.id };
      });
      await postRoomChargesTx(tx, { reservationId: reservation.id, lines }, actor);
    }
  }
  if (input.payment && input.payment.amount > 0) {
    await recordPaymentTx(tx, { reservationId: reservation.id, amount: input.payment.amount, accountId: input.payment.accountId, methodId: input.payment.methodId, reference: input.payment.reference ?? null }, actor);
  }

  const result = await tx.reservation.findUniqueOrThrow({
    where: { id: reservation.id },
    include: { rooms: { include: { room: true, roomType: true } }, guest: true, source: true },
  });
  await audit(tx, actor, {
    action: meeting ? "meeting.booked" : checkInNow ? "reservation.walk_in" : "reservation.created",
    entityType: "Reservation",
    entityId: result.id,
    after: {
      reference: result.reference,
      source: source.code,
      ...(bookingQr && { bookingQr: bookingQr.label }),
      guest: result.guest.fullName,
      rooms: result.rooms.map((r) => r.room.number),
      arrival: stay.arrivalDate,
      departure: stay.departureDate,
      ...(meeting && { start: stay.startAt.toISOString(), end: stay.endAt.toISOString(), attendees: result.adults, company: result.companyName }),
      net: result.netAmount,
      status: result.status,
    },
  });
  return result;
}

// ───────────────────────── Lifecycle operations ─────────────────────────

async function loadForUpdate(tx: Tx, reservationId: string) {
  // Row lock so two desks cannot act on the same booking at once.
  await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
  const r = await tx.reservation.findUnique({
    where: { id: reservationId },
    include: { rooms: { include: { room: true, roomType: true } }, source: true },
  });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  return r;
}

function pickRooms<T extends { id: string }>(rooms: T[], ids?: string[] | null): T[] {
  if (!ids || ids.length === 0) return rooms;
  return rooms.filter((r) => ids.includes(r.id));
}

/**
 * A booking that holds no room yet (pay later, an enquiry) is about to take one: holds whose time ran out are let go
 * first, so a lapsed hold never makes its room look taken. (Only then — a booking that holds its room is left as it is.)
 */
async function expireHoldsBeforeTaking(where: { reservationId: string } | { id: string }, now = new Date()) {
  if (await db.reservationRoom.count({ where: { ...where, status: "INQUIRY" } })) await expireUnpaidHolds(now);
}

export async function confirmReservation(reservationId: string, actor: Actor) {
  await expireHoldsBeforeTaking({ reservationId });
  return run(async (tx) => {
    const r = await loadForUpdate(tx, reservationId);
    if (!["INQUIRY", "RESERVED"].includes(r.status)) throw new AppError("Only enquiries or pending bookings can be confirmed.");
    const secured = r.paidAmount > 0 || r.billTo !== "GUEST";
    const manager = !!actor.permissions?.has("reservations.confirm_unpaid");
    if (!secured && !manager) {
      // Reception can turn an enquiry into a pending booking (room held until the hold time) — not confirm it without payment.
      if (r.status !== "INQUIRY") throw new AppError("Receive a payment (a deposit is enough) to confirm this booking — or ask a manager to confirm it without payment.", "FORBIDDEN");
      // Booked online to pay later: no room is held until it is paid — whoever pays first gets it (owner, 2026-10-05).
      if (isPayLater(r.externalData)) throw new AppError("This guest booked online to pay later — the room is held only once it is paid. Take a payment (a deposit is enough), or ask a manager to confirm it.", "FORBIDDEN");
    }
    // Not held until now: its room is checked again — the same one, another free one of its type, or "just taken".
    if (r.status === "INQUIRY") await secureRoomsTx(tx, r.id, actor);
    const waiting = (await loadForUpdate(tx, reservationId)).rooms.filter((x) => x.status === "INQUIRY" || x.status === "RESERVED");
    if (!secured && !manager) {
      const settings = await getSettingsTx(tx);
      for (const rr of waiting) { await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "RESERVED" } }); await syncRoomNights(tx, rr.id); }
      const holdUntil = holdDeadline(settings);
      await tx.reservation.update({ where: { id: r.id }, data: { holdUntil } });
      await recalculateReservation(tx, r.id);
      await audit(tx, actor, { action: "reservation.held", entityType: "Reservation", entityId: r.id, before: { status: r.status }, after: { status: "RESERVED", holdUntil } });
      return;
    }
    for (const rr of waiting) {
      await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "CONFIRMED" } });
      await syncRoomNights(tx, rr.id);
    }
    await tx.reservation.update({ where: { id: r.id }, data: { confirmedAt: new Date(), holdUntil: null } });
    await recalculateReservation(tx, r.id);
    await audit(tx, actor, {
      action: "reservation.confirmed", entityType: "Reservation", entityId: r.id, before: { status: r.status },
      after: { status: "CONFIRMED", ...(!secured && { withoutPayment: true, by: actor.label }) },
    });
  });
}

export async function checkIn(reservationId: string, actor: Actor, reservationRoomIds?: string[] | null, now = new Date()) {
  await expireHoldsBeforeTaking({ reservationId }, now);
  const res = await run((tx) => checkInTx(tx, reservationId, actor, reservationRoomIds, now));
  // The guest's welcome on WhatsApp — room, Wi-Fi, check-out, their stay link (only with a provider; never blocks).
  notifyReservationGuestSoon(reservationId, "WELCOME");
  return res;
}

/** Housekeeping states a room may be checked into with an authorised override (never maintenance / out of service). */
const OVERRIDABLE_NOT_READY = ["DIRTY", "CLEANING"];

async function checkInTx(
  tx: Tx, reservationId: string, actor: Actor, reservationRoomIds?: string[] | null, now = new Date(),
  opts: { notReadyOverride?: string | null } = {},
) {
  {
    const settings = await getSettingsTx(tx);
    const cfg = stayConfig(settings);
    const today = businessDateOf(now, cfg);
    const r = await loadForUpdate(tx, reservationId);
    const targets = pickRooms(r.rooms, reservationRoomIds).filter((x) => x.status === "RESERVED" || x.status === "CONFIRMED" || x.status === "INQUIRY");
    if (targets.length === 0) throw new AppError("There are no rooms waiting for check-in on this booking.");
    // A booking that held no room (pay later): its room may have gone to a guest who paid first — then another room is chosen.
    const notHeld = targets.filter((x) => x.status === "INQUIRY");
    if (notHeld.length) await lockRoomTypes(tx, notHeld.map((x) => x.roomTypeId));
    for (const rr of notHeld) {
      const stay = { startAt: now < rr.startAt ? now : rr.startAt, endAt: rr.endAt, arrivalDate: fromDbDate(rr.arrivalDate), departureDate: fromDbDate(rr.departureDate), isDayUse: rr.isDayUse };
      if (!(await findAvailableRooms({ stay, roomIds: [rr.roomId] }, tx)).length) {
        throw new AppError(msgf("Room {room} was taken by a guest who paid first — choose another free room for this guest.", { room: rr.room.number }), "UNAVAILABLE");
      }
    }

    // Warnings are only shown (a toast at the desk): in the reader's language.
    const t = await readerT();
    const warnings: string[] = [];
    for (const rr of targets) {
      const arrival = fromDbDate(rr.arrivalDate);
      const departure = fromDbDate(rr.departureDate);
      if (today < arrival) {
        throw new AppError(msgf("Room {room} is booked from {date}. Change the dates first to check in early.", { room: rr.room.number, date: arrival }));
      }
      if (rr.isDayUse ? today !== arrival : today >= departure) {
        throw new AppError(msgf("This stay has already ended ({date}). Mark it as a no-show or change the dates.", { date: departure }));
      }
      if (today > arrival) warnings.push(t("Room {room}: guest arrived after the booked arrival date — earlier nights remain charged.", { room: rr.room.number }));
      const room = await tx.room.findUniqueOrThrow({ where: { id: rr.roomId } });
      if (!CHECK_IN_READY.includes(room.status)) {
        const overridden = opts.notReadyOverride?.trim() && OVERRIDABLE_NOT_READY.includes(room.status)
          && actor.permissions?.has("reservations.checkin_override");
        if (!overridden) {
          throw new AppError(msgf("Room {room} is {status}. Finish housekeeping or choose another room.", { room: room.number, status: roomStatusWord(t, room.status, room.status.toLowerCase().replace("_", " ")) }), "CONFLICT");
        }
        warnings.push(t("Room {room} was {status} — checked in by authorised override.", { room: room.number, status: roomStatusWord(t, room.status, room.status.toLowerCase()) }));
        await audit(tx, actor, {
          action: "reservation.checkin_not_ready_override", entityType: "Reservation", entityId: r.id,
          after: { room: room.number, roomStatus: room.status, reason: opts.notReadyOverride!.trim() },
        });
      }
      await tx.reservationRoom.update({
        where: { id: rr.id },
        data: {
          status: "CHECKED_IN",
          checkedInAt: now,
          checkedInById: actor.userId ?? null,
          // Early check-in occupies the room from now (the constraint rejects it if the room is still taken).
          startAt: now < rr.startAt ? now : rr.startAt,
          isLateArrival: rr.isDayUse ? false : isLateArrivalInstant(now, cfg),
        },
      });
      await setRoomStatusTx(tx, rr.roomId, "OCCUPIED", actor, `Checked in: ${r.reference}`);
    }
    await recalculateReservation(tx, r.id);
    // Paid online before arriving: that money now counts in the collections of whoever checks the guest in, at
    // check-in (owner, 2026-10-05) — the payment still says it was paid online.
    const credited = actor.userId ? (await tx.payment.updateMany({
      where: { reservationId: r.id, recordedById: ONLINE_RECORDER_ID, creditedToId: null, status: "POSTED", kind: "PAYMENT" },
      data: { creditedToId: actor.userId, creditedAt: now },
    })).count : 0;
    await audit(tx, actor, {
      action: targets.every((t) => t.roomType.category === "MEETING_ROOM") ? "meeting.started" : "reservation.checked_in", entityType: "Reservation", entityId: r.id,
      before: { status: r.status }, after: { rooms: targets.map((t) => t.room.number), at: now.toISOString(), ...(credited ? { onlinePaymentsCredited: credited } : {}) },
    });
    return { warnings };
  }
}

export interface CheckOutOptions {
  reservationRoomIds?: string[] | null;
  allowBalance?: boolean;
  earlyReason?: string | null;
  overrideReason?: string | null;
  /** Guest stayed past their checkout day: charge the extra night(s) (default) or waive them — staff decide. */
  chargeOverstay?: boolean;
  /** Take this payment inside the same transaction, after the final bill is worked out ("record payment & check out"). */
  payment?: { amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null } | null;
  /** Company-billed stays: issue the invoice now, or add it to the company's open invoice (default: the company's setting). */
  invoiceMode?: InvoiceMode | null;
}

export async function checkOut(reservationId: string, actor: Actor, opts: CheckOutOptions = {}, now = new Date()) {
  const res = await run((tx) => checkOutTx(tx, reservationId, actor, opts, now));
  // The guest's thank-you note, from the finished stay (made after the check-out is saved; never blocks it).
  await thankYouAfterCheckout(reservationId, actor);
  // The final bill and the thank-you, on WhatsApp — once the whole stay is out (only with a provider; never blocks).
  const out = await db.reservation.findUnique({ where: { id: reservationId }, select: { status: true } });
  if (out?.status === "CHECKED_OUT") notifyReservationGuestSoon(reservationId, "CHECKOUT");
  return res;
}

export interface CheckOutPreview {
  early: boolean;
  overstayNights: number;
  overstayAmount: number;
  gross: number;
  discount: number;
  charges: number;
  total: number;
  paid: number;
  balance: number;
  /**
   * Room-bill items by the owner's lines: restaurant (a table's orders, food and drinks), room
   * service (orders brought to the room, with the fee), bar & minibar, transport, other.
   */
  chargesByKind: { restaurant: number; bar: number; roomService: number; transport: number; other: number; /** A discount on the whole bill (its food share, as credit lines). */ discount: number };
  /** The restaurant and room-service orders on this bill, one line each: "Restaurant — Outside 3 · #184". */
  orders: { id: string; label: string; roomService: boolean; amount: number }[];
  /**
   * The guest's (or a room sharer's) restaurant orders from this stay still unpaid and NOT on
   * this room — a reminder at check-out, never a block: "Nino still has TZS 20,000 open at Outside 3".
   */
  openOrders: { id: string; number: string; customer: string; at: string; amount: number }[];
  /** Company-billed stay: what moves to the company's invoice at checkout (the guest pays only `balance`). */
  company: { name: string; billTo: string; covers: string[]; billedNow: number; billedBefore: number; terms: number; consolidate: boolean } | null;
  /** A room the group pays for: the group's check-out progress. `last` = no other group room is still staying or to come. */
  group: { id: string; name: string; reference: string; payer: string; remaining: number; last: boolean; finalized: boolean } | null;
}

class PreviewRollback extends Error {
  constructor(readonly data: CheckOutPreview) { super("preview"); }
}

/**
 * The exact final bill if the guest checks out now — computed by running the
 * real checkout inside a transaction that is then rolled back, so the preview
 * can never disagree with what checkout will actually charge.
 */
export async function previewCheckOut(reservationId: string, opts: { chargeOverstay?: boolean; userId?: string } = {}, now = new Date()): Promise<CheckOutPreview> {
  const t = await readerT();
  const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = businessDateOf(now, stayConfig(settings));
  const rooms = await db.reservationRoom.findMany({
    where: { reservationId, status: "CHECKED_IN" },
    include: { roomType: { select: { baseRate: true } }, reservation: { select: { source: { select: { code: true } } } } },
  });
  let overstayNights = 0, overstayAmount = 0, early = false;
  for (const rr of rooms) {
    if (rr.isDayUse) continue;
    const dep = fromDbDate(rr.departureDate);
    if (today < dep) early = true;
    if (today > dep) {
      // Extra nights are priced like any new night: today's price rules (same as checkout will charge).
      const dates = eachDate(dep, today);
      overstayNights = Math.max(overstayNights, dates.length);
      const q = await quoteStay(db, { dates, base: rr.roomType.baseRate, roomTypeId: rr.roomTypeId, roomId: rr.roomId, channel: channelFor(rr.reservation.source.code), manual: rr.discountPerNight });
      overstayAmount += q.net;
    }
  }
  const stay = await db.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: { companyBilledAmount: true, arrivalDate: true, guest: { select: { id: true, fullName: true } }, guests: { select: { guest: { select: { id: true, fullName: true } } } } },
  });
  const billedBefore = stay.companyBilledAmount;
  // Restaurant orders of the people in this room (or at their table) since they arrived, not paid and not on the room.
  const people = new Map([stay.guest, ...stay.guests.map((g) => g.guest)].map((g) => [g.id, g.fullName]));
  const open = await db.restaurantOrder.findMany({
    where: {
      settlement: { not: "ROOM" }, paymentStatus: "UNPAID", status: { not: "CANCELLED" }, createdAt: { gte: stay.arrivalDate },
      OR: [{ guestId: { in: [...people.keys()] } }, { guestId: null, session: { guestId: { in: [...people.keys()] } } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, number: true, type: true, total: true, guestId: true, tableLabel: true, location: { select: { name: true } }, session: { select: { guestId: true } } },
  });
  const openOrders = open.map((o) => ({
    id: o.id, number: o.number, amount: o.total,
    customer: people.get(o.guestId ?? "") ?? people.get(o.session?.guestId ?? "") ?? stay.guest.fullName,
    // English words the check-out screens put in the reader's language.
    at: o.type === "ROOM_SERVICE" ? msg("for room service") : o.type === "TAKEAWAY" ? msg("for take out") : `at ${o.location?.name ?? o.tableLabel ?? msg("the restaurant")}`,
  }));
  try {
    await db.$transaction(async (tx) => {
      // Rolled back below — the user id only satisfies "created by" on a draft company invoice.
      const userId = opts.userId ?? (await tx.user.findFirstOrThrow({ select: { id: true } })).id;
      await checkOutTx(tx, reservationId, { userId, label: "preview", permissions: new Set(["reservations.checkout_override"]) },
        { allowBalance: true, earlyReason: "preview", overrideReason: "preview", chargeOverstay: opts.chargeOverstay ?? true }, now);
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: {
          corporateCustomer: true, group: { include: { contactGuest: { select: { fullName: true } } } },
          charges: { where: { isVoided: false }, orderBy: { createdAt: "asc" }, select: { kind: true, category: true, amount: true, restaurantOrder: { select: { id: true, number: true, type: true, tableLabel: true, location: { select: { name: true } } } } } },
        },
      });
      const c = r.corporateCustomer;
      const g = r.billTo === "GROUP" ? r.group : null;
      // Other rooms the group pays for that are still staying or still to come.
      const remaining = g ? await tx.reservation.count({ where: { groupId: g.id, billTo: "GROUP", id: { not: r.id }, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } } }) : 0;
      // A table's order is restaurant (the room only collects it); an order brought to the room is room service.
      const lineOf = (x: (typeof r.charges)[number]): keyof CheckOutPreview["chargesByKind"] => x.category === "BILL_DISCOUNT" ? "discount"
        : x.restaurantOrder ? (x.restaurantOrder.type === "ROOM_SERVICE" ? "roomService" : "restaurant")
        : x.category === "ROOM_SERVICE" || x.category === "ROOM_SERVICE_FEE" || x.kind === "ROOM_SERVICE" ? "roomService"
        : x.kind === "RESTAURANT" ? "restaurant" : x.kind === "BAR" ? "bar" : x.kind === "TRANSPORT" ? "transport" : "other";
      const byKind = { restaurant: 0, bar: 0, roomService: 0, transport: 0, other: 0, discount: 0 };
      const orders = new Map<string, CheckOutPreview["orders"][number]>();
      for (const x of r.charges) {
        byKind[lineOf(x)] += x.amount;
        const o = x.restaurantOrder;
        if (!o) continue;
        const no = `#${o.number.replace(/^ORD-\d{4}-0*/, "")}`, table = o.location?.name ?? o.tableLabel;
        const line = orders.get(o.id) ?? { id: o.id, roomService: o.type === "ROOM_SERVICE", amount: 0, label: o.type === "ROOM_SERVICE" ? `Room service · ${no}` : `Restaurant${table ? ` — ${table}` : ""} · ${no}` };
        line.amount += x.amount;
        orders.set(o.id, line);
      }
      throw new PreviewRollback({
        chargesByKind: byKind, orders: [...orders.values()].filter((o) => o.amount !== 0), openOrders,
        early, overstayNights, overstayAmount,
        gross: r.grossAmount, discount: r.discountAmount, charges: r.chargesAmount, total: r.netAmount, paid: r.paidAmount, balance: r.balanceAmount,
        company: g ? {
          // A group room: its bill goes on the group's invoice (paid by the group's company or contact).
          name: t("{group} (group · {payer})", { group: g.name, payer: c ? c.companyName : g.contactGuest.fullName }), billTo: r.billTo, covers: [], billedNow: r.companyBilledAmount - billedBefore, billedBefore,
          terms: g.paymentTermDays ?? c?.paymentTermDays ?? 0, consolidate: g.billing === "COMBINED",
        } : c && r.billTo !== "GUEST" ? {
          name: c.companyName, billTo: r.billTo, covers: r.companyCovers, billedNow: r.companyBilledAmount - billedBefore, billedBefore,
          terms: r.paymentTermDays ?? c.paymentTermDays, consolidate: c.consolidateInvoices,
        } : null,
        group: g ? {
          id: g.id, name: g.name, reference: g.reference, payer: c?.companyName ?? g.name, remaining,
          last: remaining === 0 && !g.finalizedAt, finalized: !!g.finalizedAt,
        } : null,
      });
    }, { timeout: 20_000, maxWait: 10_000 });
  } catch (e) {
    if (e instanceof PreviewRollback) return e.data;
    translateDbError(e);
  }
  throw new AppError("Could not work out the final bill.");
}

async function checkOutTx(tx: Tx, reservationId: string, actor: Actor, opts: CheckOutOptions, now: Date) {
  {
    const settings = await getSettingsTx(tx);
    const cfg = stayConfig(settings);
    const today = businessDateOf(now, cfg);
    const r = await loadForUpdate(tx, reservationId);
    const targets = pickRooms(r.rooms, opts.reservationRoomIds).filter((x) => x.status === "CHECKED_IN");
    if (targets.length === 0) throw new AppError("No checked-in rooms to check out.");

    const changes: { room: string; nights: number }[] = [];
    const early = targets.some((rr) => !rr.isDayUse && today < fromDbDate(rr.departureDate));
    if (early && !opts.earlyReason?.trim()) {
      throw new AppError("This is an early departure — give a reason (e.g. change of plans, complaint, emergency).", "VALIDATION", { earlyReason: "Required" });
    }
    for (const rr of targets) {
      const arrival = fromDbDate(rr.arrivalDate);
      const plannedDeparture = fromDbDate(rr.departureDate);
      let departure = plannedDeparture;
      let nights = rr.nights;
      if (!rr.isDayUse) {
        // Early departure: stop charging unused nights (minimum one night).
        // Stayed past the 04:00 rollover after the planned departure: charge the extra nights.
        departure = today < plannedDeparture ? (today > arrival ? today : addDays(arrival, 1))
          : today > plannedDeparture && opts.chargeOverstay !== false ? today : plannedDeparture;
        nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86_400_000);
      }
      const units = rr.isDayUse ? 1 : nights;
      const quote = quoteRoom({ ratePerNight: rr.ratePerNight, discountPerNight: rr.discountPerNight, units });
      await tx.reservationRoom.update({
        where: { id: rr.id },
        data: {
          status: "CHECKED_OUT",
          checkedOutAt: now,
          checkedOutById: actor.userId ?? null,
          // A meeting that runs over keeps its booked end, so a meeting booked right after it
          // is not disturbed; the actual finish is checkedOutAt.
          endAt: rr.isDayUse && now > rr.endAt ? rr.endAt : now,
          departureDate: toDbDate(departure),
          nights: rr.isDayUse ? 0 : nights,
          grossAmount: quote.grossAmount,
          discountAmount: quote.discountAmount,
          netAmount: quote.netAmount,
        },
      });
      await syncRoomNights(tx, rr.id);
      // A meeting room is free again straight away; a bedroom needs housekeeping first.
      if (rr.roomType.category === "MEETING_ROOM") await setRoomStatusTx(tx, rr.roomId, "AVAILABLE", actor, `Meeting completed: ${r.reference}`);
      else await setRoomStatusTx(tx, rr.roomId, "DIRTY", actor, `Checked out: ${r.reference}`);
      if (nights !== rr.nights) changes.push({ room: rr.room.number, nights });

      // Early departure: the ledger keeps only nights actually used (so occupancy stays true);
      // any penalty required by the hotel's policy is a separate, visible folio charge.
      if (!rr.isDayUse && nights < rr.nights) {
        await tx.reservationRoom.update({ where: { id: rr.id }, data: { earlyDepartureReason: opts.earlyReason!.trim() } });
        const policy = settings.earlyDeparturePolicy;
        const penaltyNights = policy === "CHARGE_FULL_STAY" ? rr.nights - nights : policy === "CHARGE_ONE_EXTRA_NIGHT" ? Math.min(1, rr.nights - nights) : 0;
        if (penaltyNights > 0) {
          const perNight = rr.ratePerNight - Math.min(rr.discountPerNight, rr.ratePerNight);
          await tx.reservationCharge.create({
            data: {
              reservationId: r.id, amount: perNight * penaltyNights, category: "EARLY_DEPARTURE", kind: "OTHER",
              description: `Early departure — room ${rr.room.number}, ${penaltyNights} night(s) per hotel policy`,
              businessDate: toDbDate(today), createdById: actor.userId ?? null,
            },
          });
        }
      }
    }
    await recalculateReservation(tx, r.id);
    // Company-billed stay: the company's part moves onto its invoice ("check out & issue invoice").
    // The preview runs this too (then rolls back), so it can show the split exactly.
    const invoice = r.billTo !== "GUEST" && (r.corporateCustomerId || (r.billTo === "GROUP" && r.groupId))
      // A group room always follows its group's billing (one running bill, or one invoice per room).
      ? await billCompanyTx(tx, r.id, actor, { mode: r.billTo === "GROUP" ? null : opts.invoiceMode, now })
      : null;
    if (opts.payment && opts.payment.amount > 0) {
      await recordPaymentTx(tx, { reservationId: r.id, amount: opts.payment.amount, accountId: opts.payment.accountId, methodId: opts.payment.methodId, reference: opts.payment.reference }, actor);
    }

    const after = await tx.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { leaveOwingBy: { select: { fullName: true } } } });
    // A manager approved beforehand that the guest may leave owing (up to that amount): reception can check them out.
    const approved = !!after.leaveOwingAt && after.leaveOwingUpTo != null && after.balanceAmount > 0 && after.balanceAmount <= after.leaveOwingUpTo;
    if (approved && !opts.overrideReason?.trim()) {
      opts = { ...opts, allowBalance: true, overrideReason: `Approved by ${after.leaveOwingBy?.fullName ?? "a manager"}: ${after.leaveOwingReason}` };
    }
    if (after.balanceAmount > 0) {
      const mayOverride = !!actor.permissions?.has("reservations.checkout_override") || approved;
      if (opts.allowBalance && mayOverride && !opts.overrideReason?.trim()) {
        throw new AppError("Give the reason for letting the guest leave with an unpaid balance.", "VALIDATION", { overrideReason: "Required" });
      }
      if (!opts.allowBalance || !mayOverride) {
        throw new AppError(
          mayOverride
            ? msgf("This guest still owes TZS {amount}. Record the payment, or confirm checkout with an unpaid balance.", { amount: after.balanceAmount.toLocaleString("en-TZ") })
            : after.leaveOwingAt && after.leaveOwingUpTo != null
              ? msgf("This guest now owes TZS {amount} — more than the TZS {allowed} the manager allowed. Receive a payment, or ask the manager again.", { amount: after.balanceAmount.toLocaleString("en-TZ"), allowed: after.leaveOwingUpTo.toLocaleString("en-TZ") })
              : msgf("This guest still owes TZS {amount}. Receive the payment first — only a manager can let a guest leave owing (they can allow it on the room card).", { amount: after.balanceAmount.toLocaleString("en-TZ") }),
          "CONFLICT",
        );
      }
    }
    await audit(tx, actor, {
      action: targets.every((t) => t.roomType.category === "MEETING_ROOM") ? "meeting.completed" : "reservation.checked_out", entityType: "Reservation", entityId: r.id,
      before: { status: r.status, balance: r.balanceAmount },
      after: {
        rooms: targets.map((t) => t.room.number), balance: after.balanceAmount, nightChanges: changes, unpaidAccepted: after.balanceAmount > 0,
        ...(after.balanceAmount > 0 && { overrideBy: actor.label, overrideReason: opts.overrideReason?.trim() || null }),
        ...(invoice && { invoice: invoice.number, billedToCompany: invoice.amount }),
      },
    });
    return { balance: after.balanceAmount, changes, rooms: targets.map((t) => t.room.number), invoice };
  }
}

export async function cancelReservation(reservationId: string, actor: Actor, reason: string, opts: { keepPayment?: boolean | null } = {}) {
  if (!reason.trim()) throw new AppError("A cancellation reason is required.", "VALIDATION", { reason: "Required" });
  const res = await run(async (tx) => {
    const r = await loadForUpdate(tx, reservationId);
    const cancellable = r.rooms.filter((x) => ["INQUIRY", "RESERVED", "CONFIRMED"].includes(x.status));
    if (cancellable.length === 0) throw new AppError("This booking cannot be cancelled (guest already checked in, or it is closed).");
    for (const rr of cancellable) {
      await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "CANCELLED" } });
      await syncRoomNights(tx, rr.id);
    }
    await tx.reservation.update({ where: { id: r.id }, data: { cancelledAt: new Date(), cancelReason: reason.trim(), holdUntil: null } });
    await recalculateReservation(tx, r.id);
    const settings = await getSettingsTx(tx);
    const keep = opts.keepPayment ?? settings.noShowPolicy === "RETAIN_PAYMENT";
    const money = await settlePaidBookingTx(tx, r.id, actor, keep, "CANCELLATION", "Cancelled — payment kept (non-refundable)");
    await audit(tx, actor, {
      action: "reservation.cancelled", entityType: "Reservation", entityId: r.id,
      before: { status: r.status, net: r.netAmount, paid: r.paidAmount },
      after: { status: "CANCELLED", reason, rooms: cancellable.map((c) => c.room.number), policy: keep ? "Payment kept" : "Refund due", ...money },
    });
  });
  notifyReservationGuestSoon(reservationId, "CANCELLED");
  return res;
}

/**
 * NO SHOW — the guest did not arrive by the cut-off (and gave no late-arrival notice).
 * The booking is never deleted. The room stays held ("action required") until it is
 * released — by a manager, or automatically when the hotel's settings say so, or at
 * once when nothing was paid. Releasing applies the paid no-show policy.
 */
export async function markNoShow(reservationId: string, actor: Actor, now = new Date(), opts: { release?: boolean; auto?: boolean } = {}) {
  return run((tx) => markNoShowTx(tx, reservationId, actor, now, opts));
}

export async function markNoShowTx(tx: Tx, reservationId: string, actor: Actor, now: Date, opts: { release?: boolean; auto?: boolean } = {}) {
  const settings = await getSettingsTx(tx);
  const today = businessDateOf(now, stayConfig(settings));
  const r = await loadForUpdate(tx, reservationId);
  const waiting = r.rooms.filter((x) => x.status === "RESERVED" || x.status === "CONFIRMED");
  if (waiting.length === 0) throw new AppError("Only bookings waiting for arrival can be marked as no-show.");
  if (waiting.some((x) => fromDbDate(x.arrivalDate) > today)) {
    throw new AppError("A booking can only be marked no-show on or after its arrival date.");
  }
  for (const rr of waiting) {
    await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "NO_SHOW" } });
    await syncRoomNights(tx, rr.id);
  }
  await tx.reservation.update({ where: { id: r.id }, data: { noShowAt: now, holdUntil: null } });
  await recalculateReservation(tx, r.id);
  await audit(tx, actor, {
    action: "reservation.no_show", entityType: "Reservation", entityId: r.id,
    before: { status: r.status, paid: r.paidAmount },
    after: { status: "NO_SHOW", rooms: waiting.map((x) => x.room.number), ...(opts.auto && { reason: "Did not arrive by the no-show cut-off" }) },
  });
  // Nothing paid (and not a company booking): nothing to protect — give the room back straight away.
  const unpaid = r.paidAmount <= 0 && r.billTo === "GUEST";
  if (opts.release || unpaid || (opts.auto && settings.noShowAutoRelease)) {
    await releaseNoShowTx(tx, r.id, actor, now, unpaid ? "Not paid — room released" : opts.auto ? "Released automatically at the no-show cut-off" : null);
  }
}

/** RELEASE ROOM after a no-show: the room can be sold again; the booking stays as NO SHOW; the payment policy applies. */
export async function releaseNoShow(reservationId: string, actor: Actor, reason?: string | null) {
  if (!actor.permissions?.has("reservations.cancel")) throw new AppError("Only a manager can release a no-show room.", "FORBIDDEN");
  return run((tx) => releaseNoShowTx(tx, reservationId, actor, new Date(), reason ?? null));
}

async function releaseNoShowTx(tx: Tx, reservationId: string, actor: Actor, now: Date, reason: string | null) {
  const r = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { rooms: { include: { room: true } } } });
  const held = r.rooms.filter((x) => x.status === "NO_SHOW" && !x.releasedAt);
  if (held.length === 0) throw new AppError("No room is being held for this no-show.");
  for (const rr of held) await tx.reservationRoom.update({ where: { id: rr.id }, data: { releasedAt: now, releasedById: actor.userId ?? null } });
  const settings = await getSettingsTx(tx);
  const keep = settings.noShowPolicy === "RETAIN_PAYMENT";
  const money = await settlePaidBookingTx(tx, r.id, actor, keep, "NO_SHOW", "No-show — payment kept (non-refundable)", now);
  await audit(tx, actor, {
    action: "reservation.room_released", entityType: "Reservation", entityId: r.id,
    before: { status: "NO_SHOW", rooms: held.map((x) => x.room.number) },
    after: { released: true, policy: r.paidAmount > 0 ? (keep ? "Payment kept" : "Refund due") : "Nothing paid", ...money, ...(reason && { reason }) },
  });
}

/**
 * The guest called: they are still coming (or have just arrived). An unreleased
 * no-show becomes an active booking again, marked as a late arrival.
 */
export async function reinstateNoShow(reservationId: string, note: string, actor: Actor, now = new Date()) {
  if (!note.trim()) throw new AppError("Say what the guest told you (e.g. arriving at midnight).", "VALIDATION", { note: "Required" });
  return run(async (tx) => {
    const r = await loadForUpdate(tx, reservationId);
    const held = r.rooms.filter((x) => x.status === "NO_SHOW" && !x.releasedAt);
    if (held.length === 0) {
      const released = r.rooms.some((x) => x.status === "NO_SHOW" && x.releasedAt);
      throw new AppError(released
        ? msg("This booking was marked no-show and its room was released. A manager must decide what to do (check which rooms are free and make a new booking).")
        : msg("This booking is not a no-show."), "CONFLICT");
    }
    const status = r.paidAmount > 0 || r.billTo !== "GUEST" || r.confirmedAt ? "CONFIRMED" : "RESERVED";
    for (const rr of held) {
      await tx.reservationRoom.update({ where: { id: rr.id }, data: { status } });
      await syncRoomNights(tx, rr.id);
    }
    await tx.reservation.update({ where: { id: r.id }, data: { noShowAt: null, lateArrivalNotedAt: now, lateArrivalNote: note.trim() } });
    await recalculateReservation(tx, r.id);
    await audit(tx, actor, {
      action: "reservation.late_arrival_confirmed", entityType: "Reservation", entityId: r.id,
      before: { status: "NO_SHOW" }, after: { status, reason: note.trim(), rooms: held.map((x) => x.room.number) },
    });
  });
}

/** "I am coming late": keeps the booking active past the no-show cut-off, with the new expected time. */
export async function noteLateArrival(reservationId: string, input: { eta?: string | null; note?: string | null }, actor: Actor, now = new Date()) {
  const eta = input.eta?.trim() || null;
  if (eta && !/^\d{2}:\d{2}$/.test(eta)) throw new AppError("Enter the time like 21:30.", "VALIDATION", { eta: "Invalid" });
  return run(async (tx) => {
    const r = await loadForUpdate(tx, reservationId);
    if (!["RESERVED", "CONFIRMED", "INQUIRY"].includes(r.status)) throw new AppError("Only bookings waiting for arrival can be marked as arriving late.");
    const note = input.note?.trim() || (eta ? `Guest will arrive around ${eta}` : "Guest will arrive late");
    await tx.reservation.update({ where: { id: r.id }, data: { eta: eta ?? r.eta, lateArrivalNotedAt: now, lateArrivalNote: note } });
    await audit(tx, actor, {
      action: "reservation.late_arrival", entityType: "Reservation", entityId: r.id,
      before: { eta: r.eta, lateArrival: r.lateArrivalNote }, after: { eta: eta ?? r.eta, lateArrival: note, reason: note },
    });
  });
}

/**
 * A paid booking that is cancelled / not used: the payment always stays on record.
 * - keep: a visible "payment kept" charge turns what was paid into income (balance 0);
 * - otherwise the money shows as a credit — a refund is a separate, authorised payment.
 */
async function settlePaidBookingTx(tx: Tx, reservationId: string, actor: Actor, keep: boolean, category: "NO_SHOW" | "CANCELLATION", label: string, now = new Date()) {
  const r = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
  const credit = -r.balanceAmount;
  if (r.paidAmount <= 0 || credit <= 0) return { paid: r.paidAmount, kept: 0, refundDue: 0 };
  if (!keep) return { paid: r.paidAmount, kept: 0, refundDue: credit };
  const settings = await getSettingsTx(tx);
  await tx.reservationCharge.create({
    data: {
      reservationId, amount: credit, category, kind: "OTHER", description: label,
      businessDate: toDbDate(businessDateOf(now, stayConfig(settings))), createdById: actor.userId ?? null,
    },
  });
  await recalculateReservation(tx, reservationId);
  return { paid: r.paidAmount, kept: credit, refundDue: 0 };
}

/** Move one room of a booking to another room (same or different type). */
export async function reassignRoom(
  reservationRoomId: string, newRoomId: string, actor: Actor, reason?: string | null, opts: { chargeDifference?: boolean } = {},
) {
  return run((tx) => reassignRoomTx(tx, reservationRoomId, newRoomId, actor, reason, opts));
}

async function reassignRoomTx(
  tx: Tx, reservationRoomId: string, newRoomId: string, actor: Actor, reason?: string | null, opts: { chargeDifference?: boolean } = {},
) {
  {
    const rr = await tx.reservationRoom.findUnique({ where: { id: reservationRoomId }, include: { room: true, reservation: true } });
    if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
    // (A booking that holds no room yet — pay later — can be given another room too, e.g. at the desk when it arrives.)
    if (!ACTIVE_STATUSES.includes(rr.status) && rr.status !== "INQUIRY") throw new AppError("Only active stays can be moved.");
    const newRoom = await tx.room.findUnique({ where: { id: newRoomId }, include: { roomType: true } });
    if (!newRoom || !newRoom.isActive) throw new AppError("Room not found.", "NOT_FOUND");
    if (newRoom.id === rr.roomId) throw new AppError("The guest is already in this room.");
    await lockRoomTypes(tx, [rr.roomTypeId, newRoom.roomTypeId]);

    const now = new Date();
    const inHouse = rr.status === "CHECKED_IN";
    const window = {
      startAt: inHouse ? now : rr.startAt,
      endAt: rr.endAt < now ? new Date(now.getTime() + 60_000) : rr.endAt,
      arrivalDate: inHouse ? businessDateOf(now, stayConfig(await getSettingsTx(tx))) : fromDbDate(rr.arrivalDate),
      departureDate: fromDbDate(rr.departureDate),
      isDayUse: rr.isDayUse,
    };
    const free = await findAvailableRooms({ stay: window, roomIds: [newRoom.id], excludeReservationRoomId: rr.id }, tx);
    if (free.length === 0) throw new AppError(msgf("Room {room} is not free for this stay.", { room: newRoom.number }), "UNAVAILABLE");
    if (inHouse && !CHECK_IN_READY.includes(newRoom.status)) {
      throw new AppError(msgf("Room {room} is not ready ({status}).", { room: newRoom.number, status: roomStatusWord(await readerT(), newRoom.status, newRoom.status.toLowerCase()) }));
    }

    // The booked rate is kept on a room move. For an upgrade, staff may charge the difference
    // for the remaining nights as a separate folio line (never silently).
    await tx.reservationRoom.update({ where: { id: rr.id }, data: { roomId: newRoom.id, roomTypeId: newRoom.roomTypeId } });
    // In the hotel: tonight and later nights move; nights already slept stay in the old room.
    if (inHouse) {
      await tx.roomNight.updateMany({ where: { reservationRoomId: rr.id, businessDate: { gte: toDbDate(window.arrivalDate) } }, data: { roomId: newRoom.id, roomTypeId: newRoom.roomTypeId } });
    }
    await syncRoomNights(tx, rr.id);
    let priceDifference: number | null = null;
    if (opts.chargeDifference && newRoom.roomType.baseRate > rr.ratePerNight && !rr.isDayUse) {
      const from = inHouse ? window.arrivalDate : fromDbDate(rr.arrivalDate);
      const remaining = Math.max(0, Math.round((Date.parse(fromDbDate(rr.departureDate)) - Date.parse(from)) / 86_400_000));
      priceDifference = (newRoom.roomType.baseRate - rr.ratePerNight) * remaining;
      if (priceDifference > 0) {
        await tx.reservationCharge.create({
          data: {
            reservationId: rr.reservationId, amount: priceDifference, category: "ROOM_UPGRADE", kind: "OTHER",
            description: `Upgrade ${rr.room.number} → ${newRoom.number} (${newRoom.roomType.name}), ${remaining} night(s)`,
            businessDate: toDbDate(window.arrivalDate), createdById: actor.userId ?? null,
          },
        });
      }
    }
    await tx.roomAssignment.create({
      data: {
        reservationRoomId: rr.id, fromRoomId: rr.roomId, toRoomId: newRoom.id, reason: reason ?? null, priceDifference, changedById: actor.userId ?? null,
        source: reason === "Assigned at arrival" ? "ARRIVAL" : "CUSTOMER", charged: priceDifference ?? 0,
      },
    });
    await recalculateReservation(tx, rr.reservationId);
    if (inHouse) {
      await setRoomStatusTx(tx, rr.roomId, "DIRTY", actor, `Guest moved to ${newRoom.number}`);
      await setRoomStatusTx(tx, newRoom.id, "OCCUPIED", actor, `Guest moved from ${rr.room.number}`);
    }
    await audit(tx, actor, {
      action: "reservation.room_assigned", entityType: "Reservation", entityId: rr.reservationId,
      before: { room: rr.room.number }, after: { room: newRoom.number, type: newRoom.roomType.name, reason: reason ?? null },
    });
  }
}

/**
 * ASSIGN ROOM & CHECK IN — one transaction: re-verify each chosen room is
 * free, move the booking onto it, fill any missing guest details, then check
 * in (room → Occupied, time & receptionist recorded, ledger & audit updated).
 * Nothing is saved if any step fails.
 */
export async function assignAndCheckIn(
  reservationId: string,
  input: {
    assignments?: { reservationRoomId: string; roomId: string }[];
    guest?: { fullName?: string | null; phone?: string | null; email?: string | null; idType?: string | null; idNumber?: string | null; nationality?: string | null };
    notReadyOverride?: string | null;
  },
  actor: Actor,
  now = new Date(),
) {
  await expireHoldsBeforeTaking({ reservationId }, now);
  const res = await run(async (tx) => {
    const r = await loadForUpdate(tx, reservationId);
    if (!["RESERVED", "CONFIRMED", "INQUIRY"].includes(r.status)) throw new AppError(msgf("This booking is {status} — nothing to check in.", { status: bookingStatusWord(await readerT(), r.status) }));
    for (const a of input.assignments ?? []) {
      const rr = r.rooms.find((x) => x.id === a.reservationRoomId);
      if (!rr) throw new AppError("That room is not part of this booking.", "NOT_FOUND");
      if (a.roomId && a.roomId !== rr.roomId) await reassignRoomTx(tx, rr.id, a.roomId, actor, "Assigned at arrival");
    }
    // Details confirmed or corrected at the desk. Blank fields never wipe stored data.
    const g = input.guest;
    if (g) {
      const guest = await tx.guest.findUniqueOrThrow({ where: { id: r.guestId } });
      const want = {
        fullName: g.fullName?.trim() || undefined,
        phone: normalizePhone(g.phone) ?? undefined,
        email: g.email?.trim().toLowerCase() || undefined,
        idType: g.idType?.trim() || undefined,
        idNumber: g.idNumber?.trim() || undefined,
        nationality: g.nationality?.trim() || undefined,
      };
      const patch = Object.fromEntries(Object.entries(want).filter(([k, v]) => v !== undefined && v !== guest[k as keyof typeof want]));
      if (Object.keys(patch).length) {
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, guest[k as keyof typeof want]]));
        await tx.guest.update({ where: { id: guest.id }, data: patch });
        await audit(tx, actor, { action: "guest.updated_at_checkin", entityType: "Guest", entityId: guest.id, before, after: patch });
      }
    }
    return checkInTx(tx, reservationId, actor, null, now, { notReadyOverride: input.notReadyOverride });
  });
  notifyReservationGuestSoon(reservationId, "WELCOME");
  return res;
}

export interface MeetingChange {
  startAt?: Date | null;
  endAt?: Date | null;
  attendees?: number | null;
  companyName?: string | null;
  specialRequests?: string | null;
  internalNotes?: string | null;
}

/**
 * Change a meeting room booking: date / start / end (availability re-checked on the
 * server, the booked price kept), attendees, company, requirements and notes.
 * Once the meeting has started only the end time can move.
 */
export async function changeMeeting(reservationId: string, change: MeetingChange, actor: Actor, now = new Date()) {
  return run(async (tx) => {
    const settings = await getSettingsTx(tx);
    const cfg = stayConfig(settings);
    const r = await loadForUpdate(tx, reservationId);
    const rooms = r.rooms.filter((x) => x.roomType.category === "MEETING_ROOM" && ["RESERVED", "CONFIRMED", "CHECKED_IN"].includes(x.status));
    if (rooms.length === 0) throw new AppError("This booking has no meeting room booking that can still change.");
    const first = rooms[0];
    const before = {
      start: first.startAt.toISOString(), end: first.endAt.toISOString(), attendees: r.adults,
      company: r.companyName, requirements: r.specialRequests, notes: r.internalNotes,
    };
    const after: Record<string, unknown> = {};

    const startAt = change.startAt ?? first.startAt;
    const endAt = change.endAt ?? first.endAt;
    if (startAt.getTime() !== first.startAt.getTime() || endAt.getTime() !== first.endAt.getTime()) {
      if (first.status === "CHECKED_IN" && startAt.getTime() !== first.startAt.getTime()) {
        throw new AppError("The meeting has already started — only the end time can change.");
      }
      let stay: Stay;
      try {
        stay = meetingStay({ startAt, endAt }, cfg);
      } catch (e) {
        if (e instanceof StayError) throw new AppError(e.localized ?? e.message, "VALIDATION");
        throw e;
      }
      if (first.status !== "CHECKED_IN" && stay.arrivalDate < businessDateOf(now, cfg)) {
        throw new AppError("The meeting date cannot be in the past.", "VALIDATION", { date: msg("In the past") });
      }
      if (stay.endAt <= now) throw new AppError("That meeting time has already passed.", "VALIDATION", { endAt: msg("In the past") });
      await lockRoomTypes(tx, rooms.map((x) => x.roomTypeId));
      for (const rr of rooms) {
        const free = await findAvailableRooms({ stay, roomIds: [rr.roomId], excludeReservationRoomId: rr.id }, tx);
        if (!free.length) throw new AppError(msgf("Room {room} is booked or blocked for part of that time. Choose another time.", { room: rr.room.number }), "UNAVAILABLE");
        await tx.reservationRoom.update({
          where: { id: rr.id },
          data: { startAt: stay.startAt, endAt: stay.endAt, arrivalDate: toDbDate(stay.arrivalDate), departureDate: toDbDate(stay.departureDate) },
        });
        await syncRoomNights(tx, rr.id); // moves the booking's one unit to the new date, at the price it was booked for
      }
      await tx.reservation.update({ where: { id: r.id }, data: { arrivalDate: toDbDate(stay.arrivalDate), departureDate: toDbDate(stay.departureDate) } });
      Object.assign(after, { start: stay.startAt.toISOString(), end: stay.endAt.toISOString() });
    }

    if (change.attendees != null && change.attendees !== r.adults) {
      const cap = Math.min(...rooms.map((x) => x.roomType.maxAdults));
      if (!Number.isInteger(change.attendees) || change.attendees < 1 || change.attendees > cap) {
        throw new AppError(msgf("{type} holds up to {n} people.", { type: (await readerT())(first.roomType.name), n: cap }), "VALIDATION", { attendees: msg("Too many") });
      }
      await tx.reservationRoom.update({ where: { id: first.id }, data: { adults: change.attendees } });
      await tx.reservation.update({ where: { id: r.id }, data: { adults: change.attendees } });
      after.attendees = change.attendees;
    }
    const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
    const patch = { companyName: text(change.companyName), specialRequests: text(change.specialRequests), internalNotes: text(change.internalNotes) };
    const changedText = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && v !== r[k as keyof typeof patch]));
    if (Object.keys(changedText).length) {
      await tx.reservation.update({ where: { id: r.id }, data: changedText });
      Object.assign(after, changedText);
    }
    if (Object.keys(after).length === 0) return { changed: false };

    await recalculateReservation(tx, r.id);
    await audit(tx, actor, { action: "meeting.changed", entityType: "Reservation", entityId: r.id, before, after });
    return { changed: true };
  });
}

const laterOf = (a: Date, b: Date) => (a.getTime() > b.getTime() ? a : b);

/** Change dates of a not-yet-arrived stay, or extend/shorten an in-house stay's departure. */
export async function changeStayDates(
  reservationRoomId: string,
  dates: { arrivalDate: BusinessDate; departureDate: BusinessDate },
  actor: Actor,
  opts: { roomId?: string | null; reason?: string | null; payment?: { accountId?: string | null; methodId?: string | null; reference?: string | null } | null } = {},
) {
  if (!isBusinessDate(dates.arrivalDate) || !isBusinessDate(dates.departureDate)) throw new AppError("Invalid dates.");
  await expireHoldsBeforeTaking({ id: reservationRoomId });
  return run((tx) => changeStayDatesTx(tx, reservationRoomId, dates, actor, opts));
}

export interface DateChangePreview {
  room: string;
  sameRoomFree: boolean;
  /** Other rooms free for the new dates (best first: same type, then others), with their price. */
  alternatives: { id: string; number: string; type: string; sameType: boolean; net: number }[];
  current: { arrival: BusinessDate; departure: BusinessDate; nights: number; roomNet: number; total: number; paid: number };
  proposed: { nights: number; roomNet: number; total: number };
  /** New total − old total (positive = guest pays more; negative = credit / refund per policy). */
  difference: number;
  balanceAfter: number;
  /** Night by night: what the booking has now, and what the new dates cost (each night priced by its own date's rules). */
  currentNights: NightLine[];
  newNights: NightLine[];
  /** What happens to money: extra to pay now, and money paid beyond the new price (hotel policy). */
  money: DateChangeMoney;
}

export interface NightLine { date: BusinessDate; base: number; discount: number; net: number; note: string | null }

export interface DateChangeMoney {
  additional: number; dueNow: number; excess: number;
  /** What happens to an excess: NO_REFUND = the price stays as paid; CREDIT = owed back / used later (a refund is a separate payment). */
  policy: "NO_REFUND" | "CREDIT"; kept: number;
}

/**
 * ReservationFinancialService rule for a date change. Money already paid never moves:
 *  - dearer: the extra (new total − old total, never the whole new total) is paid now when the hotel asks for it;
 *  - cheaper than what was paid: the hotel policy decides — keep the price as paid, or leave a credit.
 * In-house extensions are billed as usual (paid at checkout).
 */
export function dateChangeMoney(input: {
  oldTotal: number; newTotal: number; paid: number; billed: number; inHouse: boolean; billTo: string;
  settings: { dateChangePayNow: boolean; dateChangeExcessPolicy: string };
}): DateChangeMoney {
  const policy = input.settings.dateChangeExcessPolicy === "CREDIT" ? "CREDIT" : "NO_REFUND";
  const additional = Math.max(0, input.newTotal - input.oldTotal);
  const balanceAfter = input.newTotal - input.paid - input.billed;
  const payer = input.billTo === "GUEST" && !input.inHouse && input.paid > 0;
  const dueNow = payer && input.settings.dateChangePayNow ? Math.max(0, Math.min(additional, balanceAfter)) : 0;
  const excess = !input.inHouse && balanceAfter < 0 ? -balanceAfter : 0;
  const kept = policy === "NO_REFUND" ? Math.min(excess, Math.max(0, input.oldTotal - input.newTotal)) : 0;
  return { additional, dueNow, excess, policy, kept };
}

const nightLine = (n: { businessDate?: Date; date?: string; base?: number; grossAmount?: number; promoDiscount: number; manualDiscount: number; net?: number; netAmount?: number; promotionName?: string | null; priceRuleName?: string | null; promotion?: { name: string } | null; priceRule?: { name: string } | null }): NightLine => {
  const base = n.base ?? n.grossAmount ?? 0;
  const discount = n.promoDiscount + n.manualDiscount;
  const note = [n.priceRule?.name ?? n.priceRuleName, n.promotion?.name ?? n.promotionName, n.manualDiscount ? msg("discount") : null].filter(Boolean).join(" · ") || null;
  return { date: n.date ?? fromDbDate(n.businessDate!), base, discount, net: n.net ?? n.netAmount ?? base - discount, note };
};
const nightText = (l: NightLine) => `${l.date}: ${l.base.toLocaleString("en-US")}${l.discount ? ` − ${l.discount.toLocaleString("en-US")}` : ""} = ${l.net.toLocaleString("en-US")}${l.note ? ` (${l.note})` : ""}`;

/** What a date change would do: is the room free, which rooms are, and the price difference (system prices only). */
export async function previewDateChange(reservationRoomId: string, dates: { arrivalDate: BusinessDate; departureDate: BusinessDate }, roomId?: string | null): Promise<DateChangePreview> {
  const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const cfg = stayConfig(settings);
  const rr = await db.reservationRoom.findUnique({
    where: { id: reservationRoomId },
    include: { room: true, roomType: true, nightsLedger: true, reservation: { include: { source: true } } },
  });
  if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
  let stay: Stay;
  try { stay = overnightStay(dates, cfg); } catch (e) { if (e instanceof StayError) throw new AppError(e.localized ?? e.message); throw e; }
  const inHouse = rr.status === "CHECKED_IN";
  // In the hotel: only from now on matters (the nights already slept are history).
  const window = { ...stay, startAt: inHouse ? laterOf(rr.startAt, new Date()) : stay.startAt };
  const free = await findAvailableRooms({ stay: window, excludeReservationRoomId: rr.id });
  const types = await db.roomType.findMany({ select: { id: true, name: true, baseRate: true } });
  const typeOf = new Map(types.map((t) => [t.id, t]));
  // Nights already on the booking keep their price; new nights are priced by today's rules.
  const kept = new Map(rr.nightsLedger.map((n) => [fromDbDate(n.businessDate), n]));
  const nightsFor = async (roomTypeId: string, forRoomId: string): Promise<NightLine[]> => {
    const nights = stay.nightDates;
    const newOnes = nights.filter((d) => !(forRoomId === rr.roomId && kept.has(d)));
    const t = typeOf.get(roomTypeId)!;
    const q = newOnes.length ? await quoteStay(db, { dates: newOnes, base: t.baseRate, roomTypeId, roomId: forRoomId, channel: channelFor(rr.reservation.source.code), manual: rr.discountPerNight }) : { nights: [] };
    const priced = new Map(q.nights.map((n) => [n.date, nightLine(n)]));
    return nights.map((d) => (forRoomId === rr.roomId && kept.has(d) ? nightLine(kept.get(d)!) : priced.get(d)!));
  };
  const priceFor = async (roomTypeId: string, forRoomId: string) => (await nightsFor(roomTypeId, forRoomId)).reduce((t, n) => t + n.net, 0);
  const target = roomId ? free.find((f) => f.id === roomId) : null;
  const sameRoomFree = free.some((f) => f.id === rr.roomId);
  const chosen = target ?? (sameRoomFree ? { id: rr.roomId, roomTypeId: rr.roomTypeId } : null);
  const newNights = chosen ? await nightsFor(chosen.roomTypeId, chosen.id) : [];
  const roomNet = newNights.reduce((t, n) => t + n.net, 0);
  const others = free.filter((f) => f.id !== rr.roomId).sort((a, b) => Number(b.roomTypeId === rr.roomTypeId) - Number(a.roomTypeId === rr.roomTypeId)).slice(0, 8);
  const alternatives = await Promise.all(others.map(async (f) => ({
    id: f.id, number: f.number, type: typeOf.get(f.roomTypeId)?.name ?? "", sameType: f.roomTypeId === rr.roomTypeId, net: await priceFor(f.roomTypeId, f.id),
  })));
  const r = rr.reservation;
  const total = r.netAmount - rr.netAmount + roomNet;
  return {
    room: rr.room.number, sameRoomFree, alternatives,
    current: { arrival: fromDbDate(rr.arrivalDate), departure: fromDbDate(rr.departureDate), nights: rr.nights, roomNet: rr.netAmount, total: r.netAmount, paid: r.paidAmount },
    proposed: { nights: stay.nights, roomNet, total },
    difference: total - r.netAmount,
    balanceAfter: total - r.paidAmount - r.companyBilledAmount,
    currentNights: [...rr.nightsLedger].sort((a, b) => a.businessDate.getTime() - b.businessDate.getTime()).map(nightLine),
    newNights,
    money: dateChangeMoney({ oldTotal: r.netAmount, newTotal: total, paid: r.paidAmount, billed: r.companyBilledAmount, inHouse, billTo: r.billTo, settings }),
  };
}

async function changeStayDatesTx(
  tx: Tx,
  reservationRoomId: string,
  dates: { arrivalDate: BusinessDate; departureDate: BusinessDate },
  actor: Actor,
  opts: { roomId?: string | null; reason?: string | null; payment?: { accountId?: string | null; methodId?: string | null; reference?: string | null } | null } = {},
) {
  {
    const settings = await getSettingsTx(tx);
    const cfg = stayConfig(settings);
    const today = businessDateOf(new Date(), cfg);
    const rr = await tx.reservationRoom.findUnique({ where: { id: reservationRoomId }, include: { room: true, reservation: true, nightsLedger: { orderBy: { businessDate: "asc" } } } });
    if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
    if (rr.isDayUse) throw new AppError("Short-time bookings cannot change dates; cancel and rebook instead.");
    // (Booked to pay later — no room held — its dates change too: the room is still checked for the new dates.)
    if (!ACTIVE_STATUSES.includes(rr.status) && rr.status !== "INQUIRY") throw new AppError("Only active stays can change dates.");
    const inHouse = rr.status === "CHECKED_IN";
    if (inHouse && dates.arrivalDate !== fromDbDate(rr.arrivalDate)) throw new AppError("The guest is in-house; only the departure date can change.");
    if (!inHouse && dates.arrivalDate < today) throw new AppError("Arrival cannot be in the past.");
    if (inHouse && dates.departureDate <= today) throw new AppError("To end the stay today, check the guest out instead.");
    if (inHouse && opts.roomId && opts.roomId !== rr.roomId) throw new AppError("To move an in-house guest, use “Change room”.");

    let stay: Stay;
    try {
      stay = overnightStay(dates, cfg);
    } catch (e) {
      if (e instanceof StayError) throw new AppError(e.localized ?? e.message);
      throw e;
    }
    const targetRoom = opts.roomId && opts.roomId !== rr.roomId
      ? await tx.room.findUnique({ where: { id: opts.roomId }, include: { roomType: true } })
      : null;
    if (opts.roomId && opts.roomId !== rr.roomId && (!targetRoom || !targetRoom.isActive)) throw new AppError("Room not found.", "NOT_FOUND");
    await lockRoomTypes(tx, [rr.roomTypeId, ...(targetRoom ? [targetRoom.roomTypeId] : [])]);
    // In the hotel: only from now on matters — after a move, the new room may have had someone in it earlier in the stay.
    const window = { ...stay, startAt: inHouse ? laterOf(rr.startAt, new Date()) : stay.startAt };
    const roomId = targetRoom?.id ?? rr.roomId;
    const free = await findAvailableRooms({ stay: window, roomIds: [roomId], excludeReservationRoomId: rr.id }, tx);
    if (free.length === 0) {
      throw new AppError(msgf("Room {room} is not available for {from} → {to}. Choose one of the free rooms.", { room: targetRoom?.number ?? rr.room.number, from: stay.arrivalDate, to: stay.departureDate }), "UNAVAILABLE");
    }

    const before = {
      room: rr.room.number, arrival: fromDbDate(rr.arrivalDate), departure: fromDbDate(rr.departureDate), nights: rr.nights, net: rr.reservation.netAmount, paid: rr.reservation.paidAmount,
      nightPrices: rr.nightsLedger.map((n) => nightText(nightLine(n))),
    };
    await tx.reservationRoom.update({
      where: { id: rr.id },
      data: {
        startAt: window.startAt, endAt: stay.endAt,
        arrivalDate: toDbDate(stay.arrivalDate), departureDate: toDbDate(stay.departureDate), nights: stay.nights,
        ...(targetRoom && { roomId: targetRoom.id, roomTypeId: targetRoom.roomTypeId, ratePerNight: targetRoom.roomType.baseRate }),
      },
    });
    if (targetRoom) {
      await tx.roomAssignment.create({ data: { reservationRoomId: rr.id, fromRoomId: rr.roomId, toRoomId: targetRoom.id, reason: opts.reason?.trim() || "Date change", changedById: actor.userId ?? null } });
    }
    // Prices come from the system: nights kept keep their price, each new night is priced by its own date's
    // rules (date price, promotion). Payments are never edited — only an extra payment or a kept difference is added.
    await syncRoomNights(tx, rr.id);
    await recalculateReservation(tx, rr.reservationId);
    const mid = await tx.reservation.findUniqueOrThrow({ where: { id: rr.reservationId } });
    const money = dateChangeMoney({ oldTotal: before.net, newTotal: mid.netAmount, paid: mid.paidAmount, billed: mid.companyBilledAmount, inHouse, billTo: mid.billTo, settings });
    if (money.dueNow > 0) {
      if (!opts.payment) throw new AppError(msgf("The new dates cost TZS {amount} more. Receive the extra payment to change the dates.", { amount: money.additional.toLocaleString("en-TZ") }), "VALIDATION", { payment: "Required" });
      await recordPaymentTx(tx, { reservationId: rr.reservationId, amount: money.dueNow, accountId: opts.payment.accountId, methodId: opts.payment.methodId, reference: opts.payment.reference ?? null, notes: "Date change — extra for the new dates" }, actor);
    }
    if (money.kept > 0) {
      // Hotel policy: no refund — the price stays as paid; the difference is shown as its own line.
      await tx.reservationCharge.create({
        data: {
          reservationId: rr.reservationId, amount: money.kept, kind: "OTHER", category: "DATE_CHANGE_KEPT",
          description: `Date change: new dates TZS ${money.kept.toLocaleString("en-US")} cheaper — price kept as paid (no refund)`,
          businessDate: toDbDate(today), createdById: actor.userId ?? null,
        },
      });
      await recalculateReservation(tx, rr.reservationId);
    }
    const nightsAfter = (await tx.roomNight.findMany({ where: { reservationRoomId: rr.id }, orderBy: { businessDate: "asc" } })).map(nightLine);
    const after = await tx.reservation.findUniqueOrThrow({ where: { id: rr.reservationId } });
    await audit(tx, actor, {
      action: "reservation.dates_changed", entityType: "Reservation", entityId: rr.reservationId,
      before,
      after: {
        room: targetRoom?.number ?? rr.room.number, arrival: stay.arrivalDate, departure: stay.departureDate, nights: stay.nights,
        net: mid.netAmount, paid: after.paidAmount, difference: mid.netAmount - before.net,
        additionalPaid: money.dueNow, excess: money.excess, excessPolicy: money.excess ? (money.policy === "NO_REFUND" ? "Price kept as paid (no refund)" : "Credit — refund only as a separate payment") : null,
        nightPrices: nightsAfter.map(nightText),
        reason: opts.reason?.trim() || "Customer requested date change",
      },
    });
  }
}

/** Authorised discount override on one room of a booking (audited). */
export async function changeDiscount(reservationRoomId: string, discountPerNight: number, reasonIn: string, actor: Actor) {
  if (discountPerNight > 0) assertManualDiscount(discountPerNight, actor, await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } }));
  const reason = reasonIn.trim() || "Discount given at the desk";
  return run(async (tx) => {
    const rr = await tx.reservationRoom.findUnique({ where: { id: reservationRoomId }, include: { room: true } });
    if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
    if (!["INQUIRY", "RESERVED", "CONFIRMED", "CHECKED_IN"].includes(rr.status)) throw new AppError("Discounts can only change on open stays.");
    const quote = quoteRoom({ ratePerNight: rr.ratePerNight, discountPerNight, units: rr.isDayUse ? 1 : rr.nights });
    await tx.reservationRoom.update({
      where: { id: rr.id },
      data: {
        discountPerNight: quote.discountPerNight, discountOverridden: true, discountReason: reason.trim(), discountSetById: actor.userId ?? null, discountSetAt: new Date(),
        grossAmount: quote.grossAmount, discountAmount: quote.discountAmount, netAmount: quote.netAmount,
      },
    });
    await syncRoomNights(tx, rr.id);
    await recalculateReservation(tx, rr.reservationId);
    await audit(tx, actor, {
      action: "reservation.discount_changed", entityType: "Reservation", entityId: rr.reservationId,
      before: { room: rr.room.number, discountPerNight: rr.discountPerNight, net: rr.netAmount },
      after: { room: rr.room.number, discountPerNight: quote.discountPerNight, net: quote.netAmount, reason },
    });
  });
}

async function run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
  } catch (e) {
    translateDbError(e);
  }
}

// ───────────────────────── Extend stay / late checkout / check-in details ─────────────────────────

export interface ExtensionPreview {
  room: string;
  currentDeparture: BusinessDate;
  newDeparture: BusinessDate;
  extraNights: number;
  netPerNight: number;
  extraAmount: number;
  /** Each new night's price (today's prices; the booked nights keep theirs). */
  nightPrices: { date: BusinessDate; base: number; promotion: string | null; promoDiscount: number; manualDiscount: number; net: number }[];
  currentRoomAvailable: boolean;
  /** Free rooms when the guest's room is taken — the same type and price first. `extraAmount`: the new nights in that room. */
  alternatives: { id: string; number: string; type: string; baseRate: number; sameType: boolean; extraAmount: number; perNight: number }[];
}

/** What extending to `newDeparture` would cost, and whether the current room is free (with alternatives if not). */
export async function previewExtension(reservationRoomId: string, newDeparture: BusinessDate): Promise<ExtensionPreview> {
  if (!isBusinessDate(newDeparture)) throw new AppError("Choose a valid date.");
  const rr = await db.reservationRoom.findUnique({ where: { id: reservationRoomId }, include: { room: true } });
  if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
  if (rr.isDayUse) throw new AppError("Short-time stays cannot be extended; book a new stay instead.");
  if (!ACTIVE_STATUSES.includes(rr.status)) throw new AppError("Only active stays can be extended.");
  const current = fromDbDate(rr.departureDate);
  if (newDeparture <= current) throw new AppError("The new checkout date must be after the current one.");
  const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const cfg = stayConfig(settings);
  const extra = overnightStay({ arrivalDate: current, departureDate: newDeparture }, cfg);
  const window = { ...extra, startAt: rr.endAt < extra.startAt ? rr.endAt : extra.startAt };
  const [mine, others, types, roomType, source] = await Promise.all([
    findAvailableRooms({ stay: window, roomIds: [rr.roomId], excludeReservationRoomId: rr.id }),
    findAvailableRooms({ stay: { ...window, startAt: rr.status === "CHECKED_IN" ? new Date() : rr.startAt } }),
    db.roomType.findMany({ select: { id: true, name: true, baseRate: true } }),
    db.roomType.findUniqueOrThrow({ where: { id: rr.roomTypeId }, select: { baseRate: true } }),
    db.reservation.findUniqueOrThrow({ where: { id: rr.reservationId }, select: { source: { select: { code: true } } } }),
  ]);
  // New nights are priced at today's price and promotions; the nights already booked keep theirs.
  const q = await quoteStay(db, {
    dates: eachDate(current, newDeparture), base: roomType.baseRate, roomTypeId: rr.roomTypeId, roomId: rr.roomId,
    channel: channelFor(source.source.code), manual: rr.discountPerNight,
  });
  const netPerNight = q.nights[0]?.net ?? 0;
  const typeById = new Map(types.map((t) => [t.id, t]));
  // The guest's room is taken for those nights: every free ready room, priced for the new nights (same type, then the
  // same price, then the rest by price) — a dearer room can be chosen; its nights cost its price.
  const free = mine.length > 0 ? [] : others.filter((o) => o.id !== rr.roomId && ["AVAILABLE", "READY"].includes(o.status));
  const priceOf = new Map<string, { net: number; perNight: number }>();
  for (const typeId of new Set(free.map((o) => o.roomTypeId))) {
    const t = typeById.get(typeId);
    if (!t) continue;
    const tq = typeId === rr.roomTypeId ? q : await quoteStay(db, { dates: eachDate(current, newDeparture), base: t.baseRate, roomTypeId: typeId, roomId: null, channel: channelFor(source.source.code), manual: rr.discountPerNight });
    priceOf.set(typeId, { net: tq.net, perNight: tq.nights[0]?.net ?? 0 });
  }
  const alternatives = free
    .map((o) => ({ id: o.id, number: o.number, type: typeById.get(o.roomTypeId)?.name ?? "", baseRate: typeById.get(o.roomTypeId)?.baseRate ?? 0, sameType: o.roomTypeId === rr.roomTypeId, extraAmount: priceOf.get(o.roomTypeId)?.net ?? 0, perNight: priceOf.get(o.roomTypeId)?.perNight ?? 0 }))
    .sort((a, b) => Number(b.sameType) - Number(a.sameType) || Number(b.baseRate === roomType.baseRate) - Number(a.baseRate === roomType.baseRate) || a.baseRate - b.baseRate || a.type.localeCompare(b.type) || a.number.localeCompare(b.number, undefined, { numeric: true }))
    // A few of each type, so the dearer (and cheaper) rooms are always there to choose.
    .filter((o, i, all) => all.slice(0, i).filter((x) => x.type === o.type).length < 4);
  return {
    room: rr.room.number,
    currentDeparture: current,
    newDeparture,
    extraNights: extra.nights,
    netPerNight,
    extraAmount: q.net,
    nightPrices: q.nights.map((n) => ({ date: n.date, base: n.base, promotion: n.promotion?.name ?? null, promoDiscount: n.promoDiscount, manualDiscount: n.manualDiscount, net: n.net })),
    currentRoomAvailable: mine.length > 0,
    alternatives,
  };
}

/**
 * Extend a stay. Booked nights keep their price; the new nights are priced at today's
 * prices and promotions (with the guest's negotiated discount). Rechecks availability inside the transaction
 * (via changeStayDates) and, if the current room is taken, first moves the guest to `moveToRoomId`.
 * The reservation, room-night ledger, folio, invoice and balance all update together.
 */
export async function extendStay(
  reservationRoomId: string, newDeparture: BusinessDate, actor: Actor, opts: { moveToRoomId?: string | null; reason?: string | null } = {},
) {
  const rr = await db.reservationRoom.findUnique({ where: { id: reservationRoomId } });
  if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
  const preview = await previewExtension(reservationRoomId, newDeparture);
  if (!preview.currentRoomAvailable && !opts.moveToRoomId) {
    throw new AppError(msgf("Room {room} is not available for the requested extension. Choose another room or cancel the extension.", { room: preview.room }), "UNAVAILABLE");
  }
  // A guest in the hotel whose room is booked next moves with everything (their bill, charges, payments — the same
  // booking) to the free room chosen; the nights already slept stay with the old room, the new ones cost the new room's price.
  // Move & extend is one transaction: either the guest is moved AND extended, or nothing changes.
  await run(async (tx) => {
    if (!preview.currentRoomAvailable) {
      await reassignRoomTx(tx, reservationRoomId, opts.moveToRoomId!, actor, opts.reason ?? "Room change for stay extension");
    }
    await changeStayDatesTx(tx, reservationRoomId, { arrivalDate: fromDbDate(rr.arrivalDate), departureDate: newDeparture }, actor);
    await audit(tx, actor, {
      action: "reservation.extended", entityType: "Reservation", entityId: rr.reservationId,
      before: { departure: preview.currentDeparture }, after: { departure: newDeparture, extraNights: preview.extraNights, extraAmount: preview.extraAmount, movedTo: opts.moveToRoomId ?? null },
    });
  });
  return preview;
}

/**
 * A manager / the MD / the owner gives a guest extra nights on the house: the stay is extended in the
 * same room and the new nights cost nothing (kept as complimentary nights, with who and why) — the
 * room stays taken, occupancy counts them, the bill does not change.
 */
/** Split `total` over `weights` in proportion, in whole shillings (largest remainder). */
function share(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}

/**
 * A manager (the MD, the owner) takes money off a guest's WHOLE bill — room nights and everything
 * charged to the room (restaurant, bar, room service, transport…). TZS or %, up to what is still to
 * pay, with the reason. It is split in proportion so each department's income stays right: the
 * room's share comes off the nights (as a discount on each), the rest as credit lines on the bill
 * (one per kind). Recorded with who, role, before / after, when and why.
 */
export async function discountStayBill(reservationId: string, input: { amount?: number | null; percent?: number | null; reason: string }, actor: Actor, now = new Date()) {
  if (!["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => actor.permissions?.has(p as never))) {
    throw new AppError("Only a manager, the MD or the owner gives a discount on the whole bill.", "FORBIDDEN");
  }
  const why = input.reason.trim();
  if (why.length < 3) throw new AppError("Say why the discount is given.", "VALIDATION", { reason: "Required" });
  return run(async (tx) => {
    const r = await loadForUpdate(tx, reservationId);
    if (["CANCELLED", "NO_SHOW", "INQUIRY"].includes(r.status)) throw new AppError("This booking has no bill to discount.");
    const invoiced = await tx.invoice.count({ where: { reservationId: r.id, status: { notIn: ["DRAFT", "CANCELLED", "VOID"] } } })
      + await tx.invoiceItem.count({ where: { reservationId: r.id, invoice: { status: { notIn: ["DRAFT", "CANCELLED", "VOID"] } } } });
    if (invoiced) throw new AppError("This bill is already on an invoice — change the invoice instead (Invoices).", "CONFLICT");
    const fresh = await tx.reservation.findUniqueOrThrow({ where: { id: r.id } });
    // A percent is of what is still to pay (like a table's bill).
    const amount = input.percent ? Math.round((fresh.balanceAmount * Math.min(100, input.percent)) / 100) : Math.round(input.amount ?? 0);
    if (amount <= 0) throw new AppError("Enter the discount.", "VALIDATION", { amount: "Required" });
    if (amount > fresh.balanceAmount) throw new AppError(msgf("The guest only owes TZS {amount} — a discount can't be more than what is still to pay.", { amount: fresh.balanceAmount.toLocaleString("en-TZ") }), "VALIDATION", { amount: msg("Too much") });

    // What the bill is made of: each night (room income) and the charges by kind.
    const nights = await tx.roomNight.findMany({ where: { reservationRoom: { reservationId: r.id }, complimentary: false, netAmount: { gt: 0 } } });
    const charges = await tx.reservationCharge.groupBy({ by: ["kind"], where: { reservationId: r.id, isVoided: false }, _sum: { amount: true } });
    const kinds = charges.map((c) => ({ kind: c.kind, total: c._sum.amount ?? 0 })).filter((c) => c.total > 0);
    const roomTotal = nights.reduce((t, n) => t + n.netAmount, 0);
    const [roomShare, ...kindShares] = share(amount, [roomTotal, ...kinds.map((k) => k.total)]);

    // The room's share, night by night.
    const perNight = share(roomShare, nights.map((n) => n.netAmount));
    const touched = new Set<string>();
    for (const [i, n] of nights.entries()) {
      if (!perNight[i]) continue;
      await tx.roomNight.update({ where: { id: n.id }, data: { billDiscount: n.billDiscount + perNight[i] } });
      touched.add(n.reservationRoomId);
    }
    for (const id of touched) await syncRoomNights(tx, id);

    // The rest as credit lines, one per kind (restaurant, bar, room service, transport, other).
    const settings = await getSettingsTx(tx);
    const today = businessDateOf(now, stayConfig(settings));
    const who = `${actor.label ?? "Manager"}${actor.role ? ` (${actor.role})` : ""}`;
    const WORD: Record<string, string> = { RESTAURANT: "food", BAR: "drinks", ROOM_SERVICE: "room service", TRANSPORT: "transport", OTHER: "extras" };
    for (const [i, k] of kinds.entries()) {
      if (!kindShares[i]) continue;
      await tx.reservationCharge.create({
        data: {
          reservationId: r.id, amount: -kindShares[i], kind: k.kind, category: "BILL_DISCOUNT",
          description: `Discount on ${WORD[k.kind] ?? "extras"} — ${why} (${who})`, businessDate: toDbDate(today), createdById: actor.userId ?? null,
        },
      });
    }
    await recalculateReservation(tx, r.id);
    const after = await tx.reservation.findUniqueOrThrow({ where: { id: r.id } });
    const split = { rooms: roomShare, ...Object.fromEntries(kinds.map((k, i) => [k.kind.toLowerCase(), kindShares[i]])) };
    await audit(tx, actor, {
      action: "reservation.bill_discounted", entityType: "Reservation", entityId: r.id,
      before: { bill: fresh.netAmount, toPay: fresh.balanceAmount },
      after: { bill: after.netAmount, toPay: after.balanceAmount, amount, percent: input.percent ?? null, reason: why, role: actor.role ?? null, split },
    });
    return { amount, bill: after.netAmount, toPay: after.balanceAmount, split };
  });
}

/**
 * A manager (the MD, the owner) lets a guest check out still owing — up to what they owe now,
 * with the reason. Reception then checks them out without a manager at the desk; the balance
 * stays on the guest (Who owes us). Recorded with who, why and when.
 */
export async function approveLeaveOwing(reservationId: string, reason: string, actor: Actor, now = new Date()) {
  if (!["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => actor.permissions?.has(p as never)) || !actor.permissions?.has("reservations.checkout_override")) {
    throw new AppError("Only a manager, the MD or the owner lets a guest leave owing.", "FORBIDDEN");
  }
  const why = reason.trim();
  if (why.length < 3) throw new AppError("Say why the guest may leave owing (e.g. company will pay Friday).", "VALIDATION", { reason: "Required" });
  return run(async (tx) => {
    const r = await tx.reservation.findUnique({ where: { id: reservationId }, include: { rooms: { select: { status: true } } } });
    if (!r) throw new AppError("Booking not found.", "NOT_FOUND");
    if (!r.rooms.some((x) => x.status === "CHECKED_IN")) throw new AppError("Only a guest staying now can be allowed to leave owing.");
    if (r.balanceAmount <= 0) throw new AppError("This guest owes nothing.");
    await tx.reservation.update({ where: { id: r.id }, data: { leaveOwingUpTo: r.balanceAmount, leaveOwingReason: why, leaveOwingAt: now, leaveOwingById: actor.userId ?? null } });
    await audit(tx, actor, {
      action: "reservation.leave_owing_approved", entityType: "Reservation", entityId: r.id,
      before: { balance: r.balanceAmount, approved: r.leaveOwingUpTo }, after: { upTo: r.balanceAmount, reason: why },
    });
    return { upTo: r.balanceAmount };
  });
}

/** Withdraw the approval — the guest must pay before checking out again. */
export async function withdrawLeaveOwing(reservationId: string, actor: Actor) {
  if (!["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => actor.permissions?.has(p as never))) throw new AppError("Only a manager, the MD or the owner can change this.", "FORBIDDEN");
  return run(async (tx) => {
    const r = await tx.reservation.findUnique({ where: { id: reservationId } });
    if (!r?.leaveOwingAt) throw new AppError("There is no approval to withdraw.");
    await tx.reservation.update({ where: { id: r.id }, data: { leaveOwingUpTo: null, leaveOwingReason: null, leaveOwingAt: null, leaveOwingById: null } });
    await audit(tx, actor, { action: "reservation.leave_owing_withdrawn", entityType: "Reservation", entityId: r.id, before: { upTo: r.leaveOwingUpTo, reason: r.leaveOwingReason } });
  });
}

export async function extendStayFree(reservationRoomId: string, newDeparture: BusinessDate, reason: string, actor: Actor) {
  if (!["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => actor.permissions?.has(p as never))) {
    throw new AppError("Only a manager, the MD or the owner gives free nights.", "FORBIDDEN");
  }
  const why = reason.trim();
  if (why.length < 3) throw new AppError("Say why the nights are free.", "VALIDATION", { reason: "Required" });
  const rr = await db.reservationRoom.findUnique({ where: { id: reservationRoomId } });
  if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
  const preview = await previewExtension(reservationRoomId, newDeparture);
  if (!preview.currentRoomAvailable) throw new AppError(msgf("Room {room} is booked after the current checkout — free nights can only be given in the same room.", { room: preview.room }), "UNAVAILABLE");
  await run(async (tx) => {
    await changeStayDatesTx(tx, reservationRoomId, { arrivalDate: fromDbDate(rr.arrivalDate), departureDate: newDeparture }, actor);
    await tx.roomNight.updateMany({
      where: { reservationRoomId, businessDate: { gte: toDbDate(preview.currentDeparture), lt: toDbDate(newDeparture) } },
      data: { complimentary: true, compReason: why, compById: actor.userId ?? null },
    });
    await syncRoomNights(tx, reservationRoomId);
    await recalculateReservation(tx, rr.reservationId);
    await audit(tx, actor, {
      action: "reservation.extended_free", entityType: "Reservation", entityId: rr.reservationId,
      before: { departure: preview.currentDeparture }, after: { departure: newDeparture, freeNights: preview.extraNights, worth: preview.extraAmount, reason: why },
    });
  });
  return preview;
}

/** Approve a late checkout: extends today's departure time, optionally charging the configured/entered fee. */
export async function approveLateCheckout(
  reservationRoomId: string, input: { until: string; fee?: number | null; note?: string | null }, actor: Actor,
) {
  return run(async (tx) => {
    const settings = await getSettingsTx(tx);
    const cfg = stayConfig(settings);
    const rr = await tx.reservationRoom.findUnique({ where: { id: reservationRoomId }, include: { room: true } });
    if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
    if (rr.status !== "CHECKED_IN") throw new AppError("Late checkout applies to guests currently in house.");
    let until: Date;
    try {
      until = zonedInstant(fromDbDate(rr.departureDate), parseTimeToMinutes(input.until), cfg.timezone);
    } catch {
      throw new AppError("Enter a valid time (HH:MM).", "VALIDATION", { until: "Invalid" });
    }
    if (until <= rr.endAt) throw new AppError(msgf("Standard checkout is already {time} or later.", { time: input.until }));
    const dayEnd = zonedInstant(addDays(fromDbDate(rr.departureDate), 1), cfg.businessDayStartMinutes, cfg.timezone);
    if (until >= dayEnd) throw new AppError("That is past the end of the hotel day — extend the stay by a night instead.");
    const clash = await findAvailableRooms({
      stay: { startAt: rr.endAt, endAt: until, arrivalDate: fromDbDate(rr.departureDate), departureDate: fromDbDate(rr.departureDate), isDayUse: true },
      roomIds: [rr.roomId], excludeReservationRoomId: rr.id,
    }, tx);
    if (clash.length === 0) throw new AppError(msgf("Room {room} is booked for another guest from this afternoon. Offer a later time elsewhere or a room change.", { room: rr.room.number }), "UNAVAILABLE");
    const fee = input.fee ?? settings.lateCheckoutFee;
    if (!Number.isInteger(fee) || fee < 0) throw new AppError("Enter a valid fee.");
    await tx.reservationRoom.update({ where: { id: rr.id }, data: { endAt: until, lateCheckoutUntil: until, lateCheckoutNote: input.note?.trim() || null } });
    if (fee > 0) {
      await tx.reservationCharge.create({
        data: {
          reservationId: rr.reservationId, amount: fee, category: "LATE_CHECKOUT", kind: "OTHER",
          description: `Late checkout until ${input.until} — room ${rr.room.number}`,
          businessDate: toDbDate(businessDateOf(new Date(), cfg)), createdById: actor.userId ?? null,
        },
      });
    }
    await recalculateReservation(tx, rr.reservationId);
    await audit(tx, actor, {
      action: "reservation.late_checkout", entityType: "Reservation", entityId: rr.reservationId,
      before: { checkout: rr.endAt }, after: { checkout: until, fee, approvedBy: actor.label, note: input.note ?? null },
    });
  });
}

export interface WelcomeChecklist {
  guestVerified?: boolean; roomReady?: boolean; keyIssued?: boolean; wifiGiven?: boolean; breakfastExplained?: boolean;
  facilitiesExplained?: boolean; requestsConfirmed?: boolean; transportConfirmed?: boolean;
}

/** Check-in wizard: fill missing guest details, save the welcome checklist, then check in — one transaction chain. */
export async function checkInWithDetails(
  reservationId: string,
  input: { guest: { fullName: string; phone?: string | null; email?: string | null; idType?: string | null; idNumber?: string | null; nationality?: string | null; address?: string | null }; checklist: WelcomeChecklist; eta?: string | null },
  actor: Actor,
  now = new Date(),
) {
  const r = await db.reservation.findUnique({ where: { id: reservationId }, include: { guest: true } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  if (!input.guest.fullName?.trim()) throw new AppError("Guest name is required.", "VALIDATION", { fullName: "Required" });
  if (!input.checklist.guestVerified) throw new AppError("Verify the guest's ID before checking in.", "VALIDATION", { guestVerified: "Required" });
  const before = { fullName: r.guest.fullName, phone: r.guest.phone, email: r.guest.email, idType: r.guest.idType, idNumber: r.guest.idNumber, nationality: r.guest.nationality };
  const next = {
    fullName: input.guest.fullName.trim(),
    phone: normalizePhone(input.guest.phone) ?? r.guest.phone,
    email: input.guest.email?.trim().toLowerCase() || r.guest.email,
    idType: input.guest.idType?.trim() || r.guest.idType,
    idNumber: input.guest.idNumber?.trim() || r.guest.idNumber,
    nationality: input.guest.nationality?.trim() || r.guest.nationality,
    address: input.guest.address?.trim() || r.guest.address,
  };
  await db.$transaction(async (tx) => {
    await tx.guest.update({ where: { id: r.guestId }, data: next });
    await tx.reservation.update({ where: { id: r.id }, data: { welcomeChecklist: input.checklist as object, eta: input.eta ?? r.eta } });
    const changed = (Object.keys(before) as (keyof typeof before)[]).some((k) => before[k] !== next[k]);
    if (changed) {
      await audit(tx, actor, { action: "guest.updated_at_checkin", entityType: "Guest", entityId: r.guestId, before, after: next });
    }
  });
  return checkIn(reservationId, actor, null, now);
}
