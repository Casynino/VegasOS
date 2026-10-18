import "server-only";
import { db } from "../db";
import { addDays, businessRangeBounds, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { ReservationStatus, RoomStatus } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";
import { assertConsoleAccess, safe, type ConsoleUser } from "./developer-console";
import { consoleFrame } from "./developer-frame";
import { guestMovement } from "./reporting";

/**
 * THE HOTEL, AT A GLANCE (owner, 2026-10-18; the "Hotel" part of "The business, for awareness" on the Developer Home): what is in the
 * system and where it is. The hotel's work, not the Developer's — read-only, and ONLY COUNTS and plain words: never a guest's name or
 * phone, never an amount, never what a guest wrote. The latest-bookings table does not even read the guest (the query has no `guest`).
 *
 * Nothing is a second copy of a Boss figure: "bookings added" and "in the hotel" come from reporting.guestMovement (the Boss's own
 * numbers); only the plain counts that have no shared service are counted here, on the hotel's own day (04:00 → 04:00), never UTC midnight.
 * Every query is wrapped in safe() so one that fails leaves ITS figure null and the rest still draws; every one is bounded (a count, a
 * grouped count over a 14/30-day window, or a `take`).
 *
 * Only the Developer account holding "developer.access" (and not while working as someone) may call it: assertConsoleAccess, again.
 */

/** Bookings that are still alive: waiting to arrive, or in the hotel now. */
export const ALIVE_STAGES: ReservationStatus[] = ["INQUIRY", "RESERVED", "CONFIRMED", "CHECKED_IN"];
/** Every stage a booking can be in, in the order a booking lives through them. */
export const BOOKING_STAGES: ReservationStatus[] = ["INQUIRY", "RESERVED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"];
/** The plain word for each stage. */
export const BOOKING_STAGE_WORDS: Record<ReservationStatus, string> = {
  INQUIRY: msg("Inquiry"), RESERVED: msg("Reserved"), CONFIRMED: msg("Confirmed"), CHECKED_IN: msg("Checked in"),
  CHECKED_OUT: msg("Checked out"), CANCELLED: msg("Cancelled"), NO_SHOW: msg("No-show"),
};
/** How many bookings the "Latest bookings" table shows, and how many room numbers one row names before "+n". */
export const LATEST_ROWS = 8;
export const ROOMS_SHOWN = 3;
/** The windows, in hotel days: "bookings added", "where bookings come from" and "new guests". */
export const ADDED_DAYS = 7;
export const SOURCE_DAYS = 30;
export const NEW_GUEST_DAYS = 30;

export interface SourceCount { id: string; name: string; code: string; count: number }
export interface LatestBooking {
  id: string;
  /** The booking's reference (VLH-…), the only thing that names it. */
  reference: string;
  status: ReservationStatus;
  /** At most ROOMS_SHOWN room numbers. */
  rooms: string[];
  /** How many rooms the booking holds in all (so "+n" is exact). */
  roomCount: number;
  arrives: BusinessDate;
  leaves: BusinessDate;
}

export interface HotelGlance {
  today: BusinessDate;
  dayStart: string;
  /** The last 14 hotel days, oldest first, ending today. */
  days: BusinessDate[];
  /** When this was read (the Rooms panel says "as of …"). */
  readAt: Date;
  cards: {
    /** Bookings still to come or in the hotel now, out of all room bookings ever made. */
    bookings: { alive: number; ever: number } | null;
    /** Bookings made in the last 7 hotel days (the Boss's "new bookings"). */
    added: { count: number; days: number } | null;
    /** Guest rooms with someone in them now, of all active guest rooms (the meeting room is not counted). */
    rooms: { occupied: number; total: number; percent: number | null } | null;
    /** Guest records in the customer database, and how many of them were added in the last 30 hotel days. COUNTS ONLY. */
    guests: { total: number; added: number } | null;
  };
  /** The sources of the 14 days (biggest first) and, per day, how many bookings came from each. */
  addedPerDay: { sources: SourceCount[]; days: { date: BusinessDate; bySource: Record<string, number> }[] } | null;
  /** Where the bookings of the last 30 days came from (biggest first; a source with none is left out). */
  sources: SourceCount[] | null;
  /** Every stage, in lifecycle order, with how many bookings are in it (a stage with none says 0). */
  stages: { status: ReservationStatus; count: number }[] | null;
  /** The newest bookings, by when they were made. No guest. */
  latest: LatestBooking[] | null;
  /** The subtitle of the latest bookings: due today, in the hotel, to leave. */
  movement: { arriving: number; inHouse: number; leaving: number } | null;
  /** Every active guest room, once, in one of four states (they add up to `total`). */
  roomStates: { occupied: number; ready: number; cleaning: number; outOfService: number; total: number } | null;
}

/** Room status → the four states the panel shows: ready to sell (available, reserved, ready), occupied, dirty or being cleaned, out of service. */
const READY_STATUSES: RoomStatus[] = ["AVAILABLE", "RESERVED", "READY"];
const CLEANING_STATUSES: RoomStatus[] = ["DIRTY", "CLEANING"];
const OUT_STATUSES: RoomStatus[] = ["MAINTENANCE", "OUT_OF_SERVICE"];

export async function hotelGlance(user: ConsoleUser, now = new Date()): Promise<HotelGlance> {
  assertConsoleAccess(user);
  const f = await consoleFrame(now);
  const { cfg, today, days } = f;
  const d = toDbDate(today);
  const sourceFrom = toDbDate(addDays(today, -(SOURCE_DAYS - 1)));
  const newGuestsSince = businessRangeBounds(addDays(today, -(NEW_GUEST_DAYS - 1)), today, cfg).start;
  const stay = { kind: "STAY" as const };
  const guestRoom = { isActive: true, roomType: { category: "GUEST_ROOM" as const } };

  const [stageGroups, movement, perDay14, sources30, sourceRows, latestRows, arriving, leaving, roomGroups, guestsTotal, guestsAdded] = await Promise.all([
    safe(() => db.reservation.groupBy({ by: ["status"], where: stay, _count: true })),
    // The Boss's own figures: new bookings in the last 7 hotel days, and the bookings in the hotel now.
    safe(() => guestMovement({ from: f.weekFrom, to: today })),
    safe(() => db.reservation.groupBy({ by: ["businessDate", "sourceId"], where: { ...stay, businessDate: { gte: toDbDate(days[0]), lte: d } }, _count: true })),
    safe(() => db.reservation.groupBy({ by: ["sourceId"], where: { ...stay, businessDate: { gte: sourceFrom, lte: d } }, _count: true })),
    safe(() => db.bookingSource.findMany({ select: { id: true, name: true, code: true }, take: 200 })),
    safe(() => db.reservation.findMany({
      where: stay, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LATEST_ROWS,
      // No guest here, on purpose: this table must never be able to show a name or a phone number.
      select: { id: true, reference: true, status: true, arrivalDate: true, departureDate: true, rooms: { where: { status: { not: "CANCELLED" } }, orderBy: { room: { number: "asc" } }, take: 50, select: { room: { select: { number: true } } } } },
    })),
    // Guests still to come today (the front desk's waiting list): one who has checked in is already "in the hotel".
    safe(() => db.reservation.count({ where: { ...stay, arrivalDate: d, status: { in: ["INQUIRY", "RESERVED", "CONFIRMED"] } } })),
    // Guests in the hotel whose check-out day is today or earlier (the front desk's "still to leave").
    safe(() => db.reservation.count({ where: { ...stay, status: "CHECKED_IN", departureDate: { lte: d } } })),
    safe(() => db.room.groupBy({ by: ["status"], where: guestRoom, _count: true })),
    safe(() => db.guest.count({ where: { deletedAt: null } })),
    safe(() => db.guest.count({ where: { deletedAt: null, createdAt: { gte: newGuestsSince } } })),
  ]);

  // ── stages ──
  const stageCount = (s: ReservationStatus) => stageGroups?.find((g) => g.status === s)?._count ?? 0;
  const stages = stageGroups ? BOOKING_STAGES.map((status) => ({ status, count: stageCount(status) })) : null;
  const bookings = stageGroups
    ? { alive: ALIVE_STAGES.reduce((n, s) => n + stageCount(s), 0), ever: stageGroups.reduce((n, g) => n + g._count, 0) }
    : null;

  // ── rooms ──
  const roomCount = (list: RoomStatus[]) => roomGroups?.filter((g) => list.includes(g.status)).reduce((n, g) => n + g._count, 0) ?? 0;
  const roomStates = roomGroups
    ? { occupied: roomCount(["OCCUPIED"]), ready: roomCount(READY_STATUSES), cleaning: roomCount(CLEANING_STATUSES), outOfService: roomCount(OUT_STATUSES), total: roomGroups.reduce((n, g) => n + g._count, 0) }
    : null;
  const rooms = roomStates
    ? { occupied: roomStates.occupied, total: roomStates.total, percent: roomStates.total ? Math.round((roomStates.occupied / roomStates.total) * 100) : null }
    : null;

  // ── sources ──
  const named = sourceRows ? new Map(sourceRows.map((s) => [s.id, s])) : null;
  const sourceOf = (id: string, count: number): SourceCount => ({ id, name: named?.get(id)?.name ?? msg("Unknown"), code: named?.get(id)?.code ?? "", count });
  const byBiggest = (a: SourceCount, b: SourceCount) => b.count - a.count || a.name.localeCompare(b.name);
  let addedPerDay: HotelGlance["addedPerDay"] = null;
  if (perDay14 && named) {
    const totals = new Map<string, number>();
    for (const g of perDay14) totals.set(g.sourceId, (totals.get(g.sourceId) ?? 0) + g._count);
    addedPerDay = {
      sources: [...totals].map(([id, count]) => sourceOf(id, count)).sort(byBiggest),
      days: days.map((date) => ({ date, bySource: Object.fromEntries(perDay14.filter((g) => fromDbDate(g.businessDate) === date).map((g) => [g.sourceId, g._count])) })),
    };
  }
  const sources = sources30 && named ? sources30.map((g) => sourceOf(g.sourceId, g._count)).filter((s) => s.count > 0).sort(byBiggest) : null;

  // ── latest ──
  const latest = latestRows
    ? latestRows.map((r): LatestBooking => {
        const numbers = [...new Set(r.rooms.map((x) => x.room.number))];
        return { id: r.id, reference: r.reference, status: r.status, rooms: numbers.slice(0, ROOMS_SHOWN), roomCount: numbers.length, arrives: fromDbDate(r.arrivalDate), leaves: fromDbDate(r.departureDate) };
      })
    : null;

  return {
    today, dayStart: f.dayStart, days, readAt: now,
    cards: {
      bookings,
      added: movement ? { count: movement.newBookings, days: ADDED_DAYS } : null,
      rooms,
      guests: guestsTotal !== null && guestsAdded !== null ? { total: guestsTotal, added: guestsAdded } : null,
    },
    addedPerDay, sources, stages, latest,
    movement: movement && arriving !== null && leaving !== null ? { arriving, inHouse: movement.inHouse, leaving } : null,
    roomStates,
  };
}
