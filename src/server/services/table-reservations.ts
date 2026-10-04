import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { TableReservationStatus } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { AppError } from "../errors";
import { getSettings, getSettingsTx } from "../settings";
import { validPhone } from "@/lib/guest-messages";
import { isBusinessDate, localParts, parseTimeToMinutes, toDbDate, zonedInstant, type BusinessDate } from "@/lib/time/business-date";
import { normalizePhone, pickedCustomerTx, resolveGuest } from "./guests";
import { lockLocationTx } from "./dining-core";
import type { Actor } from "./reservations";

/**
 * TABLE RESERVATIONS — a table booked ahead (a phone call, WhatsApp, at reception). Kept apart
 * from the table's session: a reservation only holds the table around its time (shown as
 * Reserved, never as occupied); when the customer comes, a waiter seats them and it becomes
 * their dining session (dining-sessions.ts). Moves, edits, confirmations, cancellations and
 * no-shows are all kept (audit + table moves).
 *
 * A party on several tables: one reservation per table, all with the same `partyId`. Editing,
 * confirming, cancelling, no-show and seating are for the whole party; moving is per table.
 */

type Tx = Prisma.TransactionClient;
/** Two reservations on the same table must be at least this far apart. */
export const RESERVATION_SPAN_MIN = 120;
const OPEN_BOOKING: TableReservationStatus[] = ["BOOKED", "CONFIRMED"];

const canBook = (a: Actor) => !!(a.userId && (a.permissions?.has("restaurant.orders") || a.permissions?.has("restaurant.serve")));
function assertBook(a: Actor) {
  if (!canBook(a)) throw new AppError("Table reservations are for waiters, reception and managers.", "FORBIDDEN");
}

async function nextReference(tx: Tx, year: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('table_reservation_ref'))::text`;
  const last = await tx.tableReservation.findFirst({ where: { reference: { startsWith: `TR-${year}-` } }, orderBy: { reference: "desc" }, select: { reference: true } });
  return `TR-${year}-${String(last ? Number(last.reference.slice(8)) + 1 : 1).padStart(4, "0")}`;
}

export type ReservationInput = {
  locationId: string; name: string; phone: string; date: string; time: string; guestCount: number; notes?: string | null;
  /** Picked in the search: that very customer (even if someone else shares the number). */
  guestId?: string | null;
  /** A party on several tables (the first is `locationId`). */
  locationIds?: string[];
};
export const MAX_PARTY_TABLES = 8;

function checkInput(input: ReservationInput) {
  if (input.name.trim().length < 2) throw new AppError("Enter the customer's name.", "VALIDATION", { name: "Required" });
  if (!validPhone(input.phone)) throw new AppError("Enter the customer's phone number (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  if (!isBusinessDate(input.date)) throw new AppError("Choose the date.", "VALIDATION", { date: "Invalid" });
  if (!/^\d{1,2}:\d{2}$/.test(input.time)) throw new AppError("Choose the time.", "VALIDATION", { time: "Invalid" });
  if (!Number.isInteger(input.guestCount) || input.guestCount < 1 || input.guestCount > 60) throw new AppError("How many people? 1 to 60.", "VALIDATION", { guestCount: "Invalid" });
}

/** The reservation's moment from the date and time typed (hotel time); its day is the date typed. */
async function momentTx(tx: Tx, date: BusinessDate, time: string) {
  const settings = await getSettingsTx(tx);
  return { at: zonedInstant(date, parseTimeToMinutes(time), settings.timezone), day: date, tz: settings.timezone };
}

/** Another reservation too close on the same table? */
async function clashTx(tx: Tx, locationId: string, at: Date, exceptId: string | null, tz: string) {
  const near = await tx.tableReservation.findFirst({
    where: {
      locationId, status: { in: OPEN_BOOKING }, ...(exceptId ? { id: { not: exceptId } } : {}),
      reservedFor: { gt: new Date(at.getTime() - RESERVATION_SPAN_MIN * 60_000), lt: new Date(at.getTime() + RESERVATION_SPAN_MIN * 60_000) },
    },
    include: { guest: { select: { fullName: true } }, location: { select: { name: true } } },
  });
  if (near) {
    const t = near.reservedFor.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    throw new AppError(`${near.location.name} is already reserved at ${t} for ${near.guest.fullName} — choose another table or time.`, "CONFLICT", { locationId: "Reserved" });
  }
}

async function tableTx(tx: Tx, id: string) {
  const l = await tx.restaurantLocation.findUnique({ where: { id } });
  if (!l || !l.isActive || l.kind !== "TABLE") throw new AppError("Choose one of the tables.", "VALIDATION", { locationId: "Invalid" });
  return l;
}

/** Book a table — or several for one party — for a customer (found once by phone — never saved twice). */
export async function createTableReservation(input: ReservationInput, actor: Actor, now = new Date()) {
  assertBook(actor);
  checkInput(input);
  const ids = [...new Set([input.locationId, ...(input.locationIds ?? [])].filter(Boolean))];
  if (ids.length > MAX_PARTY_TABLES) throw new AppError(`Up to ${MAX_PARTY_TABLES} tables in one reservation.`, "VALIDATION", { locationIds: "Too many" });
  return db.$transaction(async (tx) => {
    const tables = [];
    for (const id of ids) tables.push(await tableTx(tx, id));
    for (const id of [...ids].sort()) await lockLocationTx(tx, id);
    const { at, day, tz } = await momentTx(tx, input.date, input.time);
    if (at.getTime() < now.getTime() - 15 * 60_000) throw new AppError("That time has passed — choose a time from now.", "VALIDATION", { time: "Past" });
    for (const l of tables) await clashTx(tx, l.id, at, null, tz);
    const guestId = (await pickedCustomerTx(tx, input.guestId, input.phone)) ?? await resolveGuest(tx, { fullName: input.name.trim().slice(0, 80), phone: normalizePhone(input.phone)! });
    const partyId = tables.length > 1 ? `pty_${randomBytes(9).toString("hex")}` : null;
    const made = [];
    for (const l of tables) {
      const r = await tx.tableReservation.create({
        data: {
          reference: await nextReference(tx, day.slice(0, 4)), partyId, locationId: l.id, guestId, reservedFor: at, date: toDbDate(day), guestCount: input.guestCount,
          notes: input.notes?.trim().slice(0, 300) || null, createdById: actor.userId ?? null, updatedById: actor.userId ?? null,
        },
      });
      await audit(tx, actor, { action: "table_reservation.created", entityType: "TableReservation", entityId: r.id, after: { reference: r.reference, table: l.name, at: at.toISOString(), guests: input.guestCount, guest: guestId, party: partyId, tables: tables.map((t) => t.name) } });
      made.push(r);
    }
    return { ...made[0], tables: made.length };
  });
}

/** The reservation — and, for a party, every table of it still booked. */
async function partyRowsTx(tx: Tx, id: string) {
  const r = await tx.tableReservation.findUnique({ where: { id }, select: { id: true, partyId: true } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  if (!r.partyId) return [r.id];
  const rows = await tx.tableReservation.findMany({ where: { partyId: r.partyId, status: { in: OPEN_BOOKING } }, orderBy: { reference: "asc" }, select: { id: true } });
  return rows.length ? rows.map((x) => x.id) : [r.id];
}
/** Every table of a party still booked (just this one when it is not a party). */
export async function partyReservationIds(id: string) {
  return db.$transaction((tx) => partyRowsTx(tx, id));
}

async function openBookingTx(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "table_reservations" WHERE "id" = ${id} FOR UPDATE`;
  const r = await tx.tableReservation.findUnique({ where: { id }, include: { location: { select: { id: true, name: true } }, guest: { select: { fullName: true, phone: true } } } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  if (!OPEN_BOOKING.includes(r.status)) throw new AppError(r.status === "SEATED" ? "They are already seated — this reservation is done." : "This reservation was cancelled or marked no-show.", "CONFLICT");
  return r;
}

/** Change the customer, time, people or notes — for the whole party (a table change is a move — see below). */
export async function updateTableReservation(id: string, input: Omit<ReservationInput, "locationId">, actor: Actor, now = new Date()) {
  assertBook(actor);
  checkInput({ ...input, locationId: "-" });
  return db.$transaction(async (tx) => {
    let last = null;
    for (const rid of await partyRowsTx(tx, id)) last = await updateOneTx(tx, rid, input, actor, now);
    return last!;
  });
}
async function updateOneTx(tx: Tx, id: string, input: Omit<ReservationInput, "locationId">, actor: Actor, now: Date) {
  {
    const r0 = await tx.tableReservation.findUnique({ where: { id }, select: { locationId: true } });
    if (!r0) throw new AppError("Reservation not found.", "NOT_FOUND");
    await lockLocationTx(tx, r0.locationId);
    const r = await openBookingTx(tx, id);
    const { at, day, tz } = await momentTx(tx, input.date, input.time);
    if (at.getTime() !== r.reservedFor.getTime() && at.getTime() < now.getTime() - 15 * 60_000) throw new AppError("That time has passed — choose a time from now.", "VALIDATION", { time: "Past" });
    await clashTx(tx, r.locationId, at, r.id, tz);
    const guestId = await resolveGuest(tx, { fullName: input.name.trim().slice(0, 80), phone: normalizePhone(input.phone)! });
    const updated = await tx.tableReservation.update({
      where: { id }, data: { guestId, reservedFor: at, date: toDbDate(day), guestCount: input.guestCount, notes: input.notes?.trim().slice(0, 300) || null, updatedById: actor.userId ?? null },
    });
    await audit(tx, actor, {
      action: "table_reservation.edited", entityType: "TableReservation", entityId: id,
      before: { at: r.reservedFor.toISOString(), guests: r.guestCount, guest: r.guestId, notes: r.notes }, after: { at: at.toISOString(), guests: input.guestCount, guest: guestId, notes: updated.notes },
    });
    return updated;
  }
}

/** Confirmed with the customer; cancelled (with the reason); or they did not come. */
export async function setTableReservationStatus(id: string, to: "CONFIRMED" | "CANCELLED" | "NO_SHOW", opts: { reason?: string | null }, actor: Actor, now = new Date()) {
  assertBook(actor);
  const reason = opts.reason?.trim().slice(0, 200) || null;
  if (to === "CANCELLED" && !reason) throw new AppError("Say why it is cancelled.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    let last = null;
    for (const rid of await partyRowsTx(tx, id)) last = await statusOneTx(tx, rid, to, reason, actor, now);
    return last!;
  });
}
async function statusOneTx(tx: Tx, id: string, to: "CONFIRMED" | "CANCELLED" | "NO_SHOW", reason: string | null, actor: Actor, now: Date) {
  {
    const r = await openBookingTx(tx, id);
    if (to === "CONFIRMED" && r.status === "CONFIRMED") return r;
    if (to === "NO_SHOW" && r.reservedFor.getTime() > now.getTime()) throw new AppError("It is not their time yet — cancel it instead if they called.", "VALIDATION");
    const data: Prisma.TableReservationUpdateInput = { status: to, updatedBy: { connect: { id: actor.userId! } } };
    if (to === "CONFIRMED") data.confirmedAt = now;
    if (to === "CANCELLED") { data.cancelledAt = now; data.cancelReason = reason; }
    if (to === "NO_SHOW") data.noShowAt = now;
    const updated = await tx.tableReservation.update({ where: { id }, data });
    await audit(tx, actor, { action: `table_reservation.${to.toLowerCase()}`, entityType: "TableReservation", entityId: id, before: { status: r.status }, after: { status: to, reason } });
    return updated;
  }
}

/** Give the reservation another table before they come — the same reservation, the move kept. */
export async function moveTableReservation(id: string, toLocationId: string, opts: { reason?: string | null }, actor: Actor) {
  assertBook(actor);
  return db.$transaction(async (tx) => {
    const r0 = await tx.tableReservation.findUnique({ where: { id }, select: { locationId: true } });
    if (!r0) throw new AppError("Reservation not found.", "NOT_FOUND");
    for (const lid of [r0.locationId, toLocationId].sort()) await lockLocationTx(tx, lid);
    const r = await openBookingTx(tx, id);
    const to = await tableTx(tx, toLocationId);
    if (to.id === r.locationId) throw new AppError(`It is already for ${to.name}.`, "VALIDATION");
    const settings = await getSettings();
    await clashTx(tx, to.id, r.reservedFor, r.id, settings.timezone);
    const reason = opts.reason?.trim().slice(0, 200) || null;
    await tx.tableReservation.update({ where: { id }, data: { locationId: to.id, updatedById: actor.userId ?? null } });
    await tx.tableMove.create({ data: { tableReservationId: id, fromLocationId: r.locationId, toLocationId: to.id, reason, byId: actor.userId ?? null, byLabel: actor.label ?? null } });
    await audit(tx, actor, { action: "table_reservation.moved", entityType: "TableReservation", entityId: id, before: { table: r.location.name }, after: { table: to.name, reason } });
    return { from: r.location.name, to: to.name };
  });
}

export type ReservationRow = {
  id: string; reference: string; status: TableReservationStatus; at: string; date: string; guests: number; notes: string | null;
  customer: { id: string; name: string; phone: string | null };
  table: { id: string; name: string };
  createdBy: string | null; updatedBy: string | null; createdAt: string; cancelReason: string | null;
  moves: { at: string; from: string; to: string; by: string | null; reason: string | null }[];
  session: { id: string; number: string; status: string } | null;
  /** A party on several tables: its id (rows with the same id are one booking). */
  partyId: string | null;
};

/** Reservations by day (and search by name, phone or reference — any day). */
export async function listTableReservations(opts: { from: BusinessDate; to: BusinessDate; q?: string | null; status?: "open" | "all" }): Promise<ReservationRow[]> {
  const q = opts.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const phone = digits.length >= 6 ? normalizePhone(q!) ?? digits : null;
  const where: Prisma.TableReservationWhereInput = q
    ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { guest: { fullName: { contains: q, mode: "insensitive" } } }, ...(phone ? [{ guest: { phone: { contains: phone.slice(-9) } } }] : [])] }
    : { date: { gte: toDbDate(opts.from), lte: toDbDate(opts.to) }, ...(opts.status === "open" ? { status: { in: OPEN_BOOKING } } : {}) };
  const rows = await db.tableReservation.findMany({
    where, orderBy: { reservedFor: "asc" }, take: 300,
    include: {
      guest: { select: { id: true, fullName: true, phone: true } }, location: { select: { id: true, name: true } },
      createdBy: { select: { fullName: true } }, updatedBy: { select: { fullName: true } }, session: { select: { id: true, number: true, status: true } },
      moves: { orderBy: { at: "asc" }, include: { fromLocation: { select: { name: true } }, toLocation: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id, reference: r.reference, status: r.status, at: r.reservedFor.toISOString(), date: r.date.toISOString().slice(0, 10), guests: r.guestCount, notes: r.notes,
    customer: { id: r.guest.id, name: r.guest.fullName, phone: r.guest.phone }, table: { id: r.location.id, name: r.location.name },
    createdBy: r.createdBy?.fullName ?? null, updatedBy: r.updatedBy?.fullName ?? null, createdAt: r.createdAt.toISOString(), cancelReason: r.cancelReason,
    moves: r.moves.map((m) => ({ at: m.at.toISOString(), from: m.fromLocation.name, to: m.toLocation.name, by: m.byLabel, reason: m.reason })),
    session: r.session, partyId: r.partyId,
  }));
}

/** For the form: a reservation's date and time in hotel time. */
export function reservationClock(at: Date, tz: string) {
  const p = localParts(at, tz);
  return { date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` };
}
