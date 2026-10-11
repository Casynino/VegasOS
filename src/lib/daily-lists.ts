import type { BusinessDate } from "@/lib/time/business-date";

/**
 * The two lists reception prints every day — the Daily Housekeeping Checklist and the In-House Guest & Breakfast
 * List. Pure rules only (which room goes in which part of the sheet, the totals): the same code builds the live
 * preview, the stored printed copy and the tests. Nothing here reads the database.
 *
 * A stored copy keeps codes (statuses, groups), never finished sentences, so it prints in the reader's language.
 */

export type ListKind = "HOUSEKEEPING" | "GUESTS";
/** The address word of each list: /staff/lists/housekeeping, /staff/lists/guests. */
export const LIST_SLUG: Record<ListKind, string> = { HOUSEKEEPING: "housekeeping", GUESTS: "guests" };
export const listKindOf = (slug: string): ListKind | null => (slug === "housekeeping" ? "HOUSEKEEPING" : slug === "guests" ? "GUESTS" : null);

export type RoomStatusCode = "AVAILABLE" | "RESERVED" | "OCCUPIED" | "DIRTY" | "CLEANING" | "READY" | "MAINTENANCE" | "OUT_OF_SERVICE";
export type StayStateCode = "IN_HOUSE" | "DUE_TODAY" | "OVERDUE";
/** The hotel's rule for rooms where the guest is staying on (Settings → Stay policies). */
export type OccupiedService = "DAILY" | "ON_REQUEST";
export const occupiedServiceOf = (v: string | null | undefined): OccupiedService => (v === "ON_REQUEST" ? "ON_REQUEST" : "DAILY");

// ─────────────────────────── Housekeeping checklist ───────────────────────────

/** The four parts of the sheet, in the order they are printed. */
export type HkGroup = "CHECKOUT" | "OCCUPIED" | "READY" | "ATTENTION";
export const HK_GROUPS: HkGroup[] = ["CHECKOUT", "OCCUPIED", "READY", "ATTENTION"];

/** What the system knows about one guest room at the moment the list is made. */
export type HkRoomInput = {
  roomId: string;
  room: string;
  type: string;
  floor: number | null;
  status: RoomStatusCode;
  statusNote: string | null;
  /** When the room got its present status (ISO). */
  statusChangedAt: string;
  /** The guest checked in to this room now, if any. */
  stay: { state: StayStateCode; leavesOn: BusinessDate; leavesAt: string } | null;
  /** A booking is due into this room today. */
  arrivalToday: boolean;
  /** The guest asked for cleaning (an open request) — their words. */
  request: string | null;
  /** A closure that covers today (maintenance / out of service). */
  block: { type: "MAINTENANCE" | "OUT_OF_SERVICE"; reason: string | null; until: BusinessDate | null } | null;
};

export type HkRow = {
  roomId: string;
  room: string;
  type: string;
  floor: number | null;
  group: HkGroup;
  status: RoomStatusCode;
  /** The stay in the room (occupied rooms): staying on, leaving today, or past its check-out time. */
  stay: StayStateCode | null;
  leavesOn: BusinessDate | null;
  leavesAt: string | null;
  since: string;
  arrivalToday: boolean;
  request: string | null;
  /** Why the room is closed (maintenance, out of service). */
  reason: string | null;
  closedUntil: BusinessDate | null;
  /** The room's status and the bookings disagree — reception must look before anyone prepares the room. */
  mismatch: "NO_GUEST" | "GUEST_IN" | null;
  /** A closure is planned for today but the room's status was not changed. */
  closure: "MAINTENANCE" | "OUT_OF_SERVICE" | null;
};

export type HousekeepingList = {
  kind: "HOUSEKEEPING";
  date: BusinessDate;
  generatedAt: string;
  timezone: string;
  occupiedService: OccupiedService;
  rows: HkRow[];
};

const byRoom = (a: { room: string }, b: { room: string }) => a.room.localeCompare(b.room, undefined, { numeric: true });
const BLOCKED: RoomStatusCode[] = ["MAINTENANCE", "OUT_OF_SERVICE"];

/**
 * Where one room goes on the sheet.
 *  • CHECKOUT  — needs a full clean: marked "needs cleaning" / "cleaning", or the guest leaves today (clean after they go).
 *  • OCCUPIED  — the guest is staying on: the hotel's servicing rule applies, never an automatic full clean.
 *  • READY     — clean and ready: listed so the sheet is complete, never as work.
 *  • ATTENTION — closed (maintenance, out of service, a planned closure) or the status and the bookings disagree.
 *                Never shown as ready.
 */
export function classifyRoom(r: HkRoomInput): HkRow {
  const base = {
    roomId: r.roomId, room: r.room, type: r.type, floor: r.floor, status: r.status, since: r.statusChangedAt, arrivalToday: r.arrivalToday,
    stay: r.stay?.state ?? null, leavesOn: r.stay?.leavesOn ?? null, leavesAt: r.stay?.leavesAt ?? null,
    request: r.request, reason: null as string | null, closedUntil: null as BusinessDate | null, mismatch: null as HkRow["mismatch"], closure: null as HkRow["closure"],
  };
  if (BLOCKED.includes(r.status)) {
    return { ...base, group: "ATTENTION", reason: r.statusNote ?? r.block?.reason ?? null, closedUntil: r.block?.until ?? null, mismatch: r.stay ? "GUEST_IN" : null };
  }
  if (r.status === "OCCUPIED") {
    if (!r.stay) return { ...base, group: "ATTENTION", mismatch: "NO_GUEST" };
    if (r.block) return { ...base, group: "ATTENTION", closure: r.block.type, reason: r.block.reason, closedUntil: r.block.until };
    return { ...base, group: r.stay.state === "IN_HOUSE" ? "OCCUPIED" : "CHECKOUT" };
  }
  // Not occupied on the board, yet a guest is checked in to it.
  if (r.stay) return { ...base, group: "ATTENTION", mismatch: "GUEST_IN" };
  if (r.block) return { ...base, group: "ATTENTION", closure: r.block.type, reason: r.block.reason, closedUntil: r.block.until };
  if (r.status === "DIRTY" || r.status === "CLEANING") return { ...base, group: "CHECKOUT" };
  return { ...base, group: "READY" };
}

/** Does this row mean work for housekeeping today? (Ready and closed rooms never do.) */
export function needsCleaning(row: HkRow, rule: OccupiedService): boolean {
  if (row.group === "CHECKOUT") return true;
  if (row.group === "OCCUPIED") return rule === "DAILY" || !!row.request;
  return false;
}

/** The whole sheet: every guest room once, check-outs first (rooms a guest arrives into today before the others). */
export function buildHousekeepingRows(rooms: HkRoomInput[]): HkRow[] {
  const rows = rooms.map(classifyRoom);
  // Check-outs: a guest arriving today first, then rooms that can be cleaned now, then rooms the guest has yet to leave.
  const waiting = (r: HkRow) => (r.status === "DIRTY" || r.status === "CLEANING" ? 0 : 1);
  return HK_GROUPS.flatMap((g) => {
    const part = rows.filter((r) => r.group === g).sort(byRoom);
    if (g === "CHECKOUT") part.sort((a, b) => Number(b.arrivalToday) - Number(a.arrivalToday) || waiting(a) - waiting(b) || byRoom(a, b));
    if (g === "OCCUPIED") part.sort((a, b) => Number(!!b.request) - Number(!!a.request) || byRoom(a, b));
    return part;
  });
}

export type HkTotals = { listed: number; checkout: number; waiting: number; inProgress: number; occupied: number; occupiedService: number; ready: number; attention: number; toClean: number };

export function housekeepingTotals(list: Pick<HousekeepingList, "rows" | "occupiedService">): HkTotals {
  const of = (g: HkGroup) => list.rows.filter((r) => r.group === g);
  const occupied = of("OCCUPIED");
  return {
    listed: list.rows.length,
    checkout: of("CHECKOUT").length,
    waiting: list.rows.filter((r) => r.group === "CHECKOUT" && r.status === "DIRTY").length,
    inProgress: list.rows.filter((r) => r.group === "CHECKOUT" && r.status === "CLEANING").length,
    occupied: occupied.length,
    occupiedService: occupied.filter((r) => needsCleaning(r, list.occupiedService)).length,
    ready: of("READY").length,
    attention: of("ATTENTION").length,
    toClean: list.rows.filter((r) => needsCleaning(r, list.occupiedService)).length,
  };
}

// ─────────────────────────── In-house guest & breakfast list ───────────────────────────

/**
 * Breakfast for a room, as far as the system really knows:
 *  • INCLUDED        — the hotel's Breakfast service is on (it comes with every room booking) and the stay is a night stay.
 *  • NONE_SHORT_TIME — a short-time (day) stay: no breakfast.
 *  • NOT_RECORDED    — the hotel has no Breakfast service set up: nothing to go on, so nothing is claimed.
 */
export type Breakfast = "INCLUDED" | "NONE_SHORT_TIME" | "NOT_RECORDED";
export const breakfastFor = (stay: { shortTime: boolean }, hotelServesBreakfast: boolean): Breakfast =>
  stay.shortTime ? "NONE_SHORT_TIME" : hotelServesBreakfast ? "INCLUDED" : "NOT_RECORDED";

export type GuestRow = {
  room: string;
  type: string;
  /** The main guest of the booking (null = no real name on file). */
  name: string | null;
  /** The other people registered on the booking. */
  others: string[];
  /** Rooms of the same booking in the hotel now (2+ = the other names may be in any of them). */
  bookingRooms: number;
  group: string | null;
  company: string | null;
  adults: number;
  children: number;
  checkedInAt: string | null;
  arrival: BusinessDate;
  nights: number;
  shortTime: boolean;
  leavesOn: BusinessDate;
  leavesAt: string;
  stay: StayStateCode;
  breakfast: Breakfast;
  /** The booking's special requests (what the guest asked for). */
  request: string | null;
};

export type GuestList = {
  kind: "GUESTS";
  date: BusinessDate;
  generatedAt: string;
  timezone: string;
  breakfastHours: string | null;
  /** The hotel's Breakfast service is switched on (it comes with every room booking). */
  breakfastService: boolean;
  rows: GuestRow[];
};

export const guestsIn = (r: Pick<GuestRow, "adults" | "children">) => r.adults + r.children;

export type GuestTotals = { rooms: number; guests: number; adults: number; children: number; breakfastRooms: number; breakfastGuests: number; noBreakfastRooms: number; unknownRooms: number; unknownGuests: number; leaving: number };

/** Rooms and people are counted apart: one room with two adults and a child is 1 room, 3 guests. */
export function guestTotals(rows: GuestRow[]): GuestTotals {
  const sum = (xs: GuestRow[]) => xs.reduce((n, r) => n + guestsIn(r), 0);
  const included = rows.filter((r) => r.breakfast === "INCLUDED");
  const unknown = rows.filter((r) => r.breakfast === "NOT_RECORDED");
  return {
    rooms: rows.length,
    guests: sum(rows),
    adults: rows.reduce((n, r) => n + r.adults, 0),
    children: rows.reduce((n, r) => n + r.children, 0),
    breakfastRooms: included.length,
    breakfastGuests: sum(included),
    noBreakfastRooms: rows.filter((r) => r.breakfast === "NONE_SHORT_TIME").length,
    unknownRooms: unknown.length,
    unknownGuests: sum(unknown),
    leaving: rows.filter((r) => r.stay !== "IN_HOUSE").length,
  };
}

export const sortGuestRows = (rows: GuestRow[]) => [...rows].sort(byRoom);

export type DailyListData = HousekeepingList | GuestList;

/** "HK-20261011-2" / "GL-20261011-1" — the number printed on a stored copy. */
export const listNumber = (kind: ListKind, date: BusinessDate, copyNo: number) => `${kind === "HOUSEKEEPING" ? "HK" : "GL"}-${date.replaceAll("-", "")}-${copyNo}`;
