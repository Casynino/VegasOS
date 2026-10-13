import { msg } from "@/i18n/msg";

/**
 * Payment status of a booking — separate from its stay status (a guest can be
 * CHECKED IN and PAID, or CHECKED IN and UNPAID). Company-billed amounts count
 * as settled for the guest (the company owes them on its invoice).
 */
export type PaymentStatus = "NOTHING_DUE" | "UNPAID" | "PART_PAID" | "PAID" | "CREDIT" | "GROUP_PAYS";

export function paymentStatus(r: { netAmount: number; paidAmount: number; balanceAmount: number; companyBilledAmount?: number; billTo?: string }): PaymentStatus {
  if (r.balanceAmount < 0) return "CREDIT";
  // A group room: the group's payer owes it (moved to the group invoice at checkout), not the guest.
  if (r.billTo === "GROUP" && r.balanceAmount > 0) return "GROUP_PAYS";
  if (r.netAmount <= 0) return "NOTHING_DUE";
  if (r.balanceAmount === 0) return "PAID";
  return r.paidAmount + (r.companyBilledAmount ?? 0) > 0 ? "PART_PAID" : "UNPAID";
}

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; className: string }> = {
  NOTHING_DUE: { label: msg("Nothing due"), className: "bg-muted text-muted-foreground" },
  UNPAID: { label: msg("Unpaid"), className: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  PART_PAID: { label: msg("Part paid"), className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  PAID: { label: msg("Paid"), className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  CREDIT: { label: msg("Credit (overpaid)"), className: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  GROUP_PAYS: { label: msg("Group pays"), className: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
};

/**
 * How a report states a bill — the same words as above, with one more: a bill that was only moved onto a company
 * invoice is "Company invoice", never "Paid" (an invoice is not money received).
 */
export type BillState = PaymentStatus | "COMPANY_INVOICE";

export function billState(b: { total: number; paid: number; company: number; owed: number; billTo?: string }): BillState {
  if (b.owed < 0) return "CREDIT";
  if (b.billTo === "GROUP" && b.owed > 0) return "GROUP_PAYS";
  if (b.total <= 0) return "NOTHING_DUE";
  if (b.owed === 0) return b.company > 0 && b.paid < b.total ? "COMPANY_INVOICE" : "PAID";
  return b.paid > 0 ? "PART_PAID" : "UNPAID";
}

/**
 * How a room's bill looks on its tile — paid or not paid, said in one word the Boss can read across the room. A bill moved onto a
 * company's invoice is "On company invoice", never "Paid" (an invoice is not money received); a zero bill is "Nothing due", never "Paid".
 */
export const BILL_LOOK: Record<BillState, { label: string; className: string; text: string; owes: boolean }> = {
  PAID: { label: msg("Paid"), className: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300", text: "text-emerald-600 dark:text-emerald-300", owes: false },
  UNPAID: { label: msg("Not paid"), className: "bg-rose-500/15 text-rose-700 ring-rose-500/35 dark:text-rose-300", text: "text-rose-600 dark:text-rose-300", owes: true },
  PART_PAID: { label: msg("Part paid"), className: "bg-amber-500/15 text-amber-800 ring-amber-500/35 dark:text-amber-300", text: "text-amber-700 dark:text-amber-300", owes: true },
  GROUP_PAYS: { label: msg("Group pays"), className: "bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300", text: "text-violet-600 dark:text-violet-300", owes: false },
  COMPANY_INVOICE: { label: msg("On company invoice"), className: "bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300", text: "text-violet-600 dark:text-violet-300", owes: false },
  CREDIT: { label: msg("Overpaid"), className: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300", text: "text-sky-600 dark:text-sky-300", owes: false },
  NOTHING_DUE: { label: msg("Nothing due"), className: "bg-muted text-muted-foreground ring-border", text: "text-muted-foreground", owes: false },
};

export const BILL_STATE_LABEL: Record<BillState, string> = {
  NOTHING_DUE: "Nothing due", UNPAID: "Unpaid", PART_PAID: "Part paid", PAID: "Paid", CREDIT: "Overpaid", GROUP_PAYS: "Group pays", COMPANY_INVOICE: "Company invoice",
};
