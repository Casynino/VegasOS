import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The PHONE's quick-action tile, copied from the owner's Target Express console (2026-11-08): a soft rounded chip with a thin line icon in its
 * own colour (a wash of that colour and a fine edge — light and clean, not a heavy filled block), ONE word under it, and a small count on the
 * corner where it helps. Shown only below `sm`; from there up the actions are the pills / cards they always were.
 */
export type TileTone = "gold" | "emerald" | "sky" | "violet" | "rose" | "amber" | "teal";

const CHIP: Record<TileTone, string> = {
  gold: "from-[oklch(0.72_0.12_80/0.34)] to-[oklch(0.72_0.12_80/0.1)] text-[oklch(0.84_0.11_82)] ring-[oklch(0.72_0.12_80/0.45)]",
  emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-300 ring-emerald-500/25",
  sky: "from-sky-500/20 to-sky-500/5 text-sky-300 ring-sky-500/25",
  violet: "from-violet-500/20 to-violet-500/5 text-violet-300 ring-violet-500/25",
  rose: "from-rose-500/20 to-rose-500/5 text-rose-300 ring-rose-500/25",
  amber: "from-amber-500/20 to-amber-500/5 text-amber-300 ring-amber-500/25",
  teal: "from-teal-500/20 to-teal-500/5 text-teal-300 ring-teal-500/25",
};

/** Columns on the phone, chosen so the rows come out as full as they can (Target's rule): up to five in a row, six as two rows of three. */
export const PHONE_COLUMNS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5",
  6: "grid-cols-3", 7: "grid-cols-4", 8: "grid-cols-4", 9: "grid-cols-5", 10: "grid-cols-5",
};
export const phoneColumns = (n: number) => PHONE_COLUMNS[Math.min(10, Math.max(1, n))];

/** The tile's frame (a link or a button). */
export const PHONE_TILE =
  "group relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-0.5 py-1 text-center transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.12_80)]/60 active:scale-95";

/** The inside of a tile: the chip, the count and one word. `icon` is any lucide element — it is sized and thinned here. */
export function PhoneTileFace({ icon, label, tone = "gold", badge }: { icon: ReactNode; label: string; tone?: TileTone; badge?: number }) {
  return (
    <>
      <span className={cn("relative grid size-12 place-items-center rounded-[1.1rem] bg-linear-to-b ring-1 ring-inset [&_svg]:size-[22px] [&_svg]:stroke-[1.75]", CHIP[tone])}>
        {icon}
        {badge ? <span className="absolute -right-1.5 -top-1.5 min-w-[1.15rem] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[1.15rem] tabular-nums text-white ring-2 ring-background">{badge}</span> : null}
      </span>
      <span className="w-full truncate px-0.5 text-xs leading-tight text-foreground/75">{label}</span>
    </>
  );
}
