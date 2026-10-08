/**
 * Meeting rooms are ordinary room inventory (room type category MEETING_ROOM)
 * booked by time — a start and an end on one day — instead of by the night.
 * They use the same reservation, folio, payment and report engine; only the
 * words and a few rules differ. Client-safe (no server imports).
 */
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

/** Longest single meeting booking; a longer event is booked as one booking per day. */
export const MEETING_MAX_HOURS = 16;
export const MEETING_MIN_MINUTES = 30;
/** Hours a meeting room is open for booking each day — the base for utilisation (08:00–20:00). */
export const MEETING_OPEN_HOURS = 12;

export type RoomCategoryLite = "GUEST_ROOM" | "MEETING_ROOM";

export const isMeetingRoom = (t: { category?: string | null } | null | undefined) => t?.category === "MEETING_ROOM";

/** "Room 102 — Meeting Room" so nobody mistakes it for a bedroom (in the reader's language when their `t` is given). */
export function roomLabel(number: string, type: { name: string; category?: string | null }, t: T = englishT) {
  return isMeetingRoom(type) ? t("Room {number} — {name}", { number, name: t(type.name) }) : t("Room {number}", { number });
}

/** Reservation statuses in meeting words (the lifecycle underneath is the same). */
export const MEETING_STATUS_LABEL: Record<string, string> = {
  INQUIRY: msg("Inquiry"), RESERVED: msg("Reserved"), CONFIRMED: msg("Confirmed"), CHECKED_IN: msg("In use"),
  CHECKED_OUT: msg("Completed"), CANCELLED: msg("Cancelled"), NO_SHOW: msg("No show"),
};

/** Room status in meeting words: an occupied meeting room is "In use". */
export const MEETING_ROOM_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: msg("Available"), RESERVED: msg("Reserved"), OCCUPIED: msg("In use"), DIRTY: msg("Cleaning"), CLEANING: msg("Cleaning"),
  READY: msg("Available"), MAINTENANCE: msg("Maintenance"), OUT_OF_SERVICE: msg("Out of service"),
};

const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" });
/** "09:00–13:00" in hotel time. */
export function timeRange(startAt: Date | string, endAt: Date | string) {
  return `${hm.format(new Date(startAt))}–${hm.format(new Date(endAt))}`;
}
/** Hours between two instants, to one decimal. */
export function hoursBetween(startAt: Date | string, endAt: Date | string) {
  return Math.round(((new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000) * 10) / 10;
}
