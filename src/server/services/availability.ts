import "server-only";
import { db, type Tx } from "../db";
import { addDays, businessDateOf, toDbDate, zonedInstant, type BusinessDate } from "@/lib/time/business-date";
import { DEFAULT_STAY_CONFIG, type Stay } from "@/lib/time/stay";
import type { RoomCategory, RoomStatus } from "@/generated/prisma/enums";

/**
 * Availability engine — the ONLY place that decides whether a room is free.
 * Used identically by the public website, reception, and the final
 * re-validation inside the booking transaction. The database exclusion
 * constraint is the last line of defence behind it.
 *
 * A room is available for a stay when:
 *  - the room and its type are active,
 *  - no maintenance / out-of-service block overlaps the stay's business dates,
 *  - no active stay (reserved / confirmed / checked-in) overlaps [startAt, endAt).
 *    A checked-in guest who has overstayed keeps the room until checked out: past their check-out time they hold it
 *    through tonight (it is not sold over them — reception checks them out first).
 *  - it is the right kind of room: guest rooms for stays, meeting rooms for
 *    meetings (asking for specific `roomIds` skips this — the caller chose them).
 */

export interface AvailableRoom {
  id: string;
  number: string;
  roomTypeId: string;
  floor: number | null;
  status: RoomStatus;
}

export interface AvailabilityQuery {
  stay: Pick<Stay, "startAt" | "endAt" | "arrivalDate" | "departureDate" | "isDayUse">;
  roomTypeId?: string | null;
  roomIds?: string[];
  excludeReservationRoomId?: string | null;
  /** Which rooms to search: guest rooms (default) or meeting rooms. */
  category?: RoomCategory;
  /** The moment the question is asked (tests); now by default. */
  now?: Date;
}

/**
 * Until when an overnight guest still checked in after their check-out time keeps the room: through tonight — the
 * check-out time after the current hotel night (owner, 2026-10-05: never sell a room someone is still in). Reception
 * sees them on the overdue check-out list; once checked out, the room is free.
 */
export function inHouseUntil(s: { timezone: string; businessDayStartMinutes: number; checkoutMinutes: number }, now = new Date()): Date {
  return zonedInstant(addDays(businessDateOf(now, s), 1), s.checkoutMinutes, s.timezone);
}

export async function findAvailableRooms(q: AvailabilityQuery, client: Tx | typeof db = db): Promise<AvailableRoom[]> {
  const { stay } = q;
  const blockFrom = toDbDate(stay.arrivalDate);
  const blockTo = toDbDate(stay.isDayUse ? addDays(stay.arrivalDate, 1) : stay.departureDate);
  const start = stay.startAt.toISOString();
  const end = stay.endAt.toISOString();
  const typeId = q.roomTypeId ?? null;
  const exclude = q.excludeReservationRoomId ?? "";
  const roomIds = q.roomIds && q.roomIds.length ? q.roomIds : null;
  const category = q.category ?? "GUEST_ROOM";
  const now = q.now ?? new Date();
  const settings = await client.hotelSettings.findUnique({ where: { id: 1 }, select: { timezone: true, businessDayStartMinutes: true, checkoutMinutes: true } });
  const nowAt = now.toISOString();
  const overstayUntil = inHouseUntil(settings ?? DEFAULT_STAY_CONFIG, now).toISOString();

  return client.$queryRaw<AvailableRoom[]>`
    SELECT r."id", r."number", r."roomTypeId", r."floor", r."status"
    FROM "rooms" r
    JOIN "room_types" t ON t."id" = r."roomTypeId"
    WHERE r."isActive" AND t."isActive"
      AND (${roomIds}::text[] IS NOT NULL OR t."category"::text = ${category})
      AND (${typeId}::text IS NULL OR r."roomTypeId" = ${typeId})
      AND (${roomIds}::text[] IS NULL OR r."id" = ANY(${roomIds}::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM "room_blocks" b
        WHERE b."roomId" = r."id"
          AND b."startDate" < ${blockTo}::date
          AND (b."endDate" IS NULL OR b."endDate" > ${blockFrom}::date)
      )
      AND NOT EXISTS (
        SELECT 1 FROM "reservation_rooms" rr
        WHERE rr."roomId" = r."id"
          AND rr."id" <> ${exclude}
          -- A no-show keeps its room until a manager releases it.
          AND (rr."status" IN ('RESERVED', 'CONFIRMED', 'CHECKED_IN') OR (rr."status" = 'NO_SHOW' AND rr."releasedAt" IS NULL))
          AND tsrange(
                rr."startAt",
                -- Still checked in past the check-out time: an overnight guest keeps the room through tonight
                -- (a short-time / meeting guest until now) — never sold over them.
                CASE WHEN rr."status" = 'CHECKED_IN' AND NOT rr."isDayUse" AND rr."endAt" <= ${nowAt}::timestamp
                     THEN ${overstayUntil}::timestamp
                     WHEN rr."status" = 'CHECKED_IN'
                     THEN GREATEST(rr."endAt", ${nowAt}::timestamp)
                     ELSE rr."endAt" END,
                '[)'
              ) && tsrange(${start}::timestamp, ${end}::timestamp, '[)')
      )
    ORDER BY
      CASE WHEN r."status" IN ('AVAILABLE', 'READY') THEN 0 ELSE 1 END,
      r."floor" NULLS LAST, r."number"`;
}

export interface TypeAvailability {
  roomTypeId: string;
  available: number;
}

/** Count of free rooms per room type for a stay (public search & quick booking). */
export async function availabilityByType(stay: AvailabilityQuery["stay"], category?: RoomCategory): Promise<Map<string, number>> {
  const rooms = await findAvailableRooms({ stay, category });
  const map = new Map<string, number>();
  for (const r of rooms) map.set(r.roomTypeId, (map.get(r.roomTypeId) ?? 0) + 1);
  return map;
}

/**
 * Serialise concurrent bookings of the same room types for the rest of the
 * transaction (sorted to avoid deadlocks). Combined with re-checking
 * availability after the lock, this makes auto-assignment race-free; the
 * exclusion constraint still guards every write.
 */
export async function lockRoomTypes(tx: Tx, roomTypeIds: string[]): Promise<void> {
  for (const id of [...new Set(roomTypeIds)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`roomtype:${id}`}))::text`;
  }
}

export interface DayAvailability { free: number; paid: number; unpaid: number }

/**
 * Guest rooms per night for a calendar: how many are free, how many are taken
 * by paid / confirmed bookings (or guests in the hotel), and how many are only
 * held by unpaid bookings — those can still be taken if the booking is not paid.
 */
export async function dayAvailability(from: BusinessDate, to: BusinessDate, now = new Date()) {
  const settings = await db.hotelSettings.findUnique({ where: { id: 1 }, select: { timezone: true, businessDayStartMinutes: true } });
  const today = toDbDate(businessDateOf(now, settings ?? DEFAULT_STAY_CONFIG));
  const [total, rows] = await Promise.all([
    db.room.count({ where: { isActive: true, roomType: { category: "GUEST_ROOM" } } }),
    db.reservationRoom.findMany({
      where: {
        isDayUse: false, roomType: { category: "GUEST_ROOM" }, arrivalDate: { lte: toDbDate(to) },
        OR: [
          { status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] }, departureDate: { gt: toDbDate(from) } },
          // Still in the room past their check-out time (not checked out yet): the room is taken tonight too.
          { status: "CHECKED_IN", endAt: { lte: now } },
        ],
      },
      select: { roomId: true, status: true, arrivalDate: true, departureDate: true, endAt: true, reservation: { select: { status: true } } },
    }),
  ]);
  const days: Record<string, DayAvailability> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dd = toDbDate(d).getTime();
    const paid = new Set<string>(), unpaid = new Set<string>();
    for (const r of rows) {
      const leaves = r.status === "CHECKED_IN" && r.endAt <= now ? Math.max(r.departureDate.getTime(), today.getTime() + 86_400_000) : r.departureDate.getTime();
      if (r.arrivalDate.getTime() > dd || leaves <= dd) continue;
      if (r.reservation.status === "RESERVED") unpaid.add(r.roomId); else paid.add(r.roomId);
    }
    for (const id of paid) unpaid.delete(id);
    days[d] = { free: Math.max(0, total - paid.size - unpaid.size), paid: paid.size, unpaid: unpaid.size };
  }
  return { total, days };
}
