import { Armchair, HandPlatter } from "lucide-react";
import { Initials } from "@/components/dashboard/kit";
import type { WaiterDay } from "@/server/services/waiter-day";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const first = (name: string) => name.replace(/\s*\(.*\)/, "");

/**
 * The manager's view of the waiters today — service facts, not scores and not money: the orders
 * each one handled and served, the customers behind them, what is still going and the tables they
 * look after. Waiters serve; the Restaurant Counter records the payments, so no waiter is shown as
 * a collector here.
 */
export function WaitersToday({ rows }: { rows: WaiterDay[] }) {
  const busy = rows.filter((r) => r.orders || r.tables.length);
  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h2 className="text-base font-semibold">Waiters today</h2>
          <p className="text-xs text-muted-foreground">What each one handled and served — from their orders</p>
        </div>
        <span className="text-xs text-muted-foreground">{plural(rows.length, "waiter")}</span>
      </div>
      {busy.length === 0 ? <p className="px-5 py-6 text-center text-xs text-muted-foreground">No waiter has handled an order yet today.</p> : (
        <ul className="mt-3 divide-y divide-border/60 border-t border-border/70">
          {busy.map((r) => (
            <li key={r.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2.5">
                <Initials name={first(r.name)} className="size-8 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{first(r.name)}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {plural(r.orders, "order")} handled · {plural(r.customers, "customer")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{r.served}</p>
                  <p className="text-[11px] text-muted-foreground">served</p>
                </div>
              </div>
              {(r.active > 0 || r.tables.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-10.5 text-[11px]">
                  {r.active > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 font-medium tabular-nums text-sky-700 dark:text-sky-300"><HandPlatter className="size-3" />{r.active} still going</span>}
                  {r.tables.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground"><Armchair className="size-3" />{r.tables.join(", ")}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
