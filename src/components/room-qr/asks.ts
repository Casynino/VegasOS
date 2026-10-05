import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";

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

export const ROOM_ASKS: RoomAsk[] = [
  { key: "MOVE", type: "GENERAL", label: "Change my room", hint: "Move to another room", prefix: "Room change", needsNote: true, placeholder: "Why would you like to move? e.g. quieter, two beds" },
  { key: "EXTEND", type: "GENERAL", label: "Stay longer", hint: "Add nights to your stay", prefix: "Stay longer", needsNote: false, placeholder: "Anything to add? (optional)" },
  { key: "LATE", type: "GENERAL", label: "Late check-out", hint: "Leave later on your last day", prefix: "Late check-out", needsNote: false, placeholder: "Anything to add? (optional)" },
  { key: "CLEANING", type: "CLEANING", label: "Cleaning", hint: "Tidy up, fresh sheets", needsNote: false, placeholder: "A good time, or anything to add (optional)" },
  { key: "TOWELS", type: "TOWELS", label: "Fresh towels", hint: "Towels, bathrobe, toiletries", needsNote: false, placeholder: "How many, or anything else (optional)" },
  { key: "FIX", type: "MAINTENANCE", label: "Something is not working", hint: "AC, TV, water, lights", needsNote: true, placeholder: "What is not working? e.g. the AC" },
  { key: "OTHER", type: "GENERAL", label: "Something else", hint: "Tell us what you need", needsNote: true, placeholder: "What do you need?" },
];

const PREFIXES = ROOM_ASKS.flatMap((a) => (a.prefix ? [a.prefix] : []));

/** A request as the guest's list names it: "Room change", "Late check-out", "Fresh towels"… (its type, and its words when it is GENERAL). */
export function requestLabel(type: string, note: string | null | undefined) {
  const prefix = note ? PREFIXES.find((p) => note.startsWith(`${p}:`)) : undefined;
  if (prefix) return prefix;
  if (type === "GENERAL") return "Your request";
  return ROOM_ASKS.find((a) => a.type === type)?.label ?? REQUEST_TYPE_LABEL[type] ?? "Request";
}
