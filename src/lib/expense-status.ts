import type { ExpenseStatus } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";

export const EXPENSE_STATUS_META: Record<ExpenseStatus, { label: string; className: string }> = {
  RECORDED: { label: msg("Recorded"), className: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  PENDING_APPROVAL: { label: msg("Awaiting approval"), className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  APPROVED: { label: msg("Approved"), className: "bg-green-600/10 text-green-700 dark:text-green-300" },
  REJECTED: { label: msg("Rejected"), className: "bg-red-600/10 text-red-700 dark:text-red-300" },
  CORRECTION_REQUESTED: { label: msg("Needs correction"), className: "bg-orange-600/10 text-orange-700 dark:text-orange-300" },
  VOIDED: { label: msg("Voided"), className: "bg-zinc-500/10 text-zinc-600 line-through" },
};
