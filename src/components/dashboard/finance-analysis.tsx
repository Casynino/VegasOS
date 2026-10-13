import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { COVER_CAP_DAYS, coverDays, MIN_DAYS_FOR_PACE, percent, type Insight } from "@/lib/finance-insights";
import type { ReceivablesAging, MonthRow } from "@/server/services/finance-outlook";
import type { supplierSnapshot } from "@/server/services/finance-home";
import { MoneyChart, type MoneyPoint } from "@/components/staff/finance/money-chart";
import { Panel, PanelLink } from "./kit";
import { DataTable, FigureCards, HBars, InsightList, KpiCards, SplitBar } from "./finance-panels";

/**
 * The two analysis views of Finance's Home — the cash outlook (what the money looks like from here: what is in the accounts, what is
 * owed to the hotel and how late, what the hotel owes and when, how fast money goes) and the trends (the figures that show how the
 * hotel is doing, six months, what moved against the period before, which days earn most). Words are made here, in the reader's
 * language; every figure comes in already worked out by the shared money services.
 */

const shortDay = (d: string, t: T) => new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const weekdayName = (weekday: number, t: T) => new Intl.DateTimeFormat(t.intl, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

// ───────────────────────── What stands out ─────────────────────────

/** One insight as a sentence. */
function insightText(i: Insight, t: T): string {
  const amount = formatTZS(i.amount ?? 0);
  const pct = i.pct ?? 0;
  switch (i.kind) {
    case "noExpenses": return t("No expenses were recorded in this period, so the {amount} earned is not a profit yet — costs nobody recorded are not in it.", { amount });
    case "netUp": return i.pct != null ? t("Earned is {amount} above the expenses recorded — {pct}% of what was earned.", { amount, pct }) : t("Earned is {amount} above the expenses recorded.", { amount });
    case "netDown": return t("The expenses recorded are {amount} above what was earned in this period.", { amount });
    case "earnedUp": return t("Earned is up {pct}% on the previous period.", { pct });
    case "earnedDown": return t("Earned is down {pct}% on the previous period.", { pct });
    case "expensesUp": return i.name ? t("Expenses are up {pct}% on the previous period — mostly {name}, {amount} more.", { pct, name: t(i.name), amount }) : t("Expenses are up {pct}% on the previous period.", { pct });
    case "expensesDown": return t("Expenses are down {pct}% on the previous period.", { pct });
    case "topCategory": return t("{name} is the biggest expense — {pct}% of what was spent.", { name: t(i.name ?? ""), pct });
    case "owedLate": return t.plural(i.n ?? 0, "{amount} owed to the hotel is more than a week late ({n} bill).", "{amount} owed to the hotel is more than a week late ({n} bills).", { amount });
    case "suppliersOverdue": return t("{amount} owed to suppliers is past its due date.", { amount });
    case "suppliersDue": return t("{amount} falls due to suppliers within a week.", { amount });
    case "suppliersShort": return t("{amount} is due to suppliers now or within a week, and the accounts hold {money}.", { amount, money: formatTZS(i.money ?? 0) });
    case "cover": return t.plural(i.days ?? 0, "The accounts cover about {n} day of spending at the recent pace ({amount} a day, from the last {days} days).", "The accounts cover about {n} days of spending at the recent pace ({amount} a day, from the last {days} days).", { amount, days: i.n ?? 0 });
    case "discounts": return t("Room discounts took {pct}% of the room price ({amount} given away).", { pct, amount });
    case "cashShare": return t("{pct}% of the money received was cash — {amount}. Keep it counted and banked.", { pct, amount });
  }
}

export function InsightsPanel({ insights, t, period }: { insights: Insight[]; t: T; period: string }) {
  if (insights.length === 0) return null;
  return (
    <Panel title={t("What stands out")} subtitle={t("Read from the figures below — nothing is guessed. {period}", { period })}>
      <InsightList items={insights.map((i) => ({ id: i.id, tone: i.tone, text: insightText(i, t), href: i.href }))} />
    </Panel>
  );
}

// ───────────────────────── Cash outlook ─────────────────────────

type SupplierSnapshot = Awaited<ReturnType<typeof supplierSnapshot>>;

export interface OutlookProps {
  t: T;
  /** What the accounts hold by the hotel's own records. */
  money: number;
  aging: ReceivablesAging | null;
  suppliers: SupplierSnapshot | null;
  pace: { days: number; total: number; perDay: number } | null;
  pending: { count: number; amount: number };
  booked: { nights: number; amount: number } | null;
  links: { receivables?: string; procurement?: string; accounts?: string; expenses?: string };
}

const AGE_COLOR = { current: "#94a3b8", week: "#f59e0b", month: "#f97316", older: "#e11d48" } as const;
const DUE_COLOR = { overdue: "#e11d48", week: "#f59e0b", month: "#0ea5e9", later: "#94a3b8", none: "#cbd5e1" } as const;

export function OutlookView({ t, money, aging, suppliers, pace, pending, booked, links }: OutlookProps) {
  const enough = pace != null && pace.days >= MIN_DAYS_FOR_PACE;
  const cover = enough ? coverDays(money, pace.perDay) : null;
  const coverWords = cover === null ? "—" : cover > COVER_CAP_DAYS ? t("Over a year") : String(cover);
  const ageLabel = { current: t("Not late yet"), week: t("1–7 days late"), month: t("8–30 days late"), older: t("More than 30 days late") } as const;
  const dueLabel = { overdue: t("Past its due date"), week: t("Due within a week"), month: t("Due in 8–30 days"), later: t("Due later than that"), none: t("No due date set") } as const;
  const bills = (n: number) => (n > 0 ? t.plural(n, "{n} bill", "{n} bills") : undefined);
  const invoices = (n: number) => (n > 0 ? t.plural(n, "{n} invoice", "{n} invoices") : undefined);

  return (
    <>
      <Panel title={t("Where the money stands")} subtitle={t("Side by side and never added: what is owed to the hotel is not money yet, and what is owed to suppliers is not yet spent")}
        action={links.accounts ? <PanelLink href={links.accounts}>{t("Accounts")}</PanelLink> : null}>
        <FigureCards items={[
          { label: t("In the accounts"), value: formatTZS(money), sub: t("the hotel's own records") },
          ...(aging ? [{ label: t("Owed to the hotel"), value: formatTZS(aging.total), sub: t("not money yet"), tone: aging.lateOverWeek.amount > 0 ? ("warn" as const) : undefined }] : []),
          ...(suppliers ? [{ label: t("Owed to suppliers"), value: formatTZS(suppliers.owed.amount), sub: t.plural(suppliers.owed.count, "{n} invoice", "{n} invoices"), tone: suppliers.overdue.count > 0 ? ("bad" as const) : undefined }] : []),
          { label: t("Expenses waiting for approval"), value: formatTZS(pending.amount), sub: t.plural(pending.count, "{n} expense", "{n} expenses"), tone: pending.count > 0 ? ("warn" as const) : undefined },
          { label: t("Days the money lasts"), value: coverWords,
            sub: cover !== null && pace ? t("at the recent pace of {amount} a day", { amount: formatTZS(Math.round(pace.perDay)) })
              : enough ? t("nothing was spent recently") : t("needs {n} days of records", { n: MIN_DAYS_FOR_PACE }),
            tone: cover !== null && cover < 14 ? ("bad" as const) : cover !== null && cover < 30 ? ("warn" as const) : undefined },
        ]} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {aging && (
          <Panel title={t("Who owes the hotel — how late")} subtitle={t("A guest's bill is due the day they leave, a company's on its due date")}
            action={links.receivables ? <PanelLink href={links.receivables}>{t("Who owes us")}</PanelLink> : null}>
            <SplitBar total={aging.total} empty={t("Nobody owes the hotel anything.")}
              rows={aging.rows.map((r) => ({ label: ageLabel[r.bucket], amount: r.amount, count: r.count, color: AGE_COLOR[r.bucket], note: bills(r.count) }))} />
          </Panel>
        )}
        {suppliers && (
          <Panel title={t("What the hotel owes — when it falls due")} subtitle={t("Supplier invoices not paid in full")}
            action={links.procurement ? <PanelLink href={links.procurement}>{t("Procurement")}</PanelLink> : null}>
            <SplitBar total={suppliers.owed.amount} empty={t("Nobody is owed anything.")}
              rows={suppliers.due.map((r) => ({ label: dueLabel[r.bucket], amount: r.amount, count: r.count, color: DUE_COLOR[r.bucket], note: invoices(r.count) }))} />
            {suppliers.next.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Next to pay")}</p>
                <DataTable label={t("Next to pay")} empty="" head={[t("Supplier"), t("Due"), t("Owed")]} right={[2]}
                  rows={suppliers.next.map((n) => [
                    <span key="s" className="font-medium">{n.supplier}<span className="block text-[11px] font-normal text-muted-foreground">{n.number}{n.disputed ? ` · ${t("disputed")}` : ""}</span></span>,
                    <span key="d" className={cn("whitespace-nowrap", n.late ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{shortDay(n.dueOn, t)}{n.late ? ` · ${t("late")}` : ""}</span>,
                    formatTZS(n.owed),
                  ])} />
              </div>
            )}
          </Panel>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("How fast the money goes")} subtitle={pace ? t("Recorded expenses of the last {n} closed days — today is left out until it ends", { n: pace.days }) : t("Today is left out until it ends")}
          action={links.expenses ? <PanelLink href={links.expenses}>{t("Expenses")}</PanelLink> : null}>
          {pace && enough ? (
            <FigureCards items={[
              { label: t("Spent a day, on average"), value: formatTZS(Math.round(pace.perDay)) },
              { label: t("Spent in all"), value: formatTZS(pace.total), sub: t.plural(pace.days, "{n} day", "{n} days") },
              { label: t("Days the money lasts"), value: coverWords, tone: cover !== null && cover < 14 ? "bad" : cover !== null && cover < 30 ? "warn" : undefined },
            ]} />
          ) : (
            <p className="text-sm text-muted-foreground">{pace ? t.plural(pace.days, "Only {n} closed day of records so far — a daily pace needs at least {min}.", "Only {n} closed days of records so far — a daily pace needs at least {min}.", { min: MIN_DAYS_FOR_PACE }) : t("No day has closed since the records began — a daily pace needs at least {min} days.", { min: MIN_DAYS_FOR_PACE })}</p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">{t("Only costs that were recorded count — a cost nobody recorded is not in this pace.")}</p>
        </Panel>

        {booked && (
          <Panel title={t("Rooms booked ahead")} subtitle={t("The next 30 nights — money still to be earned, not money received")}>
            {booked.nights > 0 ? (
              <FigureCards items={[
                { label: t("Room nights booked"), value: String(booked.nights) },
                { label: t("Room income on the books"), value: formatTZS(booked.amount) },
              ]} />
            ) : <p className="text-sm text-muted-foreground">{t("No rooms are booked for the next 30 nights.")}</p>}
          </Panel>
        )}
      </div>
    </>
  );
}

// ───────────────────────── Trends ─────────────────────────

export interface Movement { name: string; now: number; before: number }

export interface TrendsProps {
  t: T;
  today: string;
  kpis: { label: string; value: string; change?: React.ReactNode; sub?: string }[];
  months: MonthRow[];
  streams: Movement[];
  categories: Movement[];
  /** The average earned on each day of the week over closed days; null when there are too few days to say. */
  weekdays: { weekday: number; average: number; days: number }[] | null;
  closedDays: number;
  weeks: number;
  links: { ledger?: string; expenses?: string };
}

export const MIN_DAYS_FOR_WEEK = 14;

function MovementTable({ rows, label, costs, t }: { rows: Movement[]; label: string; costs?: boolean; t: T }) {
  const total = rows.reduce((s, r) => s + r.now, 0);
  const shown = rows.filter((r) => r.now > 0 || r.before > 0).sort((a, b) => b.now - a.now || b.before - a.before);
  return (
    <DataTable label={label} empty={t("Nothing in this period or the one before.")} head={[label, t("This period"), t.ctx("money", "Before"), t.ctx("money", "Change"), t.ctx("money", "Share")]} right={[1, 2, 3, 4]}
      rows={shown.map((r) => {
        const diff = r.now - r.before;
        const worse = costs ? diff > 0 : diff < 0;
        return [
          <span key="n" className="font-medium">{t(r.name)}</span>,
          formatTZS(r.now),
          <span key="b" className="text-muted-foreground">{r.before > 0 ? formatTZS(r.before) : "—"}</span>,
          r.before === 0 && r.now > 0 ? <span key="c" className="text-muted-foreground">{t.ctx("money", "new")}</span>
            : diff === 0 ? <span key="c" className="text-muted-foreground">—</span>
            : <span key="c" className={cn("whitespace-nowrap font-medium", worse ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{sign(diff)}{formatTZS(Math.abs(diff))}{r.before > 0 && <span className="ml-1 text-[11px] font-normal">({sign(diff)}{Math.round((Math.abs(diff) / r.before) * 100)}%)</span>}</span>,
          <span key="s" className="text-muted-foreground">{percent(r.now, total) ?? 0}%</span>,
        ];
      })} />
  );
}

export function TrendsView({ t, kpis, months, streams, categories, weekdays, closedDays, weeks, links }: TrendsProps) {
  const month = (key: string, style: "short" | "long") => new Date(`${key}-01T00:00:00Z`).toLocaleDateString(t.intl, style === "short" ? { month: "short", timeZone: "UTC" } : { month: "long", year: "numeric", timeZone: "UTC" });
  const points: MoneyPoint[] = months.map((m) => ({ key: m.key, label: month(m.key, "short"), income: m.income, expenses: m.expenses, received: m.received }));
  const best = weekdays ? Math.max(0, ...weekdays.map((d) => d.average)) : 0;
  return (
    <>
      <Panel title={t("How the hotel is doing")} subtitle={t("Each figure against the period before")}>
        <KpiCards items={kpis} />
      </Panel>

      <Panel title={t("The last six months")} subtitle={t("Month by month — this month so far; the first month starts when the hotel's records began")}
        action={links.ledger ? <PanelLink href={links.ledger}>{t("Ledger")}</PanelLink> : null}>
        {months.length === 0 ? <p className="text-sm text-muted-foreground">{t("No records yet.")}</p> : (
          <div className="space-y-5">
            <MoneyChart data={points} />
            <DataTable label={t("The last six months")} empty="" head={[t.ctx("money", "Month"), t("Earned"), t("Received"), t("Expenses"), t("Net result"), t("Spent of earned")]} right={[1, 2, 3, 4, 5]}
              rows={[...months].reverse().map((m) => {
                const net = m.income - m.expenses;
                return [
                  <span key="m" className="font-medium">{month(m.key, "long")}</span>, formatTZS(m.income), formatTZS(m.received), formatTZS(m.expenses),
                  <span key="n" className={cn("font-medium", net < 0 && "text-rose-600 dark:text-rose-400")}>{formatTZS(net)}</span>,
                  <span key="p" className="text-muted-foreground">{percent(m.expenses, m.income) != null ? `${percent(m.expenses, m.income)}%` : "—"}</span>,
                ];
              })} />
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t("Income against the period before")} subtitle={t("What each part of the business earned")}>
          <MovementTable rows={streams} label={t("Income")} t={t} />
        </Panel>
        <Panel title={t("Expenses against the period before")} subtitle={t("What each kind of cost took")} action={links.expenses ? <PanelLink href={links.expenses}>{t("Expenses")}</PanelLink> : null}>
          <MovementTable rows={categories} label={t("Expenses")} costs t={t} />
        </Panel>
      </div>

      <Panel title={t("Which days earn most")} subtitle={weekdays ? t("The average earned on each day of the week — the last {n} weeks, closed days only", { n: weeks }) : t("The average earned on each day of the week")}>
        {weekdays ? (
          <HBars empty={t("Nothing was earned in these days.")} rows={weekdays.map((d) => ({
            label: weekdayName(d.weekday, t), value: d.average, sub: t.plural(d.days, "{n} day", "{n} days"), color: d.average > 0 && d.average === best ? "#10b981" : "#8b5cf6",
          }))} />
        ) : (
          <p className="text-sm text-muted-foreground">{t.plural(closedDays, "Only {n} closed day of records so far — this needs at least {min}.", "Only {n} closed days of records so far — this needs at least {min}.", { min: MIN_DAYS_FOR_WEEK })}</p>
        )}
      </Panel>
    </>
  );
}
