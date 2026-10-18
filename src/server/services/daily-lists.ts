import "server-only";
import { breakfastHours, breakfastSchedule } from "@/lib/breakfast";
import { breakfastIncluded } from "@/server/services/breakfast";
import { db } from "../db";
import { audit } from "../audit";
import { isUniqueViolation } from "../errors";
import { getSettings, businessDayConfig } from "../settings";
import { businessDateOf, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { Prisma } from "@/generated/prisma/client";
import { isPlaceholderName } from "./guests";
import { stayState } from "./stays";
import { getT } from "@/i18n/server";
import { doneByText } from "@/lib/done-by-text";
import { developerMarks, markFor } from "./developer-marks";
import {
  breakfastFor, buildHousekeepingRows, occupiedServiceOf, sortGuestRows,
  type DailyListData, type GuestList, type GuestRow, type HkRoomInput, type HousekeepingList, type ListKind,
} from "@/lib/daily-lists";

/**
 * The two lists reception prints: the Daily Housekeeping Checklist and the In-House Guest & Breakfast List.
 *
 * Read-only and lean on purpose — the lists read the same rooms and bookings as the rest of the system and change
 * nothing; a printed copy is stored exactly as it was, so a reprint never shows different rooms or another time.
 * Guest rooms only: the meeting room is never on either list. Nothing private is read (no phone, ID or money).
 */

const json = (v: unknown) => v as Prisma.InputJsonValue;
const GUEST_ROOMS = { category: "GUEST_ROOM" } as const;
/** A real name, or nothing (stand-in names and removed customers are not names). */
const realName = (name: string | null | undefined) => (isPlaceholderName(name) || name === "Removed customer" ? null : name!.trim());

export async function buildHousekeepingList(now: Date = new Date()): Promise<HousekeepingList> {
  const settings = await getSettings();
  const today = businessDateOf(now, businessDayConfig(settings));
  const day = toDbDate(today);
  const [rooms, stays, arrivals, requests, blocks] = await Promise.all([
    db.room.findMany({
      where: { isActive: true, roomType: GUEST_ROOMS },
      select: { id: true, number: true, floor: true, status: true, statusNote: true, statusChangedAt: true, roomType: { select: { name: true } } },
    }),
    db.reservationRoom.findMany({
      where: { status: "CHECKED_IN", roomType: GUEST_ROOMS },
      select: { roomId: true, departureDate: true, endAt: true },
    }),
    db.reservationRoom.findMany({
      where: { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: day, roomType: GUEST_ROOMS },
      select: { roomId: true },
    }),
    db.serviceRequest.findMany({
      where: { type: "CLEANING", status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] }, roomId: { not: null } },
      select: { roomId: true, description: true },
      orderBy: { createdAt: "desc" },
    }),
    db.roomBlock.findMany({
      where: { startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gt: day } }] },
      select: { roomId: true, type: true, reason: true, endDate: true },
      orderBy: { startDate: "desc" },
    }),
  ]);

  const stayOf = new Map<string, (typeof stays)[number]>();
  // Two checked-in rows on one room should never happen; if they do, the one that leaves last is the guest in the room.
  for (const s of stays) { const had = stayOf.get(s.roomId); if (!had || s.endAt > had.endAt) stayOf.set(s.roomId, s); }
  const arriving = new Set(arrivals.map((a) => a.roomId));
  const requestOf = new Map<string, string>();
  for (const q of requests) if (q.roomId && !requestOf.has(q.roomId)) requestOf.set(q.roomId, q.description.trim());
  const blockOf = new Map<string, (typeof blocks)[number]>();
  for (const b of blocks) if (!blockOf.has(b.roomId)) blockOf.set(b.roomId, b);

  const input: HkRoomInput[] = rooms.map((r) => {
    const s = stayOf.get(r.id);
    const b = blockOf.get(r.id);
    return {
      roomId: r.id, room: r.number, type: r.roomType.name, floor: r.floor,
      status: r.status, statusNote: r.statusNote?.trim() || null, statusChangedAt: r.statusChangedAt.toISOString(),
      stay: s ? { state: stayState([s], today, now), leavesOn: fromDbDate(s.departureDate), leavesAt: s.endAt.toISOString() } : null,
      arrivalToday: arriving.has(r.id),
      request: requestOf.get(r.id) || null,
      block: b ? { type: b.type, reason: b.reason?.trim() || null, until: b.endDate ? fromDbDate(b.endDate) : null } : null,
    };
  });

  return {
    kind: "HOUSEKEEPING", date: today, generatedAt: now.toISOString(), timezone: settings.timezone,
    occupiedService: occupiedServiceOf(settings.occupiedRoomService), rows: buildHousekeepingRows(input),
  };
}

export async function buildGuestList(now: Date = new Date()): Promise<GuestList> {
  const settings = await getSettings();
  const today = businessDateOf(now, businessDayConfig(settings));
  const [stays, breakfast] = await Promise.all([
    // Only guests who are checked in now: not future bookings, not checked-out or cancelled ones.
    db.reservationRoom.findMany({
      where: { status: "CHECKED_IN", roomType: GUEST_ROOMS },
      select: {
        id: true, endAt: true, arrivalDate: true, departureDate: true, nights: true, isDayUse: true, adults: true, children: true, checkedInAt: true,
        room: { select: { number: true } },
        roomType: { select: { name: true } },
        reservation: {
          select: {
            id: true, companyName: true, specialRequests: true,
            guest: { select: { fullName: true } },
            guests: { where: { isPrimary: false }, select: { guest: { select: { fullName: true } } } },
            corporateCustomer: { select: { companyName: true } },
            group: { select: { name: true } },
            rooms: { where: { status: "CHECKED_IN", roomType: GUEST_ROOMS }, select: { id: true, room: { select: { number: true } } } },
          },
        },
      },
    }),
    // The same test the guest's own page and welcome card use, so the list says what the guest was told.
    breakfastIncluded(),
  ]);

  const rows: GuestRow[] = stays.map((rr) => {
    const r = rr.reservation;
    const name = realName(r.guest.fullName);
    // The booking lists its people, not who sleeps where: with several rooms the other names go on its first room only.
    const first = [...r.rooms].sort((a, b) => a.room.number.localeCompare(b.room.number, undefined, { numeric: true }))[0];
    const others = !first || first.id === rr.id
      ? [...new Set(r.guests.map((g) => realName(g.guest.fullName)).filter((n): n is string => !!n && n !== name))]
      : [];
    return {
      room: rr.room.number, type: rr.roomType.name, name, others, bookingRooms: Math.max(1, r.rooms.length),
      group: r.group?.name?.trim() || null,
      company: (r.corporateCustomer?.companyName ?? r.companyName)?.trim() || null,
      adults: rr.adults, children: rr.children,
      checkedInAt: rr.checkedInAt?.toISOString() ?? null,
      arrival: fromDbDate(rr.arrivalDate), nights: rr.nights, shortTime: rr.isDayUse,
      leavesOn: fromDbDate(rr.departureDate), leavesAt: rr.endAt.toISOString(),
      stay: stayState([rr], today, now),
      breakfast: breakfastFor({ shortTime: rr.isDayUse }, breakfast),
      request: r.specialRequests?.trim() || null,
    };
  });

  return {
    kind: "GUESTS", date: today, generatedAt: now.toISOString(), timezone: settings.timezone,
    breakfastHours: breakfastHours(breakfastSchedule(settings)), breakfastService: breakfast, rows: sortGuestRows(rows),
  };
}

export const buildDailyList = (kind: ListKind, now: Date = new Date()): Promise<DailyListData> =>
  kind === "HOUSEKEEPING" ? buildHousekeepingList(now) : buildGuestList(now);

export type DailyListCopy = {
  id: string; kind: ListKind; date: BusinessDate; copyNo: number; generatedAt: string; generatedBy: string;
  /** "Done by Developer · as Neema" (in the reader's language) when the Developer, working as someone, printed this copy; shown NEXT TO the name on the screen. The printed paper is not touched. */
  doneBy?: string | null;
};
export type StoredDailyList = DailyListCopy & { data: DailyListData };

const copyOf = (r: { id: string; kind: string; businessDate: Date; copyNo: number; generatedAt: Date; generatedBy: string }): DailyListCopy => ({
  id: r.id, kind: r.kind as ListKind, date: fromDbDate(r.businessDate), copyNo: r.copyNo, generatedAt: r.generatedAt.toISOString(), generatedBy: r.generatedBy,
});

/**
 * Keep the list as it is right now as the day's next printed copy (1, 2, 3 …). Built here, on the server, from the
 * live rooms and bookings — never from what the browser was showing.
 */
export async function saveDailyListCopy(kind: ListKind, actor: { id: string; fullName: string; roleName: string }, ipAddress: string | null = null, now: Date = new Date()): Promise<StoredDailyList> {
  const data = await buildDailyList(kind, now);
  const businessDate = toDbDate(data.date);
  const generatedBy = `${actor.fullName} (${actor.roleName})`;
  for (let attempt = 0; ; attempt++) {
    const last = await db.dailyList.aggregate({ where: { kind, businessDate }, _max: { copyNo: true } });
    const copyNo = (last._max.copyNo ?? 0) + 1;
    try {
      const row = await db.$transaction(async (tx) => {
        const created = await tx.dailyList.create({ data: { kind, businessDate, copyNo, data: json(data), generatedAt: now, generatedBy } });
        await audit(tx, { userId: actor.id, label: actor.fullName, ipAddress }, {
          action: "daily_list.printed", entityType: "DailyList", entityId: created.id,
          after: { kind, date: data.date, copyNo, rows: data.rows.length },
        });
        return created;
      });
      return { ...copyOf(row), data };
    } catch (e) {
      // Two people printed at the same moment: take the next number.
      if (!isUniqueViolation(e) || attempt >= 4) throw e;
    }
  }
}

/**
 * Adds "Done by Developer" to the copies the Developer printed while working as someone (the audit row of the print is the mark; the stored
 * "made by" name and the paper are unchanged). One lookup for all of them; a failed lookup leaves them without a tag.
 */
export async function withDoneBy<C extends DailyListCopy>(copies: C[]): Promise<C[]> {
  if (copies.length === 0) return copies;
  try {
    const [t, marks] = await Promise.all([getT(), developerMarks("DailyList", copies.map((c) => c.id), { actions: ["daily_list.printed"] })]);
    return copies.map((c) => ({ ...c, doneBy: doneByText(t, markFor(marks, c.id)) }));
  } catch {
    return copies;
  }
}

/** The copies printed on a day, newest first (without their contents). */
export async function listDailyListCopies(date: BusinessDate, kind: ListKind): Promise<DailyListCopy[]> {
  const rows = await db.dailyList.findMany({
    where: { kind, businessDate: toDbDate(date) },
    select: { id: true, kind: true, businessDate: true, copyNo: true, generatedAt: true, generatedBy: true },
    orderBy: { copyNo: "desc" },
  });
  return rows.map(copyOf);
}

export async function getDailyListCopy(id: string): Promise<StoredDailyList | null> {
  const row = await db.dailyList.findUnique({ where: { id } });
  return row ? { ...copyOf(row), data: row.data as unknown as DailyListData } : null;
}
