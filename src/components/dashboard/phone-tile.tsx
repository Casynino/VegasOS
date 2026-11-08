import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The PHONE's quick-action tile, copied from the owner's Target Express console (2026-11-08): a thin line icon in its own colour (no box —
 * light and clean), ONE word under it, and a small count on the corner where it helps. Shown only below `sm`; from there up the actions are the pills / cards they always were.
 */
export type TileTone = "gold" | "emerald" | "sky" | "violet" | "rose" | "amber" | "teal";

/** The icon's own colour — a thin line glyph, no box (as in the owner's Target console). */
const GLYPH: Record<TileTone, string> = {
  gold: "text-[oklch(0.84_0.11_82)]",
  emerald: "text-emerald-400",
  sky: "text-sky-400",
  violet: "text-violet-400",
  rose: "text-rose-400",
  amber: "text-amber-400",
  teal: "text-teal-400",
};

/** Columns on the phone: up to SIX in ONE row (a phone shows at most six: owner, 2026-11-08, "one line like the others"). */
export const PHONE_COLUMNS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6",
  7: "grid-cols-4", 8: "grid-cols-4", 9: "grid-cols-5", 10: "grid-cols-5",
};
export const phoneColumns = (n: number) => PHONE_COLUMNS[Math.min(10, Math.max(1, n))];

/** The tile's frame (a link or a button). */
export const PHONE_TILE =
  "group relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-0 py-1 text-center transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.12_80)]/60 active:scale-95";

/** The most a phone shows in its one row. */
export const PHONE_MAX = 6;

/** The inside of a tile: a thin glyph in its colour, a count on its corner where it helps, and ONE word under it. `icon` is any lucide element — it is sized and thinned here. */
export function PhoneTileFace({ icon, label, tone = "gold", badge }: { icon: ReactNode; label: string; tone?: TileTone; badge?: number }) {
  return (
    <>
      <span className={cn("relative grid h-10 w-10 place-items-center [&_svg]:size-[27px] [&_svg]:stroke-[1.6]", GLYPH[tone])}>
        {icon}
        {badge ? <span className="absolute -right-1.5 -top-0.5 min-w-[1.15rem] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[1.15rem] tabular-nums text-white ring-2 ring-background">{badge}</span> : null}
      </span>
      <span className="w-full truncate text-[11px] leading-tight tracking-tight text-foreground/75">{label}</span>
    </>
  );
}
