/**
 * Stock requests on the screen — the parts the page and its dialogs share (safe in the browser):
 * what each step is called, the shapes the server hands over (money only for buyers and
 * approvers), and small helpers for amounts, units, people and times.
 */
import { formatDateTime } from "@/lib/format";
import { unitOf } from "@/lib/inventory";
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

export type StockStatus = "SUBMITTED" | "SENT_BACK" | "APPROVED" | "PURCHASING" | "PENDING_APPROVAL" | "COMPLETED" | "REJECTED" | "CANCELLED";

/** Each step, in plain words, with its colour. */
export const STATUS_META: Record<string, { label: string; tone: string }> = {
  SUBMITTED: { label: msg("Waiting for review"), tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  SENT_BACK: { label: msg("Sent back to change"), tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  APPROVED: { label: msg("Approved — to buy"), tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  PURCHASING: { label: msg("Being bought"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  PENDING_APPROVAL: { label: msg("Bought — waiting for approval"), tone: "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300" },
  COMPLETED: { label: msg("Done — in stock"), tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  REJECTED: { label: msg("Rejected"), tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  CANCELLED: { label: msg("Cancelled"), tone: "bg-muted text-muted-foreground" },
};
export const statusMeta = (s: string) => STATUS_META[s] ?? { label: s.toLowerCase().replace(/_/g, " "), tone: "bg-muted text-muted-foreground" };

/** Still moving: not done, rejected or cancelled. */
export const OPEN_STATUSES = ["SUBMITTED", "SENT_BACK", "APPROVED", "PURCHASING", "PENDING_APPROVAL"];

/** A stock item in the stores (what a line is linked to). */
export type StockItemRef = { id: string; name: string; unit: string; tracksExpiry: boolean };

/** One line of a request. Prices, totals and expiry are only filled for buyers and approvers. */
export type StockLineView = {
  id: string;
  name: string;
  /** Asked for, in `unit`. */
  quantity: number;
  unit: string;
  note: string | null;
  /** What the manager approved (null = as asked / not reviewed yet). */
  approvedQty: number | null;
  stockItem: StockItemRef | null;
  /** Actually bought — in the stock item's unit when linked. 0 = not bought. */
  purchasedQty: number | null;
  /** Put into stock at the final approval. */
  received: boolean;
  unitPrice: number | null;
  lineTotal: number | null;
  expiresOn: string | null;
};

/** One step in a request's history. `detail` is already made safe for the viewer on the server. */
export type StockEventView = {
  id: string;
  action: string;
  from: string | null;
  to: string | null;
  by: string | null;
  role: string | null;
  reason: string | null;
  detail: string[];
  at: string;
};

/** The purchase — only for buyers and approvers. */
export type PurchaseView = {
  number: string | null;
  /** YYYY-MM-DD (hotel time). */
  on: string | null;
  supplierId: string | null;
  supplier: string | null;
  supplierName: string | null;
  receiptNumber: string | null;
  receiptFileId: string | null;
  receiptIsPdf: boolean;
  noReceiptReason: string | null;
  accountId: string | null;
  account: string | null;
  note: string | null;
  total: number | null;
  submittedAt: string | null;
  correctionNote: string | null;
  expense: { number: string | null; amount: number } | null;
};

export type StockReqView = {
  id: string;
  number: string;
  department: string;
  departmentName: string;
  departmentId: string | null;
  status: string;
  urgent: boolean;
  neededBy: string | null;
  reason: string | null;
  note: string | null;
  by: string;
  byId: string;
  at: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** P-2026-0001 once a purchase was recorded (null on requests received before purchases were recorded). */
  purchaseNumber: string | null;
  boughtBy: string | null;
  boughtById: string | null;
  finalBy: string | null;
  finalById: string | null;
  finalAt: string | null;
  lines: StockLineView[];
  purchase: PurchaseView | null;
  events: StockEventView[];
};

/** What the purchase form offers (buyers and approvers only). */
export type PurchaseOptionsView = {
  suppliers: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  items: { id: string; name: string; unit: string; departmentId: string; tracksExpiry: boolean; costPerUnit: number }[];
  categories: { id: string; code: string; name: string }[];
  expenseGroup: Record<string, string>;
};

/** The spending and the counts at each step (buyers and approvers only). */
export type PurchasingSummaryView = {
  toReview: number; sentBack: number; toBuy: number; buying: number; toApprove: number; toApproveAmount: number;
  spentToday: number; spentMonth: number; byDepartment: { name: string; amount: number }[];
};

export type DepartmentOption = { id: string; code: string; name: string };
/** A stock item someone can ask for — no prices. */
export type StoreItem = { id: string; name: string; unit: string; departmentId: string };

/** Who is looking, and what they may do. */
export type Viewer = { id: string; name: string; asker: boolean; reviewer: boolean; buyer: boolean; approverMustDiffer: boolean };

// ── Helpers ──

/** 9.5 → "9.5", 10 → "10", 0.333333 → "0.33". */
export const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
/** "Nino (Manager)" → "Nino". */
export const person = (n: string) => n.replace(/\s*\(.*\)/, "");
/** "30 Sept, 10:15" in hotel time (in the reader's wording when their `t` is given). */
export const when = (iso: string, t?: T) => (t ? t.dateTime(iso) : formatDateTime(iso));

/** A request word for a stock unit: KG → kg, PIECE → pcs, L → litres, BOTTLE → bottles. */
export function unitWord(code: string) {
  const map: Record<string, string> = { KG: "kg", G: "g", L: "litres", PIECE: "pcs" };
  return map[code] ?? unitOf(code).plural;
}

/** "9.5 kg Beef" — in the stock item's unit when it is one, else as asked (the unit in the reader's language when their `t` is given). */
export function boughtQty(l: Pick<StockLineView, "purchasedQty" | "unit" | "stockItem">, t: T = englishT) {
  const q = l.purchasedQty ?? 0;
  return l.stockItem ? `${num(q)} ${t(unitOf(l.stockItem.unit).plural)}` : `${num(q)} ${t(l.unit)}`;
}

/** What a line is to buy: the approved amount, or what was asked. */
export const toBuyQty = (l: Pick<StockLineView, "approvedQty" | "quantity">) => l.approvedQty ?? l.quantity;

/** A history step in words: "approved for purchase", "sent the purchase for final approval" (English — shown with t(…)). */
export function eventVerb(e: Pick<StockEventView, "action" | "from">) {
  switch (e.action) {
    case "SUBMITTED": return e.from === "SENT_BACK" ? msg("changed it and sent it again") : msg("asked for it");
    case "EDITED": return msg("changed the list");
    case "APPROVED": return msg("approved for purchase");
    case "SENT_BACK": return msg("sent it back to change");
    case "REJECTED": return msg("rejected it");
    case "CANCELLED": return msg("cancelled it");
    case "PURCHASE_SAVED": return msg("saved the purchase");
    case "PURCHASE_SUBMITTED": return msg("sent the purchase for final approval");
    case "PURCHASE_SENT_BACK": return msg("sent the purchase back for correction");
    case "FINAL_APPROVED": return msg("gave the final approval — stock in, expense recorded");
    default: return e.action.toLowerCase().replace(/_/g, " ");
  }
}
