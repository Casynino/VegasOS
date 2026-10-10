import { msg } from "@/i18n/msg";

/** Labels and badge tones for booking-request statuses (shared by server & client components). */
export const BOOKING_REQUEST_STATUS: Record<string, { label: string; className: string }> = {
  NEW: { label: msg("New"), className: "bg-[oklch(0.8_0.14_80)] text-[oklch(0.25_0.05_70)]" },
  REVIEWING: { label: msg("Reviewing"), className: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  CONTACTED: { label: msg("Contacted"), className: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  CONFIRMED: { label: msg("Confirmed"), className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  CONVERTED: { label: msg("Converted to reservation"), className: "bg-emerald-700 text-white" },
  REJECTED: { label: msg("Rejected"), className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
  CANCELLED: { label: msg("Cancelled"), className: "bg-muted text-muted-foreground" },
};

export const MANUAL_REQUEST_SOURCES = [["WHATSAPP", "WhatsApp"], ["PHONE", msg("Phone")], ["INSTAGRAM", "Instagram"], ["DIRECT", msg("Direct / email")], ["OTHER", msg("Other")]] as const;
