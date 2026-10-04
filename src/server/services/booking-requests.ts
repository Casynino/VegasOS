import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { getSettings, getSettingsTx, stayConfig } from "../settings";
import { findAvailableRooms } from "./availability";
import { meetingStay, overnightStay, StayError, type Stay } from "@/lib/time/stay";
import { timeRange } from "@/lib/meeting";
import { resolveGuest } from "./guests";
import { createReservation, type Actor } from "./reservations";
import { requestTransportForReservation } from "./transport";
import { distributeGuests, quoteSelection, WEBSITE_SOURCE, type PickupRequest, type Selection } from "./public-booking";
import { businessDateOf, fromDbDate, isBusinessDate, parseTimeToMinutes, toDbDate, zonedInstant, type BusinessDate } from "@/lib/time/business-date";
import type { BookingRequestStatus } from "@/generated/prisma/enums";

/**
 * BookingRequestService — the public website creates *requests*, never
 * reservations. Staff review, contact the customer and convert a request into
 * a Reservation through the single reservation engine, which re-checks
 * availability and price at that moment. Requests never hold inventory.
 */

const OPEN: BookingRequestStatus[] = ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED"];
const NEXT: Record<BookingRequestStatus, BookingRequestStatus[]> = {
  NEW: ["REVIEWING", "CONTACTED", "CONFIRMED", "REJECTED", "CANCELLED"],
  REVIEWING: ["CONTACTED", "CONFIRMED", "REJECTED", "CANCELLED"],
  CONTACTED: ["REVIEWING", "CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["CONTACTED", "REJECTED", "CANCELLED"],
  REJECTED: ["REVIEWING"],
  CANCELLED: ["REVIEWING"],
  CONVERTED: [],
};

function requestRef() {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return `VLH-REQ-${Array.from(randomBytes(5), (b) => a[b % a.length]).join("")}`;
}

export interface RequestCustomer {
  fullName: string;
  phone: string;
  email?: string | null;
  nationality?: string | null;
  specialRequests?: string | null;
  notes?: string | null;
  expectedArrivalTime?: string | null;
}

/** Public website submission. Validates dates/room/capacity and prices server-side; does not block rooms. */
export async function submitBookingRequest(
  sel: Selection, customer: RequestCustomer, ipAddress: string | null, pickup?: PickupRequest | null,
  /** Staff logging a request received by WhatsApp/phone. */
  staff?: { sourceCode: string; actor: StaffActor },
) {
  const quote = await quoteSelection(sel); // live availability + server price (throws UNAVAILABLE if sold out)
  if (customer.expectedArrivalTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(customer.expectedArrivalTime)) {
    throw new AppError("Enter a valid arrival time.", "VALIDATION", { expectedArrivalTime: "Invalid" });
  }
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const source = await tx.bookingSource.findUnique({ where: { code: staff?.sourceCode ?? WEBSITE_SOURCE } });
    if (!source || !source.isActive) throw new AppError("Choose a valid booking source.");
    // Match an existing customer by phone/email rather than creating duplicates.
    const guestId = await resolveGuest(tx, { fullName: customer.fullName, phone: customer.phone, email: customer.email, nationality: customer.nationality });
    const req = await tx.bookingRequest.create({
      data: {
        reference: requestRef(),
        manageToken: randomBytes(24).toString("base64url"),
        sourceId: source.id,
        guestId,
        fullName: customer.fullName.trim(),
        phone: (await tx.guest.findUniqueOrThrow({ where: { id: guestId } })).phone ?? customer.phone.trim(),
        email: customer.email?.trim().toLowerCase() || null,
        nationality: customer.nationality?.trim() || null,
        checkInDate: toDbDate(sel.checkIn),
        checkOutDate: toDbDate(sel.checkOut),
        expectedArrivalTime: customer.expectedArrivalTime || null,
        roomTypeId: quote.type.id,
        roomCount: sel.rooms,
        adults: sel.adults,
        children: sel.children,
        specialRequests: customer.specialRequests?.trim() || null,
        notes: customer.notes?.trim() || null,
        transportRequested: !!pickup,
        transportDetails: pickup ? { ...pickup, flightNumber: pickup.flightNumber.toUpperCase() } : undefined,
        estimatedNet: quote.netAmount,
        ipAddress,
        businessDate: toDbDate(businessDateOf(new Date(), stayConfig(settings))),
        ...(staff && { assignedToId: staff.actor.userId }),
      },
    });
    await tx.bookingRequestEvent.create({
      data: { requestId: req.id, type: "SUBMITTED", toStatus: "NEW", note: staff ? `Logged by staff (${source.name})` : "Submitted on the website", actorId: staff?.actor.userId ?? null },
    });
    await audit(tx, staff?.actor ?? { label: "website", ipAddress }, {
      action: "booking_request.submitted", entityType: "BookingRequest", entityId: req.id,
      after: { reference: req.reference, roomType: quote.type.name, rooms: sel.rooms, checkIn: sel.checkIn, checkOut: sel.checkOut, estimate: quote.netAmount },
    });
    return { id: req.id, reference: req.reference, manageToken: req.manageToken };
  });
}

// ───────────────────────────── Meeting room (website) ─────────────────────────────

/** The meeting room(s) the website offers: price and capacity come from the room type. */
export async function publicMeetingRoom() {
  return db.roomType.findFirst({
    where: { category: "MEETING_ROOM", isActive: true, isPublic: true, rooms: { some: { isActive: true } } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, baseRate: true, maxAdults: true, shortDescription: true, description: true, images: true },
  });
}

/** A meeting day + start/end (hotel time) as a stay; friendly errors. */
async function meetingWindow(date: string, start: string, end: string): Promise<Stay> {
  const settings = await getSettings();
  const cfg = stayConfig(settings);
  if (!isBusinessDate(date)) throw new AppError("Choose a date.", "VALIDATION", { date: "Required" });
  let stay: Stay;
  try {
    stay = meetingStay({
      startAt: zonedInstant(date, parseTimeToMinutes(start), settings.timezone),
      endAt: zonedInstant(date, parseTimeToMinutes(end), settings.timezone),
    }, cfg);
  } catch (e) {
    if (e instanceof StayError) throw new AppError(e.message, "VALIDATION");
    throw new AppError("Choose a start and an end time.", "VALIDATION");
  }
  const today = businessDateOf(new Date(), cfg);
  if (stay.arrivalDate < today || stay.startAt <= new Date()) throw new AppError("Please choose a time in the future.", "VALIDATION", { date: "In the past" });
  return stay;
}

/**
 * Website "check availability" for the meeting room: free or not for the asked
 * time, and the day's booked times (no names) so the customer can pick another.
 */
export async function meetingAvailability(input: { date: string; start: string; end: string }) {
  const type = await publicMeetingRoom();
  if (!type) throw new AppError("The meeting room cannot be booked online right now — please call us.", "UNAVAILABLE");
  const stay = await meetingWindow(input.date, input.start, input.end);
  const [free, day] = await Promise.all([
    findAvailableRooms({ stay, roomTypeId: type.id, category: "MEETING_ROOM" }),
    db.reservationRoom.findMany({
      where: { roomTypeId: type.id, arrivalDate: toDbDate(stay.arrivalDate), status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } },
      select: { startAt: true, endAt: true }, orderBy: { startAt: "asc" },
    }),
  ]);
  return { available: free.length > 0, price: type.baseRate, capacity: type.maxAdults, booked: day.map((x) => timeRange(x.startAt, x.endAt)) };
}

/** Is the meeting room still free for a request's time? null when the time has passed. */
export async function meetingRequestFree(r: { meetingStartAt: Date; meetingEndAt: Date; roomTypeId: string }) {
  if (r.meetingEndAt <= new Date()) return null;
  const cfg = stayConfig(await getSettings());
  const stay = meetingStay({ startAt: r.meetingStartAt, endAt: r.meetingEndAt }, cfg);
  return (await findAvailableRooms({ stay, roomTypeId: r.roomTypeId, category: "MEETING_ROOM" })).length > 0;
}

export interface MeetingRequestInput {
  date: string; start: string; end: string; attendees: number;
  fullName: string; companyName?: string | null; phone: string; email?: string | null;
  requirements?: string | null; notes?: string | null;
}

/** Website meeting room booking → a booking request (staff confirm it into a reservation). */
export async function submitMeetingRequest(input: MeetingRequestInput, ipAddress: string | null) {
  const type = await publicMeetingRoom();
  if (!type) throw new AppError("The meeting room cannot be booked online right now — please call us.", "UNAVAILABLE");
  if (input.attendees < 1 || input.attendees > type.maxAdults) {
    throw new AppError(`The meeting room holds up to ${type.maxAdults} people.`, "VALIDATION", { attendees: "Too many" });
  }
  const stay = await meetingWindow(input.date, input.start, input.end);
  const free = await findAvailableRooms({ stay, roomTypeId: type.id, category: "MEETING_ROOM" });
  if (!free.length) throw new AppError("Sorry — the meeting room is already booked for part of that time. Please choose another time.", "UNAVAILABLE");
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const source = await tx.bookingSource.findUnique({ where: { code: WEBSITE_SOURCE } });
    if (!source || !source.isActive) throw new AppError("Online booking is paused — please call us.");
    const guestId = await resolveGuest(tx, { fullName: input.fullName, phone: input.phone, email: input.email });
    const req = await tx.bookingRequest.create({
      data: {
        reference: requestRef(),
        manageToken: randomBytes(24).toString("base64url"),
        sourceId: source.id,
        guestId,
        fullName: input.fullName.trim(),
        phone: (await tx.guest.findUniqueOrThrow({ where: { id: guestId } })).phone ?? input.phone.trim(),
        email: input.email?.trim().toLowerCase() || null,
        companyName: input.companyName?.trim() || null,
        checkInDate: toDbDate(stay.arrivalDate),
        checkOutDate: toDbDate(stay.departureDate),
        meetingStartAt: stay.startAt,
        meetingEndAt: stay.endAt,
        roomTypeId: type.id,
        adults: input.attendees,
        children: 0,
        specialRequests: input.requirements?.trim() || null,
        notes: input.notes?.trim() || null,
        estimatedNet: type.baseRate,
        ipAddress,
        businessDate: toDbDate(businessDateOf(new Date(), stayConfig(settings))),
      },
    });
    await tx.bookingRequestEvent.create({ data: { requestId: req.id, type: "SUBMITTED", toStatus: "NEW", note: "Meeting room — submitted on the website", actorId: null } });
    await audit(tx, { label: "website", ipAddress }, {
      action: "booking_request.submitted", entityType: "BookingRequest", entityId: req.id,
      after: { reference: req.reference, roomType: type.name, date: stay.arrivalDate, time: timeRange(stay.startAt, stay.endAt), attendees: input.attendees, company: req.companyName, estimate: type.baseRate },
    });
    return { id: req.id, reference: req.reference, manageToken: req.manageToken, price: type.baseRate, date: stay.arrivalDate, time: timeRange(stay.startAt, stay.endAt), name: type.name };
  });
}

/**
 * Website meeting room booked and paid online: a reservation of the meeting room straight away (the same engine as
 * reception), held for `holdMinutes` while the customer pays — the payment confirms it.
 */
export async function createWebsiteMeetingBooking(input: MeetingRequestInput, ipAddress: string | null, opts: { holdMinutes: number }) {
  const type = await publicMeetingRoom();
  if (!type) throw new AppError("The meeting room cannot be booked online right now — please call us.", "UNAVAILABLE");
  if (input.attendees < 1 || input.attendees > type.maxAdults) {
    throw new AppError(`The meeting room holds up to ${type.maxAdults} people.`, "VALIDATION", { attendees: "Too many" });
  }
  const stay = await meetingWindow(input.date, input.start, input.end);
  const free = await findAvailableRooms({ stay, roomTypeId: type.id, category: "MEETING_ROOM" });
  if (!free.length) throw new AppError("Sorry — the meeting room is already booked for part of that time. Please choose another time.", "UNAVAILABLE");
  const r = await createReservation({
    sourceCode: WEBSITE_SOURCE,
    guest: { fullName: input.fullName.trim(), phone: input.phone.trim(), email: input.email?.trim() || null },
    companyName: input.companyName?.trim() || null,
    stay: { kind: "meeting", startAt: stay.startAt, endAt: stay.endAt },
    rooms: [{ roomTypeId: type.id, adults: input.attendees, children: 0 }],
    status: "RESERVED",
    specialRequests: input.requirements?.trim() || null,
    internalNotes: ["Website: meeting room booked and paying online (nTZS) — confirmed by the payment.", input.notes?.trim()].filter(Boolean).join(" "),
    holdMinutes: opts.holdMinutes,
  }, { userId: null, label: "website", ipAddress, permissions: new Set<string>() });
  return { id: r.id, reference: r.reference, manageToken: r.manageToken, price: type.baseRate, date: stay.arrivalDate, time: timeRange(stay.startAt, stay.endAt), name: type.name };
}

function sameToken(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Customer's private confirmation page (reference + token). */
export async function getRequestForCustomer(reference: string, token: string | null | undefined) {
  if (!token || token.length > 200 || !/^VLH-REQ-[A-Z0-9]{4,12}$/.test(reference)) return null;
  const r = await db.bookingRequest.findUnique({ where: { reference }, include: { roomType: { select: { name: true, slug: true, images: true } }, reservation: { select: { reference: true, status: true } } } });
  if (!r || !sameToken(r.manageToken, token)) return null;
  return {
    reference: r.reference, status: r.status, fullName: r.fullName, phone: r.phone, email: r.email,
    checkIn: fromDbDate(r.checkInDate), checkOut: fromDbDate(r.checkOutDate), expectedArrivalTime: r.expectedArrivalTime,
    roomType: r.roomType, roomCount: r.roomCount, adults: r.adults, children: r.children,
    specialRequests: r.specialRequests, transportRequested: r.transportRequested, transportDetails: r.transportDetails as PickupRequest | null,
    estimatedNet: r.estimatedNet, createdAt: r.createdAt, reservation: r.reservation,
    meeting: r.meetingStartAt && r.meetingEndAt ? { time: timeRange(r.meetingStartAt, r.meetingEndAt), company: r.companyName } : null,
  };
}

// ───────────────────────────── Staff actions ─────────────────────────────

type StaffActor = AuditActor & { userId: string; permissions: ReadonlySet<string> };

async function load(id: string) {
  const r = await db.bookingRequest.findUnique({ where: { id } });
  if (!r) throw new AppError("Booking request not found.", "NOT_FOUND");
  return r;
}

export async function setRequestStatus(id: string, to: BookingRequestStatus, actor: StaffActor, note?: string | null) {
  const r = await load(id);
  if (to === "CONVERTED") throw new AppError("Use “Confirm & create reservation” to convert a request.");
  if (!NEXT[r.status].includes(to)) throw new AppError(`A ${label(r.status)} request cannot be marked ${label(to)}.`);
  if ((to === "REJECTED" || to === "CANCELLED") && !note?.trim()) throw new AppError("Give a reason (the customer may ask).", "VALIDATION", { note: "Required" });
  await db.$transaction(async (tx) => {
    const n = await tx.bookingRequest.updateMany({
      where: { id, status: r.status },
      data: {
        status: to,
        ...(to === "REJECTED" && { rejectionReason: note!.trim() }),
        ...((to === "REJECTED" || to === "CANCELLED" || to === "CONFIRMED") && { handledById: actor.userId, handledAt: new Date() }),
        ...(!r.assignedToId && { assignedToId: actor.userId }),
      },
    });
    if (n.count === 0) throw new AppError("Someone else just updated this request. Refresh and try again.", "CONFLICT");
    await tx.bookingRequestEvent.create({ data: { requestId: id, type: "STATUS_CHANGED", fromStatus: r.status, toStatus: to, note: note?.trim() || null, actorId: actor.userId } });
    await audit(tx, actor, { action: "booking_request.status_changed", entityType: "BookingRequest", entityId: id, before: { status: r.status }, after: { status: to, note } });
  });
}

/** Record a call/WhatsApp to the customer (with time & notes). Moves NEW/REVIEWING requests to CONTACTED. */
export async function logContact(id: string, input: { note: string; contactedAt?: Date | null }, actor: StaffActor) {
  if (!input.note.trim()) throw new AppError("Write what was agreed with the customer.", "VALIDATION", { note: "Required" });
  const r = await load(id);
  if (r.status === "CONVERTED") throw new AppError("This request is already a reservation — add notes there.");
  const at = input.contactedAt ?? new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw new AppError("Contact time cannot be in the future.");
  await db.$transaction(async (tx) => {
    const to: BookingRequestStatus = ["NEW", "REVIEWING"].includes(r.status) ? "CONTACTED" : r.status;
    await tx.bookingRequest.update({ where: { id }, data: { status: to, ...(!r.assignedToId && { assignedToId: actor.userId }) } });
    await tx.bookingRequestEvent.create({ data: { requestId: id, type: "CONTACTED", fromStatus: r.status, toStatus: to, note: input.note.trim(), contactedAt: at, actorId: actor.userId } });
    await audit(tx, actor, { action: "booking_request.contacted", entityType: "BookingRequest", entityId: id, after: { note: input.note, contactedAt: at } });
  });
}

export async function assignRequest(id: string, userId: string | null, actor: StaffActor) {
  const r = await load(id);
  await db.$transaction(async (tx) => {
    if (userId) {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u || !u.isActive) throw new AppError("Choose an active staff member.");
    }
    await tx.bookingRequest.update({ where: { id }, data: { assignedToId: userId } });
    await tx.bookingRequestEvent.create({ data: { requestId: id, type: "ASSIGNED", note: userId ? "Assigned" : "Unassigned", actorId: actor.userId } });
    await audit(tx, actor, { action: "booking_request.assigned", entityType: "BookingRequest", entityId: id, before: { assignedToId: r.assignedToId }, after: { assignedToId: userId } });
  });
}

/** Correct a mistaken customer match: link to another guest, or split off a new guest profile. */
export async function relinkCustomer(id: string, guestId: string | "NEW", actor: StaffActor) {
  const r = await load(id);
  if (r.status === "CONVERTED") throw new AppError("This request is already a reservation; change the guest on the reservation.");
  await db.$transaction(async (tx) => {
    const target = guestId === "NEW"
      ? (await tx.guest.create({ data: { fullName: r.fullName, phone: r.phone, email: r.email, nationality: r.nationality } })).id
      : (await tx.guest.findUnique({ where: { id: guestId } }))?.id;
    if (!target) throw new AppError("Guest not found.");
    await tx.bookingRequest.update({ where: { id }, data: { guestId: target } });
    await tx.bookingRequestEvent.create({ data: { requestId: id, type: "CUSTOMER_LINKED", note: guestId === "NEW" ? "Created a new customer profile" : "Linked to an existing customer", actorId: actor.userId } });
    await audit(tx, actor, { action: "booking_request.customer_linked", entityType: "BookingRequest", entityId: id, before: { guestId: r.guestId }, after: { guestId: target } });
  });
}

export interface ConversionInput {
  checkIn: BusinessDate;
  checkOut: BusinessDate;
  roomTypeId: string;
  roomId?: string | null;
  roomCount: number;
  adults: number;
  children: number;
  discountPerNight?: number | null;
  discountReason?: string | null;
  note?: string | null;
  /** Food & drinks picked from the menu while confirming (a pre-order on the bill, priced from the menu). */
  menuItems?: { menuItemId: string; quantity: number }[] | null;
}

/**
 * Confirm a request: re-validates availability & price in the reservation
 * engine, creates the official reservation (source Website), links it to the
 * request atomically, and raises the transport request if one was asked for.
 */
export async function convertRequest(id: string, input: ConversionInput, actor: StaffActor) {
  if (!actor.permissions.has("reservations.create")) throw new AppError("You cannot create reservations.", "FORBIDDEN");
  const r = await db.bookingRequest.findUnique({ where: { id }, include: { source: true } });
  if (!r) throw new AppError("Booking request not found.", "NOT_FOUND");
  if (!OPEN.includes(r.status)) throw new AppError(`This request is ${label(r.status)} and cannot be converted.`);
  if (!isBusinessDate(input.checkIn) || !isBusinessDate(input.checkOut)) throw new AppError("Choose valid dates.");
  const type = await db.roomType.findUnique({ where: { id: input.roomTypeId } });
  if (!type || !type.isActive) throw new AppError("Choose an active room type.");
  if (r.meetingStartAt && r.meetingEndAt) {
    // Meeting room request: the same engine, booked by the asked-for time (change it later on the booking).
    return createReservation(
      {
        sourceCode: r.source.code,
        guest: r.guestId ? { id: r.guestId, fullName: r.fullName, phone: r.phone, email: r.email } : { fullName: r.fullName, phone: r.phone, email: r.email },
        companyName: r.companyName,
        stay: { kind: "meeting", startAt: r.meetingStartAt, endAt: r.meetingEndAt },
        rooms: [{ roomTypeId: r.roomTypeId, roomId: input.roomId ?? null, adults: r.adults, children: 0, discountPerNight: input.discountPerNight ?? null, discountReason: input.discountReason ?? null }],
        status: "RESERVED",
        specialRequests: r.specialRequests,
        internalNotes: [`From website request ${r.reference}.`, r.notes, input.note].filter(Boolean).join(" "),
        bookingRequestId: r.id,
        menuItems: input.menuItems ?? null,
      },
      actor as Actor,
    ).then(async (reservation) => {
      await audit(db, actor, { action: "booking_request.converted", entityType: "BookingRequest", entityId: r.id, after: { reservation: reservation.reference } });
      return reservation;
    });
  }
  const count = Math.max(1, Math.min(10, Math.trunc(input.roomCount)));
  const rooms = distributeGuests(type, input.adults, input.children, count);
  if (!rooms) throw new AppError(`${count} ${type.name} room(s) cannot hold ${input.adults} adult(s) and ${input.children} child(ren).`);
  if (input.roomId && count !== 1) throw new AppError("Choose a specific room only when converting a single room.");

  const reservation = await createReservation(
    {
      sourceCode: r.source.code,
      guest: r.guestId ? { id: r.guestId, fullName: r.fullName, phone: r.phone, email: r.email } : { fullName: r.fullName, phone: r.phone, email: r.email, nationality: r.nationality },
      stay: { kind: "overnight", arrivalDate: input.checkIn, departureDate: input.checkOut },
      rooms: rooms.map((x, i) => ({
        ...x, roomId: i === 0 ? input.roomId ?? null : null,
        discountPerNight: input.discountPerNight ?? null, discountReason: input.discountReason ?? null,
      })),
      // Pending until the guest pays (the room is held for the hotel's hold time); payment confirms it.
      status: "RESERVED",
      specialRequests: r.specialRequests,
      internalNotes: [`From website request ${r.reference}.`, r.notes, input.note].filter(Boolean).join(" "),
      eta: r.expectedArrivalTime,
      bookingRequestId: r.id,
      menuItems: input.menuItems ?? null,
    },
    actor as Actor,
  );

  if (r.transportRequested && r.transportDetails) {
    const t = r.transportDetails as unknown as PickupRequest;
    try {
      await requestTransportForReservation({
        reservationId: reservation.id, flightNumber: t.flightNumber, arrivalDate: t.arrivalDate, arrivalTime: t.arrivalTime,
        airport: t.airport, passengers: t.passengers, notes: t.notes,
      });
    } catch (e) {
      console.error("[booking-request] transport request failed", r.reference, e);
    }
  }
  await audit(db, actor, { action: "booking_request.converted", entityType: "BookingRequest", entityId: r.id, after: { reservation: reservation.reference } });
  return reservation;
}

export function label(s: BookingRequestStatus) {
  return s === "CONVERTED" ? "converted" : s.toLowerCase();
}

// ───────────────────────────── Staff views ─────────────────────────────

export const REQUEST_TABS = ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED", "CONVERTED", "REJECTED", "CANCELLED"] as const;

export async function listRequests(status: BookingRequestStatus | "ALL" | "OPEN", take = 100) {
  const where = status === "ALL" ? {} : status === "OPEN" ? { status: { in: OPEN } } : { status };
  const [rows, counts] = await Promise.all([
    db.bookingRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take,
      include: {
        roomType: { select: { name: true } }, source: { select: { name: true } },
        assignedTo: { select: { fullName: true } }, reservation: { select: { id: true, reference: true } },
      },
    }),
    db.bookingRequest.groupBy({ by: ["status"], _count: true }),
  ]);
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<BookingRequestStatus, number>> };
}

export async function getRequestDetail(id: string) {
  const r = await db.bookingRequest.findUnique({
    where: { id },
    include: {
      roomType: true, requestedRoom: { select: { number: true } }, source: true,
      guest: { include: { _count: { select: { reservations: true } } } },
      assignedTo: { select: { id: true, fullName: true } }, handledBy: { select: { fullName: true } },
      reservation: { select: { id: true, reference: true, status: true, netAmount: true } },
      events: { orderBy: { createdAt: "desc" }, include: { actor: { select: { fullName: true } } } },
    },
  });
  if (!r) return null;
  // Other customers sharing this phone/email — staff can correct a wrong match.
  const matches = await db.guest.findMany({
    where: { deletedAt: null, OR: [{ phone: r.phone }, ...(r.email ? [{ email: r.email }] : [])] },
    select: { id: true, fullName: true, phone: true, email: true, _count: { select: { reservations: true } } },
    take: 10,
  });
  return { ...r, checkIn: fromDbDate(r.checkInDate), checkOut: fromDbDate(r.checkOutDate), matches };
}

/** Live availability for a request's dates: free rooms per type, right now. Never holds inventory. */
export async function requestAvailability(checkIn: BusinessDate, checkOut: BusinessDate) {
  const settings = await getSettings();
  let stay;
  try {
    stay = overnightStay({ arrivalDate: checkIn, departureDate: checkOut }, stayConfig(settings));
  } catch {
    return null;
  }
  const [free, types] = await Promise.all([
    findAvailableRooms({ stay }),
    db.roomType.findMany({ where: { isActive: true, category: "GUEST_ROOM" }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, baseRate: true, maxAdults: true, maxChildren: true } }),
  ]);
  return types.map((t) => ({ ...t, rooms: free.filter((f) => f.roomTypeId === t.id).map((f) => ({ id: f.id, number: f.number, status: f.status })) }));
}

// ───────────────────────────── Dashboards ─────────────────────────────

export async function requestStats(from: BusinessDate, to: BusinessDate) {
  const where = { businessDate: { gte: toDbDate(from), lte: toDbDate(to) } };
  const [byStatus, bySource, byHandler, openNow] = await Promise.all([
    db.bookingRequest.groupBy({ by: ["status"], where, _count: true }),
    db.bookingRequest.groupBy({ by: ["sourceId"], where, _count: true }),
    db.bookingRequest.groupBy({ by: ["handledById"], where: { ...where, handledById: { not: null } }, _count: true }),
    db.bookingRequest.count({ where: { status: { in: ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED"] } } }),
  ]);
  const n = (s: BookingRequestStatus) => byStatus.find((x) => x.status === s)?._count ?? 0;
  const total = byStatus.reduce((t, x) => t + x._count, 0);
  const converted = n("CONVERTED");
  const [sources, users] = await Promise.all([
    db.bookingSource.findMany({ where: { id: { in: bySource.map((s) => s.sourceId) } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: byHandler.map((h) => h.handledById!).filter(Boolean) } }, select: { id: true, fullName: true } }),
  ]);
  return {
    total,
    new: n("NEW"),
    pending: n("NEW") + n("REVIEWING") + n("CONTACTED") + n("CONFIRMED"),
    confirmed: converted + n("CONFIRMED"),
    converted,
    rejected: n("REJECTED"),
    cancelled: n("CANCELLED"),
    conversionRate: total ? (converted / total) * 100 : null,
    openNow,
    bySource: bySource.map((s) => ({ name: sources.find((x) => x.id === s.sourceId)?.name ?? "—", count: s._count })),
    byHandler: byHandler.map((h) => ({ name: users.find((u) => u.id === h.handledById)?.fullName ?? "—", count: h._count })).sort((a, b) => b.count - a.count),
  };
}

export async function newRequestCount() {
  return db.bookingRequest.count({ where: { status: "NEW" } });
}

