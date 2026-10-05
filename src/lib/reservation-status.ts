import type { ReservationStatus } from "@/generated/prisma/enums";

export const RESERVATION_STATUS_META: Record<ReservationStatus, { label: string; className: string }> = {
  // Not paid and no room held (an enquiry, or booked online to pay later): whoever pays first gets the room.
  INQUIRY: { label: "Not paid · room not held", className: "bg-orange-500/10 text-orange-800 border-orange-500/40 dark:text-orange-300" },
  // Not paid yet: the room is held only until the hold time.
  RESERVED: { label: "Pending · unpaid", className: "bg-amber-500/15 text-amber-800 border-amber-500/40 dark:text-amber-300" },
  CONFIRMED: { label: "Confirmed", className: "bg-blue-600/10 text-blue-700 border-blue-600/30 dark:text-blue-300" },
  CHECKED_IN: { label: "Checked in", className: "bg-green-600/10 text-green-700 border-green-600/30 dark:text-green-300" },
  CHECKED_OUT: { label: "Checked out", className: "bg-slate-500/10 text-slate-700 border-slate-500/30 dark:text-slate-300" },
  CANCELLED: { label: "Cancelled", className: "bg-red-600/10 text-red-700 border-red-600/30 dark:text-red-300" },
  NO_SHOW: { label: "No show", className: "bg-orange-600/10 text-orange-700 border-orange-600/30 dark:text-orange-300" },
};
