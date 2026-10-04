import { Banknote, CreditCard, Landmark, Smartphone, Wallet, type LucideIcon } from "lucide-react";

/** Icon + colour for a payment account by its type (cards, headers, lists). */
const LOOK: Record<string, { icon: LucideIcon; card: string; tile: string; hero: string }> = {
  BANK: { icon: Landmark, card: "from-sky-500/[0.14] via-sky-500/[0.04]", tile: "bg-sky-500/15 text-sky-600 dark:text-sky-300", hero: "from-sky-500 via-indigo-500 to-rose-500" },
  MOBILE_MONEY: { icon: Smartphone, card: "from-rose-500/[0.16] via-rose-500/[0.05]", tile: "bg-rose-500/15 text-rose-600 dark:text-rose-300", hero: "from-rose-500 via-orange-500 to-amber-400" },
  CASH: { icon: Banknote, card: "from-emerald-500/[0.14] via-emerald-500/[0.04]", tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", hero: "from-emerald-500 via-teal-500 to-sky-500" },
  PETTY_CASH: { icon: Wallet, card: "from-teal-500/[0.14] via-teal-500/[0.04]", tile: "bg-teal-500/15 text-teal-600 dark:text-teal-300", hero: "from-teal-500 via-emerald-500 to-lime-400" },
  CARD: { icon: CreditCard, card: "from-violet-500/[0.14] via-violet-500/[0.04]", tile: "bg-violet-500/15 text-violet-600 dark:text-violet-300", hero: "from-violet-500 via-fuchsia-500 to-rose-400" },
  OTHER: { icon: Wallet, card: "from-slate-500/[0.12] via-slate-500/[0.03]", tile: "bg-slate-500/15 text-slate-600 dark:text-slate-300", hero: "from-slate-500 via-slate-600 to-zinc-500" },
};
export const accountLook = (kind: string) => LOOK[kind] ?? LOOK.OTHER;

/** "015C799490700" → "015C 7994 9070 0" (easier to read out and compare). */
export const spacedNumber = (n: string) => n.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");

/** "4 days ago", "24 hours ago", "just now". */
export function ago(d: Date | null, now = new Date()) {
  if (!d) return "no movement yet";
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}
