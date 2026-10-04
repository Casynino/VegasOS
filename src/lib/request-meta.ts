export const REQUEST_TYPE_LABEL: Record<string, string> = {
  TOWELS: "Extra towels", CLEANING: "Room cleaning", MAINTENANCE: "Maintenance", RESTAURANT: "Restaurant / food", TRANSPORT: "Transport", GENERAL: "General help", OTHER: "Other", COMPLAINT: "Complaint",
};

/** What a guest can ask for from their phone (stay link / room QR) — in their words. */
export const GUEST_ASKS = [
  { type: "TOWELS", label: "Extra towels", hint: "Towels, bathrobe, toiletries" },
  { type: "CLEANING", label: "Clean my room", hint: "Tidy up, fresh sheets" },
  { type: "MAINTENANCE", label: "Something isn't working", hint: "AC, TV, water, lights" },
  { type: "GENERAL", label: "Something else", hint: "Tell us what you need" },
] as const;
export type GuestAskType = (typeof GUEST_ASKS)[number]["type"];

/** A request's state as the guest reads it. */
export const GUEST_REQUEST_WORD: Record<string, string> = { NEW: "Received", ASSIGNED: "Received", IN_PROGRESS: "On it", COMPLETED: "Done", CANCELLED: "Cancelled" };
