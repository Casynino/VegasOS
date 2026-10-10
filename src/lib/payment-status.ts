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
