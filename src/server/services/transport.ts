import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { getSettings, getSettingsTx, stayConfig } from "../settings";
import { addDays, businessDateOf, parseTimeToMinutes, toDbDate, zonedInstant, type BusinessDate } from "@/lib/time/business-date";
import { recalculateReservation } from "./reservation-financials";
import { resolveAccountTx } from "./payment-accounts";
import { TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import type { Prisma } from "@/generated/prisma/client";
import type { TripStatus } from "@/generated/prisma/enums";
import { msg, msgf } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";

/**
 * Guest transport — airport pickups & drop-offs, meeting and custom trips.
 * ONE kind of request, however it arrives (website, phone/WhatsApp, a guest in
 * the hotel): it starts PENDING, reception confirms it, records who drives,
 * completes it, then adds it to the guest's room bill OR takes the payment
 * directly. The price is a snapshot of the service price when the request was
 * made (a manager may adjust it, with a reason). Transport is its own income
 * line: a room charge or a direct sale — never both, never counted twice.
 */

type Actor = AuditActor & { userId?: string | null; permissions?: ReadonlySet<string> };
type Tx = Prisma.TransactionClient;

export const DEFAULT_AIRPORT = "Julius Nyerere International Airport (DAR)";
export const OPEN_TRIP: TripStatus[] = ["REQUESTED", "CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP"];

const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["ASSIGNED", "EN_ROUTE", "COMPLETED", "CANCELLED", "NO_SHOW"],
  ASSIGNED: ["EN_ROUTE", "COMPLETED", "CONFIRMED", "CANCELLED", "NO_SHOW"],
  EN_ROUTE: ["PICKED_UP", "COMPLETED", "CANCELLED", "NO_SHOW"],
  PICKED_UP: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};
/** Statuses a driver (driver account) may set on their own trip. */
const DRIVER_STEPS: TripStatus[] = ["EN_ROUTE", "PICKED_UP", "COMPLETED"];
const can = (a: Actor, ...p: string[]) => p.some((x) => a.permissions?.has(x));
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
/** A trip's status inside a sentence, in the words of whoever asks: "en route" in English (as it always was). */
async function tripWord(word: string) {
  const t = await getT().catch(() => englishT);
  return t.ctx("trip", word);
}

/** TRN-2026-00001 — one sequence per year. */
async function nextTripRef(tx: Tx, year: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('transport_trip_ref'))::text`;
  const last = await tx.transportTrip.findFirst({ where: { reference: { startsWith: `TRN-${year}-` } }, orderBy: { reference: "desc" }, select: { reference: true } });
  return `TRN-${year}-${String(last ? Number(last.reference.slice(-5)) + 1 : 1).padStart(5, "0")}`;
}

// ─────────────────────────── Services & prices ───────────────────────────

export async function transportServices(opts: { publicOnly?: boolean; includeInactive?: boolean } = {}) {
  return db.transportService.findMany({
    where: { ...(opts.includeInactive ? {} : { isActive: true }), ...(opts.publicOnly ? { isPublic: true } : {}) },
    orderBy: { sortOrder: "asc" },
    include: { options: { where: opts.includeInactive ? {} : { isActive: true }, orderBy: [{ sortOrder: "asc" }, { price: "asc" }] } },
  });
}

export interface ServiceOptionInput { id?: string | null; name: string; description?: string | null; price: number; isActive?: boolean }

/**
 * Admin or manager: change a service (name, price, offered, on the website) and its
 * price packages. Trips already made keep the package and price they were made with.
 */
export async function saveTransportService(input: { id: string; name: string; description?: string | null; price: number; isActive: boolean; isPublic: boolean; options?: ServiceOptionInput[] | null }, actor: Actor) {
  if (!can(actor, "transport.manage", "settings.manage")) throw new AppError("Only a manager or admin can change transport prices.", "FORBIDDEN");
  if (!input.name.trim()) throw new AppError("Give the service a name.", "VALIDATION", { name: msg("Required") });
  const opts = (input.options ?? []).map((o) => ({ ...o, name: o.name.trim() }));
  for (const p of [input.price, ...opts.map((o) => o.price)]) {
    if (!Number.isInteger(p) || p < 0) throw new AppError("Enter prices in whole shillings.", "VALIDATION", { price: msg("Invalid") });
  }
  if (opts.some((o) => !o.name)) throw new AppError("Give every package a name.", "VALIDATION", { options: msg("Name") });
  return db.$transaction(async (tx) => {
    const before = await tx.transportService.findUnique({ where: { id: input.id }, include: { options: true } });
    if (!before) throw new AppError("Service not found.", "NOT_FOUND");
    // Packages: update the ones kept, add new ones, remove the ones taken out (trips keep their own copy).
    const keep = opts.filter((o) => o.id && before.options.some((b) => b.id === o.id));
    await tx.transportServiceOption.deleteMany({ where: { serviceId: before.id, id: { notIn: keep.map((o) => o.id!) } } });
    for (const [i, o] of opts.entries()) {
      const data = { name: o.name, description: o.description?.trim() || null, price: o.price, isActive: o.isActive ?? true, sortOrder: (i + 1) * 10 };
      if (o.id && keep.includes(o)) await tx.transportServiceOption.update({ where: { id: o.id }, data });
      else await tx.transportServiceOption.create({ data: { ...data, serviceId: before.id } });
    }
    const active = opts.filter((o) => o.isActive ?? true);
    // With packages, the service shows its lowest package price ("from …").
    const price = active.length ? Math.min(...active.map((o) => o.price)) : input.price;
    const s = await tx.transportService.update({
      where: { id: input.id },
      data: { name: input.name.trim(), description: input.description?.trim() || null, price, isActive: input.isActive, isPublic: input.isPublic },
    });
    await audit(tx, actor, { action: "transport.service_updated", entityType: "TransportService", entityId: s.id,
      before: { name: before.name, price: before.price, isActive: before.isActive, isPublic: before.isPublic, packages: before.options.map((o) => `${o.name} ${o.price}`) },
      after: { name: s.name, price: s.price, isActive: s.isActive, isPublic: s.isPublic, packages: opts.map((o) => `${o.name} ${o.price}`) } });
    return s;
  });
}

// ─────────────────────────── One request, three ways in ───────────────────────────

export interface TransportRequestInput {
  serviceId: string;
  /** The price package, when the service has packages (e.g. meeting trips by time & distance). */
  optionId?: string | null;
  passengerName: string;
  passengerPhone: string;
  passengerEmail?: string | null;
  /** Local date (YYYY-MM-DD) and time (HH:MM) of the pickup / flight arrival. */
  date: string;
  time: string;
  /** Airport trips: the airport. */
  airport?: string | null;
  /** Meeting / custom trips: where from (default the hotel) and where to. */
  pickupLocation?: string | null;
  destination?: string | null;
  flightNumber?: string | null;
  passengers: number;
  bags?: number | null;
  /** Staff: the booking this is for. Website: the booking number the guest typed. */
  reservationId?: string | null;
  reservationRef?: string | null;
  roomNumber?: string | null;
  notes?: string | null;
}

/**
 * Create a transport request — the same for the website (no account), reception
 * (phone / WhatsApp / walk-up) and a guest already staying. Always starts PENDING.
 */
export async function createTransportRequest(input: TransportRequestInput, via: { source: "WEBSITE" } | { source: "STAFF"; actor: Actor }, now = new Date()) {
  const staff = via.source === "STAFF" ? via.actor : null;
  if (staff && !can(staff, "transport.request", "transport.manage")) throw new AppError("You cannot create transport requests.", "FORBIDDEN");
  const name = input.passengerName.trim();
  if (name.length < 2) throw new AppError("Enter the guest's full name.", "VALIDATION", { passengerName: msg("Required") });
  if (digits(input.passengerPhone).length < 7) throw new AppError("A phone number is needed so we can confirm the trip.", "VALIDATION", { passengerPhone: msg("Required") });
  if (!Number.isInteger(input.passengers) || input.passengers < 1 || input.passengers > 40) throw new AppError("Enter the number of guests.", "VALIDATION", { passengers: msg("Invalid") });
  const bags = input.bags ?? 0;
  if (!Number.isInteger(bags) || bags < 0 || bags > 60) throw new AppError("Enter the number of bags.", "VALIDATION", { bags: msg("Invalid") });

  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const service = await tx.transportService.findUnique({ where: { id: input.serviceId }, include: { options: { where: { isActive: true } } } });
    if (!service || !service.isActive || (!staff && !service.isPublic)) throw new AppError("Choose a transport service.", "VALIDATION", { serviceId: msg("Required") });
    const option = service.options.length ? service.options.find((o) => o.id === input.optionId) : null;
    if (service.options.length && !option) throw new AppError("Choose a package.", "VALIDATION", { optionId: msg("Required") });
    const price = option?.price ?? service.price;

    let pickupAt: Date;
    try { pickupAt = zonedInstant(input.date, parseTimeToMinutes(input.time), settings.timezone); }
    catch { throw new AppError("Enter a valid date and time.", "VALIDATION", { time: msg("Invalid") }); }
    if (!staff && pickupAt.getTime() < now.getTime() - 60 * 60_000) throw new AppError("That date and time has already passed.", "VALIDATION", { date: msg("Past") });

    const hotel = settings.hotelName;
    const airport = input.airport?.trim() || null;
    const pickup = service.type === "AIRPORT_PICKUP";
    const dropoff = service.type === "AIRPORT_DROPOFF";
    if (pickup && !airport) throw new AppError("Which airport are you arriving at?", "VALIDATION", { airport: msg("Required") });
    if (pickup && !input.flightNumber?.trim()) throw new AppError("Enter your flight number.", "VALIDATION", { flightNumber: msg("Required") });
    if (pickup && input.bags == null) throw new AppError("How many bags?", "VALIDATION", { bags: msg("Required") });
    if (dropoff && !airport) throw new AppError("Which airport are you going to?", "VALIDATION", { airport: msg("Required") });
    if (!pickup && !dropoff && !input.destination?.trim()) throw new AppError("Where are you going?", "VALIDATION", { destination: msg("Required") });

    // The booking: staff pick it; a website guest's booking number is linked only when the phone matches that booking.
    let reservation: { id: string; guestId: string; reference: string } | null = null;
    let roomNumber = input.roomNumber?.trim() || null;
    if (staff && input.reservationId) {
      const r = await tx.reservation.findUnique({ where: { id: input.reservationId }, include: { rooms: { where: { status: "CHECKED_IN" }, include: { room: { select: { number: true } } } } } });
      if (!r) throw new AppError("Booking not found.", "NOT_FOUND");
      reservation = r;
      roomNumber = r.rooms.map((x) => x.room.number).join(", ") || roomNumber;
    } else if (input.reservationRef?.trim()) {
      const r = await tx.reservation.findFirst({ where: { reference: { equals: input.reservationRef.trim(), mode: "insensitive" } }, include: { guest: { select: { phone: true } } } });
      if (r && digits(r.guest.phone).slice(-9) === digits(input.passengerPhone).slice(-9)) reservation = r;
    }

    const trip = await tx.transportTrip.create({
      data: {
        reference: await nextTripRef(tx, businessDateOf(now, stayConfig(settings)).slice(0, 4)),
        type: service.type, status: "REQUESTED", serviceId: service.id,
        reservationId: reservation?.id ?? null, guestId: reservation?.guestId ?? null,
        reservationRef: input.reservationRef?.trim() || reservation?.reference || null, roomNumber,
        passengerName: name, passengerPhone: input.passengerPhone.trim(), passengerEmail: input.passengerEmail?.trim() || null,
        pickupAt, businessDate: toDbDate(businessDateOf(pickupAt, stayConfig(settings))),
        pickupLocation: pickup ? airport! : dropoff ? hotel : input.pickupLocation?.trim() || hotel,
        destination: pickup ? hotel : dropoff ? airport! : input.destination!.trim(),
        flightNumber: input.flightNumber?.trim().toUpperCase() || null,
        passengers: input.passengers, bags,
        standardPrice: price, charge: price, priceOption: option?.name ?? null,
        notes: input.notes?.trim() || null, source: staff ? "STAFF" : "WEBSITE", createdById: staff?.userId ?? null,
        // The customer's private link to pay it online and see it (website requests).
        payToken: staff ? null : randomBytes(16).toString("base64url"),
      },
    });
    await audit(tx, staff ?? { label: "website" }, { action: "transport.requested", entityType: "TransportTrip", entityId: trip.id,
      after: { reference: trip.reference, service: service.name, package: option?.name ?? null, pickupAt, price, source: trip.source, reservation: reservation?.reference ?? null } });
    return trip;
  });
}

/** Website booking with "airport pickup, please": an airport-pickup request linked to that booking. */
export async function requestTransportForReservation(input: {
  reservationId: string; flightNumber?: string | null; arrivalDate: string; arrivalTime: string;
  airport?: string | null; passengers?: number | null; bags?: number | null; notes?: string | null;
}) {
  const r = await db.reservation.findUnique({ where: { id: input.reservationId }, include: { guest: true, source: true, rooms: { select: { adults: true, children: true } } } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  const service = await db.transportService.findFirst({ where: { type: "AIRPORT_PICKUP", isActive: true }, orderBy: { sortOrder: "asc" } });
  if (!service) throw new AppError("Airport pickup is not offered right now.");
  const guests = r.rooms.reduce((s, x) => s + x.adults + x.children, 0) || 1;
  const settings = await getSettings();
  let pickupAt: Date;
  try { pickupAt = zonedInstant(input.arrivalDate, parseTimeToMinutes(input.arrivalTime), settings.timezone); }
  catch { throw new AppError("Enter a valid arrival date and time.", "VALIDATION", { arrivalTime: msg("Invalid") }); }
  return db.$transaction(async (tx) => {
    const trip = await tx.transportTrip.create({
      data: {
        reference: await nextTripRef(tx, input.arrivalDate.slice(0, 4)), type: "AIRPORT_PICKUP", status: "REQUESTED", serviceId: service.id,
        reservationId: r.id, guestId: r.guestId, reservationRef: r.reference,
        passengerName: r.guest.fullName, passengerPhone: r.guest.phone, passengerEmail: r.guest.email,
        pickupAt, businessDate: toDbDate(businessDateOf(pickupAt, stayConfig(settings))),
        pickupLocation: input.airport?.trim() || DEFAULT_AIRPORT, destination: settings.hotelName,
        flightNumber: input.flightNumber?.trim().toUpperCase() || null, passengers: Math.max(1, Math.min(20, input.passengers ?? guests)), bags: Math.max(0, input.bags ?? 0),
        standardPrice: service.price, charge: service.price,
        // Asked for by the guest themselves (the website, the Hotel QR) — not booked by staff.
        notes: input.notes?.trim() || null, source: r.source.code === "WEBSITE" || r.source.code === "HOTEL_QR" ? "WEBSITE" : "STAFF",
      },
    });
    await audit(tx, { label: r.source.code === "HOTEL_QR" ? "Hotel QR" : "website" }, { action: "transport.requested", entityType: "TransportTrip", entityId: trip.id, after: { reference: trip.reference, reservation: r.reference, flight: trip.flightNumber, pickupAt, price: service.price } });
    return trip;
  });
}

// ─────────────────────────── Reception's few clicks ───────────────────────────

async function load(tx: Tx, id: string) {
  const t = await tx.transportTrip.findUnique({ where: { id }, include: { sales: { where: { isVoided: false }, select: { id: true } } } });
  if (!t) throw new AppError("Trip not found.", "NOT_FOUND");
  return t;
}
const billed = (t: { chargeId: string | null; paidAt: Date | null; sales: { id: string }[] }) => !!t.chargeId || !!t.paidAt || t.sales.length > 0;

/** Pending → Confirmed (who and when are kept). */
export async function confirmTrip(tripId: string, actor: Actor) {
  if (!can(actor, "transport.request", "transport.manage")) throw new AppError("You cannot confirm trips.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const t = await load(tx, tripId);
    if (t.status !== "REQUESTED") throw new AppError("Only a pending request can be confirmed.");
    await tx.transportTrip.update({ where: { id: t.id }, data: { status: "CONFIRMED", confirmedById: actor.userId ?? null, confirmedAt: new Date() } });
    await audit(tx, actor, { action: "transport.confirmed", entityType: "TransportTrip", entityId: t.id, before: { status: t.status }, after: { status: "CONFIRMED" } });
  });
}

/**
 * Record who drives (no driver login needed): a name and phone, and the car —
 * or pick a driver account / hotel vehicle. Changing the driver later is a manager's call.
 */
export async function recordDriver(tripId: string, input: { driverId?: string | null; driverName?: string | null; driverPhone?: string | null; vehicleId?: string | null; vehicleName?: string | null; vehiclePlate?: string | null }, actor: Actor) {
  if (!can(actor, "transport.request", "transport.manage")) throw new AppError("You cannot arrange drivers.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const t = await load(tx, tripId);
    if (!["CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP"].includes(t.status)) throw new AppError(t.status === "REQUESTED" ? msg("Confirm the request first.") : msg("This trip is closed."));
    const hasDriver = !!(t.driverId || t.driverName);
    if (hasDriver && !can(actor, "transport.manage")) throw new AppError("Only a manager can change the driver.", "FORBIDDEN");
    let driverName = input.driverName?.trim() || null, driverPhone = input.driverPhone?.trim() || null;
    if (input.driverId) {
      const d = await tx.user.findUnique({ where: { id: input.driverId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
      if (!d || !d.isActive || !d.role.permissions.some((p) => p.permission.code === "transport.driver")) throw new AppError("Choose an active driver.");
      driverName ??= d.fullName; driverPhone ??= d.phone;
    }
    if (!driverName) throw new AppError("Enter the driver's name.", "VALIDATION", { driverName: msg("Required") });
    let vehicleName = input.vehicleName?.trim() || null, vehiclePlate = input.vehiclePlate?.trim().toUpperCase() || null;
    if (input.vehicleId) {
      const v = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!v || !v.isActive) throw new AppError("Choose an active vehicle.");
      if (t.passengers > v.capacity) throw new AppError(msgf("{vehicle} seats {seats}; this trip has {n} passengers.", { vehicle: v.name, seats: v.capacity, n: t.passengers }));
      vehicleName ??= v.name; vehiclePlate ??= v.plateNumber;
    }
    const status: TripStatus = t.status === "CONFIRMED" ? "ASSIGNED" : t.status;
    await tx.transportTrip.update({
      where: { id: t.id },
      data: { driverId: input.driverId || null, driverName, driverPhone, vehicleId: input.vehicleId || null, vehicleName, vehiclePlate, status },
    });
    await audit(tx, actor, { action: hasDriver ? "transport.driver_changed" : "transport.driver_assigned", entityType: "TransportTrip", entityId: t.id,
      before: { driver: t.driverName, phone: t.driverPhone, vehicle: t.vehicleName, plate: t.vehiclePlate }, after: { driver: driverName, phone: driverPhone, vehicle: vehicleName, plate: vehiclePlate } });
  });
}

/** Start (in progress), complete, no-show, cancel. Cancelling is a manager's call and needs a reason. */
export async function setTripStatus(tripId: string, status: TripStatus, actor: Actor, reason?: string | null) {
  return db.$transaction(async (tx) => {
    const t = await load(tx, tripId);
    const staff = can(actor, "transport.manage", "transport.request");
    const ownDriver = can(actor, "transport.driver") && !!t.driverId && t.driverId === actor.userId;
    if (!staff && !(ownDriver && DRIVER_STEPS.includes(status))) throw new AppError("You cannot change this trip.", "FORBIDDEN");
    if (status === "CONFIRMED" && t.status === "REQUESTED") throw new AppError("Use Confirm.");
    if (!TRANSITIONS[t.status].includes(status)) {
      const from = await tripWord(t.status === "REQUESTED" ? "pending" : t.status.toLowerCase().replace("_", " "));
      throw new AppError(msgf("A {from} trip cannot become {to}.", { from, to: await tripWord(status.toLowerCase().replace("_", " ")) }));
    }
    if (status === "CANCELLED") {
      if (!can(actor, "transport.manage")) throw new AppError("Only a manager can cancel a transport request.", "FORBIDDEN");
      if (!reason?.trim()) throw new AppError("Give a reason for cancelling.", "VALIDATION", { reason: msg("Required") });
    }
    if ((status === "CANCELLED" || status === "NO_SHOW") && billed(t)) throw new AppError("This trip is already on a bill or paid.");
    await tx.transportTrip.update({
      where: { id: t.id },
      data: {
        status,
        ...(status === "COMPLETED" && { completedAt: new Date() }),
        ...((status === "CANCELLED" || status === "NO_SHOW") && { cancelReason: reason?.trim() || null }),
        // Back to confirmed = the driver is taken off.
        ...(status === "CONFIRMED" && { driverId: null, driverName: null, driverPhone: null }),
      },
    });
    await audit(tx, actor, { action: `transport.${status === "EN_ROUTE" ? "started" : status.toLowerCase()}`, entityType: "TransportTrip", entityId: t.id, before: { status: t.status }, after: { status, reason: reason?.trim() || null } });
  });
}

/** A special price (manager): the standard price is kept, with who, when and why. */
export async function adjustTripPrice(tripId: string, price: number, reason: string, actor: Actor) {
  if (!can(actor, "transport.manage")) throw new AppError("Only a manager can change a trip's price.", "FORBIDDEN");
  if (!Number.isInteger(price) || price < 0) throw new AppError("Enter the price in whole shillings.", "VALIDATION", { price: msg("Invalid") });
  if (!reason.trim()) throw new AppError("Say why the price is different.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    const t = await load(tx, tripId);
    if (billed(t)) throw new AppError("The trip is already on a bill or paid — the price cannot change now.");
    if (t.status === "CANCELLED" || t.status === "NO_SHOW") throw new AppError("This trip is closed.");
    await tx.transportTrip.update({ where: { id: t.id }, data: { charge: price, standardPrice: t.standardPrice ?? t.charge, priceReason: reason.trim(), priceAdjustedById: actor.userId ?? null, priceAdjustedAt: new Date() } });
    await audit(tx, actor, { action: "transport.price_adjusted", entityType: "TransportTrip", entityId: t.id, before: { price: t.charge }, after: { price, standardPrice: t.standardPrice ?? t.charge, reason: reason.trim() } });
  });
}

const tripLabel = (t: { type: keyof typeof TRIP_TYPE_LABEL; reference: string }) => `${TRIP_TYPE_LABEL[t.type]} ${t.reference}`;

/**
 * Completed trip → the guest's room bill (paid with the rest at checkout). This is
 * the transport income; paying the room bill later only settles it.
 */
export async function chargeTripToRoom(tripId: string, actor: Actor, reservationId?: string | null) {
  if (!can(actor, "payments.record")) throw new AppError("You cannot add charges to a bill.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const t = await load(tx, tripId);
    if (t.status !== "COMPLETED") throw new AppError("Complete the trip first.");
    if (billed(t)) throw new AppError("This trip is already on a bill or paid.");
    if (!t.charge || t.charge <= 0) throw new AppError("This trip has no price.");
    const resId = t.reservationId ?? reservationId ?? null;
    if (!resId) throw new AppError("Choose the guest's booking to add it to.");
    const r = await tx.reservation.findUnique({ where: { id: resId }, include: { rooms: { where: { status: "CHECKED_IN" }, include: { room: { select: { number: true } } } } } });
    if (!r || !["RESERVED", "CONFIRMED", "CHECKED_IN"].includes(r.status)) throw new AppError("That booking is not open — receive the payment directly instead.");
    const settings = await getSettingsTx(tx);
    const charge = await tx.reservationCharge.create({
      data: {
        reservationId: r.id, amount: t.charge, category: "TRANSPORT", kind: "TRANSPORT", description: tripLabel(t),
        businessDate: toDbDate(businessDateOf(new Date(), stayConfig(settings))), createdById: actor.userId ?? null,
      },
    });
    const room = r.rooms.map((x) => x.room.number).join(", ") || t.roomNumber;
    await tx.transportTrip.update({ where: { id: t.id }, data: { chargeId: charge.id, reservationId: r.id, guestId: r.guestId, roomNumber: room } });
    await recalculateReservation(tx, r.id);
    await audit(tx, actor, { action: "transport.charged_to_room", entityType: "TransportTrip", entityId: t.id, after: { amount: t.charge, reservation: r.reference, room } });
    return { reservationId: r.id, room };
  });
}

/** Completed trip paid on the spot: transport income into the chosen account. */
export async function payTripDirect(tripId: string, input: { accountId: string; reference?: string | null }, actor: Actor) {
  if (!actor.userId || !can(actor, "payments.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const t = await load(tx, tripId);
    if (t.status !== "COMPLETED") throw new AppError("Complete the trip first.");
    if (billed(t)) throw new AppError("This trip is already on a bill or paid.");
    if (!t.charge || t.charge <= 0) throw new AppError("This trip has no price.");
    const { account, method } = await resolveAccountTx(tx, { accountId: input.accountId });
    const category = await tx.revenueCategory.findUniqueOrThrow({ where: { code: "TRANSPORT" } });
    const settings = await getSettingsTx(tx);
    const now = new Date();
    const sale = await tx.revenueTransaction.create({
      data: {
        categoryId: category.id, kind: "TRANSPORT", amount: t.charge, paymentMethodId: method.id, accountId: account.id, transportTripId: t.id,
        description: `${tripLabel(t)} · ${t.passengerName}`, notes: input.reference?.trim() || null,
        occurredAt: now, businessDate: toDbDate(businessDateOf(now, stayConfig(settings))), recordedById: actor.userId!,
      },
    });
    await tx.transportTrip.update({ where: { id: t.id }, data: { paidAt: now } });
    await audit(tx, actor, { action: "transport.paid", entityType: "TransportTrip", entityId: t.id, after: { amount: t.charge, account: account.name, reference: input.reference ?? null, sale: sale.id } });
    return sale;
  });
}

/**
 * A trip the customer paid online (nTZS confirmed it): its income into the nTZS account, once — only when what came in
 * covers its price and it is not paid or billed already (otherwise the money is left for a person to deal with).
 */
export async function payTripFromMobileTx(tx: Tx, tripId: string, received: number, input: { methodId: string; reference: string }, actor: Actor & { userId: string }) {
  await tx.$queryRaw`SELECT "id" FROM "transport_trips" WHERE "id" = ${tripId} FOR UPDATE`;
  const t = await load(tx, tripId);
  if (t.status === "CANCELLED" || t.status === "NO_SHOW" || billed(t) || !t.charge || t.charge <= 0 || received < t.charge) return { saleId: null, left: received };
  const { account, method } = await resolveAccountTx(tx, { methodId: input.methodId }, "payments", { internal: true });
  const category = await tx.revenueCategory.findUniqueOrThrow({ where: { code: "TRANSPORT" } });
  const settings = await getSettingsTx(tx);
  const now = new Date();
  const sale = await tx.revenueTransaction.create({
    data: {
      categoryId: category.id, kind: "TRANSPORT", amount: t.charge, paymentMethodId: method.id, accountId: account.id, transportTripId: t.id,
      description: `${tripLabel(t)} · ${t.passengerName}`, notes: input.reference,
      occurredAt: now, businessDate: toDbDate(businessDateOf(now, stayConfig(settings))), recordedById: actor.userId,
    },
  });
  await tx.transportTrip.update({ where: { id: t.id }, data: { paidAt: now } });
  await audit(tx, actor, { action: "transport.paid", entityType: "TransportTrip", entityId: t.id, after: { amount: t.charge, account: account.name, reference: input.reference, sale: sale.id, via: "nTZS (paid online)" } });
  return { saleId: sale.id, left: received - t.charge };
}

// ─────────────────────────── Screens & reports ───────────────────────────

/** Where a trip's money stands. */
export function tripMoney(t: { status: TripStatus; charge: number | null; chargeId: string | null; paidAt: Date | null; sales?: { id: string }[] }) {
  if (t.chargeId) return "ROOM" as const;
  if (t.paidAt || (t.sales?.length ?? 0) > 0) return "PAID" as const;
  if (t.status === "COMPLETED" && (t.charge ?? 0) > 0) return "TO_BILL" as const;
  return null;
}

/** Transport numbers for a period: trips and money (income is counted when billed or paid). */
export async function transportReport(from: BusinessDate, to: BusinessDate) {
  const range = { gte: toDbDate(from), lt: toDbDate(addDays(to, 1)) };
  const [trips, sales, charges] = await Promise.all([
    db.transportTrip.groupBy({ by: ["status"], where: { businessDate: range }, _count: true }),
    db.revenueTransaction.aggregate({ where: { kind: "TRANSPORT", isVoided: false, businessDate: range }, _sum: { amount: true }, _count: true }),
    db.reservationCharge.aggregate({ where: { kind: "TRANSPORT", isVoided: false, businessDate: range }, _sum: { amount: true }, _count: true }),
  ]);
  const toBill = await db.transportTrip.aggregate({ where: { businessDate: range, status: "COMPLETED", chargeId: null, paidAt: null, charge: { gt: 0 } }, _sum: { charge: true }, _count: true });
  const count = (...s: TripStatus[]) => trips.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const paidDirect = sales._sum.amount ?? 0, onRooms = charges._sum.amount ?? 0;
  return {
    trips: count("REQUESTED", "CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP", "COMPLETED", "NO_SHOW"),
    completed: count("COMPLETED"), pending: count("REQUESTED"), active: count("CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP"),
    cancelled: count("CANCELLED"), noShow: count("NO_SHOW"),
    revenue: paidDirect + onRooms, paidDirect, onRooms, toBill: toBill._sum.charge ?? 0, toBillCount: toBill._count,
  };
}
