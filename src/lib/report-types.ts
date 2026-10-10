/**
 * A business report as data: headline figures and blocks (bars, charts, statements, tables).
 * The Reports page draws it as a printable document; the CSV export writes the same numbers —
 * so what is printed, downloaded and shared always agrees.
 */

import { msg } from "@/i18n/msg";
import type { TextBook } from "@/lib/report-i18n";

export type ReportKey =
  | "summary" | "daily" | "restaurant" | "items" | "payments" | "outstanding" | "tables" | "rooms" | "staff" | "voids" | "expenses" | "stores";

/** The labels are English keys: shown with t(label). */
export const REPORTS: { key: ReportKey; label: string; title: string; blurb: string }[] = [
  { key: "summary", label: msg("Whole business"), title: msg("Business summary"), blurb: msg("Everything the hotel earned, received and spent — rooms, restaurant, bar and more.") },
  { key: "daily", label: msg("Daily sales"), title: msg("Daily sales"), blurb: msg("Sales day by day (or hour by hour for one day), by department.") },
  { key: "restaurant", label: msg("Restaurant & bar"), title: msg("Restaurant & bar"), blurb: msg("Food, drinks and room service: orders, types, sources, busy hours and speed.") },
  { key: "items", label: msg("Best sellers"), title: msg("Best-selling items"), blurb: msg("Every menu item sold, best first — and what did not sell.") },
  { key: "payments", label: msg("Payments"), title: msg("Payment collection"), blurb: msg("Money received: by method, by account and by who collected it.") },
  { key: "outstanding", label: msg("Outstanding"), title: msg("Outstanding money"), blurb: msg("Everything still owed to the hotel right now: unpaid orders, guests and companies.") },
  { key: "tables", label: msg("Tables"), title: msg("Table utilisation"), blurb: msg("Each table and the counter: customers, sales, time at the table and turns.") },
  { key: "rooms", label: msg("Rooms"), title: msg("Rooms & bookings"), blurb: msg("Occupancy, room types, where bookings come from, arrivals and departures.") },
  { key: "staff", label: msg("Staff"), title: msg("Staff activity"), blurb: msg("Who worked, when they started, what they did and the money they handled.") },
  { key: "voids", label: msg("Cancellations"), title: msg("Cancellations & voids"), blurb: msg("Cancelled orders, items removed, voided sales, reversed payments and cancelled bookings.") },
  { key: "expenses", label: msg("Expenses"), title: msg("Expenses"), blurb: msg("What was spent, by category, with every expense listed.") },
  { key: "stores", label: msg("Stock & waste"), title: msg("Stock, waste & assets"), blurb: msg("Stock received and used by department, what the dishes took, waste, count corrections, stock to buy — and the hotel's assets.") },
];

export type Tone = "gold" | "emerald" | "rose" | "amber" | "sky" | "violet" | "slate";

export type Figure = {
  label: string; value: string; sub?: string; tone?: Tone;
  /** % change against the period before (null = no fair comparison). */
  delta?: number | null;
  /** Up is bad (expenses, cancellations). */
  invert?: boolean;
  /** The raw number, for the CSV. */
  raw?: number;
};

export type Cell = string | number | null;
export type Column = { label: string; align?: "left" | "right"; money?: boolean; muted?: boolean };

export type Block =
  | { kind: "bars"; title: string; subtitle?: string; items: { label: string; value: number; sub?: string; color?: string; note?: string }[]; money?: boolean; empty?: string; half?: boolean; /** Different things side by side — never add them up. */ noTotal?: boolean }
  | { kind: "columns"; title: string; subtitle?: string; points: { label: string; parts: { name: string; value: number; color: string }[]; highlight?: boolean }[]; money?: boolean; empty?: string }
  | { kind: "statement"; title: string; subtitle?: string; rows: { label: string; value: number; style?: "sub" | "total" | "grand" | "less" }[]; half?: boolean }
  | { kind: "table"; title: string; subtitle?: string; columns: Column[]; rows: Cell[][]; foot?: Cell[]; empty?: string; more?: number; /** Where the rest is (default: the CSV). */ moreNote?: string; half?: boolean }
  | { kind: "highlights"; title: string; items: { label: string; value: string; sub?: string }[] }
  | { kind: "note"; text: string }
  /** Short lines — what needs attention, or plain facts about the day. */
  | { kind: "list"; title: string; items: string[]; tone: "attention" | "insight" }
  /** A chapter heading (Money, Rooms, Restaurant…) in a long report. */
  | { kind: "section"; title: string; subtitle?: string };

export type Report = {
  key: ReportKey; title: string; blurb: string;
  /** "Tuesday, 29 September 2026" or "1 Sep → 29 Sep 2026". */
  period: string; from: string; to: string; days: number;
  figures: Figure[];
  blocks: Block[];
  /** Plain-text summary for sharing (WhatsApp, email). */
  share: string;
  /** Sentences with values, kept to say them in another language (src/lib/report-i18n.ts) — reports before Oct 2026 have none. */
  i18n?: TextBook;
};
