"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShowRows } from "./show-rows";

export type AttentionTone = "rose" | "amber" | "gold" | "sky" | "slate";
export interface AttentionRow { tone: AttentionTone; icon: ReactNode; title: string; detail?: string; meta?: string; href: string; group?: string }

const TONE: Record<AttentionTone, { bar: string; icon: string }> = {
  rose: { bar: "bg-rose-500", icon: "text-rose-500" },
  amber: { bar: "bg-amber-500", icon: "text-amber-500" },
  gold: { bar: "bg-[oklch(0.72_0.12_80)]", icon: "text-[oklch(0.62_0.12_80)] dark:text-[oklch(0.78_0.12_80)]" },
  sky: { bar: "bg-sky-500", icon: "text-sky-500" },
  slate: { bar: "bg-slate-400", icon: "text-slate-500 dark:text-slate-400" },
};

/**
 * Things that need someone, as one card: area chips on top (All · Front desk ·
 * Money …), then one slim row per item — coloured bar, icon, what and why, and
 * a tap through to fix it. Three rows in view; the rest are a scroll away.
 */
export function AttentionList({ items, show = 3 }: { items: AttentionRow[]; show?: number }) {
  const groups = [...new Set(items.map((i) => i.group ?? "Other"))];
  const [pick, setPick] = useState<string | null>(null);
  const on = pick && groups.includes(pick) ? pick : null;
  const rows = on ? items.filter((i) => (i.group ?? "Other") === on) : items;
  const chip = (label: string, count: number, active: boolean, value: string | null) => (
    <button key={label} type="button" onClick={() => setPick(value)} aria-pressed={active}
      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-sky-500 bg-sky-500 text-white" : "border-border bg-card text-foreground/80 hover:bg-muted")}>
      {label}<span className={cn("tabular-nums", active ? "text-white/80" : "text-muted-foreground")}>{count}</span>
    </button>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="flex gap-1.5 overflow-x-auto border-b border-border/70 px-4 py-2.5 [scrollbar-width:none]">
        {chip("All", items.length, !on, null)}
        {groups.map((g) => chip(g, items.filter((i) => (i.group ?? "Other") === g).length, on === g, g))}
      </div>
      <ShowRows key={on ?? "all"} show={show} total={rows.length}>
        <ul className="divide-y divide-border/60">
          {rows.map((a) => (
            <li key={a.title} data-row>
              <Link href={a.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5">
                <span aria-hidden className={cn("h-8 w-[3px] shrink-0 rounded-full", TONE[a.tone].bar)} />
                <span className={cn("shrink-0 [&_svg]:size-[18px]", TONE[a.tone].icon)}>{a.icon}</span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block text-sm font-semibold text-foreground">{a.title}</span>
                  {a.detail && <span className="block truncate text-xs text-muted-foreground">{a.detail}</span>}
                </span>
                {a.meta && <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{a.meta}</span>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </ShowRows>
    </div>
  );
}
