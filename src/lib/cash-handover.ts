import { msg } from "@/i18n/msg";

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
