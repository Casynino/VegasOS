import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * ONE summary line made of small chips ("29 of 31 checks fine", "0 need fixing", ...): the few figures of a part, side by side,
 * in place of a row of big stat cards. A chip's coloured tone says if it needs a look; its longer explanation is the hover text.
 * Server component: no script.
 */
export type ChipTone = "rose" | "amber" | "emerald" | "slate";

const TONE: Record<ChipTone, string> = {
  rose: "bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300",
  amber: "bg-amber-500/14 text-amber-800 ring-amber-500/35 dark:text-amber-300",
  emerald: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  slate: "bg-muted text-foreground/80 ring-border",
};

export interface Chip { key: string; text: ReactNode; tone?: ChipTone; title?: string }

export function SummaryChips({ label, items, className }: { label: string; items: Chip[]; className?: string }) {
  return (
    <ul aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {items.map((i) => (
        <li key={i.key} title={i.title} className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tabular-nums ring-1 ring-inset", TONE[i.tone ?? "slate"])}>
          {i.text}
        </li>
      ))}
    </ul>
  );
}
