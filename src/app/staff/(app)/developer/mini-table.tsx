import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A compact table for the system parts: small rows, and a column that is empty for EVERY row is not drawn at all (a cell given as
 * null/undefined/false is "empty"; in a column that is drawn it shows a dash). More than SCROLL_ABOVE rows scroll inside the table
 * (about six rows visible, reachable by keyboard) instead of making the page longer. On a phone each row becomes a small card (data-stack).
 */
export interface MiniCol { label: string; num?: boolean }
export interface MiniRow { key: string; cells: ReactNode[] }

/** How many rows show before the table scrolls (with this row height, about 21.5 rem). */
const SCROLL_ABOVE = 6;

const isEmpty = (cell: ReactNode) => cell === null || cell === undefined || cell === false;

export function MiniTable({ cols, rows, label }: { cols: MiniCol[]; rows: MiniRow[]; label: string }) {
  const drawn = cols.map((_, i) => i).filter((i) => rows.some((r) => !isEmpty(r.cells[i])));
  const scrolls = rows.length > SCROLL_ABOVE;
  return (
    <div
      {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
      className={cn("overflow-x-auto", scrolls && "max-h-[21.5rem] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold")}
    >
      <table data-stack className="w-full text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className={cn("text-left text-xs text-muted-foreground", scrolls && "sticky top-0 bg-card")}>
          <tr className="border-b border-border/70">
            {drawn.map((i) => <th key={cols[i].label} scope="col" className={cn("py-1.5 pr-4 font-medium last:pr-0", cols[i].num && "text-right")}>{cols[i].label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.key} className="align-middle">
              {drawn.map((i) => (
                <td key={i} data-label={cols[i].label} className={cn("py-1.5 pr-4 last:pr-0", cols[i].num && "whitespace-nowrap text-right tabular-nums")}>
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
