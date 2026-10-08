import { staffPerformance } from "@/server/services/staff-performance";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import { FinanceTabs, PeriodPicker, periodLabel } from "@/components/staff/finance/finance-nav";
import type { BusinessDate } from "@/lib/time/business-date";
import { StaffBoard } from "./staff-board";

/**
 * The team for a period — visibility and fairness, not punishment: who was at work, when they
 * usually start, how much they did and the money they handled. Tap a person for their days.
 */
export async function StaffView({ p }: { p: { key: string; from: BusinessDate; to: BusinessDate } }) {
  const t = await getT();
  const { days, people } = await staffPerformance(p);
  const active = people.filter((x) => x.actions > 0);
  const sum = (k: "actions" | "money" | "checkIns" | "checkOuts" | "bookings" | "orders") => people.reduce((s, x) => s + x[k], 0);
  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/staff" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{periodLabel(p, t)}</span> · {t.plural(days.length, "{n} day", "{n} days")}</p>
        <PeriodPicker current={p.key} from={p.from} to={p.to} />
      </div>

      <section className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border/70 bg-card sm:grid-cols-3 xl:grid-cols-6 [&>div]:border-border/60 [&>div]:p-4 [&>div]:border-b xl:[&>div]:border-b-0 [&>div:not(:last-child)]:border-r">
        <Figure label={t("At work")} value={t("{n} of {total}", { n: active.length, total: people.length })} sub={t("staff who did something")} />
        <Figure label={t("Actions")} value={sum("actions").toLocaleString("en-US")} sub={t("bookings, payments, orders, rooms…")} />
        <Figure label={t("Money handled")} value={formatTZS(sum("money"))} sub={t("payments & sales they received")} tone="text-emerald-600 dark:text-emerald-400" />
        <Figure label={t("Check-ins · outs")} value={`${sum("checkIns")} · ${sum("checkOuts")}`} />
        <Figure label={t("Bookings made")} value={String(sum("bookings"))} />
        <Figure label={t("Orders placed")} value={String(sum("orders"))} sub={t("restaurant & bar")} />
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
