import "server-only";
import type { T } from "@/i18n/translate";
import { doneByText } from "@/lib/done-by-text";
import { developerMarks, markFor, type DeveloperMark } from "./developer-marks";
import { sameWho } from "./order-done-by";

/**
 * "DONE BY DEVELOPER" on the "sent by" of a guest message (owner, 2026-10-18). The message keeps its stored sender (the staff member the Developer
 * worked as); the audit row of the send is the mark: `guest.message_sent` on the Guest (a message sent from the guest's page, a booking, the welcome
 * or an order) or `thank_you.sent` on the Reservation (the thank-you note sent from the invoices). Automatic messages have no sender, so they are
 * never marked. The row is written in the same request as the message: matched by time and, when both say who, by the name.
 */
export type SentMessage = { id: string; guestId: string; reservationId: string | null; type: string; createdAt: Date; sentBy: { fullName: string } | null };

const SEND_ACTIONS = ["guest.message_sent"] as const;
const THANK_YOU_ACTIONS = ["thank_you.sent"] as const;

/** For each message the Developer sent while working as someone: its id → "Done by Developer · as Neema". Two queries at most, whatever the number of messages. */
export async function messageDoneBy(t: T, messages: readonly SentMessage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const sent = messages.filter((m) => m.sentBy);
  if (sent.length === 0) return out;
  const none = () => new Map<string, DeveloperMark[]>();
  const [byGuest, byStay] = await Promise.all([
    developerMarks("Guest", sent.map((m) => m.guestId), { actions: SEND_ACTIONS }).catch(none),
    developerMarks("Reservation", sent.filter((m) => m.type === "THANK_YOU").map((m) => m.reservationId), { actions: THANK_YOU_ACTIONS }).catch(none),
  ]);
  for (const m of sent) {
    const mark = markFor(byGuest, m.guestId, { near: m.createdAt }) ?? (m.type === "THANK_YOU" ? markFor(byStay, m.reservationId, { near: m.createdAt }) : null);
    const text = mark && sameWho(mark, m.sentBy!.fullName) ? doneByText(t, mark) : null;
    if (text) out.set(m.id, text);
  }
  return out;
}
