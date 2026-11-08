"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
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
 * Things that need someone — the SAME look as Super Drive's "Needs your attention" (owner, 2026-11-08: "very small, exactly like that one"):
 * area chips ABOVE the card as flat 11 px pills (All · Front desk · Money …), then in the card one slim row per item — a 3 px coloured bar,
 * a 16 px icon, a 13 px title and an 11 px line under it, and a small chevron. Three rows in view; the rest are a scroll away under a slim
 * "Scroll for n more" bar. On a phone the title may take two lines and the time ("43 d waiting") sits in front of the detail line.
 */
/** Rows with no area are grouped under this (its English is the key; shown in the reader's language). */
const OTHER = msg("Other");

export function AttentionList({ items, show = 3 }: { items: AttentionRow[]; show?: number }) {
  const t = useT();
  const groups = [...new Set(items.map((i) => i.group ?? OTHER))];
  const [pick, setPick] = useState<string | null>(null);
  const on = pick && groups.includes(pick) ? pick : null;
  const rows = on ? items.filter((i) => (i.group ?? OTHER) === on) : items;
  const chip = (label: string, count: number, active: boolean, value: string | null) => (
    <button key={label} type="button" onClick={() => setPick(value)} aria-pressed={active}
      className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors sm:shrink",
        active ? "bg-sky-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground")}>
      {t(label)} <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );

  return (
    <div>
      {/* one line that slides sideways on a phone; wraps on a computer */}
      <div className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
        {chip(msg("All"), items.length, !on, null)}
        {groups.map((g) => chip(g, items.filter((i) => (i.group ?? OTHER) === g).length, on === g, g))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <ShowRows key={on ?? "all"} show={show} total={rows.length} compact>
          <ul className="divide-y divide-border/60">
            {rows.map((a) => (
              <li key={a.title} data-row>
                <Link href={a.href} className="group flex items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-muted/40">
                  <span aria-hidden className={cn("h-7 w-[3px] shrink-0 rounded-full", TONE[a.tone].bar)} />
                  <span className={cn("shrink-0 [&_svg]:size-4", TONE[a.tone].icon)}>{a.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-foreground sm:line-clamp-1">{a.title}</span>
                    {(a.detail || a.meta) && (
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                        {a.meta && <span className="font-medium text-foreground/80 sm:hidden">{a.meta}{a.detail ? " · " : ""}</span>}
                        {a.detail}
                      </span>
                    )}
                  </span>
                  {a.meta && <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:block">{a.meta}</span>}
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </ShowRows>
      </div>
    </div>
  );
}
