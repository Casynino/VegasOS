import { msg } from "@/i18n/msg";

/**
 * Cash handover is SWITCHED OFF for now (owner, 2026-10-13): staff already know where to take the cash they collect, and nothing
 * in a shift, a checkout, a payment or a report waits for a digital handover. Nothing was deleted — the tables, the records and the
 * code stay, and the screens, the menu items and the server actions all follow this one switch. To bring the feature back, set it
 * to true (the Finance menu, the Collections card and the Finance Home panels return with it).
 *
 * Before turning it back on: set hotel_settings."cashHandoverFrom" to the day it restarts (e.g. UPDATE hotel_settings SET "cashHandoverFrom" = now()),
 * or every cashier shows all the cash taken since the old baseline as "still with staff" and the first handover is asked for in one huge amount.
 */
export const CASH_HANDOVER_ON = false;

/** How a cash handover's status is said (shown with t(…)). Kept out of the client component so server pages can use it too. */
export const HANDOVER_STATUS_TEXT = {
  SUBMITTED: msg("Waiting for Finance"), RETURNED: msg("Sent back"), ACCEPTED: msg("Received"), REJECTED: msg("Refused"),
} as const;

export const HANDOVER_STATUS_TONE = {
  SUBMITTED: "bg-amber-500/15 text-amber-700 dark:text-amber-300", RETURNED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  ACCEPTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", REJECTED: "bg-muted text-muted-foreground",
} as const;

export const HANDOVER_EVENT_TEXT: Record<string, string> = {
  SUBMITTED: msg("Handed over"), RESUBMITTED: msg("Corrected and sent again"), RETURNED: msg("Sent back"), ACCEPTED: msg("Received"), REJECTED: msg("Refused"),
};
