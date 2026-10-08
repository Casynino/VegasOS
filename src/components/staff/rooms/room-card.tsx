import { Ban, BedDouble, BrushCleaning, CheckCircle2, Clock, LogIn, SprayCan, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

export type CardState = "AVAILABLE" | "READY" | "ARRIVING" | "OCCUPIED" | "DIRTY" | "CLEANING" | "MAINTENANCE" | "OUT_OF_SERVICE";

/** One soft colour per status — used only for the thin bar and the dot. */
export const CARD_META: Record<CardState, { label: string; dot: string; tint: string; hover: string; icon: LucideIcon }> = {
  AVAILABLE: { label: msg("Available"), dot: "bg-emerald-500", tint: "from-emerald-500/[0.07]", hover: "hover:border-emerald-500/50", icon: CheckCircle2 },
  READY: { label: msg("Clean & ready"), dot: "bg-emerald-400", tint: "from-emerald-400/[0.07]", hover: "hover:border-emerald-400/50", icon: CheckCircle2 },
  ARRIVING: { label: msg("Arriving today"), dot: "bg-amber-400", tint: "from-amber-400/[0.09]", hover: "hover:border-amber-400/60", icon: LogIn },
  OCCUPIED: { label: msg("Occupied"), dot: "bg-sky-500", tint: "from-sky-500/[0.07]", hover: "hover:border-sky-500/50", icon: BedDouble },
  DIRTY: { label: msg("Needs cleaning"), dot: "bg-orange-400", tint: "from-orange-400/[0.08]", hover: "hover:border-orange-400/60", icon: SprayCan },
  CLEANING: { label: msg("Being cleaned"), dot: "bg-violet-400", tint: "from-violet-400/[0.08]", hover: "hover:border-violet-400/60", icon: BrushCleaning },
  MAINTENANCE: { label: msg("Maintenance"), dot: "bg-rose-400", tint: "from-rose-400/[0.08]", hover: "hover:border-rose-400/60", icon: Wrench },
  OUT_OF_SERVICE: { label: msg("Out of service"), dot: "bg-zinc-400", tint: "from-zinc-400/[0.08]", hover: "hover:border-zinc-400/60", icon: Ban },
};


/**
 * One room as a small, calm tile: status bar, number, dot, type, who is in it
 * and one line about time. Click it to open the room panel with all actions.
 */
export function RoomTile({ number, type, state, guest, detail, overdue, onClick }: {
  number: string; type: string; state: CardState; guest?: string | null; detail?: string | null; overdue?: boolean; onClick?: () => void;
}) {
  const t = useT();
  const m = CARD_META[state];
  const bar = overdue ? "bg-rose-500" : m.dot;
  const Icon = overdue ? Clock : m.icon;
  return (
    <button type="button" onClick={onClick} title={`${t("Room {room}", { room: number })} · ${overdue ? t("Checkout overdue") : t(m.label)}`}
      className={cn("group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card bg-linear-to-br to-transparent to-60% py-2.5 pl-3.5 pr-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-[0_12px_26px_-16px_rgba(15,23,42,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-white/[0.035]",
        overdue ? "border-rose-500/50 from-rose-500/[0.09] hover:border-rose-500/70" : cn("border-slate-200 dark:border-white/[0.12]", m.tint, m.hover))}>
      <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", bar)} />
      <span className="flex items-center justify-between gap-1.5">
        <span className="text-lg font-semibold leading-none tracking-tight tabular-nums">{number}</span>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full ring-2 ring-card", bar)} />
      </span>
      <span className="mt-1 truncate text-[10px] text-muted-foreground">{type}</span>
      <span className={cn("mt-2 truncate text-xs", guest ? "font-medium" : "text-muted-foreground")}>
        {guest ?? (overdue ? t("Overdue") : t(m.label))}
      </span>
      <span className={cn("flex min-w-0 items-center gap-1 text-[10px]", overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
        <Icon className="size-3 shrink-0 opacity-70" /><span className="truncate">{detail ?? t(m.label)}</span>
      </span>
    </button>
  );
}

/** All rooms in one even flow: same-size tiles, rows that always fill the width. */
export function RoomFlow({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container">
      <ul className="flex flex-wrap gap-2.5 [--per:3] @xl:[--per:4] @3xl:[--per:6] @5xl:[--per:8]">{children}</ul>
    </div>
  );
}

/** Class for each tile inside a RoomFlow: shares the row evenly and grows to fill any gap. */
export const FLOOR_ITEM = "min-w-0 grow basis-[calc((100%-(var(--per)-1)*0.625rem)/var(--per))]";
