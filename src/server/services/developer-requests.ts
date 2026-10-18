import "server-only";
import { db } from "../db";
import { addDays, businessRangeBounds, type BusinessDate } from "@/lib/time/business-date";
import { msg } from "@/i18n/msg";
import { GUEST_MESSAGE_TYPES } from "@/lib/guest-messages";
import { assertConsoleAccess, safe, type ConsoleUser } from "./developer-console";
import { consoleFrame, countPerDay } from "./developer-frame";
import { newRequestCount, openRequestCount } from "./booking-requests";

/**
 * THE "MESSAGES & REQUESTS" PART of the Developer Home (owner, 2026-10-18; laid out like the owner's other console): what guests are
 * told and what they ask for. Read-only, counts and plain words only — never a guest's name or phone, never the words of a message
 * or of a request, never a room. A message is counted by its KIND ("Booking confirmed"), a request by its STATE ("Done").
 *
 * Nothing is a second copy of a figure: the booking-request counters are the ones the front desk uses (booking-requests.ts); the
 * guest-message kinds are named by the same list the guest's profile uses (lib/guest-messages.ts). Days are hotel days
 * (04:00 → 04:00, Tanzania time), never UTC midnight. Every query is bounded (a count, a grouped count over a window, or a `take`)
 * and wrapped in safe(): one that fails leaves its figure null and the rest still draws.
 *
 * "Alerts not yet read" (the staff bell) cannot be counted: the bell is computed live from what is waiting (staff-alerts.ts) and no
 * "read" mark is stored anywhere. The figure here is what the bell is ringing for in this part's field — requests nobody has taken.
 */

/** The days the messages-per-day chart covers and the days the kinds are counted over. */
export const KIND_DAYS = 30;
/** Most messages read to draw the per-day chart (the card counts are exact; the chart is capped here, like the other parts). */
export const MESSAGE_CHART_CAP = 5000;
/** Most kinds listed. */
export const KIND_ROWS = 12;

/** A guest request's state, in plain words, in the order work moves (a guest asks → somebody takes it → it is done). */
export const GUEST_REQUEST_STATUS_WORDS: Record<string, string> = {
  NEW: msg("New"), ASSIGNED: msg("Given to someone"), IN_PROGRESS: msg("Accepted"), COMPLETED: msg("Done"), CANCELLED: msg("Cancelled"),
};
/** A website booking request's state, in plain words, in the order work moves. */
export const BOOKING_REQUEST_STATUS_WORDS: Record<string, string> = {
  NEW: msg("New"), REVIEWING: msg("Being reviewed"), CONTACTED: msg("Guest contacted"), CONFIRMED: msg("Confirmed"),
  CONVERTED: msg("Made into a booking"), REJECTED: msg("Rejected"), CANCELLED: msg("Cancelled"),
};

/** A guest request nobody has finished (the same states the staff Requests page keeps open). */
const GUEST_REQUEST_OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS"] as const;
/** Asked by the guest from their phone (stay link or room QR); the rest were logged at the desk. */
const FROM_PHONE = ["GUEST_LINK", "ROOM_QR"];

/**
 * A message kind in plain English: the list the guest's profile uses, else the code spread into words ("PAYMENT_FAILED" →
 * "Payment failed"). A code that is not a plain code is "Other": whatever is stored is never shown as it is.
 */
export function messageKindWords(type: string): string {
  if (Object.hasOwn(GUEST_MESSAGE_TYPES, type)) return GUEST_MESSAGE_TYPES[type as keyof typeof GUEST_MESSAGE_TYPES];
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(type)) return msg("Other");
  const words = type.toLowerCase().replace(/_+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface StatusRow { status: string; label: string; count: number }
/** A kind of message: its plain-English name, how many in the window, and how many of those failed. The stored code itself is never returned. */
export interface KindRow { label: string; count: number; failed: number }

export interface RequestsGlance {
  today: BusinessDate;
  dayStart: string;
  /** The last 14 hotel days, oldest first, ending today. */
  days: BusinessDate[];
  cards: {
    /** Messages logged to guests in the last 14 hotel days: those handed on (`sent`) and those that failed. */
    messages: { sent: number; failed: number } | null;
    /** What nobody has taken yet: guest requests New or given to someone and not accepted, and booking requests New. */
    waiting: { guestRequests: number; bookingRequests: number; total: number } | null;
    /** Every guest request ever raised; `fromPhone` of them were asked by the guest from their phone; `open` are not finished. */
    guestRequests: { total: number; fromPhone: number; open: number } | null;
    /** Every booking request ever made; `open` = reception has not finished with it (the front desk's own count). */
    bookingRequests: { total: number; open: number } | null;
  };
  /** One entry per day in `days`. */
  messagesPerDay: { date: BusinessDate; sent: number; failed: number }[] | null;
  /** By kind, last 30 hotel days, biggest first. */
  messageKinds: KindRow[] | null;
  /** Every guest request ever, by state (states with none are left out), biggest first. */
  guestRequestsByStatus: StatusRow[] | null;
  /** Every booking request ever, by state (states with none are left out), biggest first. */
  bookingRequestsByStatus: StatusRow[] | null;
}

/** Group counts by state, named in plain words, biggest first (ties keep the order work moves in). */
function statusRows(groups: { status: string; _count: number }[], words: Record<string, string>): StatusRow[] {
  const order = Object.keys(words);
  return groups
    .filter((g) => g._count > 0)
    .map((g) => ({ status: g.status, label: words[g.status] ?? msg("Other"), count: g._count }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.status) - order.indexOf(b.status));
}

export async function requestsGlance(user: ConsoleUser, now = new Date()): Promise<RequestsGlance> {
  assertConsoleAccess(user);
  const f = await consoleFrame(now);
  const { cfg, today, days } = f;
  const kindsFrom = businessRangeBounds(addDays(today, -(KIND_DAYS - 1)), today, cfg).start;
  const window14 = { gte: f.start, lt: f.end };

  const [sent14, failed14, rows14, kindGroups, waitingGuest, waitingBooking, guestGroups, guestFromPhone, bookingGroups, bookingOpen] = await Promise.all([
    safe(() => db.guestMessage.count({ where: { status: "SENT", createdAt: window14 } })),
    safe(() => db.guestMessage.count({ where: { status: "FAILED", createdAt: window14 } })),
    safe(() => db.guestMessage.findMany({ where: { createdAt: window14 }, select: { createdAt: true, status: true }, orderBy: { createdAt: "desc" }, take: MESSAGE_CHART_CAP })),
    safe(() => db.guestMessage.groupBy({ by: ["type", "status"], where: { createdAt: { gte: kindsFrom, lt: f.end } }, _count: { _all: true }, orderBy: { _count: { type: "desc" } }, take: 100 })),
    safe(() => db.serviceRequest.count({ where: { status: { in: ["NEW", "ASSIGNED"] } } })),
    safe(() => newRequestCount()),
    safe(() => db.serviceRequest.groupBy({ by: ["status"], _count: { _all: true } })),
    safe(() => db.serviceRequest.count({ where: { source: { in: FROM_PHONE } } })),
    safe(() => db.bookingRequest.groupBy({ by: ["status"], _count: { _all: true } })),
    safe(() => openRequestCount()),
  ]);

  const guestStates = guestGroups?.map((g) => ({ status: g.status as string, _count: g._count._all })) ?? null;
  const bookingStates = bookingGroups?.map((g) => ({ status: g.status as string, _count: g._count._all })) ?? null;
  const sumOf = (rows: { _count: number }[]) => rows.reduce((n, r) => n + r._count, 0);

  // Per day: sent and failed (a message is on the hotel day it was made).
  let messagesPerDay: RequestsGlance["messagesPerDay"] = null;
  if (rows14) {
    const sent = countPerDay(rows14.filter((r) => r.status === "SENT").map((r) => r.createdAt), days, cfg);
    const failed = countPerDay(rows14.filter((r) => r.status === "FAILED").map((r) => r.createdAt), days, cfg);
    messagesPerDay = days.map((date) => ({ date, sent: sent[date], failed: failed[date] }));
  }

  // By kind: one row per kind (the same kind sent and failed is one row), the failed ones counted apart.
  let messageKinds: RequestsGlance["messageKinds"] = null;
  if (kindGroups) {
    const byWords = new Map<string, KindRow>();
    for (const g of kindGroups) {
      const label = messageKindWords(g.type);
      const row = byWords.get(label) ?? { label, count: 0, failed: 0 };
      row.count += g._count._all;
      if (g.status === "FAILED") row.failed += g._count._all;
      byWords.set(label, row);
    }
    const sorted = [...byWords.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    // More kinds than rows: the smallest are added up in one "Other kinds" row, so the bars still add up to every message.
    if (sorted.length > KIND_ROWS) {
      const rest = sorted.slice(KIND_ROWS - 1);
      messageKinds = [...sorted.slice(0, KIND_ROWS - 1), { label: msg("Other kinds"), count: rest.reduce((n, r) => n + r.count, 0), failed: rest.reduce((n, r) => n + r.failed, 0) }];
    } else messageKinds = sorted;
  }

  return {
    today,
    dayStart: f.dayStart,
    days,
    cards: {
      messages: sent14 !== null && failed14 !== null ? { sent: sent14, failed: failed14 } : null,
      waiting: waitingGuest !== null && waitingBooking !== null
        ? { guestRequests: waitingGuest, bookingRequests: waitingBooking, total: waitingGuest + waitingBooking } : null,
      guestRequests: guestStates && guestFromPhone !== null
        ? { total: sumOf(guestStates), fromPhone: guestFromPhone, open: sumOf(guestStates.filter((g) => (GUEST_REQUEST_OPEN as readonly string[]).includes(g.status))) } : null,
      bookingRequests: bookingStates && bookingOpen !== null ? { total: sumOf(bookingStates), open: bookingOpen } : null,
    },
    messagesPerDay,
    messageKinds,
    guestRequestsByStatus: guestStates ? statusRows(guestStates, GUEST_REQUEST_STATUS_WORDS) : null,
    bookingRequestsByStatus: bookingStates ? statusRows(bookingStates, BOOKING_REQUEST_STATUS_WORDS) : null,
  };
}
