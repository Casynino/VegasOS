import "server-only";
import { db } from "../db";
import { addDays, businessDayBounds, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { ReservationStatus, RestaurantOrderStatus, RoomStatus } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";
import { assertConsoleAccess, safe, type ConsoleUser } from "./developer-console";
import { consoleFrame, countPerDay, HOUR_MS, plainName } from "./developer-frame";
import { SHIFT_OPEN_LIMIT_HOURS } from "./developer-health";
import { guestMovement, occupancy } from "./reporting";
import { checkedInWithin, checkedOutWithin } from "./room-sales";
import { getShiftOverview } from "./shifts";
import { newRequestCount, openRequestCount } from "./booking-requests";

/**
 * THE HOTEL TAB (owner, 2026-10-18): what is really happening in the hotel, read-only, for the Developer to understand the business
 * and spot trouble. Nothing here is a second copy of a figure: occupancy, check-ins, check-outs, new bookings, sales and the open
 * shift come from the same services the Boss's reports and the front desk use (reporting.ts, room-sales.ts, shifts.ts,
 * booking-requests.ts); only the plain counts that have no shared service are counted here, with the hotel's own day (04:00 → 04:00),
 * never UTC midnight. Every part is bounded (a 14-day window or a `take`) and a part that cannot be read is null — the rest still shows.
 *
 * Every function checks, again, that the caller is the Developer holding "developer.access" (assertConsoleAccess).
 */

/** Restaurant orders the kitchen / waiter has not finished serving (the tables board's "not served yet"). */
export const UNSERVED_ORDER_STATUSES: RestaurantOrderStatus[] = ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
/** Guest requests nobody has finished. */
export const OPEN_REQUEST_STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS"] as const;
/** Bookings waiting to arrive (the front desk's list). */
const WAITING: ReservationStatus[] = ["RESERVED", "CONFIRMED", "INQUIRY"];
/** An order still unserved after this many hotel days is not looked for (the index is on the order's day). */
export const OPEN_LOOKBACK_DAYS = 30;
/** How many rows a table of this tab shows. */
export const HOTEL_ROWS = { movement: 15, orders: 10, requests: 10 } as const;

export const ORDER_STATUS_WORDS: Record<RestaurantOrderStatus, string> = {
  PENDING: msg("New"), ACCEPTED: msg("Accepted"), PREPARING: msg("Preparing"), READY: msg("Ready to serve"), OUT_FOR_DELIVERY: msg("Serving"),
  DELIVERED: msg("Served · to pay"), COMPLETED: msg("Completed"), CANCELLED: msg("Cancelled"), COLLECTED: msg("Collected"),
};

const minutesSince = (at: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));

export interface MovementRow { id: string; reference: string; guest: string; rooms: string[]; status: ReservationStatus; /** Arrivals: due on an earlier day and still not here. Departures: due on an earlier day and still in the hotel. */ late: boolean }
export interface OrderRow { id: string; number: string; table: string | null; room: string | null; waiter: string | null; status: RestaurantOrderStatus; minutes: number }
export interface RequestRow { id: string; type: string; room: string | null; guest: string | null; status: string; minutes: number }

export interface HotelData {
  today: BusinessDate;
  dayStart: string;
  /** The last 14 hotel days, oldest first, ending today. */
  days: BusinessDate[];
  cards: {
    /** Rooms with a guest in them right now, of all guest rooms (the meeting room is not counted). */
    rooms: { occupied: number; total: number; percent: number | null } | null;
    /** The Boss's occupancy for today (nights sold ÷ rooms to sell) — not the same thing as "rooms with a guest right now". */
    bossOccupancy: { percent: number; nights: number; sellable: number } | null;
    inHouse: { people: number; bookings: number } | null;
    arrivals: { checkedIn: number; expected: number } | null;
    departures: { checkedOut: number; expected: number } | null;
    housekeeping: { toClean: number; outOfService: number } | null;
    shifts: { who: string; since: Date; hours: number; long: boolean }[] | null;
    orders: { open: number; oldestMinutes: number | null } | null;
    requests: { open: number; oldestMinutes: number | null } | null;
    bookingRequests: { open: number; fresh: number } | null;
  };
  occupancyPerDay: { date: BusinessDate; percent: number; nights: number; sellable: number }[] | null;
  movementPerDay: { date: BusinessDate; checkIns: number; checkOuts: number }[] | null;
  ordersPerDay: { date: BusinessDate; orders: number; total: number }[] | null;
  /** The sources new bookings came from in the 14 days (biggest first) and, per day, how many from each. */
  bookingsPerDay: { sources: { id: string; name: string; code: string; count: number }[]; days: { date: BusinessDate; bySource: Record<string, number> }[] } | null;
  arrivals: { rows: MovementRow[]; total: number } | null;
  departures: { rows: MovementRow[]; total: number } | null;
  longestOrders: OrderRow[] | null;
  openRequests: RequestRow[] | null;
  roomsByStatus: { status: RoomStatus; count: number }[] | null;
}

export async function hotelData(user: ConsoleUser, now = new Date()): Promise<HotelData> {
  assertConsoleAccess(user);
  const f = await consoleFrame(now);
  const { cfg, today, days } = f;
  const d = toDbDate(today);
  const dayBounds = businessDayBounds(today, cfg);
  const range = { gte: toDbDate(days[0]), lte: d };
  const openSince = toDbDate(addDays(today, -OPEN_LOOKBACK_DAYS));
  const guestRoom = { isActive: true, roomType: { category: "GUEST_ROOM" as const } };

  const [
    roomGroups, cleaning, blocked, movement, occupied14, waiting, leaving, people, shiftOverview, ordersOpen, ordersOldest, requestsOpen, requestRows, bookingOpen,
    checkIns14, checkOuts14, orders14, bookings14, sources, arrivalRows, arrivalTotal, departureRows, departureTotal,
  ] = await Promise.all([
    safe(() => db.room.groupBy({ by: ["status"], where: guestRoom, _count: true })),
    safe(() => db.room.count({ where: { isActive: true, status: { in: ["DIRTY", "CLEANING"] } } })),
    safe(() => db.room.count({ where: { isActive: true, status: { in: ["MAINTENANCE", "OUT_OF_SERVICE"] } } })),
    safe(() => guestMovement({ from: today, to: today })),
    safe(() => occupancy({ from: days[0], to: today })),
    safe(() => db.reservation.count({ where: { kind: "STAY", status: { in: WAITING }, arrivalDate: { lte: d } } })),
    safe(() => db.reservation.count({ where: { kind: "STAY", status: "CHECKED_IN", departureDate: { lte: d } } })),
    safe(() => db.reservationRoom.aggregate({ where: { status: "CHECKED_IN", roomType: { category: "GUEST_ROOM" } }, _sum: { adults: true, children: true } })),
    safe(() => getShiftOverview(today)),
    safe(() => db.restaurantOrder.count({ where: { status: { in: UNSERVED_ORDER_STATUSES }, businessDate: { gte: openSince } } })),
    safe(() => db.restaurantOrder.findMany({
      where: { status: { in: UNSERVED_ORDER_STATUSES }, businessDate: { gte: openSince } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: HOTEL_ROWS.orders,
      select: { id: true, number: true, status: true, tableLabel: true, roomNumber: true, createdAt: true, assignedTo: { select: { fullName: true } }, acceptedBy: { select: { fullName: true } }, createdBy: { select: { fullName: true } } },
    })),
    safe(() => db.serviceRequest.count({ where: { status: { in: [...OPEN_REQUEST_STATUSES] } } })),
    safe(() => db.serviceRequest.findMany({
      where: { status: { in: [...OPEN_REQUEST_STATUSES] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: HOTEL_ROWS.requests,
      select: { id: true, type: true, status: true, createdAt: true, room: { select: { number: true } }, guest: { select: { fullName: true } } },
    })),
    // Reception's own badge: every request still new and every request still open, on ANY day (one that came yesterday and was never touched counts).
    safe(async () => ({ openNow: await openRequestCount(), new: await newRequestCount() })),
    safe(() => db.reservationRoom.findMany({ where: checkedInWithin(f.start, f.end), select: { checkedInAt: true }, take: 5000 })),
    safe(() => db.reservationRoom.findMany({ where: checkedOutWithin(f.start, f.end), select: { checkedOutAt: true }, take: 5000 })),
    safe(() => db.restaurantOrder.groupBy({ by: ["businessDate"], where: { businessDate: range, status: { not: "CANCELLED" } }, _count: true, _sum: { total: true } })),
    safe(() => db.reservation.groupBy({ by: ["businessDate", "sourceId"], where: { kind: "STAY", businessDate: range }, _count: true })),
    safe(() => db.bookingSource.findMany({ select: { id: true, name: true, code: true } })),
    safe(() => {
      // Due today (any state) and late (due earlier, still not here).
      const where = { kind: "STAY" as const, OR: [{ arrivalDate: d, status: { notIn: ["CANCELLED" as const] } }, { arrivalDate: { lt: d }, status: { in: WAITING } }] };
      return db.reservation.findMany({
        where, orderBy: [{ arrivalDate: "desc" }, { eta: "asc" }, { createdAt: "asc" }], take: HOTEL_ROWS.movement,
        select: { id: true, reference: true, status: true, arrivalDate: true, guest: { select: { fullName: true } }, rooms: { where: { status: { not: "CANCELLED" } }, select: { room: { select: { number: true } } } } },
      });
    }),
    safe(() => db.reservation.count({ where: { kind: "STAY", OR: [{ arrivalDate: d, status: { notIn: ["CANCELLED"] } }, { arrivalDate: { lt: d }, status: { in: WAITING } }] } })),
    safe(() => {
      // Still in the hotel and due out (today or earlier), and the guests who left during today's hotel day.
      const where = { kind: "STAY" as const, OR: [{ status: "CHECKED_IN" as const, departureDate: { lte: d } }, { status: "CHECKED_OUT" as const, rooms: { some: checkedOutWithin(dayBounds.start, dayBounds.end) } }] };
      return db.reservation.findMany({
        where, orderBy: [{ departureDate: "asc" }, { createdAt: "asc" }], take: HOTEL_ROWS.movement,
        select: { id: true, reference: true, status: true, departureDate: true, guest: { select: { fullName: true } }, rooms: { where: { status: { not: "CANCELLED" } }, select: { room: { select: { number: true } } } } },
      });
    }),
    safe(() => db.reservation.count({ where: { kind: "STAY", OR: [{ status: "CHECKED_IN", departureDate: { lte: d } }, { status: "CHECKED_OUT", rooms: { some: checkedOutWithin(dayBounds.start, dayBounds.end) } }] } })),
  ]);

  // ── rooms ──
  const status = (s: RoomStatus) => roomGroups?.find((g) => g.status === s)?._count ?? 0;
  const totalRooms = roomGroups ? roomGroups.reduce((n, g) => n + g._count, 0) : 0;
  const rooms = roomGroups ? { occupied: status("OCCUPIED"), total: totalRooms, percent: totalRooms ? Math.round((status("OCCUPIED") / totalRooms) * 100) : null } : null;
  const todayOcc = occupied14?.series.find((s) => s.date === today);
  const bossOccupancy = todayOcc ? { percent: Math.round(todayOcc.occupancy), nights: todayOcc.roomNights, sellable: todayOcc.sellable } : null;

  // ── the open shift(s) at the desk ──
  const shifts = shiftOverview
    ? shiftOverview.openAll.map((s) => {
        const hours = Math.floor((now.getTime() - s.startedAt.getTime()) / HOUR_MS);
        return { who: plainName(s.user.fullName), since: s.startedAt, hours, long: now.getTime() - s.startedAt.getTime() > SHIFT_OPEN_LIMIT_HOURS * HOUR_MS };
      })
    : null;

  // ── per day ──
  const movementPerDay = checkIns14 && checkOuts14
    ? (() => {
        const ins = countPerDay(checkIns14.flatMap((r) => (r.checkedInAt ? [r.checkedInAt] : [])), days, cfg);
        const outs = countPerDay(checkOuts14.flatMap((r) => (r.checkedOutAt ? [r.checkedOutAt] : [])), days, cfg);
        return days.map((date) => ({ date, checkIns: ins[date], checkOuts: outs[date] }));
      })()
    : null;
  const ordersPerDay = orders14
    ? days.map((date) => {
        const row = orders14.find((o) => fromDbDate(o.businessDate) === date);
        return { date, orders: row?._count ?? 0, total: row?._sum.total ?? 0 };
      })
    : null;
  let bookingsPerDay: HotelData["bookingsPerDay"] = null;
  if (bookings14 && sources) {
    const name = new Map(sources.map((s) => [s.id, s]));
    const totals = new Map<string, number>();
    for (const b of bookings14) totals.set(b.sourceId, (totals.get(b.sourceId) ?? 0) + b._count);
    const list = [...totals].sort((a, b) => b[1] - a[1] || (name.get(a[0])?.name ?? "").localeCompare(name.get(b[0])?.name ?? ""))
      .map(([id, count]) => ({ id, name: name.get(id)?.name ?? msg("Unknown"), code: name.get(id)?.code ?? "", count }));
    bookingsPerDay = {
      sources: list,
      days: days.map((date) => ({ date, bySource: Object.fromEntries(bookings14.filter((b) => fromDbDate(b.businessDate) === date).map((b) => [b.sourceId, b._count])) })),
    };
  }

  // ── tables ──
  const roomsOf = (r: { rooms: { room: { number: string } }[] }) => [...new Set(r.rooms.map((x) => x.room.number))];
  const arrivals = arrivalRows && arrivalTotal !== null
    ? { total: arrivalTotal, rows: arrivalRows.map((r): MovementRow => ({ id: r.id, reference: r.reference, guest: r.guest.fullName, rooms: roomsOf(r), status: r.status, late: fromDbDate(r.arrivalDate) < today })) }
    : null;
  const departures = departureRows && departureTotal !== null
    ? { total: departureTotal, rows: departureRows.map((r): MovementRow => ({ id: r.id, reference: r.reference, guest: r.guest.fullName, rooms: roomsOf(r), status: r.status, late: r.status === "CHECKED_IN" && fromDbDate(r.departureDate) < today })) }
    : null;
  const longestOrders = ordersOldest
    ? ordersOldest.map((o): OrderRow => ({
        id: o.id, number: o.number, table: o.tableLabel, room: o.roomNumber, status: o.status, minutes: minutesSince(o.createdAt, now),
        waiter: (() => { const w = o.assignedTo ?? o.acceptedBy ?? o.createdBy; return w ? plainName(w.fullName) : null; })(),
      }))
    : null;
  const openRequests = requestRows
    ? requestRows.map((r): RequestRow => ({ id: r.id, type: r.type, room: r.room?.number ?? null, guest: r.guest?.fullName ?? null, status: r.status, minutes: minutesSince(r.createdAt, now) }))
    : null;

  return {
    today, dayStart: f.dayStart, days,
    cards: {
      rooms, bossOccupancy,
      inHouse: movement && people ? { people: (people._sum.adults ?? 0) + (people._sum.children ?? 0), bookings: movement.inHouse } : null,
      arrivals: movement && waiting !== null ? { checkedIn: movement.checkIns, expected: waiting } : null,
      departures: movement && leaving !== null ? { checkedOut: movement.checkOuts, expected: leaving } : null,
      housekeeping: cleaning !== null && blocked !== null ? { toClean: cleaning, outOfService: blocked } : null,
      shifts,
      orders: ordersOpen !== null && ordersOldest ? { open: ordersOpen, oldestMinutes: ordersOldest[0] ? minutesSince(ordersOldest[0].createdAt, now) : null } : null,
      requests: requestsOpen !== null && requestRows ? { open: requestsOpen, oldestMinutes: requestRows[0] ? minutesSince(requestRows[0].createdAt, now) : null } : null,
      bookingRequests: bookingOpen ? { open: bookingOpen.openNow, fresh: bookingOpen.new } : null,
    },
    occupancyPerDay: occupied14 ? occupied14.series.map((s) => ({ date: s.date, percent: Math.round(s.occupancy), nights: s.roomNights, sellable: s.sellable })) : null,
    movementPerDay, ordersPerDay, bookingsPerDay, arrivals, departures, longestOrders, openRequests,
    roomsByStatus: roomGroups ? roomGroups.map((g) => ({ status: g.status, count: g._count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)) : null,
  };
}
