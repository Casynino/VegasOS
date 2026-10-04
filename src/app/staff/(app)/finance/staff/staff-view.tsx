import { staffPerformance } from "@/server/services/staff-performance";
import { formatTZS } from "@/lib/format";
import { FinanceTabs, PeriodPicker, periodLabel } from "@/components/staff/finance/finance-nav";
import type { BusinessDate } from "@/lib/time/business-date";
import { StaffBoard } from "./staff-board";

/**
 * The team for a period — visibility and fairness, not punishment: who was at work, when they
 * usually start, how much they did and the money they handled. Tap a person for their days.
 */
export async function StaffView({ p }: { p: { key: string; from: BusinessDate; to: BusinessDate } }) {
  const { days, people } = await staffPerformance(p);
  const active = people.filter((x) => x.actions > 0);
  const sum = (k: "actions" | "money" | "checkIns" | "checkOuts" | "bookings" | "orders") => people.reduce((t, x) => t + x[k], 0);
  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/staff" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{periodLabel(p)}</span> · {days.length} day{days.length === 1 ? "" : "s"}</p>
        <PeriodPicker current={p.key} from={p.from} to={p.to} />
      </div>

      <section className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border/70 bg-card sm:grid-cols-3 xl:grid-cols-6 [&>div]:border-border/60 [&>div]:p-4 [&>div]:border-b xl:[&>div]:border-b-0 [&>div:not(:last-child)]:border-r">
        <Figure label="At work" value={`${active.length} of ${people.length}`} sub="staff who did something" />
        <Figure label="Actions" value={sum("actions").toLocaleString("en-US")} sub="bookings, payments, orders, rooms…" />
        <Figure label="Money handled" value={formatTZS(sum("money"))} sub="payments & sales they received" tone="text-emerald-600 dark:text-emerald-400" />
        <Figure label="Check-ins · outs" value={`${sum("checkIns")} · ${sum("checkOuts")}`} />
        <Figure label="Bookings made" value={String(sum("bookings"))} />
        <Figure label="Orders placed" value={String(sum("orders"))} sub="restaurant & bar" />
      </section>

      <StaffBoard people={people} days={days} from={p.from} to={p.to} />
    </div>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      {sub && <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}
