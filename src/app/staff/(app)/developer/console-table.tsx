import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Quiet } from "./console-ui";

/**
 * The console's tables: plain HTML, drawn on the server. On a phone each row becomes a small card (data-stack, with the column's
 * name written on every cell here on the server, so nothing has to be added in the browser). Empty says so in plain words.
 */
export interface Col { label: string; num?: boolean }

export function DataTable({ cols, rows, empty, more }: { cols: Col[]; rows: { key: string; cells: ReactNode[] }[]; empty: string; more?: string }) {
  if (rows.length === 0) return <Quiet>{empty}</Quiet>;
  return (
    <div>
      <div className="overflow-x-auto">
        <table data-stack className="w-full min-w-[440px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-border/70">
              {cols.map((c) => <th key={c.label} scope="col" className={cn("py-2 pr-4 font-medium last:pr-0", c.num && "text-right")}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.key} className="align-middle">
                {r.cells.map((cell, i) => (
                  <td key={i} data-label={cols[i]?.label ?? ""} className={cn("py-2.5 pr-4 last:pr-0", cols[i]?.num && "whitespace-nowrap text-right tabular-nums")}>{cell}</td>
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
