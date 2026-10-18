import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Quiet } from "./console-ui";

/**
 * The console's tables: plain HTML, drawn on the server. On a phone each row becomes a small card (data-stack, with the column's
 * name written on every cell here on the server, so nothing has to be added in the browser). Empty says so in plain words.
 */
export interface Col { label: string; num?: boolean }

export function DataTable({ cols, rows, empty, more, compact, scroll }: {
  cols: Col[]; rows: { key: string; cells: ReactNode[] }[]; empty: string; more?: string;
  /** Tighter rows and no minimum width, for a table that sits in half a row. */
  compact?: boolean;
  /** The name of a long list: it scrolls inside its panel (about six rows show), the heading stays, and the list can be reached with the keyboard. */
  scroll?: string;
}) {
  if (rows.length === 0) return <Quiet>{empty}</Quiet>;
  return (
    <div>
      <div
        className={cn("overflow-x-auto", scroll && "max-h-[21.5rem] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold")}
        {...(scroll ? { tabIndex: 0, role: "region", "aria-label": scroll } : {})}
      >
        <table data-stack className={cn("w-full text-sm", compact ? "min-w-0" : "min-w-[440px]")}>
          <thead className={cn("text-left text-xs text-muted-foreground", scroll && "sticky top-0 z-10 bg-card")}>
            <tr className="border-b border-border/70">
              {cols.map((c) => <th key={c.label} scope="col" className={cn("font-medium last:pr-0", compact ? "py-1.5 pr-3" : "py-2 pr-4", c.num && "text-right")}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.key} className="align-middle">
                {r.cells.map((cell, i) => (
                  <td key={i} data-label={cols[i]?.label ?? ""} className={cn("last:pr-0", compact ? "py-1.5 pr-3" : "py-2.5 pr-4", cols[i]?.num && "whitespace-nowrap text-right tabular-nums")}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && <p className="mt-2 text-xs text-muted-foreground">{more}</p>}
    </div>
  );
}

/** A small dash for "nothing to say". */
export const Dash = () => <span className="text-muted-foreground">—</span>;
