import type { TripStatus, TripType } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";

export const TRIP_TYPE_LABEL: Record<TripType, string> = {
  AIRPORT_PICKUP: msg("Airport pickup"), AIRPORT_DROPOFF: msg("Airport drop-off"), HOTEL_TRANSFER: msg("Meeting / business trip"), GUEST_TRANSPORT: msg("Custom trip"), OTHER: msg("Other trip"),
};

/** The simple lifecycle staff see: Pending → Confirmed → Driver assigned → In progress → Completed (or Cancelled / No show). */
export const TRIP_STATUS_META: Record<TripStatus, { label: string; className: string }> = {
  REQUESTED: { label: msg("Pending"), className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  CONFIRMED: { label: msg("Confirmed"), className: "bg-blue-600/10 text-blue-700 dark:text-blue-300" },
  ASSIGNED: { label: msg("Driver assigned"), className: "bg-violet-600/10 text-violet-700 dark:text-violet-300" },
  EN_ROUTE: { label: msg("In progress"), className: "bg-teal-600/10 text-teal-700 dark:text-teal-300" },
  PICKED_UP: { label: msg("In progress"), className: "bg-teal-600/10 text-teal-700 dark:text-teal-300" },
  COMPLETED: { label: msg("Completed"), className: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-300" },
  CANCELLED: { label: msg("Cancelled"), className: "bg-zinc-500/10 text-zinc-500 line-through" },
  NO_SHOW: { label: msg("No show"), className: "bg-rose-600/10 text-rose-700 dark:text-rose-300" },
};

/** Airports the forms suggest (free text is allowed too). */
export const AIRPORTS = ["Julius Nyerere International Airport (DAR)", "Abeid Amani Karume Airport, Zanzibar (ZNZ)", "Kilimanjaro International Airport (JRO)"];

const TONE: Record<string, string> = {
  AIRPORT_PICKUP: "bg-sky-500/12 text-sky-600 dark:text-sky-300", AIRPORT_DROPOFF: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
  HOTEL_TRANSFER: "bg-violet-500/12 text-violet-600 dark:text-violet-300", GUEST_TRANSPORT: "bg-teal-500/12 text-teal-600 dark:text-teal-300",
};
/** The colour chip for a kind of trip. */
export const tripTone = (type: string) => TONE[type] ?? "bg-muted text-muted-foreground";

/** Custom trips have a starting price — shown as "from TZS …"; the final price is agreed with the guest. */
export const isFromPrice = (type: string, packages = 0) => type === "GUEST_TRANSPORT" || packages > 1;
