import { Ban, BedDouble, BrushCleaning, CheckCircle2, Clock, LogIn, SprayCan, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CardState = "AVAILABLE" | "READY" | "ARRIVING" | "OCCUPIED" | "DIRTY" | "CLEANING" | "MAINTENANCE" | "OUT_OF_SERVICE";

/**
 * One clear colour per room status, used across every staff dashboard (board, tiles, filters):
 * AVAILABLE & clean-ready = blue, OCCUPIED = green, ARRIVING/reserved = purple, DIRTY = orange,
 * CLEANING = yellow, MAINTENANCE = red, OUT OF SERVICE = dark red. `dot` is the solid colour,
 * `tint` the card wash, `border`/`hover` the card edge, `badge` the readable status pill.
 */
export const CARD_META: Record<CardState, { label: string; dot: string; tint: string; border: string; hover: string; badge: string; icon: LucideIcon }> = {
  AVAILABLE: { label: "Available", dot: "bg-blue-500", tint: "from-blue-500/10", border: "border-blue-500/40", hover: "hover:border-blue-500/70", badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: CheckCircle2 },
  READY: { label: "Clean & ready", dot: "bg-blue-500", tint: "from-blue-500/10", border: "border-blue-500/40", hover: "hover:border-blue-500/70", badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: CheckCircle2 },
  ARRIVING: { label: "Arriving today", dot: "bg-violet-500", tint: "from-violet-500/10", border: "border-violet-500/40", hover: "hover:border-violet-500/70", badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300", icon: LogIn },
  OCCUPIED: { label: "Occupied", dot: "bg-green-500", tint: "from-green-500/10", border: "border-green-500/40", hover: "hover:border-green-500/70", badge: "bg-green-500/15 text-green-700 dark:text-green-300", icon: BedDouble },
  DIRTY: { label: "Needs cleaning", dot: "bg-orange-500", tint: "from-orange-500/12", border: "border-orange-500/45", hover: "hover:border-orange-500/70", badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300", icon: SprayCan },
  CLEANING: { label: "Being cleaned", dot: "bg-amber-500", tint: "from-amber-500/15", border: "border-amber-500/50", hover: "hover:border-amber-500/75", badge: "bg-amber-500/20 text-amber-700 dark:text-amber-300", icon: BrushCleaning },
  MAINTENANCE: { label: "Maintenance", dot: "bg-red-500", tint: "from-red-500/12", border: "border-red-500/45", hover: "hover:border-red-500/70", badge: "bg-red-500/15 text-red-700 dark:text-red-300", icon: Wrench },
  OUT_OF_SERVICE: { label: "Out of service", dot: "bg-red-800", tint: "from-red-900/15", border: "border-red-900/50", hover: "hover:border-red-900/75", badge: "bg-red-900/20 text-red-800 dark:text-red-300", icon: Ban },
};


/**
 * One room as a small tile with a clear status colour: a status-tinted body and border, a status
 * dot and a readable status badge, the number, who is in it and one line about time. An overdue
 * checkout shows a red accent bar and red time line, but the card keeps its status colour so you
 * can still see at a glance that the room is occupied. Click it to open the room panel.
 */
export function RoomTile({ number, type, state, guest, detail, overdue, onClick }: {
  number: string; type: string; state: CardState; guest?: string | null; detail?: string | null; overdue?: boolean; onClick?: () => void;
}) {
  const m = CARD_META[state];
  const Icon = overdue ? Clock : m.icon;
  return (
    <button type="button" onClick={onClick} title={`Room ${number} · ${m.label}${overdue ? " · checkout overdue" : ""}`}
      className={cn("group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card bg-linear-to-br to-transparent to-65% py-2.5 pl-3.5 pr-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-[0_12px_26px_-16px_rgba(15,23,42,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-white/[0.04]",
        m.tint, m.border, m.hover)}>
      <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", overdue ? "bg-red-500" : m.dot)} />
      <span className="flex items-center justify-between gap-1.5">
        <span className="text-lg font-semibold leading-none tracking-tight tabular-nums">{number}</span>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none", m.badge)}>
          <span aria-hidden className={cn("size-1.5 rounded-full", m.dot)} />{m.label}
        </span>
      </span>
      <span className="mt-1 truncate text-[10px] text-muted-foreground">{type}</span>
      <span className={cn("mt-2 truncate text-xs", guest ? "font-medium" : "text-muted-foreground")}>
        {guest ?? m.label}
      </span>
      <span className={cn("flex min-w-0 items-center gap-1 text-[10px]", overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        <Icon className="size-3 shrink-0 opacity-70" /><span className="truncate">{detail ?? m.label}</span>
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
