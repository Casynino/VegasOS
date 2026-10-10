import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { msg } from "@/i18n/msg";

/**
 * What a staying guest can ask for from "Your room" — each one a guest request through the one request system (the
 * room QR's / stay link's existing ask action: TOWELS, CLEANING, MAINTENANCE or GENERAL). A room change, more nights
 * and a late check-out are GENERAL requests whose words start with what they are ("Room change: …"), so reception
 * reads them at a glance and the guest's list can name them.
 */
export type RoomAskKey = "MOVE" | "EXTEND" | "LATE" | "CLEANING" | "TOWELS" | "FIX" | "OTHER";
export type RoomAsk = {
  key: RoomAskKey; type: "TOWELS" | "CLEANING" | "MAINTENANCE" | "GENERAL"; label: string; hint: string;
  /** GENERAL asks: the words their request starts with. */
  prefix?: string;
  /** A note is needed (what to fix, why move…). */
  needsNote: boolean;
  placeholder: string;
};

// Labels, hints and placeholders are shown translated (t(a.label)…); `prefix` is written into the request in English for
// reception (msg() only marks it — the guest's list shows it translated).
export const ROOM_ASKS: RoomAsk[] = [
  { key: "MOVE", type: "GENERAL", label: msg("Change my room"), hint: msg("Move to another room"), prefix: msg("Room change"), needsNote: true, placeholder: msg("Why would you like to move? e.g. quieter, two beds") },
  { key: "EXTEND", type: "GENERAL", label: msg("Stay longer"), hint: msg("Add nights to your stay"), prefix: msg("Stay longer"), needsNote: false, placeholder: msg("Anything to add? (optional)") },
  { key: "LATE", type: "GENERAL", label: msg("Late check-out"), hint: msg("Leave later on your last day"), prefix: msg("Late check-out"), needsNote: false, placeholder: msg("Anything to add? (optional)") },
  { key: "CLEANING", type: "CLEANING", label: msg("Cleaning"), hint: msg("Tidy up, fresh sheets"), needsNote: false, placeholder: msg("A good time, or anything to add (optional)") },
  { key: "TOWELS", type: "TOWELS", label: msg("Fresh towels"), hint: msg("Towels, bathrobe, toiletries"), needsNote: false, placeholder: msg("How many, or anything else (optional)") },
  { key: "FIX", type: "MAINTENANCE", label: msg("Something is not working"), hint: msg("AC, TV, water, lights"), needsNote: true, placeholder: msg("What is not working? e.g. the AC") },
  { key: "OTHER", type: "GENERAL", label: msg("Something else"), hint: msg("Tell us what you need"), needsNote: true, placeholder: msg("What do you need?") },
];

const PREFIXES = ROOM_ASKS.flatMap((a) => (a.prefix ? [a.prefix] : []));

/** A request as the guest's list names it: "Room change", "Late check-out", "Fresh towels"… (its type, and its words when it is GENERAL). English — shown with t(). */
export function requestLabel(type: string, note: string | null | undefined) {
  const prefix = note ? PREFIXES.find((p) => note.startsWith(`${p}:`)) : undefined;
  if (prefix) return prefix;
  if (type === "GENERAL") return msg("Your request");
  return ROOM_ASKS.find((a) => a.type === type)?.label ?? REQUEST_TYPE_LABEL[type] ?? msg("Request");
}
