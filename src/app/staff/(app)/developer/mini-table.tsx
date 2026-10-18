import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The system parts' table, drawn like the owner's other consoles (Target, ORA): it runs edge to edge inside its panel (the panel gives it
 * `TABLE_BLEED` as its body), a line under the panel's heading, a header row in small muted capitals, clean row separators. A cell given as
 * null/undefined/false is "empty" and shows a dash; a column that is empty for EVERY row is not drawn, unless `keepEmpty` says the table
 * always has all its columns (the jobs and the webhooks). More than SCROLL_ABOVE rows scroll inside the panel (a region with a label and a
 * focus ring) instead of making the page longer. On a phone each row becomes a small card (data-stack).
 */
export interface MiniCol { label: string; /** A figure: right-aligned. */ num?: boolean; /** Right-aligned text (the last column of a status). */ right?: boolean }
export interface MiniRow { key: string; cells: ReactNode[] }

/** What a panel gives its body so a table or a list runs to the panel's edges (on a phone the panel keeps its padding). */
export const TABLE_BLEED = "sm:-mx-6 sm:-mb-6";
/** How many rows show before the table scrolls (about 24 rem). */
export const SCROLL_ABOVE = 8;

const isEmpty = (cell: ReactNode) => cell === null || cell === undefined || cell === false;

export function MiniTable({ cols, rows, label, keepEmpty }: { cols: MiniCol[]; rows: MiniRow[]; label: string; keepEmpty?: boolean }) {
  const drawn = cols.map((_, i) => i).filter((i) => keepEmpty || rows.some((r) => !isEmpty(r.cells[i])));
  const scrolls = rows.length > SCROLL_ABOVE;
  const aligned = (i: number) => cols[i].num || cols[i].right;
  return (
    <div
      {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
      className={cn("overflow-x-auto border-t border-border/60", scrolls && "max-h-[24rem] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold")}
    >
      <table data-stack className="w-full text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className={cn("text-left", scrolls && "sticky top-0 z-10 bg-card")}>
          <tr className="border-b border-border/60">
            {drawn.map((i) => (
              <th key={cols[i].label} scope="col" className={cn("py-3 pl-0 pr-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground last:pr-0 sm:first:pl-6 sm:last:pr-6", aligned(i) && "text-right")}>{cols[i].label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.key} className="align-middle">
              {drawn.map((i) => (
                <td key={i} data-label={cols[i].label} className={cn("py-3.5 pl-0 pr-4 last:pr-0 sm:first:pl-6 sm:last:pr-6", aligned(i) && "whitespace-nowrap text-right tabular-nums")}>
                  {isEmpty(r.cells[i]) ? <span className="text-muted-foreground">—</span> : r.cells[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A panel's one short quiet line (an empty panel: its title and subtitle, then this and nothing else). Green for "all is well", muted otherwise. */
export function EmptyLine({ children, hint, tone = "muted" }: { children: ReactNode; hint?: ReactNode; tone?: "good" | "muted" }) {
  return (
    <div className="border-t border-border/60 px-1 pb-1 pt-5 text-center sm:px-6 sm:pb-6">
      <p className={cn("text-sm", tone === "good" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{children}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
