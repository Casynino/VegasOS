import { msg } from "@/i18n/msg";

export const REQUEST_TYPE_LABEL: Record<string, string> = {
  TOWELS: msg("Extra towels"), CLEANING: msg("Room cleaning"), MAINTENANCE: msg("Maintenance"), RESTAURANT: msg("Restaurant / food"), TRANSPORT: msg("Transport"), GENERAL: msg("General help"), OTHER: msg("Other"), COMPLAINT: msg("Complaint"),
};

/** What a guest can ask for from their phone (stay link / room QR) — in their words. */
export const GUEST_ASKS = [
  { type: "TOWELS", label: msg("Extra towels"), hint: msg("Towels, bathrobe, toiletries") },
  { type: "CLEANING", label: msg("Clean my room"), hint: msg("Tidy up, fresh sheets") },
  { type: "MAINTENANCE", label: msg("Something isn't working"), hint: msg("AC, TV, water, lights") },
  { type: "GENERAL", label: msg("Something else"), hint: msg("Tell us what you need") },
] as const;
export type GuestAskType = (typeof GUEST_ASKS)[number]["type"];

/** A request's state as the guest reads it. */
export const GUEST_REQUEST_WORD: Record<string, string> = { NEW: msg("Received"), ASSIGNED: msg("Received"), IN_PROGRESS: msg("On it"), COMPLETED: msg("Done"), CANCELLED: msg("Cancelled") };
