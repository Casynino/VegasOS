"use client";

import { useState } from "react";
import { ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * THE PROBLEMS inside "Needs your attention", as a compact list (copied from the owner's other console, 2026-10-18: "I do not like the
 * look of the cards — no need for bigger things for no reason"): one line per problem — a coloured bar at the left edge, an icon, the title,
 * one muted line, a chevron; a tap opens what it means, what to do and who fixes it. About three show; the rest scroll, with "scroll for n more"
 * under them (no filter chips, no extra detail: the owner wants it small). Everything arrives already
 * translated (the server does that), so nothing sensitive and no function crosses to the browser.
 */
export interface AttentionRow {
  id: string;
  severity: "fix" | "look";
  title: string;
  summary: string;
  what: string;
  todo: string;
  who: string | null;
  examples: string[];
  link: { href: string; label: string } | null;
}
export interface AttentionLabels { all: string; whatItMeans: string; whatToDo: string; whoFixes: string; whereToLook: string; scrollMore: string }

const VISIBLE_ROWS = 3;

export function AttentionList({ rows, labels }: { rows: AttentionRow[]; labels: AttentionLabels }) {
  const [atEnd, setAtEnd] = useState(false);
  const shown = rows;
  const more = Math.max(0, shown.length - VISIBLE_ROWS);

  return (
    <div>
      <ul
        tabIndex={more > 0 ? 0 : undefined} aria-label={labels.all}
        onScroll={(e) => { const el = e.currentTarget; setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4); }}
        className={cn("divide-y divide-border/60", more > 0 && "max-h-[9.8rem] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold")}
      >
        {shown.map((r) => {
          const Icon = r.severity === "fix" ? CircleAlert : TriangleAlert;
          return (
            <li key={r.id}>
              <details className="group">
                <summary className="relative flex cursor-pointer list-none items-center gap-3 px-4 py-2 marker:content-none hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className={cn("absolute inset-y-2 left-0 w-0.5 rounded-full", r.severity === "fix" ? "bg-rose-500" : "bg-amber-500")} />
                  <Icon className={cn("size-4 shrink-0", r.severity === "fix" ? "text-rose-500" : "text-amber-500")} aria-hidden />
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="block text-sm font-semibold text-foreground">{r.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.summary}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="space-y-3 px-4 pb-3 pt-1 text-sm sm:pl-12">
                  <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{labels.whatItMeans}</p><p className="mt-1 leading-relaxed text-foreground/90">{r.what}</p></div>
                  <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{labels.whatToDo}</p><p className="mt-1 leading-relaxed text-foreground/90">{r.todo}</p></div>
                  {r.who && <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{labels.whoFixes}</p><p className="mt-1 leading-relaxed text-foreground/90">{r.who}</p></div>}
                  {r.examples.length > 0 && <p className="text-xs text-muted-foreground">{labels.whereToLook}: <span className="break-words font-mono">{r.examples.join(" · ")}</span></p>}
                  {r.link && <Link href={r.link.href} className="inline-flex items-center gap-1 text-sm font-medium text-violet-600 underline-offset-4 hover:underline dark:text-violet-400">{r.link.label}<ChevronRight className="size-3.5" aria-hidden /></Link>}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {more > 0 && !atEnd && <p className="border-t border-border/60 py-1.5 text-center text-xs text-muted-foreground">{labels.scrollMore.replace("{n}", String(more))}</p>}
    </div>
  );
}
