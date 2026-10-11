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

export const BILL_STATE_LABEL: Record<BillState, string> = {
  NOTHING_DUE: "Nothing due", UNPAID: "Unpaid", PART_PAID: "Part paid", PAID: "Paid", CREDIT: "Overpaid", GROUP_PAYS: "Group pays", COMPANY_INVOICE: "Company invoice",
};
