import {
  Briefcase, Car, Landmark, Megaphone, Package, Scale, ShieldCheck, SprayCan, Users, UtensilsCrossed, Wifi, Wine, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

/** Icon + colour for each expense group (by the group's icon name). */
const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  Zap: { icon: Zap, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  Wifi: { icon: Wifi, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  Users: { icon: Users, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  UtensilsCrossed: { icon: UtensilsCrossed, tone: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
  Wine: { icon: Wine, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-400" },
  SprayCan: { icon: SprayCan, tone: "bg-teal-500/12 text-teal-600 dark:text-teal-400" },
  Wrench: { icon: Wrench, tone: "bg-slate-500/15 text-slate-600 dark:text-slate-300" },
  Car: { icon: Car, tone: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400" },
  Megaphone: { icon: Megaphone, tone: "bg-pink-500/12 text-pink-600 dark:text-pink-400" },
  Landmark: { icon: Landmark, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  ShieldCheck: { icon: ShieldCheck, tone: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-400" },
  Scale: { icon: Scale, tone: "bg-red-500/12 text-red-600 dark:text-red-400" },
  Briefcase: { icon: Briefcase, tone: "bg-lime-500/15 text-lime-700 dark:text-lime-400" },
};
const OTHER = { icon: Package, tone: "bg-muted text-muted-foreground" };

export function expenseLook(icon: string | null | undefined) {
  return (icon && LOOK[icon]) || OTHER;
}
