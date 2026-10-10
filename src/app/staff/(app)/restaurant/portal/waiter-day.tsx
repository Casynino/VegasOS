import { Armchair, HandPlatter } from "lucide-react";
import { Initials } from "@/components/dashboard/kit";
import type { WaiterDay } from "@/server/services/waiter-day";
import { getT } from "@/i18n/server";

const first = (name: string) => name.replace(/\s*\(.*\)/, "");

/**
 * The manager's view of the waiters today — service facts, not scores and not money: the orders
 * each one handled and served, the customers behind them, what is still going and the tables they
 * look after. Waiters serve; the Restaurant Counter records the payments, so no waiter is shown as
 * a collector here.
 */
export async function WaitersToday({ rows }: { rows: WaiterDay[] }) {
  const t = await getT();
  const busy = rows.filter((r) => r.orders || r.tables.length);
  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h2 className="text-base font-semibold">{t("Waiters today")}</h2>
          <p className="text-xs text-muted-foreground">{t("What each one handled and served — from their orders")}</p>
        </div>
        <span className="text-xs text-muted-foreground">{t.plural(rows.length, "{n} waiter", "{n} waiters")}</span>
      </div>
      {busy.length === 0 ? <p className="px-5 py-6 text-center text-xs text-muted-foreground">{t("No waiter has handled an order yet today.")}</p> : (
        <ul className="mt-3 divide-y divide-border/60 border-t border-border/70">
          {busy.map((r) => (
            <li key={r.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2.5">
                <Initials name={first(r.name)} className="size-8 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{first(r.name)}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t.plural(r.orders, "{n} order handled", "{n} orders handled")} · {t.plural(r.customers, "{n} customer", "{n} customers")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{r.served}</p>
                  <p className="text-[11px] text-muted-foreground">{t("served")}</p>
                </div>
              </div>
              {(r.active > 0 || r.tables.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-10.5 text-[11px]">
                  {r.active > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 font-medium tabular-nums text-sky-700 dark:text-sky-300"><HandPlatter className="size-3" />{t("{n} still going", { n: r.active })}</span>}
                  {r.tables.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground"><Armchair className="size-3" />{r.tables.map((x) => t(x)).join(", ")}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
