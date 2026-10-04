import { Ban, CalendarClock, CheckCircle2, CircleCheck, HandCoins, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import type { TableState } from "@/server/services/table-performance";

/** One colour per state — the thin bar and the dot, like the room cards. */
export const TABLE_META: Record<TableState, { label: string; dot: string; tint: string; hover: string; icon: LucideIcon; hex: string }> = {
  SEATED: { label: "Seated", dot: "bg-sky-500", tint: "from-sky-500/[0.08]", hover: "hover:border-sky-500/50", icon: Users, hex: "#38bdf8" },
  ORDERS: { label: "Open orders", dot: "bg-sky-500", tint: "from-sky-500/[0.08]", hover: "hover:border-sky-500/50", icon: ShoppingBag, hex: "#38bdf8" },
  BILL: { label: "Waiting to pay", dot: "bg-amber-400", tint: "from-amber-400/[0.1]", hover: "hover:border-amber-400/60", icon: HandCoins, hex: "#fbbf24" },
  PAID: { label: "Paid · to clear", dot: "bg-violet-400", tint: "from-violet-400/[0.09]", hover: "hover:border-violet-400/60", icon: CircleCheck, hex: "#a78bfa" },
  RESERVED: { label: "Reserved", dot: "bg-orange-400", tint: "from-orange-400/[0.09]", hover: "hover:border-orange-400/60", icon: CalendarClock, hex: "#fb923c" },
  FREE: { label: "Free", dot: "bg-emerald-500", tint: "from-emerald-500/[0.06]", hover: "hover:border-emerald-500/50", icon: CheckCircle2, hex: "#34d399" },
  BLOCKED: { label: "Not available", dot: "bg-slate-400", tint: "from-slate-400/[0.06]", hover: "hover:border-slate-400/50", icon: Ban, hex: "#94a3b8" },
};
