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
  AWAITING_AUTHORIZATION: { label: msg("Waiting for Finance to authorize the price"), tone: "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300" },
  ORDERED: { label: msg("Ordered — waiting for delivery"), tone: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" },
  PART_DELIVERED: { label: msg("Partly delivered"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  DELIVERED: { label: msg("Delivered — invoice and payment to finish"), tone: "bg-teal-500/12 text-teal-700 dark:text-teal-300" },
  COMPLETED: { label: msg("Done"), tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  REJECTED: { label: msg("Rejected"), tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  CANCELLED: { label: msg("Cancelled"), tone: "bg-muted text-muted-foreground" },
};
/**
 * What a request is called to the people who ASK (reception, the Restaurant, the kitchen): six simple words, whatever step Finance
 * is on. Finance and the managers see the full steps above. A step that is still waiting for goods is "Purchased" once Finance has
 * ordered or bought it; the money steps after that (invoice, payment) are Finance's, not theirs.
 */
export const SIMPLE_STATUS: Record<string, { label: string; tone: string }> = {
  SUBMITTED: { label: msg("Submitted"), tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  SENT_BACK: { label: msg("More information needed"), tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  APPROVED: { label: msg("Approved"), tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  AWAITING_AUTHORIZATION: { label: msg("Approved"), tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  PURCHASING: { label: msg("Purchased"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  PENDING_APPROVAL: { label: msg("Purchased"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  ORDERED: { label: msg("Purchased"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  PART_DELIVERED: { label: msg("Purchased"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  DELIVERED: { label: msg("Purchased"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  COMPLETED: { label: msg("Completed"), tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  REJECTED: { label: msg("Rejected"), tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  CANCELLED: { label: msg("Cancelled"), tone: "bg-muted text-muted-foreground" },
};
export const simpleStatusMeta = (s: string) => SIMPLE_STATUS[s] ?? statusMeta(s);

export const statusMeta = (s: string) => STATUS_META[s] ?? { label: s.toLowerCase().replace(/_/g, " "), tone: "bg-muted text-muted-foreground" };

/**
 * The status as procurement reads it: an approved purchase is "awaiting a supplier quotation" until a price is authorized
 * (then "ready to order"). Everything else is the request's own status.
 */
export function procurementStatus(status: string, ready: boolean) {
  if (status !== "APPROVED") return statusMeta(status);
  return ready
    ? { label: msg("Price authorized — ready to order"), tone: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" }
    : { label: msg("Approved — awaiting supplier quotation"), tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" };
}

/** Still moving: not done, rejected or cancelled. */
export const OPEN_STATUSES = ["SUBMITTED", "SENT_BACK", "APPROVED", "PURCHASING", "PENDING_APPROVAL", "AWAITING_AUTHORIZATION", "ORDERED", "PART_DELIVERED", "DELIVERED"];

/**
 * Which departments a person can ask for (owner, 2026-10-13): Reception and the other hotel staff ask for the hotel's general needs and
 * guest-room supplies; the restaurant, the kitchen and the bar ask for theirs; Finance, the managers and the Boss ask for any. The same
 * rule is checked on the server when a request is made.
 */
export const RESTAURANT_DEPARTMENTS: readonly string[] = ["KITCHEN", "BAR", "RESTAURANT"];
export type AskScope = "ALL" | "RESTAURANT" | "HOTEL";
export function askScope(perms: ReadonlySet<string> | undefined): AskScope {
  const has = (...c: string[]) => c.some((x) => perms?.has(x));
  if (has("expenses.approve", "inventory.receive", "procurement.manage", "purchases.authorize", "purchases.pay", "dashboard.admin", "dashboard.owner", "dashboard.manager")) return "ALL";
  if (has("kitchen.orders", "bar.orders", "restaurant.serve", "restaurant.device")) return "RESTAURANT";
  return "HOTEL";
}
export const canAskFor = (scope: AskScope, code: string) => scope === "ALL" || (scope === "RESTAURANT" ? RESTAURANT_DEPARTMENTS.includes(code) : !RESTAURANT_DEPARTMENTS.includes(code));

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
  /** On the purchase order, and how much of it has arrived (quantities only — no prices). */
  orderedQty: number | null;
  receivedQty: number;
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
  /** "Done by Developer · as Neema" (already translated) when the Developer did this step while working as someone. */
  doneBy?: string | null;
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
  /** A short name for the request, if the person gave one. */
  title: string | null;
  /** LOW | NORMAL | HIGH | URGENT */
  priority: string;
  /** The person's own guess of the cost — an estimate, never an approved expense. */
  estimatedTotal: number | null;
  /** What Finance approved to spend on it. */
  approvedBudget: number | null;
  /** The purchase order, once one is issued (the amount only for those who handle money). */
  order: { number: string; expectedOn: string | null; total: number | null } | null;
  /** The photo or document kept with the request. */
  attachments: { id: string; kind: string; isPdf: boolean }[];
  neededBy: string | null;
  reason: string | null;
  note: string | null;
  by: string;
  byId: string;
  at: string;
  /** "Done by Developer · as Neema" next to who asked, when the Developer made the request while working as someone. */
  byDoneBy?: string | null;
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
export type Viewer = { id: string; name: string; asker: boolean; reviewer: boolean; buyer: boolean; approverMustDiffer: boolean; /** Which departments this person may ask for. */ scope: AskScope };

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
    case "QUOTE_RECORDED": return msg("recorded a supplier quotation");
    case "QUOTE_PROPOSED": return msg("proposed a quotation to buy from");
    case "QUOTE_AUTHORIZED": return msg("authorized the price");
    case "QUOTE_RETURNED": return msg("returned the quotation");
    case "ORDER_ISSUED": return msg("issued the purchase order");
    case "DELIVERY_RECORDED": return msg("recorded a delivery");
    case "DELIVERY_PROBLEM": return msg("recorded a problem with a delivery");
    case "DELIVERY_CLOSED_SHORT": return msg("closed the delivery with what arrived");
    case "DELIVERY_REPORTED": return msg("reported that the delivery is not right");
    case "DELIVERY_CONFIRMED": return msg("confirmed the delivery is right");
    case "INVOICE_RECORDED": return msg("recorded the supplier invoice");
    case "INVOICE_VERIFIED": return msg("verified the invoice");
    case "INVOICE_DISPUTED": return msg("disputed the invoice");
    case "INVOICE_CANCELLED": return msg("cancelled the invoice");
    case "SUPPLIER_PAID": return msg("paid the supplier");
    case "COMPLETED": return msg("closed the purchase — everything delivered, invoiced and paid");
    default: return e.action.toLowerCase().replace(/_/g, " ");
  }
}
