import type { RoomStatus } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";

/** Display metadata for room statuses (shared by staff UI). */
export const ROOM_STATUS_META: Record<RoomStatus, { label: string; className: string; dot: string }> = {
  AVAILABLE: { label: msg("Available"), className: "bg-blue-600/10 text-blue-700 border-blue-600/30 dark:text-blue-300", dot: "bg-blue-600" },
  READY: { label: msg("Clean / Ready"), className: "bg-teal-600/10 text-teal-700 border-teal-600/30 dark:text-teal-300", dot: "bg-teal-600" },
  RESERVED: { label: msg("Reserved"), className: "bg-amber-500/15 text-amber-800 border-amber-500/40 dark:text-amber-300", dot: "bg-amber-500" },
  OCCUPIED: { label: msg("Occupied"), className: "bg-green-600/10 text-green-700 border-green-600/30 dark:text-green-300", dot: "bg-green-600" },
  DIRTY: { label: msg("Needs cleaning"), className: "bg-orange-600/10 text-orange-700 border-orange-600/30 dark:text-orange-300", dot: "bg-orange-600" },
  CLEANING: { label: msg("Cleaning"), className: "bg-violet-600/10 text-violet-700 border-violet-600/30 dark:text-violet-300", dot: "bg-violet-600" },
  MAINTENANCE: { label: msg("Maintenance"), className: "bg-red-600/10 text-red-700 border-red-600/30 dark:text-red-300", dot: "bg-red-600" },
  OUT_OF_SERVICE: { label: msg("Out of service"), className: "bg-zinc-600/15 text-zinc-700 border-zinc-600/30 dark:text-zinc-300", dot: "bg-zinc-600" },
};

/** Statuses a room can be sold/checked into right now. */
export const CHECK_IN_READY: RoomStatus[] = ["AVAILABLE", "READY", "RESERVED"];

/** Statuses that remove a room from sellable inventory. */
export const BLOCKED_STATUSES: RoomStatus[] = ["MAINTENANCE", "OUT_OF_SERVICE"];

/**
 * Manual transitions allowed from each status. OCCUPIED is set only by
 * check-in and cleared only by check-out; RESERVED is derived on the board.
 */
export const MANUAL_TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  AVAILABLE: ["DIRTY", "CLEANING", "MAINTENANCE", "OUT_OF_SERVICE"],
  READY: ["AVAILABLE", "DIRTY", "MAINTENANCE", "OUT_OF_SERVICE"],
  RESERVED: ["DIRTY", "MAINTENANCE", "OUT_OF_SERVICE"],
  DIRTY: ["CLEANING", "READY", "MAINTENANCE", "OUT_OF_SERVICE"],
  CLEANING: ["READY", "DIRTY", "MAINTENANCE", "OUT_OF_SERVICE"],
  MAINTENANCE: ["DIRTY", "CLEANING", "READY", "OUT_OF_SERVICE"],
  OUT_OF_SERVICE: ["DIRTY", "CLEANING", "READY", "MAINTENANCE"],
  OCCUPIED: [],
};
