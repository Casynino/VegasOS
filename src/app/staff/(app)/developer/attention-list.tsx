"use client";

import { ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ShowRows } from "@/components/dashboard/show-rows";

/**
 * THE PROBLEMS inside "Needs your attention", as a compact list in the SAME look as every other home (owner, 2026-11-08: "very small, exactly like
 * Super Drive's"): one slim row per problem — a 3 px coloured bar, a 16 px icon, a 13 px title, one 11 px line, a small chevron; a tap opens what
 * it means, what to do and who fixes it. Three rows show (measured from the real rows, so exactly three on every screen); the rest scroll under a
 * slim "Scroll for n more" bar (no filter chips here: the problems have no areas). Everything arrives already translated (the server does that),
 * so nothing sensitive and no function crosses to the browser.
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
export interface AttentionLabels { all: string; whatItMeans: string; whatToDo: string; whoFixes: string; whereToLook: string }

export function AttentionList({ rows, labels }: { rows: AttentionRow[]; labels: AttentionLabels }) {
  return (
    <ShowRows show={3} total={rows.length} compact>
      <ul aria-label={labels.all} className="divide-y divide-border/60">
        {rows.map((r) => {
          const Icon = r.severity === "fix" ? CircleAlert : TriangleAlert;
          return (
            <li key={r.id} data-row>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 marker:content-none hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className={cn("h-7 w-[3px] shrink-0 rounded-full", r.severity === "fix" ? "bg-rose-500" : "bg-amber-500")} />
                  <Icon className={cn("size-4 shrink-0", r.severity === "fix" ? "text-rose-500" : "text-amber-500")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-foreground sm:line-clamp-1">{r.title}</span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">{r.summary}</span>
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="space-y-3 px-3.5 pb-3 pt-1 text-sm sm:pl-11">
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
    </ShowRows>
  );
}
