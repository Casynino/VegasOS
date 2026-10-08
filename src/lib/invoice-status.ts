import type { InvoiceStatus } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";

export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; className: string }> = {
  DRAFT: { label: msg("Draft"), className: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" },
  ISSUED: { label: msg("Issued"), className: "bg-blue-600/10 text-blue-700 dark:text-blue-300" },
  PARTIALLY_PAID: { label: msg("Partly paid"), className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  PAID: { label: msg("Paid"), className: "bg-green-600/10 text-green-700 dark:text-green-300" },
  OVERDUE: { label: msg("Overdue"), className: "bg-red-600/10 text-red-700 dark:text-red-300" },
  CANCELLED: { label: msg("Cancelled"), className: "bg-zinc-500/10 text-zinc-500 line-through" },
  VOID: { label: msg("Void"), className: "bg-zinc-500/10 text-zinc-500 line-through" },
};
